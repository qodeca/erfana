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
 * A watcher error is not a page failure: it is logged by the error's name and
 * code, with the file name redacted and the panel by digest (QG-7 S3, S4), and
 * the next load surfaces a genuinely missing file.
 */
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import { redactPath } from '../../utils/redactUserInput'
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
  // Each watcher reports only while it is the latest one opened.
  let serial = 0
  let disposed = false
  let watchedPath = deps.initialPath

  function open(path: string): PreviewFileWatcherHandle {
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
      }
    })
  }

  let handle: PreviewFileWatcherHandle | null = open(watchedPath)

  return {
    retarget(path: string): void {
      if (disposed || path === watchedPath) {
        return
      }
      const previous = handle
      const previousPath = watchedPath
      watchedPath = path
      handle = null
      // Silence the old watcher before anything else can fail.
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
        // The page still shows; only its live reload is lost until the next move.
        logger.warn('Preview entry watcher could not follow the page', {
          panelId: loggedPanelId,
          path: redactPath(path),
          error: nameOf(error)
        })
      }
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
