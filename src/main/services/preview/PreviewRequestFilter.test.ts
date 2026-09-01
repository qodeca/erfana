// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the preview network request filter (Issue #74, work item 23; design
 * §1.2, §2.8, §5(c), §7 test rows 8 + 10).
 *
 * Covers: `onBeforeRequest` registered via the no-filter overload (a single
 * argument); an unapproved host cancelled; `onRequestStarted` only on allow;
 * a redirect hop to a non-allowlisted host cancelled; an `erfana-preview:`
 * redirect target refused even against a populated allowlist; `cspReport`/`ping`
 * badge suppression after the cancel decision; an allowed request that completes
 * produces NO timeout entry; and a genuinely stuck request badged once as a
 * `network-timeout` with no toast (`approvable: false`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreviewFailureType } from '../../../shared/ipc/preview-types'
import { attach, type PreviewFilterContext } from './PreviewRequestFilter'

type OnBeforeListener = (
  details: { id: number; url: string; resourceType: string },
  callback: (response: { cancel?: boolean }) => void
) => void
type SettleListener = (details: { id: number }) => void

/** A fake session whose `webRequest` methods capture their listeners. */
function makeSession(): {
  session: Parameters<typeof attach>[0]
  onBeforeRequest: ReturnType<typeof vi.fn>
  onCompleted: ReturnType<typeof vi.fn>
  onErrorOccurred: ReturnType<typeof vi.fn>
} {
  const onBeforeRequest = vi.fn<(...args: unknown[]) => void>()
  const onCompleted = vi.fn<(...args: unknown[]) => void>()
  const onErrorOccurred = vi.fn<(...args: unknown[]) => void>()
  const session = {
    webRequest: { onBeforeRequest, onCompleted, onErrorOccurred }
  }
  return {
    session: session as unknown as Parameters<typeof attach>[0],
    onBeforeRequest,
    onCompleted,
    onErrorOccurred
  }
}

function makeContext(allowed: string[]): {
  ctx: PreviewFilterContext
  onBlocked: ReturnType<typeof vi.fn>
  onRequestStarted: ReturnType<typeof vi.fn>
  onRequestSettled: ReturnType<typeof vi.fn>
} {
  const set = new Set(allowed)
  const onBlocked =
    vi.fn<(kind: PreviewFailureType, host: string, url: string, approvable: boolean) => void>()
  const onRequestStarted = vi.fn<(id: number) => void>()
  const onRequestSettled = vi.fn<(id: number) => void>()
  return {
    ctx: { getAllowedHosts: () => set, onBlocked, onRequestStarted, onRequestSettled },
    onBlocked,
    onRequestStarted,
    onRequestSettled
  }
}

function details(id: number, url: string, resourceType = 'xhr'): {
  id: number
  url: string
  resourceType: string
} {
  return { id, url, resourceType }
}

const REQUEST_TIMEOUT_MS = 1000
const TIMEOUT_SWEEP_MS = 100
const FILTER_DEPS = { requestTimeoutMs: REQUEST_TIMEOUT_MS, timeoutSweepMs: TIMEOUT_SWEEP_MS }

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('PreviewRequestFilter registration', () => {
  it('registers onBeforeRequest via the no-filter overload (one argument only)', () => {
    const s = makeSession()
    const { ctx } = makeContext([])
    attach(s.session, ctx, FILTER_DEPS)

    expect(s.onBeforeRequest).toHaveBeenCalledTimes(1)
    const call = s.onBeforeRequest.mock.calls[0]
    expect(call).toHaveLength(1)
    expect(typeof call[0]).toBe('function')
  })

  it('detach removes all listeners and stops the sweep', () => {
    const s = makeSession()
    const { ctx, onBlocked } = makeContext(['https://cdn.example'])
    const detach = attach(s.session, ctx, FILTER_DEPS)

    const listener = s.onBeforeRequest.mock.calls[0][0] as OnBeforeListener
    // Start an ALLOWED (in-flight) request that would otherwise time out, then detach.
    listener(details(1, 'https://cdn.example/x'), vi.fn())
    detach()

    expect(s.onBeforeRequest).toHaveBeenLastCalledWith(null)
    expect(s.onCompleted).toHaveBeenLastCalledWith(null)
    expect(s.onErrorOccurred).toHaveBeenLastCalledWith(null)

    // The sweep is cleared, so no network-timeout fires after detach.
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS + TIMEOUT_SWEEP_MS * 2)
    expect(onBlocked).not.toHaveBeenCalled()
  })
})

