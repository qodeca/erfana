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
 * `PREVIEW.WATCH_POLL_INTERVAL_MS`. `followSymlinks: false` stays in the base
 * options and is NOT duplicated here.
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
 *
 * A new watch can catch up (`changedSince`). The preview learns a page's files
 * only after the page has loaded them, and a watch hears only writes made once
 * chokidar is listening, so a save in between was lost and the page kept the
 * old file until the next save. Given the time the page's load began, the
 * watch reads its file's stamp (`lstat`, one per new watch, never more than the
 * cap) once it is listening, and a file modified since then fires `onChange`
 * once, like any change. The stamp is compared with
 * {@link WATCH_CATCH_UP_SLACK_MS} either side: a file stamped in the future
 * (an archive, a share with a fast clock) is not taken as a save. A write in
 * the moments between the stamp read and that check can be reported twice;
 * the coordinator's coalescing usually folds the two into one.
 */
import { lstat } from 'node:fs/promises'
import type { FSWatcher, ChokidarOptions } from 'chokidar'
import { createSingleFileWatcher } from '../watcher/singleFileWatch'
import type { AtomicSaveDetector } from '../watcher/AtomicSaveDetector'
import {
  createRearmingSingleFileWatcher,
  type RearmingSingleFileWatchHandle
} from '../watcher/rearmingSingleFileWatch'
import { PREVIEW } from '../../../shared/constants'
import {
  sharedPreviewWatchBudget,
  type IPreviewWatchBudget
} from './previewWatchBudget'

/**
 * Tolerance either side of the clock when a new watch checks whether its file
 * changed since the page's load began (ms). A file's stamp comes from a
 * coarser clock than `Date.now()`: on the emulated Windows box a write was
 * stamped up to 19 ms before the clock read just ahead of it, and up to 3 ms
 * after the read just behind it (400 writes).
 */
export const WATCH_CATCH_UP_SLACK_MS = 50

/** The preview-tuned `awaitWriteFinish` overrides layered onto the base options. */
const PREVIEW_WATCH_OVERRIDES: Partial<ChokidarOptions> = {
  awaitWriteFinish: {
    stabilityThreshold: PREVIEW.WATCH_STABILITY_MS,
    pollInterval: PREVIEW.WATCH_POLL_INTERVAL_MS
  }
}

/** The factory the pool uses to build a watcher; injectable for tests. */
export type WatchFactory = (
  filePath: string,
  handlers: {
    onChange: () => void
    onUnlink: () => void
    onError: (error: unknown) => void
    onReady?: () => void
  },
  overrides?: Partial<ChokidarOptions>
) => FSWatcher

/** How a new watch closes the gap before it was listening (module comment). */
export interface PreviewWatchStartOptions {
  /**
   * When the page's load began, in `Date.now()` milliseconds. Once the new
   * watch is listening, a file modified since then is reported as one change.
   * Absent: nothing is checked.
   */
  readonly changedSince?: number
}

export interface PreviewWatchPoolDeps {
  /** The low-level chokidar factory; defaults to `createSingleFileWatcher`. */
  readonly createWatcher?: WatchFactory
  /**
   * Re-check realpath confinement before re-arming a watch across an atomic save
   * (the TOCTOU window an external writer opens). Supplied per-preview by the
   * coordinator, which owns the realRoot; defaults to always confined.
   */
  readonly isPathConfined?: (filePath: string) => Promise<boolean>
  /** Atomic-save detector factory; injectable so tests avoid the real timer. */
  readonly createDetector?: () => AtomicSaveDetector
  /** Per-preview watch cap; defaults to `PREVIEW.MAX_WATCHED_FILES`. */
  readonly maxWatched?: number
  /**
   * Process-wide watch budget shared by every pool; defaults to
   * {@link sharedPreviewWatchBudget}. Each live preview builds its own pool, so
   * the per-preview cap alone would multiply by the number of previews
   * (sd-074b §4.6).
   */
  readonly budget?: IPreviewWatchBudget
  /** Reads a file's stamp for the catch-up; `fs.promises.lstat` by default. */
  readonly statFile?: (filePath: string) => Promise<{ readonly mtimeMs: number }>
  /** The clock `changedSince` is read on; `Date.now` by default. */
  readonly now?: () => number
}

