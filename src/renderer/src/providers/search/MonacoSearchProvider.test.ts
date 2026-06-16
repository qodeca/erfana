// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * MonacoSearchProvider.test.ts
 *
 * Test coverage for Monaco Editor search provider
 *
 * Test groups:
 * - Constructor and initialization (2 tests)
 * - search() - basic functionality (6 tests)
 * - search() - special character escaping (3 tests)
 * - search() - options handling (3 tests)
 * - search() - error handling (4 tests)
 * - navigateTo() (5 tests)
 * - clearHighlights() (3 tests)
 * - updateCurrentMatch() (4 tests)
 * - dispose() (2 tests)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MonacoSearchProvider } from './MonacoSearchProvider'
import type * as monaco from 'monaco-editor'
import type { MonacoEditorHandle } from '../../components/Editor/MonacoMarkdownEditor'
import { logger } from '../../utils/logger'

// Mock logger
vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

// Mock Monaco types
type MockedModel = {
  findMatches: ReturnType<typeof vi.fn>
  getValueInRange: ReturnType<typeof vi.fn>
}

type MockedEditor = {
  getModel: ReturnType<typeof vi.fn>
  setSelection: ReturnType<typeof vi.fn>
  revealLineInCenter: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  deltaDecorations: ReturnType<typeof vi.fn>
}

