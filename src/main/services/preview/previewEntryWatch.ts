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
 * A save of the page reloads it (`onChange`, through the reload policy); an
 * unlink – a rename unlinks the old path too – marks it deleted (`onDeleted`).
 * A genuine delete ends the watcher, so nothing would report the page coming
 * back – a branch switch or a merge puts it back seconds later. After a delete
 * the page is therefore asked for once per `DELETED_FILE_PROBE_INTERVAL_MS`;
 * when it is there again it is watched anew and reported as a change, which
 * reloads it and clears the failed state (#450). A move or `dispose` ends the ask.
 * A watcher error is not a page failure: it is logged by the error's name and
 * code, with the file name redacted and the panel by digest (QG-7 S3, S4), and
 * the next load surfaces a genuinely missing file.
 */
import { DELETED_FILE_PROBE_INTERVAL_MS } from '../../../shared/deletedFileProbe'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import { redactPath } from '../../utils/redactUserInput'
import { probePath } from '../watcher/pathPresence'
import type { PreviewFileWatcherHandle } from './previewViewLifecycle'

/** Opens a single-file watcher; the service's `createEntryWatcher`. */
export type PreviewEntryWatcherFactory = (
  filePath: string,
  handlers: { onChange(): void; onUnlink(): void; onError(error: unknown): void }
) => PreviewFileWatcherHandle

/** What the entry watch needs from its view. */
export interface PreviewEntryWatchDeps {
  readonly panelId: string
  /** The page the view opens on. Watched at once: a throw is the construction's to unwind. */
  readonly initialPath: string
  readonly createEntryWatcher: PreviewEntryWatcherFactory
  /** The page on screen was saved. */
  readonly onChange: () => void
  /** The page on screen was deleted, or renamed away. */
  readonly onDeleted: () => void
  /**
   * Is a deleted page on disk again? Defaults to one `stat` that must succeed:
   * a page that cannot be read yet is not back, since reloading it would fail.
   */
  readonly isPresent?: (path: string) => Promise<boolean>
}

/** The default {@link PreviewEntryWatchDeps.isPresent}: only a successful `stat` counts. */
async function statSucceeds(path: string): Promise<boolean> {
  return (await probePath(path)) === 'present'
}

/** The watch on one live view's page. */
export interface PreviewEntryWatch {
  /** Watch `path` instead of the page watched now; the same path changes nothing. */
  retarget(path: string): void
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

/** Start watching a live view's first page. */
export function createPreviewEntryWatch(deps: PreviewEntryWatchDeps): PreviewEntryWatch {
  // The panel id is the page's readable path: log lines carry its digest.
  const loggedPanelId = stablePathDigest(deps.panelId)
  const isPresent = deps.isPresent ?? statSucceeds
  // Each watcher reports only while it is the latest one opened.
  let serial = 0
  let disposed = false
  let watchedPath = deps.initialPath
  // The pending ask for a deleted page, if any (#450).
  let probeTimer: ReturnType<typeof setTimeout> | null = null

  function stopProbe(): void {
    if (probeTimer !== null) {
      clearTimeout(probeTimer)
      probeTimer = null
    }
  }

  /**
   * Ask for the deleted page until it is back, then watch it again and report
   * a change. Asks one at a time; stops when a newer watcher was opened (a
   * move) or the watch was disposed, since `isCurrent` then answers false.
   */
  function probeForReturn(path: string, isCurrent: () => boolean): void {
    stopProbe()
    const tick = async (): Promise<void> => {
      probeTimer = null
      const isBack = await isPresent(path)
      if (!isCurrent()) {
        return
      }
      if (!isBack) {
        probeTimer = setTimeout(() => void tick(), DELETED_FILE_PROBE_INTERVAL_MS)
        return
      }
      if (replaceWatcher(path, 'Preview entry watcher could not watch the returned page')) {
        deps.onChange()
        return
      }
      // No watcher could be opened: the page stays failed and is asked for
      // again, until a move or `dispose` opens a newer watcher or ends it all.
      const mine = serial
      probeForReturn(path, () => !disposed && mine === serial)
    }
    probeTimer = setTimeout(() => void tick(), DELETED_FILE_PROBE_INTERVAL_MS)
  }

  function open(path: string): PreviewFileWatcherHandle {
    serial += 1
    const mine = serial
    const current = (): boolean => !disposed && mine === serial
    return deps.createEntryWatcher(path, {
      onChange: () => {
        if (current()) deps.onChange()
      },
      onUnlink: () => {
        if (!current()) {
          return
        }
        deps.onDeleted()
        probeForReturn(path, current)
      },
      onError: (error) => {
        logger.warn('Preview entry watcher error', {
          panelId: loggedPanelId,
          path: redactPath(path),
          error: nameOf(error),
          code: codeOf(error)
        })
      }
    })
  }

  let handle: PreviewFileWatcherHandle | null = open(watchedPath)

  /**
   * Close the watcher in use and open one on `path`. The old watcher is
   * silenced first, so nothing it still reports can reach the page on screen.
   * `false` when the new watcher could not be opened; the page still shows,
   * only its live reload is lost.
   */
  function replaceWatcher(path: string, failureMessage: string): boolean {
    stopProbe()
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
      return true
    } catch (error) {
      logger.warn(failureMessage, {
        panelId: loggedPanelId,
        path: redactPath(path),
        error: nameOf(error)
      })
      return false
    }
  }

  return {
    retarget(path: string): void {
      if (disposed || path === watchedPath) {
        return
      }
      // The page still shows; only its live reload is lost until the next move.
      replaceWatcher(path, 'Preview entry watcher could not follow the page')
    },

    async dispose(): Promise<void> {
      if (disposed) {
        return
      }
      disposed = true
      stopProbe()
      const previous = handle
      handle = null
      await previous?.close()
    }
  }
}
