// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The shared link-protocol classifier (sd-074b §5.4).
 *
 * Both the Markdown preview and the HTML preview's navigation policy route
 * through this, so a change here changes what happens in two places at once.
 * The `'unknown'` cases matter most: anything that is not provably safe must
 * land there rather than in `'external'` or `'relative'`.
 */
import { describe, expect, it } from 'vitest'

import { classifyLinkProtocol, hasEmbeddedCredentials } from './linkProtocolPolicy'

describe('classifyLinkProtocol', () => {
  it.each([
    ['https://example.com', 'external'],
    ['http://example.com/a?b=c', 'external'],
    ['mailto:someone@example.com', 'external'],
    ['tel:+48123456789', 'external'],
    ['ftp://files.example.com/x', 'external']
  ])('classifies %s as %s', (href, kind) => {
    expect(classifyLinkProtocol(href)).toBe(kind)
  })

  it.each([
    ['javascript:alert(1)', 'dangerous'],
    ['JavaScript:alert(1)', 'dangerous'],
    ['vbscript:msgbox', 'dangerous'],
    ['data:text/html,<h1>x', 'dangerous'],
    ['blob:https://example.com/uuid', 'dangerous'],
    ['file:///etc/hosts', 'dangerous'],
    ['about:blank', 'dangerous']
  ])('classifies %s as %s', (href, kind) => {
    expect(classifyLinkProtocol(href)).toBe(kind)
  })

  it('sees through the whitespace the URL parser strips', () => {
    // The WHATWG parser removes tab/newline/CR, so a literal startsWith check
    // would miss this while the browser would still run it.
    expect(classifyLinkProtocol('java\nscript:alert(1)')).toBe('dangerous')
  })

  it.each([
    ['./page.html'],
    ['../sibling/page.md'],
    ['docs/a.html'],
    ['#section'],
    [''],
    ['   ']
  ])('classifies %s as relative', (href) => {
    expect(classifyLinkProtocol(href)).toBe('relative')
  })

  it.each([['ms-msdt:/id'], ['search-ms:query=x'], ['smb://host/share'], ['intent://x']])(
    'refuses %s by default rather than allowing it',
    (href) => {
      expect(classifyLinkProtocol(href)).toBe('unknown')
    }
  )

  /**
   * Regression guard for lens review F23.
   *
   * A malformed WEB address used to fall through to `'relative'`, which made the
   * Markdown preview hand it to project-file resolution as though it were a
   * path. A href that announces a scheme it cannot honour is refused.
   */
  describe('unparseable but schemed', () => {
    it.each([
      ['http://exa mple.com'],
      ['http://'],
      ['https://'],
      ['https://[not-an-ipv6']
    ])('refuses %s instead of treating it as a project path', (href) => {
      expect(classifyLinkProtocol(href)).toBe('unknown')
    })

    it('still sees a stripped-whitespace scheme in an unparseable href', () => {
      expect(classifyLinkProtocol('ht\ntp://exa mple.com')).toBe('unknown')
    })

    it('leaves a genuinely scheme-less path alone', () => {
      // The fix must not turn every parse failure into a refusal — a path with
      // no scheme is still a project-relative link.
      expect(classifyLinkProtocol('docs/a b/page.html')).toBe('relative')
    })
  })

  /**
   * Behaviour that predates the F23 fix and is NOT changed by it, pinned so a
   * later reader does not mistake it for a regression: a Windows drive path
   * parses successfully as a one-letter scheme, so it reaches the default arm
   * and is refused. Whether that should instead resolve as a local path is a
   * separate product question, deliberately not settled here.
   */
  it('classifies a Windows drive path as unknown, as it always has', () => {
    expect(classifyLinkProtocol('C:\\docs\\a.html')).toBe('unknown')
    expect(classifyLinkProtocol('d:/docs/a.html')).toBe('unknown')
  })
})

describe('hasEmbeddedCredentials', () => {
  it('detects a username and password', () => {
    expect(hasEmbeddedCredentials('https://user:pass@example.com')).toBe(true)
  })

  it('detects a username alone', () => {
    expect(hasEmbeddedCredentials('https://user@example.com')).toBe(true)
  })

  it('is false for a plain URL', () => {
    expect(hasEmbeddedCredentials('https://example.com/user@thing')).toBe(false)
  })

  it('is false for something unparseable', () => {
    expect(hasEmbeddedCredentials('./relative')).toBe(false)
  })
})
