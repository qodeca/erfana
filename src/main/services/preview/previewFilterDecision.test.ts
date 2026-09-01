// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for `decideRequest` (Issue #74, work item 6). Pure allow/deny logic
 * only — never a real network request (design §7 test row 7a).
 */

import { describe, it, expect } from 'vitest'
import { decideRequest } from './previewFilterDecision'

const allowed = new Set(['https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'])

describe('decideRequest', () => {
  it('allows an https request to an allowlisted host', () => {
    expect(decideRequest('https://cdn.jsdelivr.net/npm/foo.js', allowed)).toEqual({
      action: 'allow'
    })
  })

  it('cancels an https request to a host not on the allowlist', () => {
    expect(decideRequest('https://evil.example/collect', allowed)).toEqual({
      action: 'cancel',
      reason: 'blocked-host',
      host: 'https://evil.example'
    })
  })

  it('treats a redirect target to a non-allowlisted host as a cancel', () => {
    // A redirect hop re-enters the filter with the new URL; decideRequest is
    // stateless, so the hop is decided exactly like any other request.
    expect(decideRequest('https://tracker.example/beacon', allowed)).toEqual({
      action: 'cancel',
      reason: 'blocked-host',
      host: 'https://tracker.example'
    })
  })

  it('refuses an erfana-preview: target even against a populated allowlist', () => {
    const verdict = decideRequest('erfana-preview://deadbeef/.env', allowed)
    expect(verdict).toEqual({
      action: 'cancel',
      reason: 'insecure-scheme',
      host: 'deadbeef'
    })
  })

  it('normalises an IDN host to punycode before the allowlist check', () => {
    const punycodeAllowed = new Set(['https://xn--mnchen-3ya.de'])
    expect(decideRequest('https://münchen.de/app.js', punycodeAllowed)).toEqual({
      action: 'allow'
    })
  })

  it('lower-cases the host before the allowlist check', () => {
    expect(decideRequest('https://CDN.jsDelivr.NET/x', allowed)).toEqual({ action: 'allow' })
  })

  /*
   * DELETED: "refuses http (insecure) even to an allowlisted host".
   *
   * The defect it named ceased to exist rather than going untested. http is an
   * approvable scheme now (#108), so a grant to `https://cdn.jsdelivr.net` no
   * longer says anything about `http://cdn.jsdelivr.net` — they are two origins
   * and the second one is simply not on the list. The two assertions that
   * mattered are both kept below: an http URL is still refused when it has not
   * been granted, and granting the https origin grants nothing over http.
   */
  it('refuses an http origin that has not been granted, and it is not a SCHEME refusal', () => {
    expect(decideRequest('http://cdn.jsdelivr.net/x', allowed)).toEqual({
      action: 'cancel',
      // `blocked-host`, not `insecure-scheme` — which is what puts an Allow
      // button on the row instead of a dead end with no reason.
      reason: 'blocked-host',
      host: 'http://cdn.jsdelivr.net'
    })
  })

  it('does not let an https grant leak to the http origin of the same host', () => {
    // Two origins, two grants. The scheme is part of what was consented to.
    const httpAllowed = new Set(['http://cdn.jsdelivr.net'])
    expect(decideRequest('http://cdn.jsdelivr.net/x', httpAllowed)).toEqual({ action: 'allow' })
    expect(decideRequest('https://cdn.jsdelivr.net/x', httpAllowed)).toEqual({
      action: 'cancel',
      reason: 'blocked-host',
      host: 'https://cdn.jsdelivr.net'
    })
  })

  it('drops the default port per scheme, so :80 on http is the same origin', () => {
    const httpAllowed = new Set(['http://cdn.jsdelivr.net'])
    expect(decideRequest('http://cdn.jsdelivr.net:80/x', httpAllowed)).toEqual({ action: 'allow' })
    // But :80 on HTTPS is a non-default port, and therefore a different grant.
    expect(decideRequest('https://cdn.jsdelivr.net:80/x', allowed)).toEqual({
      action: 'cancel',
      reason: 'blocked-host',
      host: 'https://cdn.jsdelivr.net:80'
    })
  })

  it('refuses websocket and other remote schemes', () => {
    expect(decideRequest('wss://cdn.jsdelivr.net/socket', allowed).action).toBe('cancel')
    expect(decideRequest('ftp://cdn.jsdelivr.net/file', allowed).action).toBe('cancel')
  })

  it('allows non-egress pseudo-schemes gated by the CSP', () => {
    expect(decideRequest('data:image/png;base64,AAAA', allowed)).toEqual({ action: 'allow' })
    expect(decideRequest('blob:https://x/abc', allowed)).toEqual({ action: 'allow' })
    expect(decideRequest('about:blank', allowed)).toEqual({ action: 'allow' })
  })

  it('cancels a malformed URL with an empty host', () => {
    expect(decideRequest('not a url', allowed)).toEqual({
      action: 'cancel',
      reason: 'insecure-scheme',
      host: ''
    })
  })
})

describe('decideRequest — the port, which the two gates used to disagree about', () => {
  it('does not treat a non-default port as covered by the bare host', () => {
    // THE BUG THIS CHANGE EXISTS TO CLOSE. This used to compare `parsed.hostname`
    // and ignore the port entirely, so it allowed `:8443` while the CSP — whose
    // host-source carried no port, and a source with no port matches only the
    // scheme's default — refused it. The band then subtracted the allowed HOST
    // from the blocked list and reported "Allowed ✓" for a resource that could
    // never load, with no control anywhere that could fix it.
    const allowedOrigins = new Set(['https://example.com'])
    expect(decideRequest('https://example.com:8443/x.js', allowedOrigins)).toEqual({
      action: 'cancel',
      reason: 'blocked-host',
      host: 'https://example.com:8443'
    })
  })

  it('allows the port once the port itself has been approved', () => {
    const allowedOrigins = new Set(['https://example.com:8443'])
    expect(decideRequest('https://example.com:8443/x.js', allowedOrigins)).toEqual({
      action: 'allow'
    })
    // And approving the port grants nothing on the default one. A grant is the
    // origin, not the host.
    expect(decideRequest('https://example.com/x.js', allowedOrigins)).toEqual({
      action: 'cancel',
      reason: 'blocked-host',
      host: 'https://example.com'
    })
  })

  it('treats the explicit default port as the same origin', () => {
    // `:443` is canonicalised away, so a page writing it in full is not a
    // different grant.
    const allowedOrigins = new Set(['https://example.com'])
    expect(decideRequest('https://example.com:443/x.js', allowedOrigins)).toEqual({
      action: 'allow'
    })
  })

  it('never lets a blob: URL borrow an origin it does not have', () => {
    // `new URL('blob:https://cdn.jsdelivr.net/uuid').origin` is a clean
    // `https://cdn.jsdelivr.net` while its hostname is empty. The blob branch
    // returns before the https branch, and the https branch re-serialises from
    // the parsed parts rather than reading `.origin` — either alone would do,
    // and both are deliberate.
    expect(new URL('blob:https://cdn.jsdelivr.net/uuid').origin).toBe('https://cdn.jsdelivr.net')
    expect(decideRequest('blob:https://cdn.jsdelivr.net/uuid', allowed)).toEqual({
      action: 'allow'
    })
  })
})
