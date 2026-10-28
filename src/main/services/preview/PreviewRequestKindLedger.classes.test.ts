// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The request-kind ledger's class rule and `forget` (HTML Preview comments
 * spike S1e; docs/designs/comments/html-preview-comments.md §19 R3-1; M-066). A note
 * is handed back only to a request of its own class – a document load arrives
 * without `user-agent`, every fetch and subresource with one – and a request
 * that fails before the handler drops its note.
 */
import { describe, expect, it } from 'vitest'
import { attach } from './PreviewRequestFilter'
import {
  createPreviewRequestKindLedger,
  requestClassOf,
  resourceTypeClass
} from './PreviewRequestKindLedger'
import {
  FILTER_DEPS,
  details,
  makeContext,
  makeSession,
  type OnBeforeListener,
  type SettleListener
} from './__test-helpers__/previewRequestFilterMocks'

const URL_A = 'erfana-preview://abc123abc123abc123abc123abc123ab/a.html'

describe('request classes', () => {
  it.each([
    ['mainFrame', 'navigation'],
    ['subFrame', 'navigation'],
    ['object', 'navigation'],
    ['xhr', 'subresource'],
    ['script', 'subresource'],
    ['stylesheet', 'subresource'],
    ['image', 'subresource'],
    ['font', 'subresource'],
    ['media', 'subresource'],
    ['other', 'subresource']
  ] as const)('a %s note is of class %s', (resourceType, requestClass) => {
    expect(resourceTypeClass(resourceType)).toBe(requestClass)
  })

  it('a request with user-agent is a subresource, one without is a navigation', () => {
    expect(requestClassOf(new Headers({ 'user-agent': 'x' }))).toBe('subresource')
    expect(requestClassOf(new Headers({ 'User-Agent': 'x' }))).toBe('subresource')
    expect(
      requestClassOf(new Headers({ accept: 'text/html', 'upgrade-insecure-requests': '1' }))
    ).toBe('navigation')
    // Not a request Chromium built: never treated as a document load.
    expect(requestClassOf(undefined)).toBe('subresource')
  })
})

describe('PreviewRequestKindLedger – classes', () => {
  it('hands a document load the document note even when older fetch notes queue before it (S1e)', () => {
    const ledger = createPreviewRequestKindLedger()
    ledger.note(URL_A, 'xhr', 1)
    ledger.note(URL_A, 'xhr', 2)
    ledger.note(URL_A, 'mainFrame', 3)

    expect(ledger.take(URL_A, 'navigation')).toBe('mainFrame')
    expect(ledger.take(URL_A, 'subresource')).toBe('xhr')
    expect(ledger.take(URL_A, 'subresource')).toBe('xhr')
    expect(ledger.take(URL_A, 'navigation')).toBeUndefined()
  })

  it('never hands a document note to a fetch, nor a fetch note to a document load', () => {
    const ledger = createPreviewRequestKindLedger()
    ledger.note(URL_A, 'subFrame', 1)
    expect(ledger.take(URL_A, 'subresource')).toBeUndefined()
    expect(ledger.take(URL_A, 'navigation')).toBe('subFrame')

    ledger.note(URL_A, 'image', 2)
    expect(ledger.take(URL_A, 'navigation')).toBeUndefined()
    expect(ledger.take(URL_A, 'subresource')).toBe('image')
  })

  it('without a class, take is FIFO across classes, as before', () => {
    const ledger = createPreviewRequestKindLedger()
    ledger.note(URL_A, 'xhr')
    ledger.note(URL_A, 'mainFrame')
    expect(ledger.take(URL_A)).toBe('xhr')
    expect(ledger.take(URL_A)).toBe('mainFrame')
  })

  it('M-066 forget drops the note of the request that failed, and only that one', () => {
    const ledger = createPreviewRequestKindLedger()
    ledger.note(URL_A, 'xhr', 10)
    ledger.note(URL_A, 'xhr', 11)
    ledger.forget(10)
    ledger.forget(999)

    expect(ledger.take(URL_A, 'subresource')).toBe('xhr')
    expect(ledger.take(URL_A, 'subresource')).toBeUndefined()
    // A note without an id is never matched by an id.
    ledger.note(URL_A, 'xhr')
    ledger.forget(11)
    expect(ledger.take(URL_A, 'subresource')).toBe('xhr')
  })
})

describe('PreviewRequestFilter – M-066 a failed request drops its note', () => {
  it('notes a preview-scheme request with its id and forgets it on onErrorOccurred', () => {
    const { session, onBeforeRequest, onErrorOccurred } = makeSession()
    const { ctx, ledger } = makeContext([])
    attach(session, ctx, FILTER_DEPS)
    const filter = onBeforeRequest.mock.calls[0][0] as OnBeforeListener
    const onError = onErrorOccurred.mock.calls[0][0] as SettleListener

    filter(details(41, URL_A, 'xhr'), () => {})
    filter(details(42, URL_A, 'mainFrame'), () => {})
    onError({ id: 41 })

    // The aborted fetch left nothing behind; the document's note is intact.
    expect(ledger.take(URL_A, 'subresource')).toBeUndefined()
    expect(ledger.take(URL_A, 'navigation')).toBe('mainFrame')
  })
})
