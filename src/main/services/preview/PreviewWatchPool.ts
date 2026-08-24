// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview-owned single-file watch pool (Issue #74, work item 30; design §1.4).
 *
 * The HTML preview must react to subresource edits far faster than
 * `FileWatcherService`'s 300 ms debounce allows (AC24), and it needs an
 * in-process subscription API that service does not expose. Rather than fork
 * the security-load-bearing chokidar options, this pool reuses the single
 * watcher factory (`createSingleFileWatcher`, item 29) with preview overrides
 * that lower `awaitWriteFinish` to `PREVIEW.WATCH_STABILITY_MS` /
 * `PREVIEW.WATCH_POLL_INTERVAL_MS`. `followSymlinks: false` and
 * `disableGlobbing: true` stay in the base options and are NOT duplicated here.
 *
 * The pool is refcounted: acquiring an already-watched path bumps a count and
 * reuses the one watcher; releasing decrements and closes the watcher only when
 * the count reaches zero. It is capped at `PREVIEW.MAX_WATCHED_FILES` (16) PER
 * PREVIEW — an additive budget on top of the app-wide `FileWatcherService` cap,
 * bounding this preview's file-descriptor exposure (#146–#151).
 *
 * chokidar `close()` is async, so `release`, `releaseAll` and `close` are async
 * and must be awaited; the coordinator (item 31) awaits releases before new
 * acquires so a reload storm cannot stack descriptors transiently.
 *
 * A changed or unlinked subresource both signal "reload needed", so both
 * chokidar events fan out to the caller's `onChange`. A watched file is DATA:
 * its path only triggers a signal, it is never executed here.
 */
import type { FSWatcher, WatchOptions } from 'chokidar'
import { createSingleFileWatcher } from '../watcher/singleFileWatch'
import { PREVIEW } from '../../../shared/constants'

/** The preview-tuned `awaitWriteFinish` overrides layered onto the base options. */
const PREVIEW_WATCH_OVERRIDES: Partial<WatchOptions> = {
  awaitWriteFinish: {
    stabilityThreshold: PREVIEW.WATCH_STABILITY_MS,
    pollInterval: PREVIEW.WATCH_POLL_INTERVAL_MS
  }
}

/** The factory the pool uses to build a watcher; injectable for tests. */
export type WatchFactory = (
  filePath: string,
  handlers: { onChange: () => void; onUnlink: () => void; onError: (error: unknown) => void },
  overrides?: Partial<WatchOptions>
) => FSWatcher

export interface PreviewWatchPoolDeps {
  /** Defaults to `createSingleFileWatcher`. */
  readonly createWatcher?: WatchFactory
  /** Per-preview watch cap; defaults to `PREVIEW.MAX_WATCHED_FILES`. */
  readonly maxWatched?: number
}

export interface IPreviewWatchPool {
  /**
   * Watch `filePath`, invoking `onChange` on every change or unlink. Refcounted:
   * re-acquiring an already-watched path bumps the count and keeps the original
   * handler. Returns `false` (and watches nothing) when acquiring a NEW path
   * would exceed the per-preview cap; a re-acquire of an existing path always
   * succeeds because it consumes no new descriptor.
   */
  acquire(filePath: string, onChange: () => void): boolean
  /** Decrement the refcount; close the watcher when it reaches zero. */
  release(filePath: string): Promise<void>
  /** Close every watcher regardless of refcount. Awaited. */
  releaseAll(): Promise<void>
  /** Alias of `releaseAll`; the pool must not be used afterwards. */
  close(): Promise<void>
  /** Number of distinct watched paths (descriptors held). */
  readonly size: number
}

interface PoolEntry {
  watcher: FSWatcher
  refCount: number
  onChange: () => void
}

/**
 * Create a preview watch pool. `deps` are injectable so tests can substitute a
 * fake watcher factory and a smaller cap without touching chokidar.
 */
export function createPreviewWatchPool(deps: PreviewWatchPoolDeps = {}): IPreviewWatchPool {
  const createWatcher = deps.createWatcher ?? createSingleFileWatcher
  const maxWatched = deps.maxWatched ?? PREVIEW.MAX_WATCHED_FILES

  const entries = new Map<string, PoolEntry>()

  const closeEntry = async (entry: PoolEntry): Promise<void> => {
    try {
      await entry.watcher.close()
    } catch {
      // A watcher that fails to close is already unusable; there is nothing to
      // recover and swallowing keeps releaseAll from stalling on one bad handle.
    }
  }

  return {
    acquire(filePath: string, onChange: () => void): boolean {
      const existing = entries.get(filePath)
      if (existing) {
        existing.refCount += 1
        return true
      }
      if (entries.size >= maxWatched) {
        return false
      }
      // The handler indirects through the entry so a change/unlink always calls
      // the currently-registered callback.
      const entry: PoolEntry = {
        watcher: undefined as unknown as FSWatcher,
        refCount: 1,
        onChange
      }
      const fire = (): void => entry.onChange()
      entry.watcher = createWatcher(
        filePath,
        { onChange: fire, onUnlink: fire, onError: () => {} },
        PREVIEW_WATCH_OVERRIDES
      )
      entries.set(filePath, entry)
      return true
    },

    async release(filePath: string): Promise<void> {
      const entry = entries.get(filePath)
      if (!entry) return
      entry.refCount -= 1
      if (entry.refCount > 0) return
      entries.delete(filePath)
      await closeEntry(entry)
    },

    async releaseAll(): Promise<void> {
      const open = [...entries.values()]
      entries.clear()
      await Promise.all(open.map(closeEntry))
    },

    async close(): Promise<void> {
      await this.releaseAll()
    },

    get size(): number {
      return entries.size
    }
  }
}
