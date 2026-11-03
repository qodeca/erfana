// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  fitOrigin,
  fitOriginParts,
  fitOriginToWidth,
  formatOrigin,
  originParts,
  originText,
  popupWindowTitle,
  tabTitleFallback,
  withoutUserInfo,
  type WebOriginParts
} from './originFormat'
import { pinnedRegistrableDomain as psl } from './publicSuffixList'

const web = (url: string): WebOriginParts => {
  const p = originParts(url, psl)
  if (p?.kind !== 'web') throw new Error(`not web: ${url}`)
  return p
}

describe('formatted origin (design Security UI rule 2)', () => {
  it('drops https, keeps other schemes, and keeps the port only when not default', () => {
    expect(formatOrigin('https://www.example.com/a?b#c', psl)).toBe('www.example.com')
    expect(formatOrigin('https://example.com:443/', psl)).toBe('example.com')
    expect(formatOrigin('https://example.com:8443/', psl)).toBe('example.com:8443')
    expect(formatOrigin('http://localhost:5173/admin', psl)).toBe('http://localhost:5173')
    expect(formatOrigin('http://example.com:80/', psl)).toBe('http://example.com')
    expect(formatOrigin('http://127.0.0.1:3000', psl)).toBe('http://127.0.0.1:3000')
    expect(formatOrigin('http://[::1]:5173/', psl)).toBe('http://[::1]:5173')
  })

  it('never shows user info', () => {
    expect(formatOrigin('https://user:s3cret@example.com/', psl)).toBe('example.com')
  })

  it('splits subdomain labels from the registrable domain', () => {
    expect(web('https://a.b.bbc.co.uk/')).toMatchObject({ subdomain: 'a.b.', registrableDomain: 'bbc.co.uk' })
    expect(web('https://qodeca.github.io/')).toMatchObject({ subdomain: '', registrableDomain: 'qodeca.github.io' })
    expect(web('https://github.io/')).toMatchObject({ subdomain: '', registrableDomain: 'github.io' })
    expect(web('http://devbox:3000/')).toMatchObject({ subdomain: '', registrableDomain: 'devbox', port: '3000' })
  })

  it('shows a lookalike host in punycode and flags it', () => {
    const p = web('https://www.xn--80ak6aa92e.com/')
    expect(originText(p)).toBe('www.xn--80ak6aa92e.com')
    expect(p.punycode).toBe(true)
    expect(web('https://www.xn--bcher-kva.de/')).toMatchObject({ registrableDomain: 'bücher.de', punycode: false })
  })

  it('names non-web targets by scheme and local files as file://', () => {
    expect(formatOrigin('mailto:a@b.c', psl)).toBe('mailto:')
    expect(formatOrigin('javascript:alert(1)', psl)).toBe('javascript:')
    expect(formatOrigin('file:///Users/me/site/index.html', psl)).toBe('file://')
    expect(formatOrigin('not a url', psl)).toBeNull()
  })
})

describe('titles', () => {
  it('uses the host with no path while no title is known (025-FR-004)', () => {
    expect(tabTitleFallback('https://www.example.com:8443/deep/path', psl, 'New tab')).toBe('www.example.com')
    expect(tabTitleFallback('file:///Users/me/site/my%20page.html', psl, 'New tab')).toBe('my page.html')
    expect(tabTitleFallback('file:///Users/me/evil%E2%80%AElmth.exe', psl, 'New tab')).toBe('evillmth.exe')
    expect(tabTitleFallback('file:///', psl, 'New tab')).toBe('New tab')
    expect(tabTitleFallback('about:blank', psl, 'New tab')).toBe('New tab')
  })

  it('names a popup from its committed address, never the page title (025-FR-011, S-22)', () => {
    expect(popupWindowTitle('https://accounts.example.com/login', 'https://app.test/', psl)).toBe(
      'accounts.example.com – Erfana'
    )
    expect(popupWindowTitle(null, 'https://app.example.com/', psl)).toBe('about:blank – opened by app.example.com')
    expect(popupWindowTitle('about:blank', 'http://localhost:3000/', psl)).toBe(
      'about:blank – opened by http://localhost:3000'
    )
    expect(popupWindowTitle(null, '::', psl)).toBe('about:blank – opened by a page')
  })
})

