// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** What a served local folder serves, by fetch metadata (spec 025, 025-FR-005 rule 1; S-7). */
import { describe, expect, it, vi } from 'vitest'
import {
  decideLocalRequest,
  LOCAL_REFUSAL_HEADERS,
  LOCAL_SANDBOX_POLICY,
  localResponseHeaders,
  SERVED_DESTINATIONS
} from './localResponsePolicy'

const armed = (): boolean => true
const unarmed = (): boolean => false

describe('decideLocalRequest', () => {
  it.each([undefined, 'empty', 'serviceworker', 'sharedworker', 'object', 'embed', 'report', 'webidentity'])(
    'refuses the destination %s (script reads, workers that outlive the page, plugins, non-browsers)',
    (dest) => {
      expect(decideLocalRequest({ dest, site: 'same-origin' }, armed)).toEqual({ serve: false })
    }
  )

  it('serves an armed top-level document with the folder origin, and uses the arm', () => {
    const consume = vi.fn(armed)
    expect(decideLocalRequest({ dest: 'document', site: 'none' }, consume)).toEqual({ serve: true, document: true, sandbox: false })
    expect(consume).toHaveBeenCalledTimes(1)
  })

  it('sandboxes every other document: unarmed top loads and every frame (S-7)', () => {
    expect(decideLocalRequest({ dest: 'document', site: 'same-origin' }, unarmed)).toEqual({ serve: true, document: true, sandbox: true })
    const consume = vi.fn(armed)
    for (const dest of ['iframe', 'frame']) {
      expect(decideLocalRequest({ dest, site: 'same-origin' }, consume)).toEqual({ serve: true, document: true, sandbox: true })
    }
    expect(consume).not.toHaveBeenCalled()
  })

  it('serves a worker from its own folder only', () => {
    expect(decideLocalRequest({ dest: 'worker', site: 'same-origin' }, armed)).toEqual({ serve: true, document: false, sandbox: false })
    expect(decideLocalRequest({ dest: 'worker', site: 'cross-site' }, armed)).toEqual({ serve: false })
    expect(decideLocalRequest({ dest: 'worker', site: undefined }, armed)).toEqual({ serve: false })
  })

  it('serves a subresource the page asked for, never a browser-started one', () => {
    for (const dest of ['script', 'style', 'image', 'font', 'audio', 'video', 'track', 'manifest']) {
      expect(decideLocalRequest({ dest, site: 'same-origin' }, unarmed)).toEqual({ serve: true, document: false, sandbox: false })
      // From a sandboxed document (an opaque origin) the request is cross-site.
      expect(decideLocalRequest({ dest, site: 'cross-site' }, unarmed)).toMatchObject({ serve: true })
      expect(decideLocalRequest({ dest, site: 'none' }, unarmed)).toEqual({ serve: false })
      expect(decideLocalRequest({ dest, site: undefined }, unarmed)).toEqual({ serve: false })
    }
  })

  it('lists exactly the destinations of 025-FR-005 rule 1', () => {
    expect([...SERVED_DESTINATIONS].sort()).toEqual(
      ['audio', 'document', 'font', 'frame', 'iframe', 'image', 'manifest', 'script', 'style', 'track', 'video', 'worker'].sort()
    )
  })
})

describe('localResponseHeaders', () => {
  it('never caches, never sniffs and never sends a referrer; no resource policy, which would block sandboxed documents', () => {
    expect(localResponseHeaders('text/css', 12, { document: false, sandbox: false })).toEqual({
      'Content-Type': 'text/css',
      'Content-Length': '12',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    })
  })

  it('gives documents an opener policy, and sandboxed ones the sandbox', () => {
    const top = localResponseHeaders('text/html', 1, { document: true, sandbox: false })
    expect(top['Cross-Origin-Opener-Policy']).toBe('noopener-allow-popups')
    expect(top).not.toHaveProperty('Content-Security-Policy')
    const framed = localResponseHeaders('text/html', 1, { document: true, sandbox: true })
    expect(framed['Content-Security-Policy']).toBe(LOCAL_SANDBOX_POLICY)
    expect(LOCAL_SANDBOX_POLICY).not.toContain('allow-same-origin')
    expect(LOCAL_SANDBOX_POLICY).not.toContain('allow-popups')
  })

  it('refuses with no body and nothing to cache', () => {
    expect(LOCAL_REFUSAL_HEADERS).toEqual({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': '0' })
  })
})
