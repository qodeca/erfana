// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The hung-page probe (spec 025, 025-FR-056; solution design § 6.3; ADR 0008
 * decision 8; panel findings A8, P10, X16).
 *
 * Chromium's own hung-renderer signal is suppressed while a debugger is
 * attached (inferred, ADR 0007 consequences), so Erfana asks the page itself:
 * `Runtime.evaluate('0')` on the top target, one probe in flight at a time,
 * every {@link HANG_PROBE_INTERVAL_VISIBLE_MS} on the visible tab and every
 * {@link HANG_PROBE_INTERVAL_HIDDEN_MS} on a hidden one. A probe unanswered
 * for {@link HANG_THRESHOLD_MS} (at exactly 5 s, not before) makes the page
 * hung. A hidden tab's hang is reported only when the tab is shown.
 *
 * Suspended – no probe, and a probe in flight forgotten – while any reason
 * holds: frozen (025-FR-028), a JavaScript dialog or `beforeunload` prompt
 * pending (the page's script is legitimately blocked), the view off-screen
 * behind the pick menu, or the session detached.
 *
 * **Wait** ({@link BrowserHangProbe.wait}) closes the notice; it shows again
 * after another 5 s if the same probe is still unanswered (025-FR-056).
 */
import type { Clock, TimerHandle } from '../../../../shared/clock'

export const HANG_PROBE_INTERVAL_VISIBLE_MS = 1000
export const HANG_PROBE_INTERVAL_HIDDEN_MS = 5000
export const HANG_THRESHOLD_MS = 5000

export type HangProbeSuspension = 'frozen' | 'dialog' | 'beforeunload' | 'offScreen' | 'detached'

/**
 * - `hung`: show "This page is not responding".
 * - `responsive`: the page answered after a reported hang; close the notice.
 * - `cleared`: a reported hang can no longer be judged (suspended or
 *   stopped); close the notice without claiming the page recovered.
 */
export type HangProbeEvent = 'hung' | 'responsive' | 'cleared'

export interface HangProbeDeps {
  readonly clock: Clock
  /** Sends the probe; any settlement (answer or protocol error) counts as an answer. */
  readonly evaluate: () => Promise<unknown>
  readonly onEvent: (event: HangProbeEvent) => void
}

export class BrowserHangProbe {
  private started = false
  private visible = false
  private readonly suspensions = new Set<HangProbeSuspension>()
  private ticker: TimerHandle | undefined
  private deadline: TimerHandle | undefined
  /** Generation of the probe in flight; a settlement from another generation is stale. */
  private generation = 0
  private inFlight = false
  private hung = false
  private reported = false

  constructor(private readonly deps: HangProbeDeps) {}

  /** True while the page counts as hung (reported or not). */
  get isHung(): boolean {
    return this.hung
  }

  get isRunning(): boolean {
    return this.started && this.suspensions.size === 0
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.restartTicker()
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.abandon()
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return
    this.visible = visible
    if (visible && this.hung && !this.reported) this.report()
    this.restartTicker()
  }

  suspend(reason: HangProbeSuspension): void {
    if (this.suspensions.has(reason)) return
    this.suspensions.add(reason)
    this.abandon()
  }

  resume(reason: HangProbeSuspension): void {
    if (!this.suspensions.delete(reason)) return
    this.restartTicker()
  }

  /** The user pressed **Wait**: close the notice, judge the same probe again in 5 s. */
  wait(): void {
    if (!this.hung) return
    this.hung = false
    this.reported = false
    if (this.inFlight) this.armDeadline(this.generation)
  }

  /** Drops the probe in flight and the timers; withdraws a reported hang. */
  private abandon(): void {
    this.clearTimers()
    this.generation += 1
    this.inFlight = false
    const wasReported = this.reported
    this.hung = false
    this.reported = false
    if (wasReported) this.deps.onEvent('cleared')
  }

  private clearTimers(): void {
    this.deps.clock.clearInterval(this.ticker)
    this.deps.clock.clearTimeout(this.deadline)
    this.ticker = undefined
    this.deadline = undefined
  }

  private restartTicker(): void {
    this.deps.clock.clearInterval(this.ticker)
    this.ticker = undefined
    if (!this.isRunning) return
    const interval = this.visible ? HANG_PROBE_INTERVAL_VISIBLE_MS : HANG_PROBE_INTERVAL_HIDDEN_MS
    this.ticker = this.deps.clock.setInterval(() => this.tick(), interval)
  }

  private tick(): void {
    if (!this.isRunning || this.inFlight) return
    const generation = ++this.generation
    this.inFlight = true
    this.armDeadline(generation)
    let settled: Promise<unknown>
    try {
      settled = this.deps.evaluate()
    } catch (error) {
      settled = Promise.reject(error)
    }
    settled.then(
      () => this.answered(generation),
      () => this.answered(generation)
    )
  }

  private armDeadline(generation: number): void {
    this.deps.clock.clearTimeout(this.deadline)
    this.deadline = this.deps.clock.setTimeout(() => {
      this.deadline = undefined
      if (generation !== this.generation || !this.inFlight) return
      this.hung = true
      if (this.visible) this.report()
    }, HANG_THRESHOLD_MS)
  }

  private report(): void {
    this.reported = true
    this.deps.onEvent('hung')
  }

  private answered(generation: number): void {
    if (generation !== this.generation) return
    this.inFlight = false
    this.deps.clock.clearTimeout(this.deadline)
    this.deadline = undefined
    const wasReported = this.reported
    this.hung = false
    this.reported = false
    if (wasReported) this.deps.onEvent('responsive')
  }
}
