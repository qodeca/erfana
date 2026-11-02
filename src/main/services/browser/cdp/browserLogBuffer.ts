// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Recent console and network errors per frame (spec 025, 025-FR-038; solution
 * design § 6.3).
 *
 * Each frame (keyed by its CDP frame id, or a worker's target key) keeps its
 * last {@link LOG_BUFFER_MAX_ENTRIES} console entries – errors and warnings,
 * exceptions included – and its last {@link LOG_BUFFER_MAX_ENTRIES} failed
 * requests. A frame's lists are cleared when it gets a new document. At pick
 * time {@link BrowserLogBuffer.snapshot} merges every frame in time order and
 * keeps the last 20 of each list: a frozen copy, so later page activity never
 * changes a held capture (025-FR-053).
 *
 * Messages are cut to {@link LOG_MESSAGE_MAX_CODE_UNITS}; URLs go through
 * {@link failedRequestUrl}. Nothing here is logged (025-FR-064).
 */
import type { Clock } from '../../../../shared/clock'
import { cutAtCodeUnits } from '../../../../shared/browser/textCut'

export const LOG_BUFFER_MAX_ENTRIES = 20
export const LOG_MESSAGE_MAX_CODE_UNITS = 500
/** Longest failed-request URL kept; a longer one is cut (a `data:` URL can be megabytes). */
export const LOG_URL_MAX_CODE_UNITS = 2048

export type ConsoleLevel = 'error' | 'warning'

export interface LoggedConsoleEntry {
  /** Clock time at receipt, ms. */
  readonly timeMs: number
  readonly frameOrigin: string
  readonly level: ConsoleLevel
  readonly message: string
}

export interface LoggedFailedRequest {
  readonly timeMs: number
  readonly frameOrigin: string
  /** HTTP status (`"500"`), or the engine's error (`"net::ERR_NAME_NOT_RESOLVED"`, `"blocked:mixed-content"`). */
  readonly status: string
  readonly url: string
}

export interface LogSnapshot {
  readonly console: readonly LoggedConsoleEntry[]
  readonly failedRequests: readonly LoggedFailedRequest[]
  /** True when a flood budget turned a frame's logs off since its last new document (S-14). */
  readonly truncated: boolean
}

interface Sequenced<T> {
  readonly seq: number
  readonly entry: T
}

interface FrameLog {
  console: Sequenced<LoggedConsoleEntry>[]
  failedRequests: Sequenced<LoggedFailedRequest>[]
  truncated: boolean
}

/**
 * The failed-request URL as the context file shows it: userinfo and fragment
 * removed (they never reach a server and can hold credentials); `data:` URLs
 * reduced to their media type; then cut to {@link LOG_URL_MAX_CODE_UNITS}.
 * Path and query are kept, as 025-FR-042 allows for browser URLs.
 */
export function failedRequestUrl(raw: string): string {
  let text = raw
  if (/^data:/i.test(raw)) {
    const comma = raw.indexOf(',')
    text = `${comma === -1 ? raw : raw.slice(0, comma)},…`
  } else {
    try {
      const url = new URL(raw)
      url.username = ''
      url.password = ''
      url.hash = ''
      text = url.href
    } catch {
      // Not a parseable URL: keep the text, still cut below.
    }
  }
  return cutAtCodeUnits(text, LOG_URL_MAX_CODE_UNITS)
}

function pushBounded<T>(list: Sequenced<T>[], item: Sequenced<T>): void {
  list.push(item)
  if (list.length > LOG_BUFFER_MAX_ENTRIES) list.splice(0, list.length - LOG_BUFFER_MAX_ENTRIES)
}

function lastInOrder<T>(lists: readonly Sequenced<T>[][]): readonly T[] {
  return Object.freeze(
    lists
      .flat()
      .sort((a, b) => a.seq - b.seq)
      .slice(-LOG_BUFFER_MAX_ENTRIES)
      .map(s => s.entry)
  )
}

export class BrowserLogBuffer {
  private readonly frames = new Map<string, FrameLog>()
  private seq = 0

  constructor(private readonly clock: Clock) {}

  private frame(frameKey: string): FrameLog {
    let log = this.frames.get(frameKey)
    if (!log) {
      log = { console: [], failedRequests: [], truncated: false }
      this.frames.set(frameKey, log)
    }
    return log
  }

  addConsole(frameKey: string, frameOrigin: string, level: ConsoleLevel, message: string): void {
    const entry: LoggedConsoleEntry = Object.freeze({
      timeMs: this.clock.now(),
      frameOrigin,
      level,
      message: cutAtCodeUnits(message, LOG_MESSAGE_MAX_CODE_UNITS)
    })
    pushBounded(this.frame(frameKey).console, { seq: ++this.seq, entry })
  }

  addFailedRequest(frameKey: string, frameOrigin: string, status: string, url: string): void {
    const entry: LoggedFailedRequest = Object.freeze({
      timeMs: this.clock.now(),
      frameOrigin,
      status: cutAtCodeUnits(status, LOG_MESSAGE_MAX_CODE_UNITS),
      url: failedRequestUrl(url)
    })
    pushBounded(this.frame(frameKey).failedRequests, { seq: ++this.seq, entry })
  }

  /** Records that a flood budget cut this frame's logs off. */
  markTruncated(frameKey: string): void {
    this.frame(frameKey).truncated = true
  }

  /** A new document in the frame: its entries and truncation note go. */
  clearFrame(frameKey: string): void {
    this.frames.delete(frameKey)
  }

  /** A new top-level document, a crash or a detach: every frame goes. */
  clearAll(): void {
    this.frames.clear()
  }

  /** A frozen copy of the last 20 entries of each list across all frames, in time order. */
  snapshot(): LogSnapshot {
    const logs = [...this.frames.values()]
    return Object.freeze({
      console: lastInOrder(logs.map(l => l.console)),
      failedRequests: lastInOrder(logs.map(l => l.failedRequests)),
      truncated: logs.some(l => l.truncated)
    })
  }
}
