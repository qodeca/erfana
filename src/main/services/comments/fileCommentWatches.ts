// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The file watches behind `file-comment:changed` (spec 024 architecture note
 * 001 § 8 C18; 024-NFR-005 item 6; #478 C4).
 *
 * One watch per real path, whatever number of panels and windows listed it:
 * each panel is a subscriber, and the watch closes when its last subscriber
 * leaves (the panel lists another file, its window closes, the project
 * changes).
 *
 * Each watch is a freshness tracker on the one watch layer (#478 plan S19,
 * `freshness/mainTrackedWatch.ts`, `comments` profile), so it draws from the
 * `comments` bucket (64 files, every window together), and the layer suspends
 * and restores it across a project switch, re-arms it after a wake and
 * re-checks it in its health round (F2). A watch that ends is restarted once
 * and caught up; a write that landed meanwhile is a change, so the drawer
 * lists the file again. Past the bucket a watch is queued, not refused: the
 * file is listed at once and follows live as soon as a slot frees, and until
 * then window focus checks it (the safety net) – that is logged by digest only.
 *
 * Who is told about a change is the service's business – it sends to the
 * subscribers' own windows only.
 */
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { createTrackedFileWatch, type TrackedWatchProblem } from '../freshness/mainTrackedWatch'
import { logger } from '../LoggingService'

/** What closing a watch takes. */
export interface FileCommentWatchHandle {
  close(): Promise<void>
}

/** Start watching `realPath`; `onChange` runs on every change, an atomic save's re-arm and a delete included. */
export type FileCommentWatchFactory = (realPath: string, onChange: () => void) => FileCommentWatchHandle

/** The process-wide set of comment file watches. */
export interface FileCommentWatches {
  /** Add `subscriber` to `realPath`'s watch, starting it if needed. */
  subscribe(realPath: string, subscriber: string): void
  /** Remove `subscriber`; the watch closes with its last one. */
  unsubscribe(realPath: string, subscriber: string): void
  /** Watches open now. */
  readonly size: number
  /** Close every watch. */
  closeAll(): Promise<void>
}

interface Watch {
  readonly handle: FileCommentWatchHandle
  readonly subscribers: Set<string>
}

/** Close a handle without letting a failure escape: a watch that will not close is gone for our purposes. */
function closeQuietly(handle: FileCommentWatchHandle): Promise<void> {
  return handle.close().catch(() => {})
}

/** What a comment watch says about itself in the log; the file by digest only (C20). */
function logProblem(realPath: string, problem: TrackedWatchProblem): void {
  const file = stablePathDigest(realPath)
  if (problem === 'queued') {
    logger.warn('File comments: the watch limit is reached; the file follows live once a slot frees', { file })
    return
  }
  if (problem === 'limited') {
    // A network or WSL volume: the focus and resume checks still cover it (G7)
    logger.info('File comments: live refresh is limited on this volume; checks still run', { file })
    return
  }
  logger.warn('File comments: the file is no longer followed live', { file, problem })
}

/** The production watch: a freshness tracker on the shared watch layer. */
export const defaultFileCommentWatch: FileCommentWatchFactory = (realPath, onChange) =>
  createTrackedFileWatch(
    realPath,
    { onChange, onDeleted: onChange, onProblem: (problem) => logProblem(realPath, problem) },
    { profile: 'comments' }
  )

/**
 * Build the set.
 *
 * @param onChange - Told the real path whose file changed.
 */
export function createFileCommentWatches(deps: {
  readonly watch: FileCommentWatchFactory
  readonly onChange: (realPath: string) => void
}): FileCommentWatches {
  const watches = new Map<string, Watch>()

  return {
    subscribe(realPath, subscriber) {
      const known = watches.get(realPath)
      if (known !== undefined) {
        known.subscribers.add(subscriber)
        return
      }
      const handle = deps.watch(realPath, () => deps.onChange(realPath))
      watches.set(realPath, { handle, subscribers: new Set([subscriber]) })
    },
    unsubscribe(realPath, subscriber) {
      const watch = watches.get(realPath)
      if (watch === undefined || !watch.subscribers.delete(subscriber) || watch.subscribers.size > 0) return
      watches.delete(realPath)
      void closeQuietly(watch.handle)
    },
    get size() {
      return watches.size
    },
    async closeAll() {
      const all = [...watches.values()]
      watches.clear()
      await Promise.all(all.map(watch => closeQuietly(watch.handle)))
    }
  }
}
