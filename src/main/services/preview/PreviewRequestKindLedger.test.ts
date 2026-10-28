// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The request-kind ledger (issue #124, WI-12; design part 2 §2.2): FIFO per
 * URL, at most `REQUEST_KIND_LEDGER_MAX` notes, each forgotten after
 * `REQUEST_KIND_LEDGER_TTL_MS`, and the resource-type → kind mapping that
 * replaced the `sec-fetch-dest` read (spike S1).
 */
import { describe, expect, it } from 'vitest'

import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import {
  REQUEST_KIND_KEY_MAX_CHARS,
  createPreviewRequestKindLedger,
  requestKind
} from './PreviewRequestKindLedger'

const URL_A = 'erfana-preview://abc123abc123abc123abc123abc123ab/a.html'
const URL_B = 'erfana-preview://abc123abc123abc123abc123abc123ab/b.css'

/** A ledger on a clock the test moves by hand. */
function makeLedger() {
  let time = 1_000
  const ledger = createPreviewRequestKindLedger({ now: () => time })
  return {
    ledger,
    advance(ms: number) {
      time += ms
    }
  }
}

describe('requestKind', () => {
  it.each([
    ['mainFrame', 'document'],
    ['subFrame', 'iframe'],
    ['script', 'script'],
    ['stylesheet', 'style']
  ] as const)('maps webRequest %s to %s', (resourceType, kind) => {
    expect(requestKind(resourceType)).toBe(kind)
  })

  it.each([['image'], ['font'], ['xhr'], ['other'], [''], [undefined]])(
    'gives no kind for %s, so no badge depends on it',
    (resourceType) => {
      expect(requestKind(resourceType)).toBe('')
    }
  )
})

describe('PreviewRequestKindLedger', () => {
  it('returns nothing for a URL the filter never noted', () => {
    const { ledger } = makeLedger()
    expect(ledger.take(URL_A)).toBeUndefined()
  })

  it('hands a note back once: the second take of the same request finds nothing', () => {
    const { ledger } = makeLedger()
    ledger.note(URL_A, 'mainFrame')

    expect(ledger.take(URL_A)).toBe('mainFrame')
    expect(ledger.take(URL_A)).toBeUndefined()
  })

  it('is FIFO per URL: one URL requested as an image and as a frame keeps both, in order', () => {
    const { ledger } = makeLedger()
    ledger.note(URL_A, 'image')
    ledger.note(URL_B, 'stylesheet')
    ledger.note(URL_A, 'subFrame')

    expect(ledger.take(URL_A)).toBe('image')
    expect(ledger.take(URL_A)).toBe('subFrame')
    expect(ledger.take(URL_B)).toBe('stylesheet')
  })

  it('matches with or without a fragment on either side (S15: only one side may carry it)', () => {
    const { ledger } = makeLedger()
    ledger.note(`${URL_A}#section`, 'subFrame')
    ledger.note(URL_B, 'mainFrame')

    expect(ledger.take(URL_A)).toBe('subFrame')
    expect(ledger.take(`${URL_B}#sec%201`)).toBe('mainFrame')
  })

  it(`keeps at most ${PREVIEW_LIMITS.REQUEST_KIND_LEDGER_MAX} notes, dropping the oldest first`, () => {
    const { ledger } = makeLedger()
    const max = PREVIEW_LIMITS.REQUEST_KIND_LEDGER_MAX
    for (let i = 0; i <= max; i += 1) {
      ledger.note(`${URL_A}?n=${i}`, 'subFrame')
    }

    // One note past the cap: the very first went, the second is still there.
    expect(ledger.take(`${URL_A}?n=0`)).toBeUndefined()
    expect(ledger.take(`${URL_A}?n=1`)).toBe('subFrame')
    expect(ledger.take(`${URL_A}?n=${max}`)).toBe('subFrame')
  })

  it('forgets a note once it is REQUEST_KIND_LEDGER_TTL_MS old, and keeps a younger one', () => {
    const { ledger, advance } = makeLedger()
    const ttl = PREVIEW_LIMITS.REQUEST_KIND_LEDGER_TTL_MS
    ledger.note(URL_A, 'mainFrame')
    advance(ttl - 1)
    ledger.note(URL_B, 'script')

    expect(ledger.take(URL_B)).toBe('script')
    ledger.note(URL_B, 'script')
    advance(1)
    // A is exactly TTL old: forgotten. B is 1 ms old: kept.
    expect(ledger.take(URL_A)).toBeUndefined()
    expect(ledger.take(URL_B)).toBe('script')
  })

  it('does not let an expired note of one URL shadow a fresh note of the same URL', () => {
    const { ledger, advance } = makeLedger()
    ledger.note(URL_A, 'image')
    advance(PREVIEW_LIMITS.REQUEST_KIND_LEDGER_TTL_MS)
    ledger.note(URL_A, 'subFrame')

    expect(ledger.take(URL_A)).toBe('subFrame')
    expect(ledger.take(URL_A)).toBeUndefined()
  })

  it('bounds the key of a page-made, very long URL and still matches it', () => {
    const { ledger } = makeLedger()
    const long = `${URL_A}?q=${'x'.repeat(100_000)}`
    const sameLengthOtherTail = `${long.slice(0, -1)}y`
    ledger.note(long, 'subFrame')

    expect(long.length).toBeGreaterThan(REQUEST_KIND_KEY_MAX_CHARS)
    // A shorter URL with the same head is another request.
    expect(ledger.take(long.slice(0, REQUEST_KIND_KEY_MAX_CHARS))).toBeUndefined()
    // Same head, same length: one key – a wrong kind only mislabels a badge.
    expect(ledger.take(sameLengthOtherTail)).toBe('subFrame')
  })

  it('uses a monotonic clock by default', () => {
    const ledger = createPreviewRequestKindLedger()
    ledger.note(URL_A, 'stylesheet')
    expect(ledger.take(URL_A)).toBe('stylesheet')
  })
})
