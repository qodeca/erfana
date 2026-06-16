// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for selectionHelpers utilities
 *
 * Tests cover:
 * - getSelectedText: Combined editor/DOM selection with fallback
 * - getEditorSelection: Monaco editor only selection
 * - getPreviewSelection: DOM selection only
 *
 * @see selectionHelpers.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getSelectedText, getEditorSelection, getPreviewSelection } from './selectionHelpers'
import type { MonacoEditorHandle } from '../components/Editor/MonacoMarkdownEditor'

// Mock Monaco editor types
interface MockSelection {
  isEmpty: () => boolean
}

interface MockModel {
  getValueInRange: (selection: MockSelection) => string
}

interface MockEditor {
  getSelection: () => MockSelection | null
  getModel: () => MockModel | null
}

/**
 * Creates a mock editor ref with configurable behavior
 */
function createMockEditorRef(options: {
  hasEditor?: boolean
  hasSelection?: boolean
  selectionEmpty?: boolean
  selectedText?: string
  hasModel?: boolean
}): React.RefObject<MonacoEditorHandle | null> {
  const {
    hasEditor = true,
    hasSelection = true,
    selectionEmpty = false,
    selectedText = 'selected text',
    hasModel = true
  } = options

  const mockSelection: MockSelection = {
    isEmpty: () => selectionEmpty
  }

  const mockModel: MockModel = {
    getValueInRange: () => selectedText
  }

  const mockEditor: MockEditor = {
    getSelection: () => (hasSelection ? mockSelection : null),
    getModel: () => (hasModel ? mockModel : null)
  }

  const mockHandle: MonacoEditorHandle = {
    getEditor: () => (hasEditor ? mockEditor : null) as ReturnType<MonacoEditorHandle['getEditor']>,
    formatBold: vi.fn(),
    formatItalic: vi.fn(),
    formatStrikethrough: vi.fn(),
    formatCode: vi.fn(),
    formatCodeBlock: vi.fn(),
    insertLink: vi.fn(),
    insertImage: vi.fn(),
    insertHeading: vi.fn(),
    insertList: vi.fn(),
    getScrollTop: vi.fn(),
    setScrollTop: vi.fn(),
    getTopForLineNumber: vi.fn(),
    setPositionAndReveal: vi.fn()
  }

  return { current: mockHandle }
}

