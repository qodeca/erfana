// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * watchSubscriptions - every subscription `FileWatcherService` holds, keyed
 * by owner + `watchId` (#478, plan S9, decisions 4, 5, 16).
 *
 * - A subscription is found by `(ownerKey, watchId)` only, so a pause, resume
 *   or unsubscribe naming another owner's id finds nothing: a no-op (F23).
 * - A pause belongs to one subscription: other subscriptions on the same file
 *   keep hearing changes (L5). It ends by itself after the profile's
 *   `pauseMaxMs`; a change meanwhile, or the time-out, sets `missed`, which the
 *   resume answers so the saver checks the file (G2).
 */
import { TIMING_PROFILES, type TimingProfileName } from '../../../shared/freshness/timingProfiles'
import { ownerKeyOf, type WatchOwner, type WatchSubscription } from './watchTypes'

/** A pause with no `pauseMaxMs` in its profile still ends: the editor's 10 s. */
const DEFAULT_PAUSE_MAX_MS = TIMING_PROFILES.editor.pauseMaxMs

/** What a new subscription is made from. */
export interface NewSubscription {
  readonly owner: WatchOwner
  readonly watchId: string
  readonly profile: TimingProfileName
  readonly requestedPath: string
  readonly realPath: string
  readonly generation: number
  readonly pageGeneration: number | null
}

/** The key of one owner's subscription. */
export function subscriptionKey(ownerKey: string, watchId: string): string {
  return `${ownerKey}\0${watchId}`
}

export class WatchSubscriptions {
  private readonly byKey = new Map<string, WatchSubscription>()

  /** Build a subscription record; it is not held until {@link add}. */
  static create(input: NewSubscription): WatchSubscription {
    const ownerKey = ownerKeyOf(input.owner)
    const watchId = input.watchId
    return {
      key: subscriptionKey(ownerKey, watchId),
      watchId,
      owner: input.owner,
      ownerKey,
      profile: input.profile,
      bucket: TIMING_PROFILES[input.profile].bucket,
      requestedPath: input.requestedPath,
      realPath: input.realPath,
      generation: input.generation,
      pageGeneration: input.pageGeneration,
      entryKey: null,
      state: 'pending',
      paused: false,
      missed: false,
      pauseTimer: null
    }
  }

  add(sub: WatchSubscription): void {
    this.byKey.set(sub.key, sub)
  }

  get(key: string): WatchSubscription | undefined {
    return this.byKey.get(key)
  }

  /** `sub` is still the one held under its key (it was not ended or replaced meanwhile). */
  holds(sub: WatchSubscription): boolean {
    return this.byKey.get(sub.key) === sub
  }

  /** Forget a subscription and stop its pause timer; true when it was held. */
  remove(sub: WatchSubscription): boolean {
    if (!this.holds(sub)) return false
    clearPauseTimer(sub)
    this.byKey.delete(sub.key)
    return true
  }

  all(): WatchSubscription[] {
    return [...this.byKey.values()]
  }

  get size(): number {
    return this.byKey.size
  }

  forOwner(ownerKey: string): WatchSubscription[] {
    return this.all().filter(sub => sub.ownerKey === ownerKey)
  }

  /**
   * Pause `sub` for an own save. It resumes by itself after the profile's
   * `pauseMaxMs`, with `missed` set: a save that never resumed (its page went
   * away) cannot mute the file for good (G2).
   */
  pause(sub: WatchSubscription): void {
    clearPauseTimer(sub)
    sub.paused = true
    const maxMs = TIMING_PROFILES[sub.profile].pauseMaxMs ?? DEFAULT_PAUSE_MAX_MS
    sub.pauseTimer = setTimeout(() => {
      sub.pauseTimer = null
      sub.paused = false
      sub.missed = true
    }, maxMs)
    sub.pauseTimer.unref?.()
  }

  /** End a pause; answers whether a change was missed meanwhile, and forgets that. */
  resume(sub: WatchSubscription): boolean {
    clearPauseTimer(sub)
    const missed = sub.missed
    sub.paused = false
    sub.missed = false
    return missed
  }
}

function clearPauseTimer(sub: WatchSubscription): void {
  if (sub.pauseTimer !== null) {
    clearTimeout(sub.pauseTimer)
    sub.pauseTimer = null
  }
}
