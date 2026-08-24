// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `erfana-preview` network request filter (Issue #74, work item 23; design
 * §1.2, §2.8, §5(c)).
 *
 * `attach` installs `session.webRequest.onBeforeRequest` via the **no-filter
 * overload** (`onBeforeRequest(listener)`, `electron.d.ts:18636`) — with NO
 * `types`/`urls` filter. That is the whole point (X2a): `WebRequestFilter.urls`
 * is required and `types` is an allowlist whose unlisted members
 * (`cspReport`, `ping`, `other`) are never delivered and therefore never
 * cancellable, which would leave `navigator.sendBeacon(...)` a silent
 * exfiltration channel. So EVERY request is observed; the `cspReport`/`ping`
 * badge-noise suppression happens INSIDE the handler, AFTER the cancel decision.
 *
 * Each request — and each redirect hop, which re-enters `onBeforeRequest`
 * independently — is classified by the pure `decideRequest` (item 6). A deny
 * cancels with `callback({ cancel: true })`; an `erfana-preview:` redirect
 * target is always refused regardless of the allowlist (design §1.2).
 *
 * `onCompleted` and `onErrorOccurred` settle in-flight requests so the bounded
 * timeout sweep records `network-timeout` only for genuinely stuck requests, and
 * an allowed request that completes never produces a timeout entry (AC10).
 *
 * Trust model: the request URL and its metadata are untrusted DATA — parsed,
 * classified, allowed or refused; only the hostname is retained, and it is never
 * reflected into a response.
 */

import type { Session } from 'electron'
import type { PreviewFailureType } from '../../../shared/ipc/preview-types'
import { isApprovableHost } from '../../../shared/ipc/preview-settings-schema'
import { decideRequest } from './previewFilterDecision'

/**
 * How long an allowed, still-in-flight request may run before the sweep records
 * a `network-timeout` for it (design AC10). Not in the shared `PREVIEW` constant
 * block (item 3, already built without it); defined here and overridable via
 * {@link PreviewRequestFilterDeps} so the sweep is testable under fake timers.
 * ASSUMPTION: if a shared home is later wanted, move this to the `PREVIEW` block.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** How often the bounded sweep runs (ms). See {@link DEFAULT_REQUEST_TIMEOUT_MS}. */
const DEFAULT_TIMEOUT_SWEEP_MS = 5_000

/**
 * Request-lifetime accounting the filter drives (design §1.2). `onRequestStarted`
 * fires ONLY for requests `onBeforeRequest` allows; `onRequestSettled` fires from
 * BOTH `onCompleted` and `onErrorOccurred`.
 */
export interface PreviewFilterContext {
  /** The currently-approved hosts for this project (ASCII, lower-cased). */
  getAllowedHosts(): ReadonlySet<string>
  /**
   * Record a refused (or timed-out) request as a failure entry. `approvable` is
   * `true` only for a blocked HTTPS host the user could add to the allowlist;
   * the notifier decides whether to also raise a toast.
   */
  onBlocked(kind: PreviewFailureType, host: string, url: string, approvable: boolean): void
  /** A request `onBeforeRequest` allowed and that is now in flight. */
  onRequestStarted(id: number): void
  /** A previously-started request that completed, errored or timed out. */
  onRequestSettled(id: number): void
}

/** Injectable timing/scheduling overrides (all defaulted; tests shrink them). */
export interface PreviewRequestFilterDeps {
  /** In-flight budget before a `network-timeout` (defaults to 30 s). */
  requestTimeoutMs?: number
  /** Sweep cadence (defaults to 5 s). */
  timeoutSweepMs?: number
  /** Monotonic-enough clock for start timestamps (defaults to `Date.now`). */
  now?: () => number
}

/** Metadata retained for an in-flight request so the sweep can badge it. */
interface InFlightRequest {
  readonly startedAt: number
  readonly host: string
  readonly url: string
}

/**
 * Attach the unfiltered network gate to `session` and return a detach function.
 * The detach removes all four `webRequest` listeners and stops the sweep.
 */
export function attach(
  session: Session,
  ctx: PreviewFilterContext,
  deps: PreviewRequestFilterDeps = {}
): () => void {
  const requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const timeoutSweepMs = deps.timeoutSweepMs ?? DEFAULT_TIMEOUT_SWEEP_MS
  const now = deps.now ?? Date.now

  const inFlight = new Map<number, InFlightRequest>()

  // The no-filter overload: NO `types`/`urls` argument, so every request is
  // observed and therefore cancellable (design §5(c), X2a).
  session.webRequest.onBeforeRequest((details, callback) => {
    const verdict = decideRequest(details.url, ctx.getAllowedHosts())

    if (verdict.action === 'allow') {
      inFlight.set(details.id, { startedAt: now(), host: hostOf(details.url), url: details.url })
      ctx.onRequestStarted(details.id)
      callback({ cancel: false })
      return
    }

    // Cancel FIRST — the refusal must land regardless of badge policy.
    callback({ cancel: true })

    // AFTER the cancel decision: suppress badge noise for `cspReport`/`ping`.
    // These fire in volume from a hostile page (a beacon fan-out); cancelling
    // them still matters, but badging every one would bury the real signal.
    if (details.resourceType === 'cspReport' || details.resourceType === 'ping') {
      return
    }

    const approvable = verdict.reason === 'blocked-host' && isApprovableHost(verdict.host)
    ctx.onBlocked(verdict.reason, verdict.host, details.url, approvable)
  })

  const settle = (id: number): void => {
    if (inFlight.delete(id)) {
      ctx.onRequestSettled(id)
    }
  }

  session.webRequest.onCompleted((details) => {
    settle(details.id)
  })
  session.webRequest.onErrorOccurred((details) => {
    settle(details.id)
  })

  // Bounded sweep: a request still in flight past the budget is genuinely stuck;
  // record ONE `network-timeout` (no toast) and settle it so it is swept once.
  const sweep = setInterval(() => {
    const deadline = now() - requestTimeoutMs
    for (const [id, req] of inFlight) {
      if (req.startedAt <= deadline) {
        inFlight.delete(id)
        ctx.onBlocked('network-timeout', req.host, req.url, false)
        ctx.onRequestSettled(id)
      }
    }
  }, timeoutSweepMs)
  // Do not keep the process alive for the sweep alone.
  sweep.unref?.()

  return () => {
    clearInterval(sweep)
    session.webRequest.onBeforeRequest(null)
    session.webRequest.onCompleted(null)
    session.webRequest.onErrorOccurred(null)
    inFlight.clear()
  }
}

/** The hostname of a URL, or `''` when it cannot be parsed (kept for badging). */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}
