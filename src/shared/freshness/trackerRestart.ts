// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Subscription ids and the restart policy of a tracker (#478, plan decisions
 * 4–6 and 40).
 *
 * - Every subscribe mints a fresh id; an event for any other id is dropped, so
 *   a late event of a replaced subscription can never touch the tab (F25).
 * - `changed` / `deleted` that arrive before `started` are remembered and
 *   folded into the catch-up read, which runs once (F25).
 * - `ended` because the project switched or closed stops the watch quietly;
 *   any other `ended`, or a refused subscribe, gets one automatic restart with
 *   a new id, then `stopped(reason)`.
 * - `PAGE_CHANGED` / `PROJECT_CHANGED` refusals are quiet: the tab is going away.
 *
 * @module shared/freshness/trackerRestart
 */
import type {
  FreshnessSource,
  SubscribeRefusalCode,
  SubscribeReply,
  SubscribeRequest,
  WatchEndReason,
  WatchStopReason,
} from './freshnessTypes'

/** Why a subscribe is made. */
export type SubscribePurpose = 'begin' | 'restart' | 'reload' | 'file-back'

/** Refusals that mean "this page or project is going away": no notice, no restart. */
const QUIET_REFUSALS: ReadonlySet<SubscribeRefusalCode> = new Set(['PAGE_CHANGED', 'PROJECT_CHANGED'])

export function isQuietRefusal(code: SubscribeRefusalCode): boolean {
  return QUIET_REFUSALS.has(code)
}

/** `ended` because the project switched or closed: the tab closes with it, no restart. */
export function isProjectEnd(reason: WatchEndReason): boolean {
  return reason === 'project-switch' || reason === 'project-closed'
}

/** The stop reason a failed restart shows, from what ended the watch. */
export function stopReasonForEnd(reason: WatchEndReason): WatchStopReason {
  switch (reason) {
    case 'project-switch':
    case 'project-closed':
      return 'project-closed'
    case 'watcher-error':
    case 'outside-project':
    case 'unsupported':
    case 'restart-failed':
      return reason
  }
}

/** The stop reason for a refused subscribe; a generic refusal keeps `fallback`. */
export function stopReasonForRefusal(code: SubscribeRefusalCode, fallback: WatchStopReason): WatchStopReason {
  if (code === 'OUTSIDE_PROJECT') return 'outside-project'
  if (code === 'UNSUPPORTED') return 'unsupported'
  return fallback
}

/** Subscribe, turning a rejected call into a `WATCH_FAILED` refusal. */
export async function subscribeSafely(source: FreshnessSource, request: SubscribeRequest): Promise<SubscribeReply> {
  try {
    return await source.subscribe(request)
  } catch {
    return { status: 'refused', code: 'WATCH_FAILED' }
  }
}

/**
 * The tracker's current subscription: its id, whether it has `started`, and
 * whether a change arrived before it did.
 */
export class WatchIds {
  private id: string | null = null
  private startedFlag = false
  private bufferedFlag = false
  /** Main dropped this subscription (it saw the file deleted, or refused NOT_FOUND). */
  private deadFlag = false
  /** The one automatic restart is still available (reset by Reload and file-back). */
  private restartAvailable = true

  constructor(private readonly newId: () => string) {}

  /** Mint a new current id; returns it and the one it replaced. */
  mint(): { readonly id: string; readonly previous: string | null } {
    const previous = this.id
    this.id = this.newId()
    this.startedFlag = false
    this.bufferedFlag = false
    this.deadFlag = false
    return { id: this.id, previous }
  }

  /** Forget the current id (stopped for good); returns it. */
  clear(): string | null {
    const previous = this.id
    this.id = null
    this.startedFlag = false
    this.bufferedFlag = false
    this.deadFlag = false
    return previous
  }

  get current(): string | null {
    return this.id
  }

  isCurrent(id: string): boolean {
    return this.id !== null && this.id === id
  }

  get started(): boolean {
    return this.startedFlag
  }

  /** Mark `started`; returns whether a change was buffered before it (and clears that). */
  markStarted(): boolean {
    this.startedFlag = true
    const buffered = this.bufferedFlag
    this.bufferedFlag = false
    return buffered
  }

  /** Whether main has dropped the current subscription: only a new subscribe follows the file again. */
  get dead(): boolean {
    return this.deadFlag
  }

  /** Main dropped the current subscription (a `deleted` event, a `NOT_FOUND` refusal – S1). */
  markDead(): void {
    this.deadFlag = true
  }

  /** Remember a change that arrived before `started`. */
  buffer(): void {
    this.bufferedFlag = true
  }

  /** Take the automatic restart; `false` when it was already used. */
  takeRestart(): boolean {
    const available = this.restartAvailable
    this.restartAvailable = false
    return available
  }

  /** Give the automatic restart back (an explicit Reload, the file coming back). */
  resetRestart(): void {
    this.restartAvailable = true
  }
}
