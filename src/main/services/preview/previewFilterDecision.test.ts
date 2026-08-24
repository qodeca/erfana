// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for `decideRequest` (Issue #74, work item 6). Pure allow/deny logic
 * only — never a real network request (design §7 test row 7a).
 */

import { describe, it, expect } from 'vitest'
import { decideRequest } from './previewFilterDecision'

const allowed = new Set(['cdn.jsdelivr.net', 'fonts.googleapis.com'])

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
      host: 'evil.example'
    })
  })

  it('treats a redirect target to a non-allowlisted host as a cancel', () => {
    // A redirect hop re-enters the filter with the new URL; decideRequest is
    // stateless, so the hop is decided exactly like any other request.
    expect(decideRequest('https://tracker.example/beacon', allowed)).toEqual({
      action: 'cancel',
      reason: 'blocked-host',
      host: 'tracker.example'
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
    const punycodeAllowed = new Set(['xn--mnchen-3ya.de'])
    expect(decideRequest('https://münchen.de/app.js', punycodeAllowed)).toEqual({
      action: 'allow'
    })
  })

  it('lower-cases the host before the allowlist check', () => {
    expect(decideRequest('https://CDN.jsDelivr.NET/x', allowed)).toEqual({ action: 'allow' })
  })

  it('refuses http (insecure) even to an allowlisted host', () => {
    expect(decideRequest('http://cdn.jsdelivr.net/x', allowed)).toEqual({
      action: 'cancel',
      reason: 'insecure-scheme',
      host: 'cdn.jsdelivr.net'
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
