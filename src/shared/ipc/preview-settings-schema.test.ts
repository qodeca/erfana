// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PreviewAllowlistSchema / isApprovableHost tests (Issue #74, work item 10).
 *
 * @see docs/designs/sd-074-html-preview.md §3.1
 */
import { describe, it, expect } from 'vitest'
import {
  PREVIEW_ALLOWLIST_VERSION,
  MAX_ALLOWLIST_HOSTS,
  PreviewAllowlistSchema,
  PreviewHostSchema,
  isApprovableHost
} from './preview-settings-schema'

describe('isApprovableHost', () => {
  it('accepts an ordinary CDN host', () => {
    expect(isApprovableHost('cdn.jsdelivr.net')).toBe(true)
    expect(isApprovableHost('fonts.googleapis.com')).toBe(true)
  })

  it.each([
    ['IPv4 literal', '127.0.0.1'],
    ['IPv6 literal (bracketed)', '[::1]'],
    ['hex IPv4 shorthand', '0x7f.1'],
    ['localhost', 'localhost'],
    ['*.localhost subdomain', 'db.localhost'],
    ['*.local mDNS name', 'printer.local'],
    ['*.internal name', 'svc.internal'],
    ['all-numeric label set', '10.0.0.1'],
    ['bare decimal (integer IPv4)', '2130706433'],
    ['bare single-label name (intranet-SSRF surface, #32)', 'intranet'],
    ['single-label name (wiki)', 'wiki']
  ])('rejects %s (%s)', (_label, host) => {
    expect(isApprovableHost(host)).toBe(false)
  })

  it('rejects a host carrying a CR or LF (header/CSP injection guard)', () => {
    expect(isApprovableHost('evil.example\r\nfoo')).toBe(false)
    expect(isApprovableHost('evil.example\nfoo')).toBe(false)
  })

  it('rejects a bare IPv6 literal without brackets', () => {
    expect(isApprovableHost('fe80::1')).toBe(false)
  })
  it('refuses a hostname the WRITE schema would reject', () => {
    // THE MISMATCH. This predicate decides the `approvable` flag the user sees;
    // `PreviewHostSchema`'s regex decides whether the write is accepted. The
    // predicate was the LOOSER of the two, so a trailing dot or an underscore
    // produced an Approve button that `preview:approveHost` then refused —
    // and the renderer discards that result, so the reader saw the toast
    // dismiss and believed a decision had been made.
    expect(isApprovableHost('example.com.')).toBe(false)
    expect(isApprovableHost('foo_bar.com')).toBe(false)
    expect(isApprovableHost('-leading.com')).toBe(false)
    expect(isApprovableHost('trailing-.com')).toBe(false)
  })

  it('agrees with the schema that gates the write, in both directions', () => {
    // The guard that keeps them aligned. Anything this predicate calls
    // approvable must survive `PreviewHostSchema`, or the Approve button is
    // offering something the boundary will refuse.
    const cases = [
      'cdn.jsdelivr.net',
      'fonts.gstatic.com',
      'example.com.',
      'foo_bar.com',
      'localhost',
      '127.0.0.1',
      'intranet',
      'a.b.c.d.example.com',
      '-leading.com'
    ]
    for (const host of cases) {
      expect({ host, ok: isApprovableHost(host) }).toEqual({
        host,
        ok: PreviewHostSchema.safeParse(host).success
      })
    }
  })

})

describe('PreviewHostSchema', () => {
  it('accepts an approvable host', () => {
    expect(PreviewHostSchema.parse('cdn.jsdelivr.net')).toBe('cdn.jsdelivr.net')
  })

  it('rejects an IP literal via the refinement', () => {
    expect(PreviewHostSchema.safeParse('127.0.0.1').success).toBe(false)
  })

  it('rejects a host with characters the CSP grammar forbids', () => {
    // Uppercase, spaces, semicolons and quotes are all outside the regex.
    expect(PreviewHostSchema.safeParse('EXAMPLE.com').success).toBe(false)
    expect(PreviewHostSchema.safeParse('a b.com').success).toBe(false)
    expect(PreviewHostSchema.safeParse("a'.com").success).toBe(false)
  })
})

describe('PreviewAllowlistSchema', () => {
  it('round-trips a valid version-1 allowlist', () => {
    const input = { version: 1, hosts: ['cdn.jsdelivr.net', 'fonts.googleapis.com'] }
    const parsed = PreviewAllowlistSchema.parse(input)
    expect(parsed).toEqual(input)
    expect(parsed.version).toBe(PREVIEW_ALLOWLIST_VERSION)
  })

  it('defaults hosts to an empty array when omitted', () => {
    const parsed = PreviewAllowlistSchema.parse({ version: 1 })
    expect(parsed.hosts).toEqual([])
  })

  it('fails closed on any version other than 1', () => {
    expect(PreviewAllowlistSchema.safeParse({ version: 2, hosts: [] }).success).toBe(false)
    expect(PreviewAllowlistSchema.safeParse({ version: 0, hosts: [] }).success).toBe(false)
  })

  it('rejects a block containing a non-approvable host', () => {
    const result = PreviewAllowlistSchema.safeParse({ version: 1, hosts: ['localhost'] })
    expect(result.success).toBe(false)
  })

  it('rejects more than MAX_ALLOWLIST_HOSTS entries', () => {
    const hosts = Array.from({ length: MAX_ALLOWLIST_HOSTS + 1 }, (_, i) => `h${i}.example.com`)
    expect(PreviewAllowlistSchema.safeParse({ version: 1, hosts }).success).toBe(false)
  })

  it('accepts exactly MAX_ALLOWLIST_HOSTS entries', () => {
    const hosts = Array.from({ length: MAX_ALLOWLIST_HOSTS }, (_, i) => `h${i}.example.com`)
    expect(PreviewAllowlistSchema.safeParse({ version: 1, hosts }).success).toBe(true)
  })
})
