// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import {
  truncate,
  basename,
  dirname,
  formatLineRange,
  uppercase,
  lowercase,
  pluralize
} from './helpers'

describe('Template Helpers', () => {
  describe('truncate()', () => {
    it('should truncate string longer than max length', () => {
      const result = truncate('This is a very long string', 10)
      expect(result).toBe('This is a ...')
    })

    it('should keep string shorter than max length unchanged', () => {
      const result = truncate('Short', 10)
      expect(result).toBe('Short')
    })

    it('should keep string exactly at max length unchanged', () => {
      const result = truncate('Exactly10!', 10)
      expect(result).toBe('Exactly10!')
    })

    it('should handle empty string', () => {
      const result = truncate('', 10)
      expect(result).toBe('')
    })

    it('should handle undefined input', () => {
      const result = truncate(undefined, 10)
      expect(result).toBe('')
    })

    it('should handle number input (returns empty string)', () => {
      const result = truncate(12345, 3)
      expect(result).toBe('')
    })

    it('should coerce length from string to number', () => {
      const result = truncate('Hello World', '5')
      expect(result).toBe('Hello...')
    })

    it('should handle very long strings', () => {
      const longStr = 'a'.repeat(1000)
      const result = truncate(longStr, 50)
      expect(result).toBe('a'.repeat(50) + '...')
      expect(result.length).toBe(53)
    })
  })

  describe('basename()', () => {
    it('should extract filename from path with slashes', () => {
      const result = basename('/Users/test/file.md')
      expect(result).toBe('file.md')
    })

    it('should handle path without slashes (return as-is)', () => {
      const result = basename('file.md')
      expect(result).toBe('file.md')
    })

    it('should ignore a trailing slash and return the final segment', () => {
      const result = basename('/Users/test/directory/')
      expect(result).toBe('directory')
    })

    it('should handle root path (returns original path)', () => {
      const result = basename('/')
      expect(result).toBe('/')
    })

    it('should handle undefined input', () => {
      const result = basename(undefined)
      expect(result).toBe('')
    })

    it('should handle number input (returns empty string)', () => {
      const result = basename(12345)
      expect(result).toBe('')
    })

    it('should extract the filename from Windows-style backslash paths', () => {
      const result = basename('C:\\Users\\test\\file.md')
      expect(result).toBe('file.md')
    })

    it('should handle multiple levels deep', () => {
      const result = basename('/a/b/c/d/e/file.txt')
      expect(result).toBe('file.txt')
    })
  })

  describe('dirname()', () => {
    it('should extract directory from single-level path', () => {
      const result = dirname('/test/file.md')
      expect(result).toBe('/test')
    })

    it('should extract directory from multi-level path', () => {
      const result = dirname('/Users/test/project/file.md')
      expect(result).toBe('/Users/test/project')
    })

    it('should handle root directory', () => {
      const result = dirname('/file.md')
      expect(result).toBe('/')
    })

    it('should handle path without directory (return /)', () => {
      const result = dirname('file.md')
      expect(result).toBe('/')
    })

    it('should handle undefined input', () => {
      const result = dirname(undefined)
      expect(result).toBe('')
    })

    it('should handle number input (returns empty string)', () => {
      const result = dirname(12345)
      expect(result).toBe('')
    })

    it('should ignore a trailing slash and return the parent directory', () => {
      const result = dirname('/Users/test/directory/')
      expect(result).toBe('/Users/test')
    })

    it('should handle multiple levels deep', () => {
      const result = dirname('/a/b/c/d/e/file.txt')
      expect(result).toBe('/a/b/c/d/e')
    })
  })

  describe('formatLineRange()', () => {
    it('should format single line as "line N"', () => {
      const result = formatLineRange(10)
      expect(result).toBe('line 10')
    })

    it('should format line range as "lines N-M"', () => {
      const result = formatLineRange(10, 15)
      expect(result).toBe('lines 10-15')
    })

    it('should handle same start and end line (single line)', () => {
      const result = formatLineRange(10, 10)
      expect(result).toBe('line 10')
    })

    it('should handle missing end line (single line)', () => {
      const result = formatLineRange(10, undefined)
      expect(result).toBe('line 10')
    })

    it('should handle both lines missing (empty string)', () => {
      const result = formatLineRange(undefined, undefined)
      expect(result).toBe('')
    })

    it('should handle start = 0 (returns empty)', () => {
      const result = formatLineRange(0, 10)
      expect(result).toBe('')
    })

    it('should coerce string numbers to numbers', () => {
      const result = formatLineRange('10', '15')
      expect(result).toBe('lines 10-15')
    })

    it('should handle line 1', () => {
      const result = formatLineRange(1)
      expect(result).toBe('line 1')
    })

    it('should handle large line numbers', () => {
      const result = formatLineRange(1000, 1500)
      expect(result).toBe('lines 1000-1500')
    })

    // Boundary validation tests (#11)
    describe('boundary validation', () => {
      it('should return empty for negative start line', () => {
        expect(formatLineRange(-1, 10)).toBe('')
        expect(formatLineRange(-5)).toBe('')
      })

      it('should swap start and end if start > end', () => {
        const result = formatLineRange(15, 10)
        expect(result).toBe('lines 10-15')
      })

      it('should treat negative end line as single line', () => {
        const result = formatLineRange(10, -5)
        expect(result).toBe('line 10')
      })

      it('should treat zero end line as single line', () => {
        const result = formatLineRange(10, 0)
        expect(result).toBe('line 10')
      })

      it('should handle start = 1, end = 0 (single line)', () => {
        const result = formatLineRange(1, 0)
        expect(result).toBe('line 1')
      })

      it('should handle both negative (empty)', () => {
        const result = formatLineRange(-1, -5)
        expect(result).toBe('')
      })

      it('should handle NaN values (empty)', () => {
        expect(formatLineRange(NaN, 10)).toBe('')
        expect(formatLineRange(10, NaN)).toBe('line 10')
      })

      it('should handle string that converts to negative', () => {
        const result = formatLineRange('-5', '10')
        expect(result).toBe('')
      })

      it('should swap string numbers if out of order', () => {
        const result = formatLineRange('20', '10')
        expect(result).toBe('lines 10-20')
      })
    })
  })

  describe('uppercase()', () => {
    it('should convert string to uppercase', () => {
      const result = uppercase('hello world')
      expect(result).toBe('HELLO WORLD')
    })

    it('should handle empty string', () => {
      const result = uppercase('')
      expect(result).toBe('')
    })

    it('should handle undefined input', () => {
      const result = uppercase(undefined)
      expect(result).toBe('')
    })

    it('should handle number input (returns empty string)', () => {
      const result = uppercase(12345)
      expect(result).toBe('')
    })

    it('should handle already uppercase string', () => {
      const result = uppercase('HELLO')
      expect(result).toBe('HELLO')
    })

    it('should handle mixed case string', () => {
      const result = uppercase('HeLLo WoRLd')
      expect(result).toBe('HELLO WORLD')
    })

    it('should handle special characters', () => {
      const result = uppercase('hello@123!')
      expect(result).toBe('HELLO@123!')
    })
  })

  describe('lowercase()', () => {
    it('should convert string to lowercase', () => {
      const result = lowercase('HELLO WORLD')
      expect(result).toBe('hello world')
    })

    it('should handle empty string', () => {
      const result = lowercase('')
      expect(result).toBe('')
    })

    it('should handle undefined input', () => {
      const result = lowercase(undefined)
      expect(result).toBe('')
    })

    it('should handle number input (returns empty string)', () => {
      const result = lowercase(12345)
      expect(result).toBe('')
    })

    it('should handle already lowercase string', () => {
      const result = lowercase('hello')
      expect(result).toBe('hello')
    })

    it('should handle mixed case string', () => {
      const result = lowercase('HeLLo WoRLd')
      expect(result).toBe('hello world')
    })

    it('should handle special characters', () => {
      const result = lowercase('HELLO@123!')
      expect(result).toBe('hello@123!')
    })
  })

  describe('pluralize()', () => {
    it('should return singular for count = 1', () => {
      const result = pluralize(1, 'file', 'files')
      expect(result).toBe('file')
    })

    it('should return plural for count = 0', () => {
      const result = pluralize(0, 'file', 'files')
      expect(result).toBe('files')
    })

    it('should return plural for count > 1', () => {
      const result = pluralize(5, 'file', 'files')
      expect(result).toBe('files')
    })

    it('should return plural for count = 2', () => {
      const result = pluralize(2, 'file', 'files')
      expect(result).toBe('files')
    })

    it('should coerce string count to number', () => {
      const result = pluralize('1', 'file', 'files')
      expect(result).toBe('file')
    })

    it('should handle undefined count', () => {
      const result = pluralize(undefined, 'file', 'files')
      expect(result).toBe('files') // NaN !== 1, so plural
    })

    it('should handle number singular/plural (convert to string)', () => {
      const result = pluralize(1, 100, 200)
      expect(result).toBe('100')
    })

    it('should handle negative count (plural)', () => {
      const result = pluralize(-1, 'item', 'items')
      expect(result).toBe('items')
    })

    it('should handle fractional count (plural)', () => {
      const result = pluralize(1.5, 'item', 'items')
      expect(result).toBe('items')
    })

    it('should handle exactly 1.0 (singular)', () => {
      const result = pluralize(1.0, 'item', 'items')
      expect(result).toBe('item')
    })
  })

  describe('Edge Cases - All Helpers', () => {
    it('should handle null inputs gracefully', () => {
      expect(truncate(null as any, 10)).toBe('')
      expect(basename(null as any)).toBe('')
      expect(dirname(null as any)).toBe('')
      expect(formatLineRange(null as any, null as any)).toBe('')
      expect(uppercase(null as any)).toBe('')
      expect(lowercase(null as any)).toBe('')
      expect(pluralize(null as any, 'a', 'b')).toBe('b')
    })

    it('should handle empty objects as input', () => {
      const obj = {} as any
      expect(truncate(obj, 10)).toBe('')
      expect(basename(obj)).toBe('')
      expect(dirname(obj)).toBe('')
      expect(uppercase(obj)).toBe('')
      expect(lowercase(obj)).toBe('')
    })
  })
})