describe('MonacoSearchProvider', () => {
  let provider: MonacoSearchProvider
  let mockEditor: MockedEditor
  let mockModel: MockedModel
  let mockEditorHandle: MonacoEditorHandle
  let editorRef: React.RefObject<MonacoEditorHandle | null>

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock model
    mockModel = {
      findMatches: vi.fn(),
      getValueInRange: vi.fn()
    }

    // Create mock editor
    mockEditor = {
      getModel: vi.fn(() => mockModel),
      setSelection: vi.fn(),
      revealLineInCenter: vi.fn(),
      focus: vi.fn(),
      deltaDecorations: vi.fn(() => ['decoration-1', 'decoration-2'])
    }

    // Create mock editor handle
    mockEditorHandle = {
      getEditor: () => mockEditor as unknown as monaco.editor.IStandaloneCodeEditor
    } as MonacoEditorHandle

    // Create ref
    editorRef = { current: mockEditorHandle }

    // Create provider
    provider = new MonacoSearchProvider(editorRef)
  })

  describe('Constructor and initialization', () => {
    it('creates provider with correct id and name', () => {
      expect(provider.id).toBe('monaco')
      expect(provider.name).toBe('Monaco Editor')
    })

    it('stores editor ref', () => {
      expect(editorRef.current).toBe(mockEditorHandle)
    })
  })

  describe('search() - basic functionality', () => {
    it('returns matches when query is found', async () => {
      const mockMatches = [
        {
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endColumn: 5,
            endLineNumber: 1
          }
        },
        {
          range: {
            startLineNumber: 2,
            startColumn: 10,
            endColumn: 14,
            endLineNumber: 2
          }
        }
      ] as monaco.editor.FindMatch[]

      mockModel.findMatches.mockReturnValue(mockMatches)
      mockModel.getValueInRange.mockReturnValue('test')

      const results = await provider.search('test', { caseSensitive: false, wholeWord: false })

      expect(results).toHaveLength(2)
      expect(results[0]).toEqual({
        id: 'monaco-0',
        line: 1,
        startColumn: 1,
        endColumn: 5,
        text: 'test',
        meta: { range: mockMatches[0].range }
      })
      expect(results[1]).toEqual({
        id: 'monaco-1',
        line: 2,
        startColumn: 10,
        endColumn: 14,
        text: 'test',
        meta: { range: mockMatches[1].range }
      })
    })

    it('returns empty array when no matches found', async () => {
      mockModel.findMatches.mockReturnValue([])

      const results = await provider.search('notfound', { caseSensitive: false, wholeWord: false })

      expect(results).toEqual([])
    })

    it('returns empty array when query is empty', async () => {
      const results = await provider.search('', { caseSensitive: false, wholeWord: false })

      expect(results).toEqual([])
      expect(mockModel.findMatches).not.toHaveBeenCalled()
    })

    it('returns empty array when editor is null', async () => {
      editorRef.current = null

      const results = await provider.search('test', { caseSensitive: false, wholeWord: false })

      expect(results).toEqual([])
    })

    it('calls findMatches with correct parameters', async () => {
      mockModel.findMatches.mockReturnValue([])

      await provider.search('hello', { caseSensitive: true, wholeWord: false })

      expect(mockModel.findMatches).toHaveBeenCalledWith(
        'hello',
        true, // searchOnlyEditableRange
        false, // isRegex
        true, // matchCase
        null, // wordSeparators
        false // captureMatches
      )
    })

    it('logs debug message with match count', async () => {
      mockModel.findMatches.mockReturnValue([
        { range: { startLineNumber: 1, startColumn: 1, endColumn: 5 } }
      ] as monaco.editor.FindMatch[])
      mockModel.getValueInRange.mockReturnValue('test')

      await provider.search('test', { caseSensitive: false, wholeWord: false })

      expect(logger.debug).toHaveBeenCalledWith('MonacoSearchProvider: Search complete', {
        query: 'test',
        matchCount: 1
      })
    })
  })

  describe('search() - special character escaping', () => {
    it('escapes regex special characters in query', async () => {
      mockModel.findMatches.mockReturnValue([])

      await provider.search('test.*?', { caseSensitive: false, wholeWord: false })

      const calls = mockModel.findMatches.mock.calls[0]
      expect(calls[0]).toBe('test\\.\\*\\?')
    })

    it('escapes all regex metacharacters', async () => {
      mockModel.findMatches.mockReturnValue([])

      await provider.search('[test]+()', { caseSensitive: false, wholeWord: false })

      const calls = mockModel.findMatches.mock.calls[0]
      expect(calls[0]).toBe('\\[test\\]\\+\\(\\)')
    })

    it('escapes backslashes and dollar signs', async () => {
      mockModel.findMatches.mockReturnValue([])

      await provider.search('$test\\path', { caseSensitive: false, wholeWord: false })

      const calls = mockModel.findMatches.mock.calls[0]
      expect(calls[0]).toBe('\\$test\\\\path')
    })
  })

  describe('search() - options handling', () => {
    it('passes caseSensitive option to findMatches', async () => {
      mockModel.findMatches.mockReturnValue([])

      await provider.search('test', { caseSensitive: true, wholeWord: false })

      const calls = mockModel.findMatches.mock.calls[0]
      expect(calls[3]).toBe(true) // matchCase parameter
    })

    it('passes wholeWord option as "boundary" separator', async () => {
      mockModel.findMatches.mockReturnValue([])

      await provider.search('test', { caseSensitive: false, wholeWord: true })

      expect(mockModel.findMatches).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'boundary', // wordSeparators
        expect.anything()
      )
    })

    it('passes null separator when wholeWord is false', async () => {
      mockModel.findMatches.mockReturnValue([])

      await provider.search('test', { caseSensitive: false, wholeWord: false })

      expect(mockModel.findMatches).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        null, // wordSeparators
        expect.anything()
      )
    })
  })

  describe('search() - error handling', () => {
    it('returns empty array on findMatches error', async () => {
      mockModel.findMatches.mockImplementation(() => {
        throw new Error('Search failed')
      })

      const results = await provider.search('test', { caseSensitive: false, wholeWord: false })

      expect(results).toEqual([])
    })

    it('logs error when search fails', async () => {
      const error = new Error('Search failed')
      mockModel.findMatches.mockImplementation(() => {
        throw error
      })

      await provider.search('test', { caseSensitive: false, wholeWord: false })

      expect(logger.error).toHaveBeenCalledWith(
        'MonacoSearchProvider.search error',
        error,
        { query: 'test', options: { caseSensitive: false, wholeWord: false } }
      )
    })

    it('logs warning when model is null', async () => {
      mockEditor.getModel.mockReturnValue(null)

      const results = await provider.search('test', { caseSensitive: false, wholeWord: false })

      expect(logger.warn).toHaveBeenCalledWith('MonacoSearchProvider: No model available')
      expect(results).toEqual([])
    })

    it('clears cached matches on error', async () => {
      // First, populate cache with successful search
      mockModel.findMatches.mockReturnValue([
        { range: { startLineNumber: 1, startColumn: 1, endColumn: 5 } }
      ] as monaco.editor.FindMatch[])
      mockModel.getValueInRange.mockReturnValue('test')

      await provider.search('test', { caseSensitive: false, wholeWord: false })

      // Now trigger error
      mockModel.findMatches.mockImplementation(() => {
        throw new Error('Search failed')
      })

      await provider.search('error', { caseSensitive: false, wholeWord: false })

      // navigateTo should not work because cache was cleared
      provider.navigateTo(0)
      expect(mockEditor.setSelection).not.toHaveBeenCalled()
    })
  })

  describe('navigateTo()', () => {
    beforeEach(async () => {
      // Populate cache with search results
      const mockMatches = [
        { range: { startLineNumber: 1, startColumn: 1, endColumn: 5 } },
        { range: { startLineNumber: 2, startColumn: 10, endColumn: 14 } }
      ] as monaco.editor.FindMatch[]

      mockModel.findMatches.mockReturnValue(mockMatches)
      mockModel.getValueInRange.mockReturnValue('test')

      await provider.search('test', { caseSensitive: false, wholeWord: false })
      vi.clearAllMocks()
    })

    it('sets selection to match range', () => {
      provider.navigateTo(0)

      expect(mockEditor.setSelection).toHaveBeenCalledWith({
        startLineNumber: 1,
        startColumn: 1,
        endColumn: 5
      })
    })

    it('reveals line in center', () => {
      provider.navigateTo(0)

      expect(mockEditor.revealLineInCenter).toHaveBeenCalledWith(1)
    })

    it('focuses editor by default', () => {
      provider.navigateTo(0)

      expect(mockEditor.focus).toHaveBeenCalled()
    })

    it('focuses editor when focusEditor option is true', () => {
      provider.navigateTo(0, { focusEditor: true })

      expect(mockEditor.focus).toHaveBeenCalled()
    })

    it('does not focus editor when focusEditor option is false', () => {
      provider.navigateTo(0, { focusEditor: false })

      expect(mockEditor.focus).not.toHaveBeenCalled()
    })

    it('does nothing for invalid index (negative)', () => {
      provider.navigateTo(-1)

      expect(mockEditor.setSelection).not.toHaveBeenCalled()
      expect(mockEditor.revealLineInCenter).not.toHaveBeenCalled()
    })

    it('does nothing for invalid index (out of bounds)', () => {
      provider.navigateTo(999)

      expect(mockEditor.setSelection).not.toHaveBeenCalled()
      expect(mockEditor.revealLineInCenter).not.toHaveBeenCalled()
    })
  })

  describe('clearHighlights()', () => {
    it('removes all decorations', () => {
      provider.clearHighlights()

      expect(mockEditor.deltaDecorations).toHaveBeenCalledWith([], [])
    })

    it('clears cached matches', async () => {
      // Populate cache
      mockModel.findMatches.mockReturnValue([
        { range: { startLineNumber: 1, startColumn: 1, endColumn: 5 } }
      ] as monaco.editor.FindMatch[])
      mockModel.getValueInRange.mockReturnValue('test')

      await provider.search('test', { caseSensitive: false, wholeWord: false })
      vi.clearAllMocks()

      provider.clearHighlights()

      // navigateTo should not work after clear
      provider.navigateTo(0)
      expect(mockEditor.setSelection).not.toHaveBeenCalled()
    })

    it('handles error gracefully when editor throws', () => {
      mockEditor.deltaDecorations.mockImplementation(() => {
        throw new Error('Decoration error')
      })

      expect(() => provider.clearHighlights()).not.toThrow()
      expect(logger.error).toHaveBeenCalled()
    })
  })

  describe('updateCurrentMatch()', () => {
    beforeEach(async () => {
      // Populate cache with search results
      const mockMatches = [
        { range: { startLineNumber: 1, startColumn: 1, endColumn: 5 } },
        { range: { startLineNumber: 2, startColumn: 10, endColumn: 14 } },
        { range: { startLineNumber: 3, startColumn: 20, endColumn: 24 } }
      ] as monaco.editor.FindMatch[]

      mockModel.findMatches.mockReturnValue(mockMatches)
      mockModel.getValueInRange.mockReturnValue('test')

      await provider.search('test', { caseSensitive: false, wholeWord: false })
      vi.clearAllMocks()
    })

    it('applies decorations to all matches', () => {
      provider.updateCurrentMatch(1)

      expect(mockEditor.deltaDecorations).toHaveBeenCalledWith(
        [],
        expect.arrayContaining([
          expect.objectContaining({
            range: { startLineNumber: 1, startColumn: 1, endColumn: 5 }
          }),
          expect.objectContaining({
            range: { startLineNumber: 2, startColumn: 10, endColumn: 14 }
          }),
          expect.objectContaining({
            range: { startLineNumber: 3, startColumn: 20, endColumn: 24 }
          })
        ])
      )
    })

    it('applies current decoration to specified index', () => {
      provider.updateCurrentMatch(1)

      const decorations = mockEditor.deltaDecorations.mock.calls[0][1]
      expect(decorations[1].options.className).toBe('search-match-current-decoration')
    })

    it('applies regular decoration to non-current matches', () => {
      provider.updateCurrentMatch(1)

      const decorations = mockEditor.deltaDecorations.mock.calls[0][1]
      expect(decorations[0].options.className).toBe('search-match-decoration')
      expect(decorations[2].options.className).toBe('search-match-decoration')
    })

    it('does nothing when no matches exist', () => {
      provider.clearHighlights()
      vi.clearAllMocks()

      provider.updateCurrentMatch(0)

      expect(mockEditor.deltaDecorations).not.toHaveBeenCalled()
    })
  })

  describe('dispose()', () => {
    it('clears highlights on dispose', () => {
      provider.dispose()

      expect(mockEditor.deltaDecorations).toHaveBeenCalledWith([], [])
    })

    it('logs debug message', () => {
      provider.dispose()

      expect(logger.debug).toHaveBeenCalledWith('MonacoSearchProvider disposed')
    })
  })
})