describe('PreviewRequestFilter gating', () => {
  it('cancels a request to an unapproved host and badges it', () => {
    const s = makeSession()
    const { ctx, onBlocked, onRequestStarted } = makeContext(['https://cdn.jsdelivr.net'])
    attach(s.session, ctx, FILTER_DEPS)
    const listener = s.onBeforeRequest.mock.calls[0][0] as OnBeforeListener

    const callback = vi.fn()
    listener(details(1, 'https://evil.example/collect'), callback)

    expect(callback).toHaveBeenCalledWith({ cancel: true })
    expect(onRequestStarted).not.toHaveBeenCalled()
    expect(onBlocked).toHaveBeenCalledWith(
      'blocked-host',
      // The blocked IDENTITY is the ORIGIN, so the row the reader is offered is
      // the thing that was actually refused — port included.
      'https://evil.example',
      'https://evil.example/collect',
      true,
      // The default `resourceType` in this harness is `xhr`, which maps to
      // `connect` — what the consent row will say the host wanted to do.
      'connect'
    )
  })

  it('allows an approved host and marks it started (no badge)', () => {
    const s = makeSession()
    const { ctx, onBlocked, onRequestStarted } = makeContext(['https://cdn.jsdelivr.net'])
    attach(s.session, ctx, FILTER_DEPS)
    const listener = s.onBeforeRequest.mock.calls[0][0] as OnBeforeListener

    const callback = vi.fn()
    listener(details(7, 'https://cdn.jsdelivr.net/npm/x.js'), callback)

    expect(callback).toHaveBeenCalledWith({ cancel: false })
    expect(onRequestStarted).toHaveBeenCalledWith(7)
    expect(onBlocked).not.toHaveBeenCalled()
  })

  it('cancels a redirect hop to a non-allowlisted host', () => {
    const s = makeSession()
    const { ctx, onBlocked } = makeContext(['https://cdn.jsdelivr.net'])
    attach(s.session, ctx, FILTER_DEPS)
    const listener = s.onBeforeRequest.mock.calls[0][0] as OnBeforeListener

    // Hop 1: the allowlisted origin is allowed.
    const cb1 = vi.fn()
    listener(details(3, 'https://cdn.jsdelivr.net/redirect'), cb1)
    expect(cb1).toHaveBeenCalledWith({ cancel: false })

    // Hop 2: the redirect target re-enters the filter and is cancelled + badged.
    const cb2 = vi.fn()
    listener(details(3, 'https://tracker.example/beacon'), cb2)
    expect(cb2).toHaveBeenCalledWith({ cancel: true })
    expect(onBlocked).toHaveBeenCalledWith(
      'blocked-host',
      'https://tracker.example',
      'https://tracker.example/beacon',
      true,
      'connect'
    )
  })

  it('allows an erfana-preview request even for a sensitive-looking path — the confining protocol handler, not this filter, refuses local reads', () => {
    // The network filter governs REMOTE egress; local `erfana-preview:` reads are
    // gated by `resolveConfined` (realpath confinement + dot-segment / excluded-dir
    // exclusion), which refuses a dotfile like `.env` with a 403. So the filter
    // passes the request through to that handler rather than blanket-cancelling
    // the whole local scheme (which broke the entry page and every subresource).
    const s = makeSession()
    const { ctx, onBlocked, onRequestStarted } = makeContext(['https://cdn.jsdelivr.net'])
    attach(s.session, ctx, FILTER_DEPS)
    const listener = s.onBeforeRequest.mock.calls[0][0] as OnBeforeListener

    const callback = vi.fn()
    listener(details(9, 'erfana-preview://deadbeef/.env'), callback)

    expect(callback).toHaveBeenCalledWith({ cancel: false })
    expect(onRequestStarted).toHaveBeenCalledWith(9)
    expect(onBlocked).not.toHaveBeenCalled()
  })

  it.each([
    ['entry document (mainFrame)', 'mainFrame', 'erfana-preview://deadbeef/index.html'],
    ['relative stylesheet', 'stylesheet', 'erfana-preview://deadbeef/styles.css'],
    ['relative script', 'script', 'erfana-preview://deadbeef/app.js'],
    ['relative image', 'image', 'erfana-preview://deadbeef/logo.svg']
  ])(
    'allows a local erfana-preview request — %s — so the confining protocol handler serves it',
    (_label, resourceType, url) => {
      const s = makeSession()
      const { ctx, onBlocked, onRequestStarted } = makeContext(['https://cdn.jsdelivr.net'])
      attach(s.session, ctx, FILTER_DEPS)
      const listener = s.onBeforeRequest.mock.calls[0][0] as OnBeforeListener

      const callback = vi.fn()
      listener(details(7, url, resourceType), callback)

      // Local, protocol-handled reads are confined by `resolveConfined`, not by
      // this remote-egress filter. Cancelling them here breaks the whole page
      // (ERR_BLOCKED_BY_CLIENT on the entry; broken CSS/JS/images on subresources).
      expect(callback).toHaveBeenCalledWith({ cancel: false })
      expect(onRequestStarted).toHaveBeenCalledWith(7)
      expect(onBlocked).not.toHaveBeenCalled()
    }
  )

  it('still refuses a remote https request to a non-approved host (egress gate intact)', () => {
    const s = makeSession()
    const { ctx, onBlocked, onRequestStarted } = makeContext(['https://cdn.jsdelivr.net'])
    attach(s.session, ctx, FILTER_DEPS)
    const listener = s.onBeforeRequest.mock.calls[0][0] as OnBeforeListener

    const callback = vi.fn()
    listener(details(8, 'https://tracker.example/beacon', 'script'), callback)

    expect(callback).toHaveBeenCalledWith({ cancel: true })
    expect(onRequestStarted).not.toHaveBeenCalled()
    expect(onBlocked).toHaveBeenCalledWith(
      'blocked-host',
      'https://tracker.example',
      'https://tracker.example/beacon',
      true,
      // This case passes `script` as the resource type, so it proves the kind
      // is read from the REQUEST rather than defaulted — the difference
      // between a consent row saying "wants to run a script" and one saying
      // "something", which is the difference the reader decides on.
      'script'
    )
  })

  it('cancels but does NOT badge a cspReport/ping to an unapproved host', () => {
    const s = makeSession()
    const { ctx, onBlocked } = makeContext(['https://cdn.jsdelivr.net'])
    attach(s.session, ctx, FILTER_DEPS)
    const listener = s.onBeforeRequest.mock.calls[0][0] as OnBeforeListener

    const cbPing = vi.fn()
    listener(details(1, 'https://evil.example/beacon', 'ping'), cbPing)
    const cbReport = vi.fn()
    listener(details(2, 'https://evil.example/report', 'cspReport'), cbReport)

    expect(cbPing).toHaveBeenCalledWith({ cancel: true })
    expect(cbReport).toHaveBeenCalledWith({ cancel: true })
    // Cancelled, but the badge noise is suppressed after the cancel decision.
    expect(onBlocked).not.toHaveBeenCalled()
  })
})

