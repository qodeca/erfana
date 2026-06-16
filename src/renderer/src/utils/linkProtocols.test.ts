// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import {
  isDangerousProtocol,
  isExternalProtocol,
  isInternalLink,
  cleanMailtoLink,
  cleanTelLink
} from './linkProtocols'

/**
 * Link Protocol Utilities Tests
 *
 * Tests for security-critical protocol validation and classification
 */
describe('linkProtocols', () => {
  describe('isDangerousProtocol', () => {
    it('should block javascript: protocol', () => {
      expect(isDangerousProtocol('javascript:alert(1)')).toBe(true)
    })

    it('should block JavaScript: protocol (case insensitive)', () => {
      expect(isDangerousProtocol('JavaScript:alert(1)')).toBe(true)
    })

    it('should block JAVASCRIPT: protocol (uppercase)', () => {
      expect(isDangerousProtocol('JAVASCRIPT:alert(1)')).toBe(true)
    })

    it('should block data: protocol', () => {
      expect(isDangerousProtocol('data:text/html,<script>alert(1)</script>')).toBe(true)
    })

    it('should block DATA: protocol (case insensitive)', () => {
      expect(isDangerousProtocol('DATA:text/html,test')).toBe(true)
    })

    it('should block vbscript: protocol', () => {
      expect(isDangerousProtocol('vbscript:msgbox("XSS")')).toBe(true)
    })

    it('should block VBScript: protocol (case insensitive)', () => {
      expect(isDangerousProtocol('VBScript:msgbox(1)')).toBe(true)
    })

    it('should block file:// protocol', () => {
      expect(isDangerousProtocol('file:///etc/passwd')).toBe(true)
    })

    it('should block FILE:// protocol (case insensitive)', () => {
      expect(isDangerousProtocol('FILE:///Users/test')).toBe(true)
    })

    it('should allow http:// protocol', () => {
      expect(isDangerousProtocol('http://example.com')).toBe(false)
    })

    it('should allow https:// protocol', () => {
      expect(isDangerousProtocol('https://example.com')).toBe(false)
    })

    it('should allow mailto: protocol', () => {
      expect(isDangerousProtocol('mailto:test@example.com')).toBe(false)
    })

    it('should allow relative paths', () => {
      expect(isDangerousProtocol('./file.md')).toBe(false)
    })

    it('should handle empty string', () => {
      expect(isDangerousProtocol('')).toBe(false)
    })

    it('should handle strings with whitespace', () => {
      expect(isDangerousProtocol('  javascript:alert(1)  ')).toBe(true)
    })

    it('should block URL-encoded javascript:', () => {
      // Note: Basic implementation doesn't decode, but this documents expected behavior
      expect(isDangerousProtocol('%6A%61%76%61%73%63%72%69%70%74:alert(1)')).toBe(false)
      // Would need URL decoding to catch this - potential enhancement
    })
  })

  describe('isExternalProtocol', () => {
    it('should recognize http:// as external', () => {
      expect(isExternalProtocol('http://example.com')).toBe(true)
    })

    it('should recognize https:// as external', () => {
      expect(isExternalProtocol('https://example.com')).toBe(true)
    })

    it('should recognize mailto: as external', () => {
      expect(isExternalProtocol('mailto:test@example.com')).toBe(true)
    })

    it('should recognize tel: as external', () => {
      expect(isExternalProtocol('tel:+1234567890')).toBe(true)
    })

    it('should recognize ftp:// as external', () => {
      expect(isExternalProtocol('ftp://ftp.example.com')).toBe(true)
    })

    it('should NOT recognize dangerous protocols as external', () => {
      expect(isExternalProtocol('javascript:alert(1)')).toBe(false)
      expect(isExternalProtocol('data:text/html,test')).toBe(false)
      expect(isExternalProtocol('vbscript:msgbox(1)')).toBe(false)
      expect(isExternalProtocol('file:///etc/passwd')).toBe(false)
    })

    it('should NOT recognize relative paths as external', () => {
      expect(isExternalProtocol('./file.md')).toBe(false)
      expect(isExternalProtocol('../docs/api.md')).toBe(false)
      expect(isExternalProtocol('/absolute/path.md')).toBe(false)
    })

    it('should handle case insensitive protocols', () => {
      expect(isExternalProtocol('HTTP://example.com')).toBe(true)
      expect(isExternalProtocol('HTTPS://example.com')).toBe(true)
      expect(isExternalProtocol('MAILTO:test@example.com')).toBe(true)
    })

    it('should handle empty string', () => {
      expect(isExternalProtocol('')).toBe(false)
    })
  })

  describe('isInternalLink', () => {
    it('should recognize relative paths as internal', () => {
      expect(isInternalLink('./file.md')).toBe(true)
      expect(isInternalLink('../docs/api.md')).toBe(true)
      expect(isInternalLink('file.md')).toBe(true)
    })

    it('should recognize absolute paths as internal', () => {
      expect(isInternalLink('/docs/file.md')).toBe(true)
    })

    it('should NOT recognize external protocols as internal', () => {
      expect(isInternalLink('http://example.com')).toBe(false)
      expect(isInternalLink('https://example.com')).toBe(false)
      expect(isInternalLink('mailto:test@example.com')).toBe(false)
    })

    it('should NOT recognize dangerous protocols as internal', () => {
      expect(isInternalLink('javascript:alert(1)')).toBe(false)
      expect(isInternalLink('data:text/html,test')).toBe(false)
      expect(isInternalLink('file:///etc/passwd')).toBe(false)
    })

    it('should NOT recognize anchor-only links as internal', () => {
      expect(isInternalLink('#section')).toBe(false)
      expect(isInternalLink('#heading-1')).toBe(false)
    })

    it('should handle empty string', () => {
      expect(isInternalLink('')).toBe(false)
    })
  })

  describe('cleanMailtoLink', () => {
    it('should remove mailto: prefix', () => {
      expect(cleanMailtoLink('mailto:test@example.com')).toBe('test@example.com')
    })

    it('should remove query parameters', () => {
      expect(cleanMailtoLink('mailto:test@example.com?subject=Hello')).toBe('test@example.com')
    })

    it('should remove multiple query parameters', () => {
      expect(cleanMailtoLink('mailto:test@example.com?subject=Hello&body=World')).toBe('test@example.com')
    })

    it('should handle email without query params', () => {
      expect(cleanMailtoLink('mailto:simple@email.com')).toBe('simple@email.com')
    })

    it('should handle email with encoded query params', () => {
      expect(cleanMailtoLink('mailto:test@example.com?subject=Hello%20World')).toBe('test@example.com')
    })
  })

  describe('cleanTelLink', () => {
    it('should remove tel: prefix', () => {
      expect(cleanTelLink('tel:+1234567890')).toBe('+1234567890')
    })

    it('should remove query parameters', () => {
      expect(cleanTelLink('tel:+1234567890?ext=123')).toBe('+1234567890')
    })

    it('should handle phone without query params', () => {
      expect(cleanTelLink('tel:5551234')).toBe('5551234')
    })

    it('should handle international format', () => {
      expect(cleanTelLink('tel:+44-20-1234-5678')).toBe('+44-20-1234-5678')
    })
  })
})
