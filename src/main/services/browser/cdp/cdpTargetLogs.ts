// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One CDP session's targets and their log domains (spec 025, 025-FR-038,
 * solution design § 5, § 6.3; panel finding S6, P7), moved out of
 * `BrowserCdpSession.ts`.
 *
 * - {@link TargetRecord}: an attached target, with its flood budget
 *   (`cdpFloodBudget.ts`) and its timers.
 * - {@link CdpTargetLogs}: `Runtime`, `Log` and – with the `network` source –
 *   `Network` on and off per target; a flood trip turns them off, marks the
 *   target's root frame "logs truncated" and tells the session; a new
 *   document re-arms them. Console objects are released in one batch
 *   {@link CONSOLE_RELEASE_DELAY_MS} after the first console call, so a burst
 *   of calls costs one release.
 */
import type { Clock, TimerHandle } from '../../../../shared/clock'
import { logger } from '../../LoggingService'
import type { BrowserLogBuffer } from './browserLogBuffer'
import { TargetFloodBudget } from './cdpFloodBudget'
import type { FailedRequestSource } from './cdpLogCollector'
import { CONSOLE_OBJECT_GROUP, NETWORK_ENABLE_PARAMS } from './cdpPinned'
import type { CdpDetachCause, CdpTargetInfo } from './cdpSessionTypes'
import type { CdpWebContents } from './cdpTypes'

/** The top target's session key (Electron's root session has no id). */
export const TOP_TARGET = ''

/** Delay before a target's console objects are released, so a burst of calls costs one release. */
export const CONSOLE_RELEASE_DELAY_MS = 250

/** Electron's detach reason when the page goes away (`Debugger::AgentHostClosed`). */
export const TARGET_CLOSED_REASON = 'target closed'

export interface TargetRecord extends CdpTargetInfo {
  readonly parentKey: string | null
  readonly budget: TargetFloodBudget
  logsOff: boolean
  release: TimerHandle | undefined
  resume: TimerHandle | undefined
}

/** A new record for an attached target. */
export function newTargetRecord(clock: Clock, info: CdpTargetInfo, parentKey: string | null): TargetRecord {
  return { ...info, parentKey, budget: new TargetFloodBudget(clock), logsOff: false, release: undefined, resume: undefined }
}

export const isFrameTarget = (t: CdpTargetInfo): boolean => t.sessionKey === TOP_TARGET || t.type === 'iframe'

/** Why the debugger detached: a closing view detaches with "target closed" before `isDestroyed()` turns true (commit-8 probe). */
export function detachCause(contents: CdpWebContents, reason: string): CdpDetachCause {
  if (contents.isDestroyed()) return 'viewClosed'
  if (reason === TARGET_CLOSED_REASON && !contents.isDevToolsOpened()) return 'viewClosed'
  return 'other'
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

export interface CdpTargetLogsDeps {
  readonly clock: Clock
  readonly source: FailedRequestSource
  readonly buffer: BrowserLogBuffer
  /** Fire and forget one command at a target. */
  readonly fire: (method: string, sessionKey: string, params?: unknown) => void
  /** Whether `target` is still the one attached under its key. */
  readonly isCurrent: (target: TargetRecord) => boolean
  /** The frame key a target's entries go under when they have no frame of their own. */
  readonly rootFrameKey: (target: TargetRecord) => string
  /** A target's flood budget tripped (after its logs went off). */
  readonly onTruncated: (target: TargetRecord) => void
}

export class CdpTargetLogs {
  constructor(private readonly deps: CdpTargetLogsDeps) {}

  enable(target: TargetRecord): void {
    this.deps.fire('Runtime.enable', target.sessionKey)
    this.deps.fire('Log.enable', target.sessionKey)
    if (this.deps.source === 'network') this.deps.fire('Network.enable', target.sessionKey, NETWORK_ENABLE_PARAMS)
  }

  /** The flood budget tripped: logs off until the next navigation, and the snapshot says "logs truncated". */
  tripped(target: TargetRecord): void {
    target.logsOff = true
    this.deps.buffer.markTruncated(this.deps.rootFrameKey(target))
    this.deps.fire('Runtime.disable', target.sessionKey)
    this.deps.fire('Log.disable', target.sessionKey)
    if (this.deps.source === 'network') this.deps.fire('Network.disable', target.sessionKey)
    logger.warn('Browser CDP: flood budget exceeded, logs off until navigation', { targetType: target.type })
    this.deps.onTruncated(target)
  }

  /** A new document: the budget starts afresh, and logs a flood turned off come back on. */
  rearm(target: TargetRecord): void {
    target.budget.reset()
    if (!target.logsOff) return
    target.logsOff = false
    this.enable(target)
  }

  /** Release the target's console objects after {@link CONSOLE_RELEASE_DELAY_MS}, once per burst. */
  scheduleRelease(target: TargetRecord): void {
    if (target.release !== undefined) return
    target.release = this.deps.clock.setTimeout(() => {
      target.release = undefined
      if (!this.deps.isCurrent(target)) return
      this.deps.fire('Runtime.releaseObjectGroup', target.sessionKey, { objectGroup: CONSOLE_OBJECT_GROUP })
      this.deps.fire('Runtime.discardConsoleEntries', target.sessionKey)
    }, CONSOLE_RELEASE_DELAY_MS)
  }
}