describe('fitOrigin (design § States › Tiers, step 8)', () => {
  const parts = web('http://a.very.long.sub.example.co.uk:8080/')

  it('returns the full origin when it fits', () => {
    expect(fitOrigin(parts, 100)).toBe('http://a.very.long.sub.example.co.uk:8080')
  })

  it('removes whole subdomain labels from the front behind ….', () => {
    expect(fitOrigin(parts, 37)).toBe('http://….long.sub.example.co.uk:8080')
    expect(fitOrigin(parts, 30)).toBe('http://….example.co.uk:8080')
  })

  it('fits an https origin with no scheme or port to keep', () => {
    const https = web('https://deep.sub.example.com/')
    expect(fitOrigin(https, 18)).toBe('….sub.example.com')
    expect(fitOrigin(https, 8)).toBe('…ple.com')
  })

  it('cuts the registrable domain from its start only as a last resort, keeping the TLD and port', () => {
    expect(fitOrigin(parts, 20)).toBe('http://…e.co.uk:8080')
    expect(fitOrigin(parts, 13)).toBe('http://…:8080')
  })
})

describe('attacker pass (spec 025 issue #448 DoD § 4)', () => {
  it('F2: a trailing dot does not move the registrable domain one label right', () => {
    expect(web('https://evil.github.io./')).toMatchObject({ subdomain: '', registrableDomain: 'evil.github.io' })
    expect(web('https://accounts.google.com.evil.test./')).toMatchObject({
      subdomain: 'accounts.google.com.',
      registrableDomain: 'evil.test'
    })
    expect(web('http://localhost.:3000/')).toMatchObject({ registrableDomain: 'localhost', port: '3000' })
  })

  it('F2: fitting a trailing-dot host keeps its registrable domain', () => {
    expect(fitOrigin(web('https://accounts.google.com.evil.test./'), 12)).toBe('….evil.test')
  })

  it('F6: without a public-suffix list, a look-alike behind www is shown in punycode', () => {
    const p = originParts('https://www.gıthub.com/', () => null)
    expect(p).toMatchObject({ kind: 'web', punycode: true })
    expect(p?.kind === 'web' && p.registrableDomain).toMatch(/^www\.xn--/)
  })

  it('F7: drops user info from an address, and leaves other text alone', () => {
    expect(withoutUserInfo('https://accounts.example.com@evil.test/a?b#c')).toBe('https://evil.test/a?b#c')
    expect(withoutUserInfo('https://u:p@evil.test:8443/')).toBe('https://evil.test:8443/')
    expect(withoutUserInfo('https://evil.test/@x')).toBe('https://evil.test/@x')
    expect(withoutUserInfo('not a url')).toBe('not a url')
    expect(withoutUserInfo('mailto:a@b.c')).toBe('mailto:a@b.c')
  })
})

describe('fitOriginParts and fitOriginToWidth (F1)', () => {
  const long = web('http://accounts.google.com.secure-login.verify.evil.test:8080/')
  /** One px per character, as a monospace font draws ASCII. */
  const mono = (text: string): number => [...text].length

  it('splits the fitted origin into its parts', () => {
    expect(fitOriginParts(long, 34)).toEqual({
      scheme: 'http://',
      subdomain: '….verify.',
      registrableDomain: 'evil.test',
      port: ':8080'
    })
    expect(fitOriginParts(long, 10)).toEqual({ scheme: 'http://', subdomain: '', registrableDomain: '…', port: ':8080' })
  })

  it('fits to a width in px: 0 labels, 1 label and many labels removed', () => {
    const whole = fitOriginToWidth(long, 1000, mono)
    expect(whole.subdomain).toBe('accounts.google.com.secure-login.verify.')
    expect(fitOriginToWidth(long, 34, mono).subdomain).toBe('….verify.')
    expect(fitOriginToWidth(long, 25, mono)).toMatchObject({ subdomain: '….', registrableDomain: 'evil.test' })
    expect(fitOriginToWidth(long, 1, mono).registrableDomain).toBe('…')
  })

  it('gives the whole origin before layout (width 0 or not finite)', () => {
    expect(fitOriginToWidth(long, 0, mono).subdomain).toBe('accounts.google.com.secure-login.verify.')
    expect(fitOriginToWidth(long, Number.NaN, mono).registrableDomain).toBe('evil.test')
  })

  it('measures wide characters with the given measure, not by count', () => {
    const wide = web('https://例え.例え.例え.jp/')
    const twoPerHan = (text: string): number =>
      [...text].reduce((n, ch) => n + (/\p{Script=Han}|\p{Script=Hiragana}/u.test(ch) ? 2 : 1), 0)
    const fitted = fitOriginToWidth(wide, 9, twoPerHan)
    expect(twoPerHan(`${fitted.subdomain}${fitted.registrableDomain}`)).toBeLessThanOrEqual(9)
    expect(fitted.registrableDomain).toBe('例え.jp')
  })
})
