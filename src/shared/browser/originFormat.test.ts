// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  fitOrigin,
  formatOrigin,
  originParts,
  originText,
  popupWindowTitle,
  tabTitleFallback,
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
