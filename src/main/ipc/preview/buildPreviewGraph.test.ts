// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The destination string the external-link consent dialog shows.
 *
 * That dialog is the only thing between an untrusted previewed page and an OS
 * hand-off, so what it names is load-bearing. It used to read `origin ||
 * protocol` — and `URL.origin` is the STRING "null" for every non-special
 * scheme, which is truthy. A `tel:` link therefore produced a dialog reading
 * "The preview wants to open: null", while Open still handed the full URL to
 * the operating system.
 *
 * @see buildPreviewGraph.ts
 */
import { describe, it, expect } from 'vitest'

import { describeExternalDestination } from './externalLinkConsent'

describe('describeExternalDestination', () => {
  it('names the number for a tel: link, never "null"', () => {
    expect(describeExternalDestination('tel:+48123456789')).toBe('tel:+48123456789')
  })

  it('names the address for a mailto: link', () => {
    expect(describeExternalDestination('mailto:someone@example.com')).toBe(
      'mailto:someone@example.com'
    )
  })

  it('names the origin for an http(s) link', () => {
    // The control: the common case must not regress into the opaque branch.
    expect(describeExternalDestination('https://example.com/deep/path?q=1')).toBe(
      'https://example.com'
    )
  })

  it('never returns the literal string "null"', () => {
    // The property that actually matters, across every scheme the policy allows
    // out. A dialog that names nothing cannot be consented to.
    for (const url of [
      'tel:+48123',
      'sms:+48123',
      'mailto:a@b.com',
      'https://example.com',
      'http://example.com'
    ]) {
      expect(describeExternalDestination(url)).not.toBe('null')
      expect(describeExternalDestination(url)).not.toBe('')
    }
  })

  it('does not leak the query string or a mailto body', () => {
    // The href is attacker-controlled; the dialog shows the target, not the
    // payload.
    expect(describeExternalDestination('https://example.com/x?token=secret')).not.toContain(
      'secret'
    )
    expect(describeExternalDestination('mailto:a@b.com?body=secret')).not.toContain('secret')
  })

  it('refuses an unparseable href rather than interpolating it', () => {
    expect(describeExternalDestination('not a url')).toBe('(unparseable link)')
  })
})
