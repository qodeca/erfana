// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One consumer's hold on a main-process file watch.
 *
 * `window.api.fileWatch.start` is **not** idempotent: main-side it increments a
 * per-window subscriber count, and `stop` decrements it. The watcher (one of
 * only `MAX_WATCHED_FILES = 100` app-wide) is closed when the count reaches
 * zero. So every renderer consumer must send exactly as many `stop`s as it sent
 * successful `start`s – no more, no fewer:
 *
 * - **one start too many** leaves a residual count, the chokidar watcher and the
 *   map entry outlive the panel, and the app leaks slots until
 *   `file-watch:start` starts refusing for *every* surface, silently
 *   reintroducing the stale-content bug this module exists to prevent;
 * - **one stop too many** decrements a count this consumer never acquired,
 *   deafening whichever other panel legitimately holds it;
 * - **a stop that overtakes its start** (fast mount → unmount, both calls in
 *   flight) leaks the slot permanently, because the stop finds nothing to
 *   release and the start then creates an entry nobody will ever stop.
 *
 * This module makes those three impossible by pairing a `isHeld` flag with a
 * serialised operation queue. Both file-watching hooks –
 * `useFileChangeSubscription` (read-only surfaces) and `useFileWatcher` (the
 * Markdown editor) – hold one slot each.
 *
 * @module fileWatchSlot
 * @see Issue #70 - preview tabs show stale content when the file changes
 */

/**
 * A single consumer's watch subscription.
 *
 * Create one per hook instance with {@link createFileWatchSlot} and keep it in
 * a ref; never share one between consumers.
 */
export interface FileWatchSlot {
  /** True between a successful `start` and its matching `stop`. */
  isHeld: boolean
  /**
   * Tail of the serialised start/stop chain.
   *
   * Every operation is appended here, so ordering is guaranteed by
   * construction rather than by the caller remembering to chain teardown onto
   * the start promise.
   */
  pending: Promise<unknown>
}

/** Outcome of {@link acquireFileWatch}. Never throws – failures are values. */
export interface FileWatchAcquireResult {
  /** True when this slot now holds a live watch (including "already held"). */
  started: boolean
  /** The bridge's error string, when the main process refused the watch. */
  error?: string
  /** The thrown error, when the IPC call itself rejected. */
  cause?: Error
}

/**
 * Creates an empty, unheld watch slot.
 *
 * @returns A fresh slot holding no subscription
 *
 * @example
 * ```ts
 * const slotRef = useRef<FileWatchSlot>(createFileWatchSlot())
 * ```
 */
export function createFileWatchSlot(): FileWatchSlot {
  return { isHeld: false, pending: Promise.resolve() }
}

/**
 * Appends an operation to the slot's serialised queue.
 *
 * The queue tail is kept rejection-free so one failed operation cannot poison
 * every later one; the caller still sees the real outcome through the returned
 * promise.
 */
function enqueue<T>(slot: FileWatchSlot, operation: () => Promise<T>): Promise<T> {
  const result = slot.pending.then(operation, operation)
  slot.pending = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

/**
 * Starts the watch for `filePath`, at most once per slot.
 *
 * A second call while the slot is already held resolves `{ started: true }`
 * **without** touching IPC: the main process re-arms its own watcher after an
 * atomic save, so a duplicate `start` buys nothing and costs a leaked slot.
 *
 * @param slot - The consumer's slot
 * @param filePath - Absolute path to watch
 * @returns Whether the slot now holds a live watch, plus the failure detail
 *
 * @example
 * ```ts
 * const { started, error } = await acquireFileWatch(slot, filePath)
 * if (!started) setUnavailableReason(classifyWatchStartFailure(error))
 * ```
 */
export function acquireFileWatch(
  slot: FileWatchSlot,
  filePath: string
): Promise<FileWatchAcquireResult> {
  return enqueue(slot, async () => {
    if (slot.isHeld) return { started: true }

    try {
      const result = await window.api.fileWatch.start(filePath)
      if (!result?.success) {
        return { started: false, error: result?.error }
      }
      slot.isHeld = true
      return { started: true }
    } catch (error) {
      return {
        started: false,
        cause: error instanceof Error ? error : new Error(String(error))
      }
    }
  })
}

/**
 * Stops the watch for `filePath`, but only if this slot actually holds it.
 *
 * Safe to call unconditionally in an effect cleanup: a slot whose `start` was
 * refused, rejected, or is still in flight releases nothing, and the queue
 * guarantees this runs after that `start` has settled.
 *
 * @param slot - The consumer's slot
 * @param filePath - Absolute path the slot was acquired for
 * @returns Resolves once the release has been sent (or skipped)
 *
 * @example
 * ```ts
 * return () => { void releaseFileWatch(slot, filePath) }
 * ```
 */
export function releaseFileWatch(slot: FileWatchSlot, filePath: string): Promise<void> {
  return enqueue(slot, async () => {
    if (!slot.isHeld) return

    // Flip first: a rejected `stop` must not leave the slot claiming a hold it
    // may no longer have, or the next acquire would skip its `start`.
    slot.isHeld = false
    try {
      await window.api.fileWatch.stop(filePath)
    } catch {
      // The watch is gone either way; the caller has nothing to do about it.
    }
  })
}
