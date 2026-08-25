// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the parse5-based remote-image stripper used before DOCX export.
 *
 * Covers the SSRF control and, explicitly, the two regex-sanitizer bypasses that
 * motivated moving to a real parser (a `>` inside a quoted attribute, and a
 * `data-src` decoy attribute) — kept here as regression tests.
 */
import { describe, it, expect } from 'vitest'
import { stripRemoteImages, isRemoteImageSrc } from './docxImageStrip'

describe('docxImageStrip', () => {
  describe('isRemoteImageSrc', () => {
    it.each([
      ['', false],
      ['   ', false],
      ['data:image/png;base64,AAAA', false],
      ['DATA:image/png;base64,AAAA', false],
      ['./assets/pic.png', false],
      ['../pic.png', false],
      ['pic.png', false],
      ['http://evil/x', true],
      ['https://evil/x', true],
      ['  http://evil/x', true],
      ['//evil/x', true],
      ['file:///etc/passwd', true],
      ['ftp://host/x', true]
    ])('classifies %j as remote=%s', (src, expected) => {
      expect(isRemoteImageSrc(src)).toBe(expected)
    })
  })

  describe('stripRemoteImages', () => {
    it('strips quoted http(s) images and preserves data:/relative', () => {
      const { html, removed } = stripRemoteImages(
        '<p>Doc</p><img src="http://127.0.0.1:8080/x.png"><img src="data:image/png;base64,AAAA"><img src="./a.png">'
      )
      expect(removed).toBe(1)
      expect(html).not.toContain('127.0.0.1')
      expect(html).toContain('data:image/png;base64,AAAA')
      expect(html).toContain('./a.png')
    })

    // Regression: the former regex `/<img[^>]*>/` truncated at the first `>`,
    // leaving the remote src in place.
    it('strips a remote image with a `>` inside a quoted attribute', () => {
      const { html, removed } = stripRemoteImages(
        '<img alt="a>b" src="http://169.254.169.254/latest/meta-data">'
      )
      expect(removed).toBe(1)
      expect(html).not.toContain('169.254.169.254')
    })

    // Regression: the former `\bsrc` regex bound to the decoy `data-src` value
    // and kept the tag, so the library fetched the real remote src.
    it('strips an image whose real src is remote despite a local data-src decoy', () => {
      const { html, removed } = stripRemoteImages('<img data-src="x.png" src="http://evil.example/y">')
      expect(removed).toBe(1)
      expect(html).not.toContain('evil.example')
    })

    it('strips protocol-relative and non-http schemes', () => {
      const { html, removed } = stripRemoteImages(
        '<img src="//evil.example/a"><img src="file:///etc/passwd"><img src="ftp://host/b">'
      )
      expect(removed).toBe(3)
      expect(html).not.toContain('evil.example')
      expect(html).not.toContain('/etc/passwd')
      expect(html).not.toContain('ftp://')
    })

    it('preserves an uppercase DATA: URI', () => {
      const { html, removed } = stripRemoteImages('<img src="DATA:image/png;base64,AAAA">')
      expect(removed).toBe(0)
      expect(html).toContain('DATA:image/png;base64,AAAA')
    })

    it('strips a remote image nested inside other elements, keeping siblings', () => {
      const { html, removed } = stripRemoteImages(
        '<div><p>keep</p><img src="https://evil.example/x"></div>'
      )
      expect(removed).toBe(1)
      expect(html).not.toContain('evil.example')
      expect(html).toContain('<p>keep</p>')
    })

    it('strips a remote srcset (img and <source>)', () => {
      const { html, removed } = stripRemoteImages(
        '<img srcset="https://evil.example/x 1x"><picture><source srcset="https://evil.example/y"></picture>'
      )
      expect(removed).toBe(2)
      expect(html).not.toContain('evil.example')
    })

    it('returns unchanged HTML and removed=0 when there is nothing to strip', () => {
      const input = '<p>hello</p><img src="data:image/png;base64,AAAA">'
      const { html, removed } = stripRemoteImages(input)
      expect(removed).toBe(0)
      expect(html).toContain('hello')
      expect(html).toContain('data:image/png;base64,AAAA')
    })
  })
})