export interface IPreviewWatchPool {
  /**
   * Watch `filePath`, invoking `onChange` on every change or unlink. Refcounted:
   * re-acquiring an already-watched path bumps the count and keeps the original
   * handler. Returns `false` (and watches nothing) when acquiring a NEW path
   * would exceed the per-preview cap OR the process-wide budget; a re-acquire of
   * an existing path always succeeds because it consumes no new descriptor.
   *
   * `options.changedSince` applies to a NEW watch only: a watch already held
   * was listening all along, so it heard every write itself.
   */
  acquire(filePath: string, onChange: () => void, options?: PreviewWatchStartOptions): boolean
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
  watcher: RearmingSingleFileWatchHandle
  refCount: number
  onChange: () => void
}

/**
 * Create a preview watch pool. `deps` are injectable so tests can substitute a
 * fake watcher factory and a smaller cap without touching chokidar.
 */
export function createPreviewWatchPool(deps: PreviewWatchPoolDeps = {}): IPreviewWatchPool {
  const createWatcher = deps.createWatcher ?? createSingleFileWatcher
  const isPathConfined = deps.isPathConfined
  const createDetector = deps.createDetector
  const maxWatched = deps.maxWatched ?? PREVIEW.MAX_WATCHED_FILES
  const budget = deps.budget ?? sharedPreviewWatchBudget
  const statFile = deps.statFile ?? lstat
  const now = deps.now ?? Date.now

  const entries = new Map<string, PoolEntry>()

  /**
   * The new watch is listening: report a write it could not have heard – one
   * made since `changedSince`, before chokidar was listening – as one change.
   * Never rejects.
   */
  const catchUp = async (
    filePath: string,
    entry: PoolEntry,
    changedSince: number
  ): Promise<void> => {
    let modifiedAt: number
    try {
      modifiedAt = (await statFile(filePath)).mtimeMs
    } catch {
      // Gone or unreadable: a delete reaches the consumer through the watch itself.
      return
    }
    // Released meanwhile: its consumer no longer wants to hear about it.
    if (entries.get(filePath) !== entry) {
      return
    }
    const slack = WATCH_CATCH_UP_SLACK_MS
    if (modifiedAt >= changedSince - slack && modifiedAt <= now() + slack) {
      entry.onChange()
    }
  }

  // Give the budget slot back in the SAME place the entry is closed, so the take
  // and the give can never drift apart (sd-074b §4.6).
  const closeEntry = async (entry: PoolEntry): Promise<void> => {
    budget.give()
    try {
      await entry.watcher.close()
    } catch {
      // A watcher that fails to close is already unusable; there is nothing to
      // recover and swallowing keeps releaseAll from stalling on one bad handle.
    }
  }

  return {
    acquire(filePath: string, onChange: () => void, options?: PreviewWatchStartOptions): boolean {
      const existing = entries.get(filePath)
      if (existing) {
        existing.refCount += 1
        return true
      }
      if (entries.size >= maxWatched) {
        return false
      }
      // A NEW path costs a descriptor, so it costs a budget slot.
      if (!budget.tryTake()) {
        return false
      }
      // The handler indirects through the entry so a change/unlink always calls
      // the currently-registered callback.
      const entry: PoolEntry = {
        watcher: undefined as unknown as RearmingSingleFileWatchHandle,
        refCount: 1,
        onChange
      }
      // A changed, re-armed OR genuinely-deleted subresource all mean "reload
      // needed", so onChange and onDeleted both fire the signal. The re-arm keeps
      // the watch alive across an atomic save so later edits still reload.
      const fire = (): void => entry.onChange()
      const changedSince = options?.changedSince
      const onReady =
        changedSince === undefined
          ? {}
          : { onReady: (): void => void catchUp(filePath, entry, changedSince) }
      // The slot is taken above but only RETURNED by `closeEntry`, which is
      // reachable only through `entries`. A throw between the two — chokidar
      // failing on EMFILE/ENOSPC, or the confinement check rejecting — would
      // burn the slot permanently, and 64 of those stop auto-refresh for every
      // preview with no error surfaced anywhere, because `acquire` returning
      // false is the degrade-quietly branch (lens review F12).
      try {
        entry.watcher = createRearmingSingleFileWatcher(
          filePath,
          { onChange: fire, onDeleted: fire, onError: () => {}, ...onReady },
          { createWatcher, isPathConfined, createDetector, overrides: PREVIEW_WATCH_OVERRIDES }
        )
      } catch (error) {
        budget.give()
        throw error
      }
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
