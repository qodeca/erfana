// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Navigation policy decision table (sd-074b §5.4).
 *
 * The security-relevant branching lives in one pure function, so it is tested as
 * a table. The load-bearing case is the DEFAULT arm: a scheme on no list must
 * come back blocked without anyone having had to list it.
 */
import { describe, expect, it } from 'vitest'
import { decideLinkIntent } from './PreviewNavigationPolicy'

const TOKEN = 'abcdef0123456789abcdef0123456789'
const CURRENT = `erfana-preview://${TOKEN}/index.html`

/** Decide for an href clicked in the standard test document. */
function decide(href: string, extra: { download?: boolean; target?: string } = {}) {
  return decideLinkIntent({ href, currentUrl: CURRENT, token: TOKEN, ...extra })
}

describe('decideLinkIntent — in-project links', () => {
  it('resolves a sibling page to a project-relative path', () => {
    expect(decide(`erfana-preview://${TOKEN}/other.html`)).toEqual({
      kind: 'in-project',
      relPath: 'other.html',
      anchor: null
    })
  })

  it('keeps nested paths intact', () => {
    expect(decide(`erfana-preview://${TOKEN}/docs/deep/page.html`)).toEqual({
      kind: 'in-project',
      relPath: 'docs/deep/page.html',
      anchor: null
    })
  })

  it('percent-decodes each segment', () => {
    expect(decide(`erfana-preview://${TOKEN}/my%20docs/a%20page.html`)).toEqual({
      kind: 'in-project',
      relPath: 'my docs/a page.html',
      anchor: null
    })
  })

  it('carries an anchor to another document', () => {
    expect(decide(`erfana-preview://${TOKEN}/other.html#section-2`)).toEqual({
      kind: 'in-project',
      relPath: 'other.html',
      anchor: 'section-2'
    })
  })

  it('treats a fragment on the CURRENT document as a scroll, not a navigation', () => {
    // Chromium handles this natively inside the sandbox; intercepting it would
    // break every in-page anchor.
    expect(decide(`${CURRENT}#section-2`)).toEqual({ kind: 'same-document' })
  })

  it('refuses another preview root token', () => {
    expect(decide('erfana-preview://ffffffffffffffffffffffffffffffff/secret.html')).toEqual({
      kind: 'blocked',
      reason: 'foreign-token'
    })
  })

  it('refuses a bare root link that names no file', () => {
    expect(decide(`erfana-preview://${TOKEN}/`)).toEqual({
      kind: 'blocked',
      reason: 'unknown-scheme'
    })
  })

  it('does not split an encoded separator into extra path levels', () => {
    // %2F decodes inside one segment; confinement main-side rejects it later.
    const result = decide(`erfana-preview://${TOKEN}/a%2F..%2F..%2Fetc%2Fhosts`)
    expect(result).toEqual({
      kind: 'in-project',
      relPath: 'a/../../etc/hosts',
      anchor: null
    })
  })
})

describe('decideLinkIntent — external links', () => {
  it.each(['https://example.com/', 'http://example.com/', 'mailto:someone@example.com'])(
    'hands %s to the OS browser',
    (href) => {
      expect(decide(href)).toMatchObject({ kind: 'external' })
    }
  )

  it('refuses embedded credentials', () => {
    expect(decide('https://user:pass@example.com/')).toEqual({
      kind: 'blocked',
      reason: 'embedded-credentials'
    })
  })
})

describe('decideLinkIntent — refusals', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://example.com/uuid',
    'about:blank'
  ])('blocks the dangerous scheme %s', (href) => {
    expect(decide(href)).toEqual({ kind: 'blocked', reason: 'dangerous-scheme' })
  })

  it.each(['ms-msdt:/id', 'search-ms:query=x', 'smb://host/share', 'intent://scan/#Intent;end'])(
    'blocks %s by the DEFAULT arm, without it being on any list',
    (href) => {
      expect(decide(href)).toEqual({ kind: 'blocked', reason: 'unknown-scheme' })
    }
  )

  it('blocks a scheme disguised with a safe-looking substring', () => {
    // A prefix check for "https:" would have passed this.
    expect(decide('javascript:void("https://example.com")')).toEqual({
      kind: 'blocked',
      reason: 'dangerous-scheme'
    })
  })

  it('blocks a scheme hidden by an embedded newline', () => {
    // The URL parser strips ASCII tab/newline, so this IS javascript: — a
    // literal startsWith() test would have missed it.
    expect(decide('java\nscript:alert(1)')).toEqual({
      kind: 'blocked',
      reason: 'dangerous-scheme'
    })
  })

  it('blocks a download regardless of how safe the href looks', () => {
    expect(decide(`erfana-preview://${TOKEN}/report.pdf`, { download: true })).toEqual({
      kind: 'blocked',
      reason: 'download'
    })
  })

  it('blocks an unparseable href', () => {
    expect(decide('not a url at all')).toEqual({ kind: 'blocked', reason: 'unparseable' })
  })
})

describe('decideLinkIntent — target is advisory only', () => {
  it.each(['', '_blank', '_self', '_top', '_parent', 'named-frame'])(
    'opens a new tab for target="%s"',
    (target) => {
      expect(decide(`erfana-preview://${TOKEN}/other.html`, { target })).toMatchObject({
        kind: 'in-project'
      })
    }
  )
})
