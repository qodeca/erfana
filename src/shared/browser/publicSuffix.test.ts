// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { parsePublicSuffixList, publicSuffixOf, registrableDomainOf } from './publicSuffix'
import { pinnedPublicSuffixRules, pinnedRegistrableDomain } from './publicSuffixList'

const SMALL = parsePublicSuffixList(`// comment
com
uk
co.uk
*.ck
!www.ck
github.io   trailing text is ignored
公司.cn

`)

describe('Public Suffix List algorithm', () => {
  it('finds the prevailing rule: exact, wildcard, exception and the implicit *', () => {
    expect(publicSuffixOf('a.b.example.co.uk', SMALL)).toBe('co.uk')
    expect(publicSuffixOf('x.foo.ck', SMALL)).toBe('foo.ck')
    expect(publicSuffixOf('www.ck', SMALL)).toBe('ck')
    expect(publicSuffixOf('host.unknowntld', SMALL)).toBe('unknowntld')
    expect(publicSuffixOf('Example.COM.', SMALL)).toBe('com')
  })

  it('gives the registrable domain, or null for a public suffix itself', () => {
    expect(registrableDomainOf('a.b.example.co.uk', SMALL)).toBe('example.co.uk')
    expect(registrableDomainOf('user.github.io', SMALL)).toBe('user.github.io')
    expect(registrableDomainOf('github.io', SMALL)).toBeNull()
    expect(registrableDomainOf('co.uk', SMALL)).toBeNull()
    expect(registrableDomainOf('www.ck', SMALL)).toBe('www.ck')
    expect(registrableDomainOf('', SMALL)).toBeNull()
  })

  it('skips malformed rules instead of failing the list', () => {
    const rules = parsePublicSuffixList('a..b\nfoo.*.bar\n*\n!\nok.test')
    expect([...rules.exact]).toEqual(['ok.test'])
    expect(rules.wildcard.size).toBe(0)
    expect(publicSuffixOf('', rules)).toBe('')
  })

  it('encodes Unicode rules so ASCII hosts match them', () => {
    expect(SMALL.exact.has('xn--55qx5d.cn')).toBe(true)
    expect(registrableDomainOf('shop.example.xn--55qx5d.cn', SMALL)).toBe('example.xn--55qx5d.cn')
  })
})

describe('the pinned list (Q10)', () => {
  it('parses both sections with thousands of rules', () => {
    const rules = pinnedPublicSuffixRules()
    expect(rules.exact.size).toBeGreaterThan(9000)
    expect(rules.wildcard.size).toBeGreaterThan(10)
    expect(rules.exception.size).toBeGreaterThan(5)
    expect(pinnedPublicSuffixRules()).toBe(rules)
  })

  it('answers ICANN, private-section, wildcard and exception cases', () => {
    expect(pinnedRegistrableDomain('www.bbc.co.uk')).toBe('bbc.co.uk')
    expect(pinnedRegistrableDomain('qodeca.github.io')).toBe('qodeca.github.io')
    expect(pinnedRegistrableDomain('a.b.kawasaki.jp')).toBe('a.b.kawasaki.jp')
    expect(pinnedRegistrableDomain('www.city.kawasaki.jp')).toBe('city.kawasaki.jp')
    expect(pinnedRegistrableDomain('staging.example.com')).toBe('example.com')
    expect(pinnedRegistrableDomain('com')).toBeNull()
  })
})
