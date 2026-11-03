// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The per-target CDP event budget (spec 025 solution design § 5, ADR 0007
 * decision 3, panel finding S6, spec change S-14, 025-FR-038).
 *
 * A page can log in a tight loop and bury main in protocol events. Only the
 * events the log collector reads are counted, in two classes with their own
 * limits per {@link FLOOD_WINDOW_MS} window:
 * - log events (`Runtime.consoleAPICalled`, `Runtime.exceptionThrown`,
 *   `Log.entryAdded`) – at most {@link FLOOD_MAX_EVENTS} events and
 *   {@link FLOOD_MAX_BYTES} of payload, the 025-FR-038 limits;
 * - the four `Network.*` events the collector reads – at most
 *   {@link FLOOD_MAX_NETWORK_EVENTS} and {@link FLOOD_MAX_NETWORK_BYTES}. A
 *   request costs three of them, so an unbundled dev server's first load (a
 *   few hundred module requests in a second) stays well inside it.
 * Every other event (targets, contexts, `Network.dataReceived`, …) is free:
 * it is either bounded by real page work or not read at all.
 *
 * The payload counted is the text the collector keeps (messages and URLs),
 * read from the fields themselves – no event is serialised to be measured.
 * The first event past either limit of either class trips the budget, and it
 * stays tripped until {@link TargetFloodBudget.reset} (the next navigation).
 * The session then turns the target's log domains off and notes "logs
 * truncated".
 *
 * Windows are fixed (tumbling), starting at the first event after the last
 * window ended; all time comes from the injected clock.
 */
import type { Clock } from '../../../../shared/clock'
import { argumentText } from './cdpLogCollector'
import { isRecord } from './cdpTypes'

export const FLOOD_WINDOW_MS = 1000
export const FLOOD_MAX_EVENTS = 200
export const FLOOD_MAX_BYTES = 1024 * 1024
export const FLOOD_MAX_NETWORK_EVENTS = 2000
export const FLOOD_MAX_NETWORK_BYTES = 8 * 1024 * 1024

export interface FloodLimits {
  readonly events: number
  readonly bytes: number
}

export const LOG_FLOOD_LIMITS: FloodLimits = Object.freeze({ events: FLOOD_MAX_EVENTS, bytes: FLOOD_MAX_BYTES })
export const NETWORK_FLOOD_LIMITS: FloodLimits = Object.freeze({ events: FLOOD_MAX_NETWORK_EVENTS, bytes: FLOOD_MAX_NETWORK_BYTES })

export type FloodClass = 'log' | 'network'

const LOG_METHODS: ReadonlySet<string> = new Set(['Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Log.entryAdded'])
const NETWORK_METHODS: ReadonlySet<string> = new Set([
  'Network.requestWillBeSent',
  'Network.responseReceived',
  'Network.loadingFinished',
  'Network.loadingFailed'
])

/** The budget class `method` counts against, or null when it is free. */
export function floodClassOf(method: string): FloodClass | null {
  if (LOG_METHODS.has(method)) return 'log'
  if (NETWORK_METHODS.has(method)) return 'network'
  return null
}

const len = (v: unknown): number => (typeof v === 'string' ? v.length : 0)

/**
 * Length, in UTF-16 units, of the text the collector reads from one event:
 * the console arguments, the exception text, the log entry's text and URL, a
 * request's URL or error. An approximation of bytes, like the old JSON length,
 * without serialising anything.
 */
export function keptPayloadSize(method: string, params: unknown): number {
  if (!isRecord(params)) return 0
  switch (method) {
    case 'Runtime.consoleAPICalled':
      return Array.isArray(params.args) ? params.args.reduce((sum: number, arg) => sum + argumentText(arg).length, 0) : 0
    case 'Runtime.exceptionThrown': {
      const details = isRecord(params.exceptionDetails) ? params.exceptionDetails : {}
      const exception = isRecord(details.exception) ? details.exception : {}
      return len(details.text) + len(exception.description)
    }
    case 'Log.entryAdded':
      return isRecord(params.entry) ? len(params.entry.text) + len(params.entry.url) : 0
    case 'Network.requestWillBeSent':
      return isRecord(params.request) ? len(params.request.url) : 0
    case 'Network.responseReceived':
      return isRecord(params.response) ? len(params.response.url) : 0
    case 'Network.loadingFailed':
      return len(params.errorText) + len(params.blockedReason)
    default:
      return 0
  }
}

/** One class's tumbling-window counter. */
export class CdpFloodBudget {
  private windowStart = Number.NEGATIVE_INFINITY
  private events = 0
  private bytes = 0
  private tripped = false

  constructor(
    private readonly clock: Clock,
    private readonly limits: FloodLimits = LOG_FLOOD_LIMITS
  ) {}

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
    if (this.events > this.limits.events || this.bytes > this.limits.bytes) {
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

/** A target's two budgets: whichever trips first trips the target, once, until {@link reset}. */
export class TargetFloodBudget {
  private readonly log: CdpFloodBudget
  private readonly network: CdpFloodBudget

  constructor(clock: Clock) {
    this.log = new CdpFloodBudget(clock, LOG_FLOOD_LIMITS)
    this.network = new CdpFloodBudget(clock, NETWORK_FLOOD_LIMITS)
  }

  /**
   * Counts one protocol event; free events cost nothing.
   *
   * @returns true when this event tripped the target (once per trip)
   */
  count(method: string, params: unknown): boolean {
    const kind = floodClassOf(method)
    if (kind === null || this.isTripped) return false
    return (kind === 'log' ? this.log : this.network).count(keptPayloadSize(method, params))
  }

  get isTripped(): boolean {
    return this.log.isTripped || this.network.isTripped
  }

  reset(): void {
    this.log.reset()
    this.network.reset()
  }
}
