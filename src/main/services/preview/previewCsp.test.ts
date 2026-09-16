// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for `buildPreviewCsp` (Issue #74, work item 12; design §2.5, §7 row 6)
 * and its frame tripwires (issue #124 WI-13, design part 2 §2.1): `frame-src` is
 * exactly `erfana-preview://<32 lowercase hex>`, a malformed token gives
 * `frame-src 'none'` plus a report and never a throw, and the policy carries no
 * `frame-ancestors`.
 */

import { describe, it, expect, vi } from 'vitest'
import { buildPreviewCsp, type PreviewCspOptions } from './previewCsp'

/** A root token of the shape `PreviewRootRegistry` mints. */
const TOKEN = '0123456789abcdef0123456789abcdef' // gitleaks:allow
const OTHER_TOKEN = 'fedcba9876543210fedcba9876543210' // gitleaks:allow
const OPTIONS: PreviewCspOptions = { ownToken: TOKEN }

/** The policy's directives named `name`, each as written. */
function directivesNamed(csp: string, name: string): string[] {
  return csp
    .split(';')
    .map(directive => directive.trim())
    .filter(directive => directive.split(' ')[0] === name)
}

describe('buildPreviewCsp', () => {
  it('emits only the erfana-preview scheme-source for an empty allowlist', () => {
    const csp = buildPreviewCsp([], OPTIONS)
    expect(csp).toContain('erfana-preview:')
    expect(csp).not.toContain('https:')
  })

  it('renders exactly the approved hosts as https:// sources', () => {
    // Dotted hosts: a bare single-label name is no longer approvable (#32).
    const csp = buildPreviewCsp(['https://a.io', 'https://b.io'], OPTIONS)
    expect(csp).toContain('erfana-preview: https://a.io https://b.io')
    // No bare `https:` scheme-source wildcard: every https: is followed by //.
    expect(csp).not.toMatch(/https:(?!\/\/)/)
  })

  it('always contains default-src none and sandbox allow-scripts', () => {
    for (const hosts of [[], ['cdn.jsdelivr.net']]) {
      for (const options of [OPTIONS, { ownToken: 'not-a-token' }]) {
        const csp = buildPreviewCsp(hosts, options)
        expect(csp).toContain("default-src 'none'")
        expect(csp).toContain('sandbox allow-scripts')
      }
    }
  })

  it("never emits a 'self' source (opaque origin has no self)", () => {
    expect(buildPreviewCsp(['https://cdn.jsdelivr.net'], OPTIONS)).not.toContain("'self'")
  })

  it('skips a host containing a newline and never throws, badging it instead', () => {
    const onReject = vi.fn()
    let csp = ''
    expect(() => {
      csp = buildPreviewCsp(
        ['https://good.example', 'https://bad\nhost.example'],
        OPTIONS,
        onReject
      )
    }).not.toThrow()
    expect(csp).toContain('https://good.example')
    expect(csp).not.toContain('bad')
    // The report says what was left out: since #124 a token can be, too.
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledWith({ kind: 'host', host: 'https://bad\nhost.example' })
  })

  it('rejects hosts carrying CSP delimiters or non-ASCII characters', () => {
    const bad = ['a b', 'a;b', "a'b", 'a"b', 'a,b', 'a\rb', 'a\nb', 'münchen.de', 'a:b']
    for (const host of bad) {
      const csp = buildPreviewCsp([host], OPTIONS)
      expect(csp).not.toContain(host)
      // Nothing but the scheme-source survives.
      expect(csp).not.toContain('https://')
    }
  })

  it('accepts a legitimate CDN host', () => {
    expect(buildPreviewCsp(['https://cdn.jsdelivr.net'], OPTIONS)).toContain(
      'https://cdn.jsdelivr.net'
    )
  })
})

describe('buildPreviewCsp frame-src tripwires (issue #124 WI-13)', () => {
  it('names exactly the own token: frame-src erfana-preview://<32 lowercase hex>', () => {
    const frameSrc = directivesNamed(buildPreviewCsp([], OPTIONS), 'frame-src')
    expect(frameSrc).toEqual([`frame-src erfana-preview://${TOKEN}`])
    expect(frameSrc[0]).toMatch(/^frame-src erfana-preview:\/\/[0-9a-f]{32}$/)
  })

  it('never names the bare scheme, a host, data: or blob: – not even an approved host', () => {
    const csp = buildPreviewCsp(['https://cdn.example.com', 'https://a.io:8443'], OPTIONS)
    const [frameSrc = ''] = directivesNamed(csp, 'frame-src')
    const sources = frameSrc.split(' ').slice(1)
    expect(sources).toEqual([`erfana-preview://${TOKEN}`])
    for (const forbidden of ['erfana-preview:', 'https:', 'data:', 'blob:', '*']) {
      expect(sources).not.toContain(forbidden)
    }
    // The approved hosts are still granted – to subresources only.
    expect(directivesNamed(csp, 'script-src')[0]).toContain(
      'https://cdn.example.com https://a.io:8443'
    )
  })

  it("names each page's own token and never another's", () => {
    const mine = buildPreviewCsp([], OPTIONS)
    const theirs = buildPreviewCsp([], { ownToken: OTHER_TOKEN })
    expect(directivesNamed(theirs, 'frame-src')).toEqual([
      `frame-src erfana-preview://${OTHER_TOKEN}`
    ])
    expect(mine).not.toContain(OTHER_TOKEN)
    expect(theirs).not.toContain(TOKEN)
  })

  it('reports nothing for a well-formed token and valid hosts', () => {
    const onReject = vi.fn()
    buildPreviewCsp(['https://a.io'], OPTIONS, onReject)
    expect(onReject).not.toHaveBeenCalled()
  })

  it.each([
    ['empty', ''],
    ['uppercase hex', TOKEN.toUpperCase()],
    ['31 characters', TOKEN.slice(1)],
    ['33 characters', `${TOKEN}0`],
    ['a dashed UUID', '01234567-89ab-cdef-0123-456789abcdef'],
    ['a non-hex letter', `${TOKEN.slice(0, 31)}g`],
    ['a trailing newline', `${TOKEN}\n`],
    ['a leading space', ` ${TOKEN.slice(1)}`],
    ['a directive break-out', `${TOKEN}; frame-ancestors *`],
    ['the bare scheme', 'erfana-preview:'],
    ['a host', 'example.com'],
    ['a wildcard', '*'],
    ["'self'", "'self'"]
  ])(
    "degrades a malformed token (%s) to frame-src 'none', reported once, never throwing",
    (_label, ownToken) => {
      const onReject = vi.fn()
      let csp = ''
      expect(() => {
        csp = buildPreviewCsp(['https://a.io'], { ownToken }, onReject)
      }).not.toThrow()
      expect(directivesNamed(csp, 'frame-src')).toEqual(["frame-src 'none'"])
      expect(onReject).toHaveBeenCalledTimes(1)
      expect(onReject).toHaveBeenCalledWith({ kind: 'own-token' })
      // Only frame-src moved: every other directive is the well-formed policy's,
      // so the bad value appears nowhere in the header.
      expect(csp).toBe(
        buildPreviewCsp(['https://a.io'], OPTIONS).replace(
          `frame-src erfana-preview://${TOKEN}`,
          "frame-src 'none'"
        )
      )
    }
  )

  it('degrades a missing or non-string token instead of throwing (types are no guarantee)', () => {
    for (const options of [undefined, {}, { ownToken: 42 }, { ownToken: null }]) {
      const onReject = vi.fn()
      let csp = ''
      expect(() => {
        csp = buildPreviewCsp([], options as unknown as PreviewCspOptions, onReject)
      }).not.toThrow()
      expect(directivesNamed(csp, 'frame-src')).toEqual(["frame-src 'none'"])
      expect(onReject).toHaveBeenCalledWith({ kind: 'own-token' })
    }
  })

  it('reports a bad host and a bad token separately, hosts first', () => {
    const onReject = vi.fn()
    buildPreviewCsp(['a b', 'https://a.io'], { ownToken: 'nope' }, onReject)
    expect(onReject.mock.calls).toEqual([[{ kind: 'host', host: 'a b' }], [{ kind: 'own-token' }]])
  })

  it('never emits frame-ancestors, for any input', () => {
    for (const options of [OPTIONS, { ownToken: 'nope' }]) {
      for (const hosts of [[], ['https://a.io']]) {
        expect(buildPreviewCsp(hosts, options)).not.toContain('frame-ancestors')
      }
    }
  })

  it('changes nothing else in the policy (golden)', () => {
    expect(buildPreviewCsp(['https://a.io'], OPTIONS)).toBe(
      [
        "default-src 'none'",
        "script-src 'unsafe-inline' 'unsafe-eval' erfana-preview: https://a.io",
        "style-src 'unsafe-inline' erfana-preview: https://a.io",
        'img-src data: blob: erfana-preview: https://a.io',
        'font-src data: erfana-preview: https://a.io',
        'media-src blob: erfana-preview: https://a.io',
        'connect-src erfana-preview: https://a.io',
        `frame-src erfana-preview://${TOKEN}`,
        "object-src 'none'",
        "worker-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
        'sandbox allow-scripts'
      ].join('; ')
    )
  })
})
