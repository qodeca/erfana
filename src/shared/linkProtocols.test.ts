// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import {
  isDangerousProtocol,
  isSafeProtocol,
  SAFE_EXTERNAL_PROTOCOLS,
  DANGEROUS_PROTOCOLS
} from './linkProtocols'

/**
 * Link Protocol Validation Tests
 *
 * Tests security validation for link protocols in DOCX export and markdown preview.
 *
 * @see Issue #65 - DOCX export security
 */

describe('isDangerousProtocol', () => {
  describe('dangerous protocols', () => {
    it('should detect javascript: protocol', () => {
      expect(isDangerousProtocol('javascript:alert(1)')).toBe(true)
      expect(isDangerousProtocol('javascript:void(0)')).toBe(true)
    })

    it('should detect data: protocol', () => {
      expect(isDangerousProtocol('data:text/html,<script>alert(1)</script>')).toBe(true)
      expect(isDangerousProtocol('data:text/javascript,alert(1)')).toBe(true)
      expect(isDangerousProtocol('data:image/png;base64,abc')).toBe(true)
    })

    it('should detect vbscript: protocol', () => {
      expect(isDangerousProtocol('vbscript:msgbox("xss")')).toBe(true)
    })

    it('should detect file:// protocol', () => {
      expect(isDangerousProtocol('file:///etc/passwd')).toBe(true)
      expect(isDangerousProtocol('file://localhost/c$/windows/system32')).toBe(true)
    })

    it('should be case-insensitive', () => {
      expect(isDangerousProtocol('JAVASCRIPT:alert(1)')).toBe(true)
      expect(isDangerousProtocol('JavaScript:void(0)')).toBe(true)
      expect(isDangerousProtocol('DATA:text/html,test')).toBe(true)
      expect(isDangerousProtocol('VBScript:test')).toBe(true)
      expect(isDangerousProtocol('FILE:///test')).toBe(true)
    })

    it('should handle whitespace around protocol', () => {
      expect(isDangerousProtocol('  javascript:alert(1)')).toBe(true)
      expect(isDangerousProtocol('javascript:alert(1)  ')).toBe(true)
      expect(isDangerousProtocol('  javascript:alert(1)  ')).toBe(true)
    })
  })

  describe('safe protocols', () => {
    it('should not flag http: protocol', () => {
      expect(isDangerousProtocol('http://example.com')).toBe(false)
    })

    it('should not flag https: protocol', () => {
      expect(isDangerousProtocol('https://example.com')).toBe(false)
    })

    it('should not flag mailto: protocol', () => {
      expect(isDangerousProtocol('mailto:user@example.com')).toBe(false)
    })

    it('should not flag tel: protocol', () => {
      expect(isDangerousProtocol('tel:+1234567890')).toBe(false)
    })

    it('should not flag ftp: protocol', () => {
      expect(isDangerousProtocol('ftp://example.com')).toBe(false)
    })

    it('should not flag relative URLs', () => {
      expect(isDangerousProtocol('/path/to/page')).toBe(false)
      expect(isDangerousProtocol('./relative/path')).toBe(false)
      expect(isDangerousProtocol('../parent/path')).toBe(false)
    })

    it('should not flag anchor links', () => {
      expect(isDangerousProtocol('#section')).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(isDangerousProtocol('')).toBe(false)
    })

    it('should handle null-like values safely', () => {
      expect(isDangerousProtocol(null as unknown as string)).toBe(false)
      expect(isDangerousProtocol(undefined as unknown as string)).toBe(false)
    })

    it('should not be fooled by protocol-like content in URL', () => {
      expect(isDangerousProtocol('https://example.com?q=javascript:test')).toBe(false)
      expect(isDangerousProtocol('https://example.com#javascript:test')).toBe(false)
    })

    it('should detect protocols at start only', () => {
      // Only protocols at the very start should be flagged
      expect(isDangerousProtocol('javascript:alert(1)')).toBe(true)
      expect(isDangerousProtocol('not-javascript:alert(1)')).toBe(false)
    })
  })
})

describe('isSafeProtocol', () => {
  describe('safe protocols', () => {
    it('should accept http: protocol', () => {
      expect(isSafeProtocol('http://example.com')).toBe(true)
    })

    it('should accept https: protocol', () => {
      expect(isSafeProtocol('https://example.com')).toBe(true)
    })

    it('should accept mailto: protocol', () => {
      expect(isSafeProtocol('mailto:user@example.com')).toBe(true)
    })

    it('should accept tel: protocol', () => {
      expect(isSafeProtocol('tel:+1234567890')).toBe(true)
    })

    it('should accept ftp: protocol', () => {
      expect(isSafeProtocol('ftp://example.com')).toBe(true)
    })

    it('should be case-insensitive', () => {
      expect(isSafeProtocol('HTTPS://example.com')).toBe(true)
      expect(isSafeProtocol('Http://example.com')).toBe(true)
      expect(isSafeProtocol('MAILTO:user@example.com')).toBe(true)
    })
  })

  describe('dangerous protocols', () => {
    it('should reject javascript: protocol', () => {
      expect(isSafeProtocol('javascript:alert(1)')).toBe(false)
    })

    it('should reject data: protocol', () => {
      expect(isSafeProtocol('data:text/html,test')).toBe(false)
    })

    it('should reject vbscript: protocol', () => {
      expect(isSafeProtocol('vbscript:test')).toBe(false)
    })

    it('should reject file:// protocol', () => {
      expect(isSafeProtocol('file:///test')).toBe(false)
    })
  })

  describe('relative URLs', () => {
    it('should not accept relative URLs (not external)', () => {
      expect(isSafeProtocol('/path/to/page')).toBe(false)
      expect(isSafeProtocol('./relative')).toBe(false)
      expect(isSafeProtocol('#anchor')).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(isSafeProtocol('')).toBe(false)
    })

    it('should handle null-like values', () => {
      expect(isSafeProtocol(null as unknown as string)).toBe(false)
      expect(isSafeProtocol(undefined as unknown as string)).toBe(false)
    })
  })
})

describe('protocol constants', () => {
  it('should export SAFE_EXTERNAL_PROTOCOLS', () => {
    expect(SAFE_EXTERNAL_PROTOCOLS).toBeDefined()
    expect(SAFE_EXTERNAL_PROTOCOLS).toContain('https://')
    expect(SAFE_EXTERNAL_PROTOCOLS).toContain('http://')
    expect(SAFE_EXTERNAL_PROTOCOLS).toContain('mailto:')
    expect(SAFE_EXTERNAL_PROTOCOLS).toContain('tel:')
    expect(SAFE_EXTERNAL_PROTOCOLS).toContain('ftp://')
  })

  it('should export DANGEROUS_PROTOCOLS', () => {
    expect(DANGEROUS_PROTOCOLS).toBeDefined()
    expect(DANGEROUS_PROTOCOLS).toContain('javascript:')
    expect(DANGEROUS_PROTOCOLS).toContain('data:')
    expect(DANGEROUS_PROTOCOLS).toContain('vbscript:')
    expect(DANGEROUS_PROTOCOLS).toContain('file://')
  })
})
