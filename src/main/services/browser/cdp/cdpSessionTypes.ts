// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The public shapes of `BrowserCdpSession`: target info, detach info, the
 * events it emits and the hang-probe controls a tab drives. Re-exported by
 * `BrowserCdpSession.ts`.
 */
import type { HangProbeEvent, HangProbeSuspension } from './browserHangProbe'

export interface CdpTargetInfo {
  /** Flattened session id; `TOP_TARGET` (empty) for the top target. */
  readonly sessionKey: string
  readonly targetId: string
  /** CDP target type: `page` (top), `iframe`, `worker`, `service_worker`, `shared_worker`, … */
  readonly type: string
  readonly url: string
}

/**
 * Why the debugger went away. Electron reports the reason "target closed" for
 * both a closed view and DevTools taking over (inferred from Electron's
 * source), so the cause is read from the view's state at the event.
 */
export type CdpDetachCause = 'devtools' | 'viewClosed' | 'other'

export interface CdpDetachInfo {
  readonly cause: CdpDetachCause
  /** Electron's reason text, for the log. */
  readonly reason: string
}

export interface CdpProtocolEvent {
  readonly target: CdpTargetInfo
  readonly method: string
  readonly params: unknown
}

export interface BrowserCdpSessionEvents {
  /** The debugger detached without Erfana asking: pick is unavailable until re-attached. */
  detached: CdpDetachInfo
  hang: HangProbeEvent
  targetAttached: CdpTargetInfo
  targetDetached: CdpTargetInfo
  /** A target went over its flood budget; its logs are off until it navigates. */
  logsTruncated: CdpTargetInfo
  /** Every event outside `Runtime`, `Log` and `Network` (pick, freeze, dialogs listen here). */
  protocolEvent: CdpProtocolEvent
}

/** The hang-probe controls the tab drives. */
export interface HangProbeControl {
  readonly isHung: boolean
  setVisible(visible: boolean): void
  suspend(reason: Exclude<HangProbeSuspension, 'detached'>): void
  resume(reason: Exclude<HangProbeSuspension, 'detached'>): void
  wait(): void
}
