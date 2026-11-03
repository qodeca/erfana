// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Turns CDP `Runtime`, `Log` and `Network` events into log-buffer entries
 * (spec 025, 025-FR-038; solution design § 6.3; ADR 0007 decision 2).
 *
 * - Console: `Runtime.consoleAPICalled` of type `error`, `assert` (error) and
 *   `warning`; `Runtime.exceptionThrown` (uncaught exceptions and unhandled
 *   rejections, error); `Log.entryAdded` errors and warnings from any source
 *   but `network` and `violation`.
 * - Failed requests, by the source the session picks (`BrowserCdpSession`
 *   defaults to `network`: the commit-8 probe found only it reports a
 *   dedicated worker's failed request):
 *   - `log`: `Log.entryAdded` with source `network` and level
 *     `error`; the status is read from the engine's message
 *     (`status of 500`, `net::ERR_…`); `net::ERR_ABORTED` (cancelled) skipped.
 *   - `network`: a request-id map, bounded at {@link MAX_TRACKED_REQUESTS}
 *     (oldest dropped), filled by `requestWillBeSent`, dropped at
 *     `loadingFinished` / `loadingFailed`; HTTP status ≥ 400 and
 *     non-cancelled `loadingFailed` are failures.
 *
 * A frame's default execution context being created is its new document: the
 * frame's entries are cleared, except when `Runtime.enable` replays a context
 * this collector already knows.
 */
import type { BrowserLogBuffer } from './browserLogBuffer'
import { isRecord } from './cdpTypes'

export type FailedRequestSource = 'log' | 'network'

export const MAX_TRACKED_REQUESTS = 500

/** The target an event came from, as the collector needs it. */
export interface LogScope {
  /** Unique per attached target (the flattened session id, `''` for the top target). */
  readonly sessionKey: string
  /** Where entries with no frame of their own go (Log entries, workers). */
  readonly rootFrameKey: string
  /** The origin shown for entries with no known frame origin. */
  rootOrigin(): string
}

interface ContextInfo {
  readonly frameKey: string
  readonly origin: string
}

interface TrackedRequest {
  readonly sessionKey: string
  url: string
  frameKey: string
  frameOrigin: string
  recorded: boolean
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Text of one console argument (a CDP `RemoteObject`). */
function argumentText(arg: unknown): string {
  if (!isRecord(arg)) return ''
  if (arg.type === 'string' && typeof arg.value === 'string') return arg.value
  if (arg.value !== undefined && arg.value !== null && typeof arg.value !== 'object') return String(arg.value)
  if (typeof arg.description === 'string') return arg.description
  if (typeof arg.unserializableValue === 'string') return arg.unserializableValue
  return str(arg.subtype) || str(arg.type)
}

/** The status in an engine "Failed to load resource" message, or null for a cancelled request. */
export function statusFromLogText(text: string): string | null {
  if (text.includes('net::ERR_ABORTED')) return null
  const http = /status of (\d{3})\b/.exec(text)
  if (http) return http[1]
  const net = /net::ERR_[A-Z0-9_]+/.exec(text)
  return net ? net[0] : 'failed'
}

export class CdpLogCollector {
  private readonly contexts = new Map<string, Map<number, ContextInfo>>()
  private readonly frameOrigins = new Map<string, string>()
  private readonly requests = new Map<string, TrackedRequest>()

  constructor(
    private readonly buffer: BrowserLogBuffer,
    private readonly source: FailedRequestSource
  ) {}

  /**
   * Handles one event.
   *
   * @returns true when it was a console API call, whose objects the caller
   *   should release (ADR 0007 decision 2, P7)
   */
  handle(scope: LogScope, method: string, params: unknown): boolean {
    if (!isRecord(params)) return false
    switch (method) {
      case 'Runtime.executionContextCreated':
        this.contextCreated(scope, params.context)
        return false
      case 'Runtime.executionContextDestroyed':
        if (typeof params.executionContextId === 'number') this.contextsOf(scope).delete(params.executionContextId)
        return false
      case 'Runtime.executionContextsCleared':
        this.contextsOf(scope).clear()
        return false
      case 'Runtime.consoleAPICalled':
        this.consoleCalled(scope, params)
        return true
      case 'Runtime.exceptionThrown':
        this.exceptionThrown(scope, params.exceptionDetails)
        return false
      case 'Log.entryAdded':
        this.logEntry(scope, params.entry)
        return false
      default:
        if (this.source === 'network' && method.startsWith('Network.')) this.networkEvent(scope, method, params)
        return false
    }
  }

  /** The target detached: its contexts and tracked requests go. */
  forgetTarget(sessionKey: string): void {
    this.contexts.delete(sessionKey)
    for (const [key, request] of this.requests) if (request.sessionKey === sessionKey) this.requests.delete(key)
  }

  /** Detach or a new top-level document: everything goes. */
  reset(): void {
    this.contexts.clear()
    this.frameOrigins.clear()
    this.requests.clear()
  }

  /** Number of requests tracked in `network` mode (for the bound tests). */
  get trackedRequests(): number {
    return this.requests.size
  }

  private contextsOf(scope: LogScope): Map<number, ContextInfo> {
    let map = this.contexts.get(scope.sessionKey)
    if (!map) {
      map = new Map()
      this.contexts.set(scope.sessionKey, map)
    }
    return map
  }

  private contextCreated(scope: LogScope, context: unknown): void {
    if (!isRecord(context) || typeof context.id !== 'number') return
    const aux = isRecord(context.auxData) ? context.auxData : {}
    const frameKey = str(aux.frameId) || scope.rootFrameKey
    const origin = str(context.origin) || scope.rootOrigin()
    const contexts = this.contextsOf(scope)
    const replayed = contexts.has(context.id)
    contexts.set(context.id, { frameKey, origin })
    if (aux.isDefault !== true) return
    this.frameOrigins.set(frameKey, origin)
    if (!replayed) this.buffer.clearFrame(frameKey)
  }

  private where(scope: LogScope, contextId: unknown): ContextInfo {
    const known = typeof contextId === 'number' ? this.contextsOf(scope).get(contextId) : undefined
    return known ?? { frameKey: scope.rootFrameKey, origin: scope.rootOrigin() }
  }

  private consoleCalled(scope: LogScope, params: Record<string, unknown>): void {
    const level = params.type === 'error' || params.type === 'assert' ? 'error' : params.type === 'warning' ? 'warning' : null
    if (!level) return
    const args = Array.isArray(params.args) ? params.args : []
    const { frameKey, origin } = this.where(scope, params.executionContextId)
    this.buffer.addConsole(frameKey, origin, level, args.map(argumentText).join(' '))
  }

  private exceptionThrown(scope: LogScope, details: unknown): void {
    if (!isRecord(details)) return
    const exception = isRecord(details.exception) ? details.exception : {}
    const message = [str(details.text), str(exception.description)].filter(Boolean).join(' ')
    const { frameKey, origin } = this.where(scope, details.executionContextId)
    this.buffer.addConsole(frameKey, origin, 'error', message)
  }

  private logEntry(scope: LogScope, entry: unknown): void {
    if (!isRecord(entry)) return
    const level = entry.level === 'error' ? 'error' : entry.level === 'warning' ? 'warning' : null
    if (!level) return
    const origin = scope.rootOrigin()
    if (entry.source === 'network') {
      if (this.source !== 'log' || level !== 'error') return
      const status = statusFromLogText(str(entry.text))
      if (status) this.buffer.addFailedRequest(scope.rootFrameKey, origin, status, str(entry.url))
      return
    }
    if (entry.source === 'violation') return
    this.buffer.addConsole(scope.rootFrameKey, origin, level, str(entry.text))
  }

  private networkEvent(scope: LogScope, method: string, params: Record<string, unknown>): void {
    const requestId = str(params.requestId)
    if (!requestId) return
    const key = `${scope.sessionKey}\u0000${requestId}`
    switch (method) {
      case 'Network.requestWillBeSent':
        this.track(scope, key, params)
        return
      case 'Network.responseReceived':
        this.responseReceived(key, params.response)
        return
      case 'Network.loadingFinished':
        this.requests.delete(key)
        return
      case 'Network.loadingFailed':
        this.loadingFailed(scope, key, params)
        return
    }
  }

  private track(scope: LogScope, key: string, params: Record<string, unknown>): void {
    const request = isRecord(params.request) ? params.request : {}
    const frameId = str(params.frameId)
    const frameKey = frameId || scope.rootFrameKey
    const frameOrigin = this.frameOrigins.get(frameKey) ?? scope.rootOrigin()
    const existing = this.requests.get(key)
    if (existing) {
      // A redirect reuses the request id; the newest URL is the one that failed.
      existing.url = str(request.url)
      return
    }
    this.requests.set(key, { sessionKey: scope.sessionKey, url: str(request.url), frameKey, frameOrigin, recorded: false })
    if (this.requests.size > MAX_TRACKED_REQUESTS) {
      const oldest = this.requests.keys().next().value
      if (oldest !== undefined) this.requests.delete(oldest)
    }
  }

  private responseReceived(key: string, response: unknown): void {
    const request = this.requests.get(key)
    if (!request || !isRecord(response) || typeof response.status !== 'number' || response.status < 400) return
    request.recorded = true
    this.buffer.addFailedRequest(request.frameKey, request.frameOrigin, String(response.status), str(response.url) || request.url)
  }

  private loadingFailed(scope: LogScope, key: string, params: Record<string, unknown>): void {
    const request = this.requests.get(key)
    this.requests.delete(key)
    if (params.canceled === true || request?.recorded) return
    const cors = isRecord(params.corsErrorStatus) ? str(params.corsErrorStatus.corsError) : ''
    const blocked = str(params.blockedReason)
    const status = blocked ? `blocked:${blocked}` : cors ? `cors:${cors}` : str(params.errorText) || 'failed'
    // An evicted request (over the bound) is still a failure; its URL is lost.
    const frameKey = request?.frameKey ?? scope.rootFrameKey
    const frameOrigin = request?.frameOrigin ?? scope.rootOrigin()
    this.buffer.addFailedRequest(frameKey, frameOrigin, status, request?.url ?? '')
  }
}
