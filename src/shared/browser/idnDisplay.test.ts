// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { displayHost, latinSkeleton } from './idnDisplay'
import { labelToAscii } from './punycode'
import { pinnedRegistrableDomain } from './publicSuffixList'

/** The ASCII form of a Unicode host, as the URL parser would give it. */
const ascii = (host: string): string => host.split('.').map(l => labelToAscii(l.toLowerCase()) ?? l).join('.')
const shown = (host: string): string => {
  const a = ascii(host)
  return displayHost(a, pinnedRegistrableDomain(a))
}

describe('displayHost (S9)', () => {
  it('shows ASCII hosts unchanged', () => {
    expect(shown('www.example.com')).toBe('www.example.com')
  })

  it('shows a single-script IDN in Unicode', () => {
    expect(shown('bücher.de')).toBe('bücher.de')
    expect(shown('пример.рф')).toBe('пример.рф')
    expect(shown('例え.jp')).toBe('例え.jp')
    expect(shown('ドメイン名例.jp')).toBe('ドメイン名例.jp')
  })

  it('shows mixed-script labels in punycode', () => {
    const mixed = 'gооgle.com' // Latin g, l, e with Cyrillic о
    expect(shown(mixed)).toBe(ascii(mixed))
    expect(shown('paypаl.com')).toMatch(/^xn--/)
  })

  it('shows whole-script confusables in punycode unless the TLD is in that script', () => {
    expect(shown('аррӏе.com')).toBe('xn--80ak6aa92e.com')
    expect(shown('ѕсоре.рф')).toBe('ѕсоре.рф')
  })

  it('shows look-alikes of often-imitated names in punycode', () => {
    expect(shown('googlé.com')).toBe(ascii('googlé.com'))
    expect(shown('gıthub.io')).toMatch(/xn--/)
    expect(latinSkeleton('Gооglé')).toBe('google')
  })

  it('treats scripts outside the checked list as one script each', () => {
    expect(shown('ไทย.com')).toBe('ไทย.com')
    expect(shown('ไทยa.com')).toMatch(/^xn--/)
  })

  it('checks imitation only on the registrable label', () => {
    expect(shown('bücher.google.com')).toBe('bücher.google.com')
    expect(displayHost(ascii('bücher.de'), null)).toBe('bücher.de')
  })

  it('refuses symbols, invisibles and invalid punycode', () => {
    expect(shown('a⁄b.com')).toMatch(/^xn--/) // fraction slash looks like "/"
    expect(displayHost('xn--zzzzzzzzzzzz.com', null)).toBe('xn--zzzzzzzzzzzz.com')
    expect(displayHost('xn--ls8h.example.com', 'example.com')).toBe('xn--ls8h.example.com') // an emoji label
  })
})

describe('displayHost – attacker pass (spec 025 issue #448 DoD § 4)', () => {
  it('F3: shows labels in scripts outside the UTS #39 Recommended set in punycode', () => {
    const lisu = 'ꓖꓳꓳꓖꓡꓰ.com' // Lisu letters drawn as G O O G L E
    expect(shown(lisu)).toBe(ascii(lisu))
    expect(shown(lisu)).toMatch(/^xn--/)
    const cherokee = 'ᏀᎾᎾᏀᏞᎬ.com' // Cherokee letters drawn as G O O G L E
    expect(shown(cherokee)).toMatch(/^xn--/)
    const syllabics = 'ᑭᗩᑭᗩᒪ.com' // Canadian Syllabics drawn as P A P A L
    expect(shown(syllabics)).toMatch(/^xn--/)
    expect(displayHost(ascii(lisu), null)).toMatch(/^xn--/)
  })

  it('F3: still shows single-script labels in Recommended scripts in Unicode', () => {
    expect(shown('ไทย.com')).toBe('ไทย.com')
    expect(shown('उदाहरण.com')).toBe('उदाहरण.com')
    expect(shown('ექსპერიმენტი.com')).toBe('ექსპერიმენტი.com')
  })

  it('F6: with no registrable domain known, checks every label for imitation', () => {
    const host = ascii('www.gıthub.com')
    expect(displayHost(host, null)).toBe(host)
    expect(displayHost(ascii('bücher.example.com'), null)).toBe('bücher.example.com')
  })
})
