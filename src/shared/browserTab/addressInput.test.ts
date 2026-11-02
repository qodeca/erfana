// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { SEARCH_URL_PREFIX, classifyAddressInput } from './addressInput'

const load = (input: string): string | undefined => {
  const d = classifyAddressInput(input)
  return d.kind === 'load' ? d.url : undefined
}

describe('classifyAddressInput (025-FR-002)', () => {
  it('025-AC-002 rule 1 loads http, https and file addresses in any letter case', () => {
    expect(load('https://example.com/a')).toBe('https://example.com/a')
    expect(load('HTTP://Example.com')).toBe('HTTP://Example.com')
    expect(load('file:///Users/me/site/index.html')).toBe('file:///Users/me/site/index.html')
    expect(classifyAddressInput('  https://x.test  ')).toMatchObject({ kind: 'load', url: 'https://x.test', rule: 1 })
  })

  it('025-AC-002 rule 2 loads a bracketed IPv6 address as http', () => {
    expect(classifyAddressInput('[::1]:5173/app')).toEqual({ kind: 'load', url: 'http://[::1]:5173/app', rule: 2 })
    expect(load('[::1]')).toBe('http://[::1]')
  })

  it('025-AC-002 rule 3 loads localhost, *.localhost, IPv4 and dotless names with a port as http', () => {
    expect(classifyAddressInput('localhost:5173/admin')).toMatchObject({ url: 'http://localhost:5173/admin', rule: 3 })
    expect(load('app.localhost:3000')).toBe('http://app.localhost:3000')
    expect(load('127.0.0.1:8080?x=1')).toBe('http://127.0.0.1:8080?x=1')
    expect(load('devbox:3000')).toBe('http://devbox:3000')
  })

  it('025-AC-002 rule 3 refuses ports outside 1–65535 instead of loading them', () => {
    expect(classifyAddressInput('localhost:0').kind).not.toBe('load')
    expect(classifyAddressInput('localhost:65536').kind).not.toBe('load')
    expect(load('localhost:65535')).toBe('http://localhost:65535')
  })

  it('025-AC-002 rule 4 loads localhost and IPv4 without a port as http', () => {
    expect(classifyAddressInput('localhost')).toMatchObject({ url: 'http://localhost', rule: 4 })
    expect(load('192.168.1.10/status')).toBe('http://192.168.1.10/status')
  })

  it('025-AC-002 rule 5 loads dotted host names as https, with an optional port and path', () => {
    expect(classifyAddressInput('github.com')).toMatchObject({ url: 'https://github.com', rule: 5 })
    expect(load('staging.example.com:8443/app')).toBe('https://staging.example.com:8443/app')
  })

  it('025-AC-002 rule 6 refuses other schemes and Windows drive paths, never searching them', () => {
    for (const input of ['chrome://settings', 'javascript:alert(1)', 'mailto:a@b.c', 'C:\\site\\index.html', 'about:blank', 'data:text/html,x']) {
      expect(classifyAddressInput(input)).toEqual({ kind: 'refused', reason: 'scheme', rule: 6 })
    }
  })

  it('025-AC-002 rule 7 refuses network paths', () => {
    expect(classifyAddressInput('\\\\server\\share')).toEqual({ kind: 'refused', reason: 'network-path', rule: 7 })
    expect(classifyAddressInput('//server/share')).toEqual({ kind: 'refused', reason: 'network-path', rule: 7 })
  })

  it('025-AC-002 rule 8 searches single dotless words and any text with a space', () => {
    expect(classifyAddressInput('erfana')).toEqual({ kind: 'search', url: `${SEARCH_URL_PREFIX}erfana`, rule: 8 })
    expect(classifyAddressInput('how to center a div')).toEqual({
      kind: 'search',
      url: `${SEARCH_URL_PREFIX}how%20to%20center%20a%20div`,
      rule: 8
    })
    expect(classifyAddressInput('github.com is down').kind).toBe('search')
    expect(classifyAddressInput('a&b=c#d')).toMatchObject({ url: `${SEARCH_URL_PREFIX}a%26b%3Dc%23d` })
  })
})
