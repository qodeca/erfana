// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * SubscriberCounter - per-webContents subscription counting for a watched path.
 *
 * `FileWatcherService` keys watches by path. Before this class the subscriber
 * list was a `Set<number>` of webContents ids, which cannot represent **two
 * consumers inside one window** watching the same path: the first `unwatchFile`
 * removed the id and closed the chokidar watcher out from under the second
 * consumer, which then went permanently deaf (issue #70, defect D3).
 *
 * Counting subscriptions instead of recording ids is what makes two consumers
 * in one window representable at all: the watch is torn down only when the
 * last subscription for the last window is released.
 *
 * What that guarantees, precisely: **no `release` before the last one closes
 * the watch**. It does not by itself guarantee the watch survives, because the
 * count is only as truthful as its callers. It holds while every consumer that
 * starts a watch releases it exactly once, and while joining an existing watch
 * cannot fail - `FileWatcherService.watchFile` checks `MAX_WATCHED_FILES`
 * *after* the join branch for that reason: a refused join that still released
 * on unmount would decrement a count it never incremented, and close the watch
 * under the consumer that owns it.
 *
 * Two distinct removal semantics are deliberately separate methods:
 * - {@link release} - one consumer unsubscribed (decrement).
 * - {@link removeAll} - the whole webContents is gone (window closed, dev
 *   refresh), so every subscription it held dies at once regardless of count.
 */
export class SubscriberCounter {
  private readonly counts: Map<number, number> = new Map()

  /**
   * Build a counter from a list of webContents ids.
   *
   * Repeated ids increment, so `from([1, 1, 2])` yields two subscriptions for
   * window 1 and one for window 2. Primarily an ergonomics/fixture helper.
   */
  static from(ids: number[]): SubscriberCounter {
    const counter = new SubscriberCounter()
    for (const id of ids) {
      counter.add(id)
    }
    return counter
  }

  /**
   * Register one subscription for a webContents.
   *
   * @returns the subscription count for that webContents after the increment
   */
  add(webContentsId: number): number {
    const next = (this.counts.get(webContentsId) ?? 0) + 1
    this.counts.set(webContentsId, next)
    return next
  }

  /**
   * Release one subscription for a webContents. The key is dropped when its
   * count reaches zero; releasing an unknown id is a no-op.
   *
   * @returns the number of webContents ids that still hold at least one
   *          subscription. Zero means the watch has no consumers left and can
   *          be torn down.
   */
  release(webContentsId: number): number {
    const current = this.counts.get(webContentsId)
    if (current !== undefined) {
      if (current <= 1) {
        this.counts.delete(webContentsId)
      } else {
        this.counts.set(webContentsId, current - 1)
      }
    }
    return this.counts.size
  }

  /**
   * Drop a webContents outright, whatever its count. Used when the webContents
   * itself is destroyed, where every subscription it held dies together.
   *
   * @returns the number of webContents ids that still hold a subscription
   */
  removeAll(webContentsId: number): number {
    this.counts.delete(webContentsId)
    return this.counts.size
  }

  /** Whether this webContents holds at least one subscription. */
  has(webContentsId: number): boolean {
    return this.counts.has(webContentsId)
  }

  /** How many subscriptions this webContents holds (0 when it holds none). */
  countFor(webContentsId: number): number {
    return this.counts.get(webContentsId) ?? 0
  }

  /** Number of distinct webContents holding at least one subscription. */
  get size(): number {
    return this.counts.size
  }

  /** Total subscriptions across every webContents (diagnostics). */
  get totalSubscriptions(): number {
    let total = 0
    for (const count of this.counts.values()) {
      total += count
    }
    return total
  }

  /** The subscribing webContents ids, each listed once. */
  ids(): number[] {
    return Array.from(this.counts.keys())
  }
}