describe('selectionHelpers', () => {
  let originalGetSelection: typeof window.getSelection

  beforeEach(() => {
    originalGetSelection = window.getSelection
  })

  afterEach(() => {
    window.getSelection = originalGetSelection
  })

  /**
   * Helper to mock window.getSelection
   */
  function mockDOMSelection(text: string | null): void {
    window.getSelection = vi.fn(() => ({
      toString: () => text ?? ''
    })) as unknown as typeof window.getSelection
  }

  describe('getSelectedText', () => {
    describe('with Monaco editor', () => {
      it('returns Monaco selection when available', () => {
        mockDOMSelection('DOM text')
        const editorRef = createMockEditorRef({ selectedText: 'Monaco text' })

        const result = getSelectedText(editorRef)

        expect(result).toBe('Monaco text')
      })

      it('returns undefined when Monaco selection is empty', () => {
        mockDOMSelection(null)
        const editorRef = createMockEditorRef({ selectionEmpty: true })

        const result = getSelectedText(editorRef)

        expect(result).toBeUndefined()
      })

      it('returns undefined when Monaco selection is whitespace only', () => {
        mockDOMSelection(null)
        const editorRef = createMockEditorRef({ selectedText: '   \n\t  ' })

        const result = getSelectedText(editorRef)

        expect(result).toBeUndefined()
      })

      it('falls back to DOM when no editor ref', () => {
        mockDOMSelection('DOM fallback')

        const result = getSelectedText(undefined)

        expect(result).toBe('DOM fallback')
      })

      it('falls back to DOM when editor ref current is null', () => {
        mockDOMSelection('DOM fallback')
        const editorRef: React.RefObject<MonacoEditorHandle | null> = { current: null }

        const result = getSelectedText(editorRef)

        expect(result).toBe('DOM fallback')
      })

      it('falls back to DOM when getEditor returns null', () => {
        mockDOMSelection('DOM fallback')
        const editorRef = createMockEditorRef({ hasEditor: false })

        const result = getSelectedText(editorRef)

        expect(result).toBe('DOM fallback')
      })

      it('falls back to DOM when getSelection returns null', () => {
        mockDOMSelection('DOM fallback')
        const editorRef = createMockEditorRef({ hasSelection: false })

        const result = getSelectedText(editorRef)

        expect(result).toBe('DOM fallback')
      })

      it('falls back to DOM when getModel returns null', () => {
        mockDOMSelection('DOM fallback')
        const editorRef = createMockEditorRef({ hasModel: false })

        const result = getSelectedText(editorRef)

        expect(result).toBe('DOM fallback')
      })
    })

    describe('DOM fallback', () => {
      it('returns DOM selection when no Monaco selection', () => {
        mockDOMSelection('DOM selected')
        const editorRef = createMockEditorRef({ selectionEmpty: true })

        const result = getSelectedText(editorRef)

        // Falls back to DOM since Monaco selection is empty
        expect(result).toBe('DOM selected')
      })

      it('returns undefined when no selection anywhere', () => {
        mockDOMSelection(null)
        const editorRef = createMockEditorRef({ selectionEmpty: true })

        const result = getSelectedText(editorRef)

        expect(result).toBeUndefined()
      })

      it('trims whitespace from DOM selection', () => {
        mockDOMSelection('  trimmed text  ')

        const result = getSelectedText(undefined)

        expect(result).toBe('trimmed text')
      })

      it('returns undefined for whitespace-only DOM selection', () => {
        mockDOMSelection('   \n\t  ')

        const result = getSelectedText(undefined)

        expect(result).toBeUndefined()
      })
    })
  })

  describe('getEditorSelection', () => {
    it('returns Monaco selection when available', () => {
      const editorRef = createMockEditorRef({ selectedText: 'editor text' })

      const result = getEditorSelection(editorRef)

      expect(result).toBe('editor text')
    })

    it('returns undefined when no ref', () => {
      const editorRef: React.RefObject<MonacoEditorHandle | null> = { current: null }

      const result = getEditorSelection(editorRef)

      expect(result).toBeUndefined()
    })

    it('returns undefined when no editor', () => {
      const editorRef = createMockEditorRef({ hasEditor: false })

      const result = getEditorSelection(editorRef)

      expect(result).toBeUndefined()
    })

    it('returns undefined when no selection', () => {
      const editorRef = createMockEditorRef({ hasSelection: false })

      const result = getEditorSelection(editorRef)

      expect(result).toBeUndefined()
    })

    it('returns undefined when no model', () => {
      const editorRef = createMockEditorRef({ hasModel: false })

      const result = getEditorSelection(editorRef)

      expect(result).toBeUndefined()
    })

    it('returns undefined when selection is empty', () => {
      const editorRef = createMockEditorRef({ selectionEmpty: true })

      const result = getEditorSelection(editorRef)

      expect(result).toBeUndefined()
    })

    it('trims whitespace from selection', () => {
      const editorRef = createMockEditorRef({ selectedText: '  trimmed  ' })

      const result = getEditorSelection(editorRef)

      expect(result).toBe('trimmed')
    })

    it('returns undefined for whitespace-only selection', () => {
      const editorRef = createMockEditorRef({ selectedText: '   \n\t  ' })

      const result = getEditorSelection(editorRef)

      expect(result).toBeUndefined()
    })

    it('does not fall back to DOM selection', () => {
      mockDOMSelection('DOM text')
      const editorRef = createMockEditorRef({ selectionEmpty: true })

      const result = getEditorSelection(editorRef)

      // Should NOT fall back to DOM
      expect(result).toBeUndefined()
    })
  })

  describe('getPreviewSelection', () => {
    it('returns DOM selection when available', () => {
      mockDOMSelection('preview text')

      const result = getPreviewSelection()

      expect(result).toBe('preview text')
    })

    it('returns undefined when no selection', () => {
      mockDOMSelection(null)

      const result = getPreviewSelection()

      expect(result).toBeUndefined()
    })

    it('returns undefined when empty string', () => {
      mockDOMSelection('')

      const result = getPreviewSelection()

      expect(result).toBeUndefined()
    })

    it('trims whitespace from selection', () => {
      mockDOMSelection('  trimmed preview  ')

      const result = getPreviewSelection()

      expect(result).toBe('trimmed preview')
    })

    it('returns undefined for whitespace-only selection', () => {
      mockDOMSelection('   \n\t  ')

      const result = getPreviewSelection()

      expect(result).toBeUndefined()
    })

    it('handles window.getSelection returning null', () => {
      window.getSelection = vi.fn(() => null) as unknown as typeof window.getSelection

      const result = getPreviewSelection()

      expect(result).toBeUndefined()
    })
  })
})
