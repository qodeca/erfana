// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * watchSuspension - file watches across a project switch (#478, plan
 * decision 18, N1).
 *
 * `ProjectService` stops nothing until the new project's settings and path
 * filter are built, so a failed open leaves every watch running (G1). Just
 * before the commit it calls {@link WatchSuspension.suspendAll}: the
 * `suspending` flag goes up first, then every native watcher is closed while
 * its records stay. A subscribe that reaches its insert while the flag is up
 * is inserted suspended, with no watcher.
 *
 * - A step after the suspend fails → {@link WatchSuspension.resumeSuspended}
 *   re-arms every suspended entry, including those inserted while suspending,
 *   and each subscription hears `restarted` (or `ended`).
 * - The commit happened → {@link WatchSuspension.endSuspended} ends every
 *   subscription – window, in-process or waitlisted – recorded with an older
 *   generation. With the generation check inside `subscribe` (decision 15),
 *   nothing of the old project stays live in the new session.
 */
import type { WatchEndReason } from '../../../shared/freshness/freshnessTypes'
import type { WatchEntry, WatchSubscription } from './watchTypes'

/** What the suspension needs from `FileWatcherService`. */
export interface SuspensionHost {
  entries(): readonly WatchEntry[]
  subscriptions(): readonly WatchSubscription[]
  /** Close the entry's watcher and mark it suspended; the record stays. */
  suspendEntry(entry: WatchEntry): Promise<void>
  /** Re-arm a suspended entry and tell its subscriptions (`restarted`, or `ended`). */
  resumeEntry(entry: WatchEntry): Promise<void>
  /** End one subscription with `reason` and drop it (its entry closes when it was the last). */
  endSubscription(sub: WatchSubscription, reason: WatchEndReason): void
}

export class WatchSuspension {
  /** The generation being left while suspended; `null` when not suspending. */
  private leaving: number | null = null

  /** Between {@link suspendAll} and its resume or end: a new subscribe is inserted suspended. */
  get isSuspending(): boolean {
    return this.leaving !== null
  }

  /** Raise the flag, then close every native watcher; records stay. */
  async suspendAll(host: SuspensionHost, generation: number): Promise<void> {
    this.leaving = generation
    await Promise.all(host.entries().map(entry => host.suspendEntry(entry)))
  }

  /** A step after the suspend failed: lower the flag and re-arm every suspended entry. */
  async resumeSuspended(host: SuspensionHost): Promise<void> {
    this.leaving = null
    const suspended = host.entries().filter(entry => entry.suspended)
    await Promise.all(suspended.map(entry => host.resumeEntry(entry)))
  }

  /**
   * The commit made `newGeneration` current: lower the flag and end every
   * subscription recorded before it. An entry left with a newer subscription
   * (none is expected: the commit is synchronous) is re-armed.
   */
  async endSuspended(host: SuspensionHost, newGeneration: number, reason: WatchEndReason): Promise<void> {
    this.leaving = null
    for (const sub of host.subscriptions()) {
      if (sub.generation < newGeneration) host.endSubscription(sub, reason)
    }
    const left = host.entries().filter(entry => entry.suspended && entry.subs.size > 0)
    await Promise.all(left.map(entry => host.resumeEntry(entry)))
  }
}
