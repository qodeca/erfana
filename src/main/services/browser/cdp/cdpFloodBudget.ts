// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The per-target CDP event budget (spec 025 solution design § 5, ADR 0007
 * decision 3, panel finding S6, spec change S-14).
 *
 * A page can log in a tight loop and bury main in protocol events. Each
 * target may send at most {@link FLOOD_MAX_EVENTS} events and
 * {@link FLOOD_MAX_BYTES} of event payload per {@link FLOOD_WINDOW_MS}
 * window; the first event past either limit trips the budget, and it stays
 * tripped until {@link CdpFloodBudget.reset} (the next navigation). The
 * session then turns the target's log domains off and notes "logs truncated".
 *
 * Windows are fixed (tumbling), starting at the first event after the last
 * window ended; all time comes from the injected clock.
 */
import type { Clock } from '../../../../shared/clock'

export const FLOOD_WINDOW_MS = 1000
export const FLOOD_MAX_EVENTS = 200
export const FLOOD_MAX_BYTES = 1024 * 1024

export class CdpFloodBudget {
  private windowStart = Number.NEGATIVE_INFINITY
  private events = 0
  private bytes = 0
  private tripped = false

  constructor(private readonly clock: Clock) {}

  /**
   * Counts one event of `bytes` payload.
   *
   * @returns true when this event tripped the budget (once per trip); false
   *   while within budget and after it has already tripped
   */
  count(bytes: number): boolean {
    if (this.tripped) return false
    const now = this.clock.now()
    if (now - this.windowStart >= FLOOD_WINDOW_MS) {
      this.windowStart = now
      this.events = 0
      this.bytes = 0
    }
    this.events += 1
    this.bytes += bytes
    if (this.events > FLOOD_MAX_EVENTS || this.bytes > FLOOD_MAX_BYTES) {
      this.tripped = true
      return true
    }
    return false
  }

  get isTripped(): boolean {
    return this.tripped
  }

  /** Starts afresh (a new document in the target). */
  reset(): void {
    this.windowStart = Number.NEGATIVE_INFINITY
    this.events = 0
    this.bytes = 0
    this.tripped = false
  }
}

/** Payload size of an event's params, in UTF-16 units of its JSON (an approximation of bytes). */
export function eventPayloadSize(params: unknown): number {
  try {
    return JSON.stringify(params)?.length ?? 0
  } catch {
    // A cyclic or otherwise unserialisable payload cannot come from the
    // protocol; count it as over any budget rather than as free.
    return Number.POSITIVE_INFINITY
  }
}
