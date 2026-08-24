// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for `buildPreviewCsp` (Issue #74, work item 12; design §2.5, §7 row 6).
 */

import { describe, it, expect, vi } from 'vitest'
import { buildPreviewCsp } from './previewCsp'

describe('buildPreviewCsp', () => {
  it('emits only the erfana-preview scheme-source for an empty allowlist', () => {
    const csp = buildPreviewCsp([])
    expect(csp).toContain('erfana-preview:')
    expect(csp).not.toContain('https:')
  })

  it('renders exactly the approved hosts as https:// sources', () => {
    const csp = buildPreviewCsp(['a', 'b'])
    expect(csp).toContain('erfana-preview: https://a https://b')
    // No bare `https:` scheme-source wildcard: every https: is followed by //.
    expect(csp).not.toMatch(/https:(?!\/\/)/)
  })

  it('always contains default-src none and sandbox allow-scripts', () => {
    for (const hosts of [[], ['cdn.jsdelivr.net']]) {
      const csp = buildPreviewCsp(hosts)
      expect(csp).toContain("default-src 'none'")
      expect(csp).toContain('sandbox allow-scripts')
    }
  })

  it("never emits a 'self' source (opaque origin has no self)", () => {
    expect(buildPreviewCsp(['cdn.jsdelivr.net'])).not.toContain("'self'")
  })

  it('skips a host containing a newline and never throws, badging it instead', () => {
    const onReject = vi.fn()
    let csp = ''
    expect(() => {
      csp = buildPreviewCsp(['good.example', 'bad\nhost.example'], onReject)
    }).not.toThrow()
    expect(csp).toContain('https://good.example')
    expect(csp).not.toContain('bad')
    expect(onReject).toHaveBeenCalledWith('bad\nhost.example')
  })

  it('rejects hosts carrying CSP delimiters or non-ASCII characters', () => {
    const bad = ['a b', 'a;b', "a'b", 'a"b', 'a,b', 'a\rb', 'a\nb', 'münchen.de', 'a:b']
    for (const host of bad) {
      const csp = buildPreviewCsp([host])
      expect(csp).not.toContain(host)
      // Nothing but the scheme-source survives.
      expect(csp).not.toContain('https://')
    }
  })

  it('accepts a legitimate CDN host', () => {
    expect(buildPreviewCsp(['cdn.jsdelivr.net'])).toContain('https://cdn.jsdelivr.net')
  })
})
