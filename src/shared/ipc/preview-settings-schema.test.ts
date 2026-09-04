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
  PreviewOriginSchema,
  isApprovableHost,
  originFromLegacyHost,
  parsePreviewOrigin
} from './preview-settings-schema'

describe('isApprovableHost', () => {
  it('accepts an ordinary CDN host', () => {
    expect(isApprovableHost('cdn.jsdelivr.net')).toBe(true)
    expect(isApprovableHost('fonts.googleapis.com')).toBe(true)
  })

  /*
   * THE POLICY TABLE THAT USED TO BE HERE IS GONE, and this note is the record.
   *
   * It asserted refusal for `127.0.0.1`, `0x7f.1`, `localhost`, `db.localhost`,
   * `printer.local`, `svc.internal`, `10.0.0.1`, `2130706433`, `intranet` and
   * `wiki`. Every one of those is approvable now (#108), because the policy did
   * not do what it claimed: `docs/security.md` conceded in the same breath that a
   * name RESOLVING to a private address was never detected, so `127.0.0.1.nip.io`
   * walked past all ten. It stopped the honest reader and not a hostile page, and
   * it was paid for with a row that had no button and no reason.
   *
   * Two of those cases were not policy and did not disappear — they MOVED, and
   * they are re-asserted below rather than deleted:
   *   - the hex and bare-decimal IPv4 shorthands are canonicalised by the URL
   *     parser before any predicate sees them, which covers a family the hand-
   *     written list could only enumerate and could have under-enumerated;
   *   - `[::1]` is still refused, and now for a reason that is physics rather
   *     than judgement.
   */
  it.each([
    ['IPv6 literal (bracketed)', '[::1]'],
    ['bare IPv6 literal', 'fe80::1'],
    ['underscore, not a DNS label', 'foo_bar.com'],
    ['leading hyphen', '-leading.com'],
    ['empty label', 'example..com']
  ])('still rejects %s (%s) — structure, not judgement', (_label, host) => {
    expect(isApprovableHost(host)).toBe(false)
  })

  it.each([
    ['localhost', 'localhost'],
    ['a loopback literal', '127.0.0.1'],
    ['an mDNS name', 'printer.local'],
    ['a single-label name', 'intranet']
  ])('now ACCEPTS %s (%s) — the dead end this deleted', (_label, host) => {
    expect(isApprovableHost(host)).toBe(true)
  })

  it('does not need to enumerate the IPv4 shorthands, because the parser folds them', () => {
    // The old table listed `0x7f.1` and `2130706433` by hand. Both — and every
    // other shorthand — collapse to 127.0.0.1 in the URL parser, before any
    // predicate is asked anything.
    for (const shorthand of ['http://0x7f.1', 'http://2130706433', 'http://127.1']) {
      expect(new URL(shorthand).hostname).toBe('127.0.0.1')
    }
  })

  it('rejects a host carrying a CR or LF (header/CSP injection guard)', () => {
    expect(isApprovableHost('evil.example\r\nfoo')).toBe(false)
    expect(isApprovableHost('evil.example\nfoo')).toBe(false)
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

  it('accepts an IP literal now, and still refuses IPv6', () => {
    // The refinement used to reject both. Only the second refusal was ever
    // structural: an IPv6 literal cannot be written as a CSP host-source.
    expect(PreviewHostSchema.safeParse('127.0.0.1').success).toBe(true)
    expect(PreviewHostSchema.safeParse('[::1]').success).toBe(false)
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

  it('accepts a block naming localhost, and refuses one naming an IPv6 literal', () => {
    // A cloned repository CAN now arrive with localhost approved, and that is a
    // deliberate, recorded decision rather than an oversight — see
    // docs/security.md, "Risks knowingly accepted".
    expect(PreviewAllowlistSchema.safeParse({ version: 1, hosts: ['localhost'] }).success).toBe(true)
    expect(PreviewAllowlistSchema.safeParse({ version: 1, hosts: ['[::1]'] }).success).toBe(false)
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

describe('parsePreviewOrigin', () => {
  it('returns the canonical origin for the ordinary case', () => {
    expect(parsePreviewOrigin('https://cdn.jsdelivr.net')).toBe('https://cdn.jsdelivr.net')
  })

  it('keeps a non-default port and drops the default one', () => {
    // The whole reason the unit had to change. A CSP host-source with no port
    // matches only the scheme's default, so `:8443` had to become part of what
    // is stored or it could never be granted.
    expect(parsePreviewOrigin('https://example.com:8443')).toBe('https://example.com:8443')
    expect(parsePreviewOrigin('https://example.com:443')).toBe('https://example.com')
  })

  it('is idempotent, which is what makes the schema a round-trip check', () => {
    for (const input of ['https://a.example.com', 'https://a.example.com:8443']) {
      const once = parsePreviewOrigin(input)
      expect(once).not.toBeNull()
      expect(parsePreviewOrigin(once as string)).toBe(once)
    }
  })

  it('KEEPS a trailing dot, because Chromium treats it as a different host', () => {
    /*
     * This used to strip it. The argument was that `example.com.` and
     * `example.com` are the same name to a resolver and that CSP could not
     * express the dotted form anyway — so the grant had to be written dotless.
     *
     * The second half is false, measured in the Chromium this ships
     * (142.0.7444.265, Electron 39.8.10), one served page per case:
     *
     *   CSP `img-src http://localhost:P`   ⇒ `http://localhost:P/x`  LOADS
     *                                        `http://localhost.:P/x` BLOCKED
     *   CSP `img-src http://localhost.:P`  ⇒ `http://localhost.:P/x` LOADS
     *                                        `http://localhost:P/x`  BLOCKED
     *
     * Chromium accepts a dotted host-source and never matches it against the
     * dotless one. So stripping WAS the button that lies: a page requesting
     * `example.com./x` got a row offering `example.com`, and the grant it wrote
     * could not apply to the request that produced it.
     */
    expect(parsePreviewOrigin('https://example.com./')).toBe('https://example.com.')
    expect(parsePreviewOrigin('https://example.com/')).toBe('https://example.com')
    // Still a round trip, which is what the schema's refinement demands.
    expect(parsePreviewOrigin('https://example.com.')).toBe('https://example.com.')
    // Two dots leave a genuinely empty label, which is not a host.
    expect(parsePreviewOrigin('https://example.com..')).toBeNull()
    // And the root label is not a free pass for a bad name.
    expect(parsePreviewOrigin('https://foo_bar.com.')).toBeNull()
  })

  it('refuses a scheme outside the closed set, however well it parses', () => {
    // Parseability is not the test. Each of these is a perfectly valid URL.
    expect(parsePreviewOrigin('ws://example.com:1234')).toBeNull()
    expect(parsePreviewOrigin('ftp://example.com')).toBeNull()
    expect(parsePreviewOrigin('file:///etc/passwd')).toBeNull()
  })

  it('admits http, which was measured to work rather than assumed', () => {
    // The plan assumed a plain http subresource would be refused as mixed
    // content before the allowlist was consulted, which would have made an http
    // grant an irreversible button that does nothing. Measured in Electron 39 it
    // is not refused — the document sits at an opaque origin, and mixed content
    // is decided against the origin's scheme, not against isSecureContext.
    // docs/designs/108-http-and-ipv6-in-the-preview.md
    expect(parsePreviewOrigin('http://localhost:3000')).toBe('http://localhost:3000')
    expect(parsePreviewOrigin('http://example.com')).toBe('http://example.com')
    // The default port for the scheme is still dropped, per scheme.
    expect(parsePreviewOrigin('http://example.com:80')).toBe('http://example.com')
    expect(parsePreviewOrigin('https://example.com:80')).toBe('https://example.com:80')
  })

  it('refuses a blob: URL whose .origin looks perfectly respectable', () => {
    // THE reason nothing here is built from `URL.origin`:
    //   new URL('blob:https://evil.com/1234').origin === 'https://evil.com'
    // while its `.hostname` is empty. Reading `.origin` would validate a string
    // that never described a real fetch target.
    const smuggled = 'blob:https://evil.com/1234'
    expect(new URL(smuggled).origin).toBe('https://evil.com')
    expect(parsePreviewOrigin(smuggled)).toBeNull()
  })

  it('refuses embedded credentials, which .origin would have discarded silently', () => {
    expect(new URL('https://user:pw@example.com').origin).toBe('https://example.com')
    expect(parsePreviewOrigin('https://user:pw@example.com')).toBeNull()
  })

  it('refuses anything carrying a path, query or fragment', () => {
    // `pathname` is '/' for a bare origin, so query and fragment need their own
    // checks — they do not show up in the path.
    expect(parsePreviewOrigin('https://example.com/path')).toBeNull()
    expect(parsePreviewOrigin('https://example.com?q=1')).toBeNull()
    expect(parsePreviewOrigin('https://example.com#f')).toBeNull()
  })

  it('refuses a control character before the parser can strip it', () => {
    // The WHATWG parser removes tab, LF and CR from anywhere in its input, so a
    // guard placed after `new URL` would pass while the byte that can break out
    // of a CSP directive is still in the value that reached disk.
    expect(new URL('https://exa\tmple.com').hostname).toBe('example.com')
    expect(parsePreviewOrigin('https://exa\tmple.com')).toBeNull()
    expect(parsePreviewOrigin('https://example.com\r\nx')).toBeNull()
  })

  it('refuses port 0, which is valid everywhere and connects nowhere', () => {
    expect(new URL('https://example.com:0').port).toBe('0')
    expect(parsePreviewOrigin('https://example.com:0')).toBeNull()
  })

  it('refuses IPv6 — the one refusal that is physics, not policy', () => {
    // CSP3's `host-char` is ALPHA / DIGIT / "-", so a bracketed literal cannot
    // be written as a host-source at all. Granting one would land it in the
    // network filter and not in the CSP: a grant that looks live and is
    // half-refused.
    expect(parsePreviewOrigin('https://[::1]:3000')).toBeNull()
  })

  it('refuses a label the URL parser is happy to accept', () => {
    expect(parsePreviewOrigin('https://foo_bar.com')).toBeNull()
    expect(parsePreviewOrigin('https://-leading.com')).toBeNull()
  })

  it('normalises case and IDN through the parser, never by hand', () => {
    expect(parsePreviewOrigin('https://EXAMPLE.com')).toBe('https://example.com')
    // A U-label enters and an A-label comes out. This is the homograph defence,
    // and it is the parser's doing rather than a rule of ours.
    expect(parsePreviewOrigin('https://münchen.de')).toBe('https://xn--mnchen-3ya.de')
  })

  it('canonicalises the IPv4 shorthands the old predicate listed by hand', () => {
    // The rejection table used to enumerate `0x7f.1` and `2130706433`. That
    // guarantee did not disappear — it MOVED: every shorthand collapses to
    // 127.0.0.1 before any policy sees it, so one rule now covers a family the
    // old code had to spell out and could have under-spelled.
    for (const shorthand of ['http://127.1', 'http://0x7f.1', 'http://2130706433']) {
      expect(new URL(shorthand).hostname).toBe('127.0.0.1')
    }
  })
})

describe('originFromLegacyHost', () => {
  it('means exactly what a host entry always meant', () => {
    // A host grant emitted `https://<host>` into the CSP and matched a hostname
    // under https in the filter. Both are this origin at the default port.
    expect(originFromLegacyHost('cdn.jsdelivr.net')).toBe('https://cdn.jsdelivr.net')
  })

  it('migrates what an older build could express, and nothing it could not', () => {
    // A host entry always meant the https origin at the default port, so that is
    // what it becomes — including for hosts an older build would have refused to
    // write but a newer one may.
    expect(originFromLegacyHost('localhost')).toBe('https://localhost')
    expect(originFromLegacyHost('127.0.0.1')).toBe('https://127.0.0.1')
    // Still nothing for a form no CSP host-source can carry.
    expect(originFromLegacyHost('[::1]')).toBeNull()
  })
})

describe('PreviewOriginSchema', () => {
  it('accepts only what is ALREADY canonical', () => {
    // Validity is canonicality. Anything the parser would rewrite is refused
    // rather than quietly normalised, so the string on disk, the string in the
    // CSP and the string the filter compares are provably one string.
    expect(PreviewOriginSchema.safeParse('https://example.com:8443').success).toBe(true)
    expect(PreviewOriginSchema.safeParse('https://example.com:443').success).toBe(false)
    expect(PreviewOriginSchema.safeParse('https://EXAMPLE.com').success).toBe(false)
    // Refused for the trailing SLASH, not the dot — the dot is part of the
    // origin now, and `https://example.com.` on its own is accepted below.
    expect(PreviewOriginSchema.safeParse('https://example.com./').success).toBe(false)
    expect(PreviewOriginSchema.safeParse('https://example.com.').success).toBe(true)
  })

  it('agrees with parsePreviewOrigin in both directions', () => {
    // The same guard the host schema carries, re-expressed: anything the app
    // will offer must survive the boundary, or the Allow button is a lie.
    const cases = [
      'https://cdn.jsdelivr.net',
      'https://example.com:8443',
      'https://example.com:443',
      'http://example.com',
      'https://[::1]',
      'https://localhost',
      'blob:https://evil.com/1234',
      'https://user:pw@example.com'
    ]
    for (const candidate of cases) {
      const canonical = parsePreviewOrigin(candidate)
      const accepted = PreviewOriginSchema.safeParse(candidate).success
      expect(accepted).toBe(canonical === candidate)
    }
  })
})

describe('PreviewAllowlistSchema forward compatibility', () => {
  it('parses a block carrying origins WITHOUT bumping the version', () => {
    // This test is what makes "do not bump the version" enforceable rather than
    // aspirational. An older build reads this same shape through this same
    // schema; a bump would leave it with an empty allowlist and every write
    // refused, recoverable only by hand-editing JSON.
    const parsed = PreviewAllowlistSchema.safeParse({
      version: PREVIEW_ALLOWLIST_VERSION,
      hosts: ['cdn.jsdelivr.net'],
      origins: ['https://cdn.jsdelivr.net', 'https://example.com:8443']
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.origins).toEqual([
      'https://cdn.jsdelivr.net',
      'https://example.com:8443'
    ])
  })

  it('still parses a block written before origins existed', () => {
    const parsed = PreviewAllowlistSchema.safeParse({
      version: PREVIEW_ALLOWLIST_VERSION,
      hosts: ['cdn.jsdelivr.net']
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.origins).toBeUndefined()
  })
})
