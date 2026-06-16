// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Document Import Channel Constants Tests
 *
 * Tests for IMPORT_CHANNELS constants and ImportChannel type.
 *
 * @see Issue #133 - LiteParse IPC handlers, Zod schemas, and preload bridge
 * @see Spec #021 - LiteParse document import
 */
import { describe, it, expect } from 'vitest'
import { IMPORT_CHANNELS, type ImportChannel } from './import-channels'

describe('IMPORT_CHANNELS', () => {
  describe('channel count', () => {
    it('has exactly 5 channel keys', () => {
      expect(Object.keys(IMPORT_CHANNELS)).toHaveLength(5)
    })
  })

  describe('channel values', () => {
    it('DOCUMENT resolves to "import:document"', () => {
      expect(IMPORT_CHANNELS.DOCUMENT).toBe('import:document')
    })

    it('DOCUMENT_PROGRESS resolves to "import:documentProgress"', () => {
      expect(IMPORT_CHANNELS.DOCUMENT_PROGRESS).toBe('import:documentProgress')
    })

    it('DOCUMENT_CANCEL resolves to "import:documentCancel"', () => {
      expect(IMPORT_CHANNELS.DOCUMENT_CANCEL).toBe('import:documentCancel')
    })

    it('GET_DOCUMENT_EXTENSIONS resolves to "import:getDocumentExtensions"', () => {
      expect(IMPORT_CHANNELS.GET_DOCUMENT_EXTENSIONS).toBe('import:getDocumentExtensions')
    })

    it('DEPENDENCIES_READY resolves to "import:dependenciesReady"', () => {
      expect(IMPORT_CHANNELS.DEPENDENCIES_READY).toBe('import:dependenciesReady')
    })
  })

  describe('channel uniqueness', () => {
    it('all channel values are unique strings', () => {
      const values = Object.values(IMPORT_CHANNELS)
      const unique = new Set(values)
      expect(unique.size).toBe(values.length)
    })

    it('all channel values start with "import:"', () => {
      for (const value of Object.values(IMPORT_CHANNELS)) {
        expect(value).toMatch(/^import:/)
      }
    })
  })
})

describe('ImportChannel type', () => {
  it('allows a valid channel value at compile time', () => {
    // This is a compile-time check – if the type is wrong, TypeScript will reject it
    const channel: ImportChannel = 'import:document'
    expect(channel).toBe('import:document')
  })

  it('is assignable from all IMPORT_CHANNELS values', () => {
    const channels: ImportChannel[] = Object.values(IMPORT_CHANNELS)
    expect(channels).toHaveLength(5)
  })
})
