// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The watcher on the page a live view shows (issue #124, WI-17b; part 3 §3.4).
 *
 * Extracted from `wirePreviewLifecycle`, which watched the entry file for the
 * life of the view. A same-tab move changes the page inside the same view, so
 * the watch has to follow it: `retarget(path)` closes the old watcher and opens
 * one on the new page. A late event from the old watcher – one may still arrive
 * after its `close()` was asked for – is ignored, so saving the page the tab
 * left cannot reload, or mark deleted, the page it shows now.
 *
 * In production the watcher is a freshness tracker on the shared watch layer
 * (#478 plan S17, `freshness/mainTrackedWatch.ts`, `preview` profile): a save
 * of the page reloads it (`onChange`, through the reload policy, whose
 * coalesce is the preview's only burst control – F21); a confirmed delete – a
 * rename unlinks the old path too – marks it deleted (`onDeleted`). The page
 * coming back (a branch switch, a merge) is reported by the tracker itself as
 * a change, which reloads it and clears the failed state (#450): there is no
 * probe loop here any more. A watch that stopped for good, waits for a slot,
 * or a page that cannot be read is reported to `onProblem` for the failure
 * badge (§ 3.6). The page is checked on window focus, on a power resume and
 * when the view is shown again (`setVisible`).
 *
 * A watcher error is not a page failure: it is logged by the error's name and
 * code, with the file name redacted and the panel by digest (QG-7 S3, S4), and
 * the next load surfaces a genuinely missing file.
 */
import { basename } from 'node:path'
import { ErrorCode } from '../../../shared/errors'
import type { CheckReason } from '../../../shared/freshness/freshnessTypes'
import type { PreviewFailureInput, PreviewFailureType } from '../../../shared/ipc/preview-types'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import { redactPath } from '../../utils/redactUserInput'
import type { TrackedWatchProblem } from '../freshness/mainTrackedWatch'
import type { PreviewFileWatcherHandle } from './previewViewLifecycle'

/** What the page's watcher reports. */
export interface PreviewEntryWatchHandlers {
  onChange(): void
  onUnlink(): void
  onError(error: unknown): void
  /** The watch stopped, waits for a slot, or the page cannot be read (§ 3.6). */
  onProblem?(problem: TrackedWatchProblem): void
}

/** A page watcher; the tracked one also checks on demand and when shown. */
export type PreviewEntryWatcherHandle = PreviewFileWatcherHandle & {
  check?(reason: CheckReason): void
  setVisible?(visible: boolean): void
}

/** Opens a single-file watcher; the service's `createEntryWatcher`. */
export type PreviewEntryWatcherFactory = (
  filePath: string,
  handlers: PreviewEntryWatchHandlers
) => PreviewEntryWatcherHandle

/** What the entry watch needs from its view. */
export interface PreviewEntryWatchDeps {
  readonly panelId: string
  /** The page the view opens on. Watched at once: a throw is the construction's to unwind. */
  readonly initialPath: string
  readonly createEntryWatcher: PreviewEntryWatcherFactory
  /** The page on screen was saved, or came back after a delete. */
  readonly onChange: () => void
  /** The page on screen was deleted, or renamed away. */
  readonly onDeleted: () => void
  /** Something to tell the reader about the page's watch (the failure badge). */
  readonly onProblem?: (problem: TrackedWatchProblem) => void
}

/** The watch on one live view's page. */
export interface PreviewEntryWatch {
  /** Watch `path` instead of the page watched now; the same path changes nothing. */
  retarget(path: string): void
  /** The view was shown or hidden: a shown page is checked (S1). */
  setVisible(visible: boolean): void
  /** Check the page against the version last seen. */
  check(reason: CheckReason): void
  /** Close the watcher. Nothing is reported afterwards; a failed close rejects. */
  dispose(): Promise<void>
}

/** Only the error's name: a watcher's message can carry the path. */
function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

/** A Node errno code such as `EMFILE`, when the error carries one as a string. */
function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }
  return typeof error.code === 'string' ? error.code : undefined
}

/** The badge entry each watch problem shows (§ 3.6 of #478's plan). */
const PROBLEM_FAILURE: Readonly<Record<TrackedWatchProblem, PreviewFailureType>> = {
  stopped: 'auto-refresh-stopped',
  queued: 'watch-limit',
  unreadable: 'file-unreadable',
  limited: 'live-refresh-limited'
}

/** The failure-badge entry for a problem with the page at `pagePath`; it names the file, never its folder. */
export function entryProblemFailure(problem: TrackedWatchProblem, pagePath: string): PreviewFailureInput {
  return {
    type: PROBLEM_FAILURE[problem],
    resourceUrlOrHost: basename(pagePath),
    reasonCode: problem === 'unreadable' ? ErrorCode.PATH_NOT_ACCESSIBLE : ErrorCode.UNKNOWN_ERROR
  }
}

/** Start watching a live view's first page. */
export function createPreviewEntryWatch(deps: PreviewEntryWatchDeps): PreviewEntryWatch {
  // The panel id is the page's readable path: log lines carry its digest.
  const loggedPanelId = stablePathDigest(deps.panelId)
  // Each watcher reports only while it is the latest one opened.
  let serial = 0
  let disposed = false
  let watchedPath = deps.initialPath

  function open(path: string): PreviewEntryWatcherHandle {
    serial += 1
    const mine = serial
    const current = (): boolean => !disposed && mine === serial
    return deps.createEntryWatcher(path, {
      onChange: () => {
        if (current()) deps.onChange()
      },
      onUnlink: () => {
        if (current()) deps.onDeleted()
      },
      onError: (error) => {
        logger.warn('Preview entry watcher error', {
          panelId: loggedPanelId,
          path: redactPath(path),
          error: nameOf(error),
          code: codeOf(error)
        })
      },
      onProblem: (problem) => {
        if (current()) deps.onProblem?.(problem)
      }
    })
  }

  let handle: PreviewEntryWatcherHandle | null = open(watchedPath)

  /**
   * Close the watcher in use and open one on `path`. The old watcher is
   * silenced first, so nothing it still reports can reach the page on screen.
   * When the new watcher cannot be opened the page still shows; only its live
   * reload is lost until the next move.
   */
  function replaceWatcher(path: string): void {
    const previous = handle
    const previousPath = watchedPath
    watchedPath = path
    handle = null
    serial += 1
    previous?.close().catch((error: unknown) => {
      logger.warn('Preview entry watcher did not close', {
        panelId: loggedPanelId,
        path: redactPath(previousPath),
        error: nameOf(error)
      })
    })
    try {
      handle = open(path)
    } catch (error) {
      logger.warn('Preview entry watcher could not follow the page', {
        panelId: loggedPanelId,
        path: redactPath(path),
        error: nameOf(error)
      })
    }
  }

  return {
    retarget(path: string): void {
      if (disposed || path === watchedPath) {
        return
      }
      replaceWatcher(path)
    },

    setVisible(visible: boolean): void {
      if (!disposed) handle?.setVisible?.(visible)
    },

    check(reason: CheckReason): void {
      if (!disposed) handle?.check?.(reason)
    },

    async dispose(): Promise<void> {
      if (disposed) {
        return
      }
      disposed = true
      const previous = handle
      handle = null
      await previous?.close()
    }
  }
}
