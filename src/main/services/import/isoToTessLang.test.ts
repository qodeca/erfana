// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * isoToTessLang.test.ts
 *
 * Tests for the ISO 639-1 to Tesseract language code mapping utility.
 *
 * @see Issue #132 – LiteParse document import
 */

import { describe, it, expect } from 'vitest'
import { isoToTessLang } from './isoToTessLang'

describe('isoToTessLang', () => {
  // --------------------------------------------------------------------------
  // Common 2-letter code mappings
  // --------------------------------------------------------------------------

  describe('common 2-letter code mappings', () => {
    it('should map en to eng', () => {
      expect(isoToTessLang('en')).toBe('eng')
    })

    it('should map de to deu', () => {
      expect(isoToTessLang('de')).toBe('deu')
    })

    it('should map fr to fra', () => {
      expect(isoToTessLang('fr')).toBe('fra')
    })

    it('should map ja to jpn', () => {
      expect(isoToTessLang('ja')).toBe('jpn')
    })

    it('should map zh to chi_sim', () => {
      expect(isoToTessLang('zh')).toBe('chi_sim')
    })

    it('should map pl to pol', () => {
      expect(isoToTessLang('pl')).toBe('pol')
    })
  })

  // --------------------------------------------------------------------------
  // 3-letter passthrough codes
  // --------------------------------------------------------------------------

  describe('3-letter codes passed through unchanged', () => {
    it('should pass through eng unchanged', () => {
      expect(isoToTessLang('eng')).toBe('eng')
    })

    it('should pass through deu unchanged', () => {
      expect(isoToTessLang('deu')).toBe('deu')
    })

    it('should pass through fra unchanged', () => {
      expect(isoToTessLang('fra')).toBe('fra')
    })

    it('should pass through jpn unchanged', () => {
      expect(isoToTessLang('jpn')).toBe('jpn')
    })

    it('should fall back to eng for compound Tesseract codes like chi_sim', () => {
      // chi_sim is 7 chars, not matched by 3-letter passthrough
      expect(isoToTessLang('chi_sim')).toBe('eng')
    })

    it('should pass through pol unchanged', () => {
      expect(isoToTessLang('pol')).toBe('pol')
    })
  })

  // --------------------------------------------------------------------------
  // Null / undefined / empty string fallback
  // --------------------------------------------------------------------------

  describe('fallback to eng for null/undefined/empty', () => {
    it('should return eng for null', () => {
      expect(isoToTessLang(null)).toBe('eng')
    })

    it('should return eng for undefined', () => {
      expect(isoToTessLang(undefined)).toBe('eng')
    })

    it('should return eng for empty string', () => {
      expect(isoToTessLang('')).toBe('eng')
    })
  })

  // --------------------------------------------------------------------------
  // Unknown 2-letter codes
  // --------------------------------------------------------------------------

  describe('unknown 2-letter codes', () => {
    it('should return eng for unknown code xx', () => {
      expect(isoToTessLang('xx')).toBe('eng')
    })

    it('should return eng for unknown code zz', () => {
      expect(isoToTessLang('zz')).toBe('eng')
    })

    it('should return eng for unknown code ab', () => {
      expect(isoToTessLang('ab')).toBe('eng')
    })
  })

  // --------------------------------------------------------------------------
  // Case insensitivity
  // --------------------------------------------------------------------------

  describe('case insensitivity', () => {
    it('should map EN to eng', () => {
      expect(isoToTessLang('EN')).toBe('eng')
    })

    it('should map De to deu', () => {
      expect(isoToTessLang('De')).toBe('deu')
    })

    it('should map FR to fra', () => {
      expect(isoToTessLang('FR')).toBe('fra')
    })

    it('should map JA to jpn', () => {
      expect(isoToTessLang('JA')).toBe('jpn')
    })

    it('should map ZH to chi_sim', () => {
      expect(isoToTessLang('ZH')).toBe('chi_sim')
    })

    it('should map PL to pol', () => {
      expect(isoToTessLang('PL')).toBe('pol')
    })
  })

  // --------------------------------------------------------------------------
  // 3-letter codes with non-alpha characters
  // --------------------------------------------------------------------------

  describe('3-letter codes with non-alpha characters', () => {
    it('should return eng for code with digits like e1g', () => {
      expect(isoToTessLang('e1g')).toBe('eng')
    })

    it('should return eng for code with punctuation like en!', () => {
      expect(isoToTessLang('en!')).toBe('eng')
    })

    it('should return eng for code with spaces like "e g"', () => {
      expect(isoToTessLang('e g')).toBe('eng')
    })
  })

  // --------------------------------------------------------------------------
  // Whitespace handling
  // --------------------------------------------------------------------------

  describe('whitespace handling', () => {
    it('should map " en " (with spaces) to eng', () => {
      expect(isoToTessLang(' en ')).toBe('eng')
    })

    it('should map "  de  " (multiple spaces) to deu', () => {
      expect(isoToTessLang('  de  ')).toBe('deu')
    })

    it('should map "\tfr\t" (tabs) to fra', () => {
      expect(isoToTessLang('\tfr\t')).toBe('fra')
    })
  })
})
