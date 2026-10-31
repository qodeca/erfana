// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The file watches behind `file-comment:changed` (spec 024 architecture note
 * 001 § 8 C18; 024-NFR-005 item 6).
 *
 * One watch per real path, whatever number of panels and windows listed it:
 * each panel is a subscriber, and the watch closes when its last subscriber
 * leaves (the panel lists another file, its window closes, the project
 * changes). Watches are counted and capped at {@link FILE_COMMENT_WATCHES_MAX}
 * for the whole process: past the cap a list is still answered, only without
 * live updates, and that is logged (path digest only).
 *
 * Who is told about a change is the service's business – it sends to the
 * subscribers' own windows only.
 */
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'

/** Files watched at once for comments, every window together. */
export const FILE_COMMENT_WATCHES_MAX = 64

/** What closing a watch takes. */
export interface FileCommentWatchHandle {
  close(): Promise<void>
}

/** Start watching `realPath`; `onChange` runs on every change, an atomic save's re-arm included. */
export type FileCommentWatchFactory = (realPath: string, onChange: () => void) => FileCommentWatchHandle

/** The process-wide set of comment file watches. */
export interface FileCommentWatches {
  /** Add `subscriber` to `realPath`'s watch, starting it if needed; `false` when the cap left no room. */
  subscribe(realPath: string, subscriber: string): boolean
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

/**
 * Build the set.
 *
 * @param onChange - Told the real path whose file changed.
 */
export function createFileCommentWatches(deps: {
  readonly watch: FileCommentWatchFactory
  readonly onChange: (realPath: string) => void
  readonly max?: number
}): FileCommentWatches {
  const max = deps.max ?? FILE_COMMENT_WATCHES_MAX
  const watches = new Map<string, Watch>()

  return {
    subscribe(realPath, subscriber) {
      const known = watches.get(realPath)
      if (known !== undefined) {
        known.subscribers.add(subscriber)
        return true
      }
      if (watches.size >= max) {
        logger.warn('File comments: the watch cap is reached; the file is listed without live updates', {
          watches: watches.size,
          file: stablePathDigest(realPath)
        })
        return false
      }
      const handle = deps.watch(realPath, () => deps.onChange(realPath))
      watches.set(realPath, { handle, subscribers: new Set([subscriber]) })
      return true
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
