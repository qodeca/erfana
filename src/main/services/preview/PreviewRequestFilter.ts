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
 * A request carrying the LOCAL `erfana-preview:` scheme — the entry document and
 * every relative subresource it references — is served by the confining
 * `protocol.handle` pipeline (`resolveConfined`: realpath confinement + excluded
 * paths + an unguessable 32-hex root token), which is the real gate for local
 * reads. Under Electron 39 those local requests re-enter this session-scoped
 * filter, so the filter ALLOWS them and lets the handler confine the bytes;
 * blanket-cancelling the scheme here instead broke the entry page
 * (`ERR_BLOCKED_BY_CLIENT`) and every CSS/JS/image subresource (#78).
 *
 * Every OTHER request — and each redirect hop, which re-enters `onBeforeRequest`
 * independently — is classified by the pure `decideRequest` (item 6): a remote
 * load to an approved host is allowed, everything else cancels with
 * `callback({ cancel: true })`. The network filter governs remote EGRESS; the
 * protocol handler governs local reads.
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
import {
  kindFromResourceType,
  type PreviewBlockedKind
} from '../../../shared/ipc/previewBlockedKind'
import { logger } from '../LoggingService'
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
  onBlocked(
    kind: PreviewFailureType,
    host: string,
    url: string,
    approvable: boolean,
    /** What the resource WAS, so a consent row can say more than a hostname. */
    resourceKind: PreviewBlockedKind
  ): void
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
    // Electron requires the callback be invoked with a response object exactly
    // once. `answer` guarantees that: without it, an unexpected throw below would
    // leave the request neither allowed nor cancelled — hung forever.
    let answered = false
    const answer = (response: { cancel: boolean }): void => {
      if (answered) return
      answered = true
      callback(response)
    }

    try {
      // A request carrying the LOCAL `erfana-preview:` scheme — the entry
      // document AND every relative subresource it references (CSS, JS, images,
      // fonts) — is served by the confining `protocol.handle` pipeline, NOT the
      // remote-egress path this filter governs. Under Electron 39 these local
      // requests re-enter this session-scoped filter, so they must be allowed
      // here; otherwise `decideRequest` cancels them all as scheme-confusion and
      // NOTHING renders (ERR_BLOCKED_BY_CLIENT on the entry, broken CSS/JS/images
      // on every subresource — AC6). This grants no read capability: the protocol
      // handler realpath-confines every byte to the served root, and the 32-hex
      // root token is unguessable, so a page can reach only files it already may.
      // The network filter's real job — blocking egress to non-approved remote
      // hosts — is unaffected; `decideRequest` below still governs every https:
      // (and other-scheme) request exactly as before.
      if (isPreviewSchemeUrl(details.url)) {
        inFlight.set(details.id, { startedAt: now(), host: hostOf(details.url), url: details.url })
        ctx.onRequestStarted(details.id)
        answer({ cancel: false })
        return
      }

      const verdict = decideRequest(details.url, ctx.getAllowedHosts())

      if (verdict.action === 'allow') {
        inFlight.set(details.id, { startedAt: now(), host: hostOf(details.url), url: details.url })
        ctx.onRequestStarted(details.id)
        answer({ cancel: false })
        return
      }

      // Cancel FIRST — the refusal must land regardless of badge policy.
      answer({ cancel: true })

      // AFTER the cancel decision: suppress badge noise for `cspReport`/`ping`.
      // These fire in volume from a hostile page (a beacon fan-out); cancelling
      // them still matters, but badging every one would bury the real signal.
      if (details.resourceType === 'cspReport' || details.resourceType === 'ping') {
        return
      }

      const approvable = verdict.reason === 'blocked-host' && isApprovableHost(verdict.host)
      ctx.onBlocked(
        verdict.reason,
        verdict.host,
        details.url,
        approvable,
        kindFromResourceType(details.resourceType)
      )
    } catch (error) {
      // Fail closed: deny by default (matching the filter's posture) and drop any
      // half-recorded in-flight entry so the sweep does not later badge it.
      inFlight.delete(details.id)
      answer({ cancel: true })
      logger.error(
        'Preview request filter listener error',
        error instanceof Error ? error : undefined
      )
    }
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
        // The in-flight record keeps only host, url and a timestamp, so the
      // resource type is genuinely unknown here. `other` says "something",
      // which is honest; inventing a specific kind would not be.
      ctx.onBlocked('network-timeout', req.host, req.url, false, 'other')
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

/** The local preview scheme, matched case-insensitively on the URL prefix. */
const PREVIEW_SCHEME_PREFIX = 'erfana-preview:'

/** True when `url` is an `erfana-preview:` URL (the local, protocol-served scheme). */
function isPreviewSchemeUrl(url: string): boolean {
  try {
    return new URL(url).protocol === PREVIEW_SCHEME_PREFIX
  } catch {
    return false
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
