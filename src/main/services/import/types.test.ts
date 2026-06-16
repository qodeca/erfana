// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * types.test.ts
 *
 * Tests for the isConfigurableConverter type guard.
 *
 * @see Issue #132 – LiteParse document import
 */

import { describe, it, expect, vi } from 'vitest'
import { isConfigurableConverter } from './types'
import type { IConverter, ImportOptions } from './types'

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeBaseConverter(overrides?: Partial<IConverter>): IConverter {
  return {
    supportedExtensions: ['txt'],
    requiresConversion: false,
    category: 'text',
    validate: vi.fn().mockResolvedValue({ valid: true, sizeInMB: 0.1, fileName: 'test.txt' }),
    convert: vi.fn().mockResolvedValue({ success: true, content: 'hello' }),
    ...overrides
  }
}

describe('isConfigurableConverter', () => {
  // --------------------------------------------------------------------------
  // Returns true
  // --------------------------------------------------------------------------

  describe('returns true', () => {
    it('should return true when converter has createConfigured as a function', () => {
      const converter = {
        ...makeBaseConverter(),
        createConfigured: vi.fn((_options: ImportOptions) => makeBaseConverter())
      }

      expect(isConfigurableConverter(converter)).toBe(true)
    })

    it('should return true for a converter whose createConfigured returns a different instance', () => {
      const inner = makeBaseConverter()
      const converter = {
        ...makeBaseConverter({ supportedExtensions: ['pdf'] }),
        createConfigured: (_options: ImportOptions) => inner
      }

      expect(isConfigurableConverter(converter)).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // Returns false
  // --------------------------------------------------------------------------

  describe('returns false', () => {
    it('should return false for a plain IConverter without createConfigured', () => {
      const converter = makeBaseConverter()

      expect(isConfigurableConverter(converter)).toBe(false)
    })

    it('should return false when createConfigured is a string (non-function)', () => {
      const converter = {
        ...makeBaseConverter(),
        createConfigured: 'not-a-function'
      } as unknown as IConverter

      expect(isConfigurableConverter(converter)).toBe(false)
    })

    it('should return false when createConfigured is null', () => {
      const converter = {
        ...makeBaseConverter(),
        createConfigured: null
      } as unknown as IConverter

      expect(isConfigurableConverter(converter)).toBe(false)
    })

    it('should return false when createConfigured is a number', () => {
      const converter = {
        ...makeBaseConverter(),
        createConfigured: 42
      } as unknown as IConverter

      expect(isConfigurableConverter(converter)).toBe(false)
    })

    it('should return false when createConfigured is undefined', () => {
      const converter = {
        ...makeBaseConverter(),
        createConfigured: undefined
      } as unknown as IConverter

      expect(isConfigurableConverter(converter)).toBe(false)
    })

    it('should return false when createConfigured is an object (not a function)', () => {
      const converter = {
        ...makeBaseConverter(),
        createConfigured: { method: () => {} }
      } as unknown as IConverter

      expect(isConfigurableConverter(converter)).toBe(false)
    })
  })
})