describe('PreviewRequestFilter timeout accounting', () => {
  it('produces no timeout entry for an allowed request that completes', () => {
    const s = makeSession()
    const { ctx, onBlocked, onRequestSettled } = makeContext(['https://cdn.jsdelivr.net'])
    attach(s.session, ctx, FILTER_DEPS)

    const before = s.onBeforeRequest.mock.calls[0][0] as OnBeforeListener
    const completed = s.onCompleted.mock.calls[0][0] as SettleListener

    before(details(5, 'https://cdn.jsdelivr.net/npm/x.js'), vi.fn())
    completed({ id: 5 })
    expect(onRequestSettled).toHaveBeenCalledWith(5)

    // Well past the timeout: the completed request must never be swept.
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS + TIMEOUT_SWEEP_MS * 3)
    expect(onBlocked).not.toHaveBeenCalled()
  })

  it('settles an errored request so it is not swept as a timeout', () => {
    const s = makeSession()
    const { ctx, onBlocked, onRequestSettled } = makeContext(['https://cdn.jsdelivr.net'])
    attach(s.session, ctx, FILTER_DEPS)

    const before = s.onBeforeRequest.mock.calls[0][0] as OnBeforeListener
    const errored = s.onErrorOccurred.mock.calls[0][0] as SettleListener

    before(details(6, 'https://cdn.jsdelivr.net/npm/y.js'), vi.fn())
    errored({ id: 6 })
    expect(onRequestSettled).toHaveBeenCalledWith(6)

    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS + TIMEOUT_SWEEP_MS * 3)
    expect(onBlocked).not.toHaveBeenCalled()
  })

  it('badges a genuinely stuck request once as a network-timeout with no toast', () => {
    const s = makeSession()
    const { ctx, onBlocked, onRequestSettled } = makeContext(['https://cdn.jsdelivr.net'])
    attach(s.session, ctx, FILTER_DEPS)

    const before = s.onBeforeRequest.mock.calls[0][0] as OnBeforeListener
    before(details(8, 'https://cdn.jsdelivr.net/npm/slow.js'), vi.fn())

    // The request never settles; advance past the timeout so the sweep fires.
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS + TIMEOUT_SWEEP_MS)

    const timeoutCalls = onBlocked.mock.calls.filter((c) => c[0] === 'network-timeout')
    expect(timeoutCalls).toHaveLength(1)
    // `approvable: false` ⇒ badge only, never a toast.
    expect(timeoutCalls[0][3]).toBe(false)
    expect(onRequestSettled).toHaveBeenCalledWith(8)

    // A second sweep must not double-badge the same request.
    vi.advanceTimersByTime(TIMEOUT_SWEEP_MS * 3)
    expect(onBlocked.mock.calls.filter((c) => c[0] === 'network-timeout')).toHaveLength(1)
  })
})
