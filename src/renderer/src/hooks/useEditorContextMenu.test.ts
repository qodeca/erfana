/**
 * Tests for useEditorContextMenu Hook
 *
 * Tests the editor context menu state management and action handlers
 * for cut, paste, and menu open/close operations.
 *
 * Test groups:
 * - Initial state (2 tests)
 * - Opening context menu (3 tests)
 * - Closing context menu (2 tests)
 * - Cut action (4 tests)
 * - Paste action (5 tests)
 * - Cleanup on unmount (1 test)
 *
 * @see Spec #002 - Editor context menu with AI prompts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEditorContextMenu, type EditorContextMenuState } from './useEditorContextMenu'
import type { MonacoEditorHandle } from '../components/Editor/MonacoMarkdownEditor'

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    error: vi.fn()
  }
}))

// Create mock editor functions
const mockGetEditor = vi.fn()
const mockGetSelection = vi.fn()
const mockExecuteEdits = vi.fn()
const mockIsEmpty = vi.fn()

describe('useEditorContextMenu', () => {
  let mockEditorRef: React.RefObject<MonacoEditorHandle | null>

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset clipboard mock
    Object.assign(navigator, {
      clipboard: {
        readText: vi.fn()
      }
    })

    // Setup mock editor ref
    mockEditorRef = {
      current: {
        getEditor: mockGetEditor
      } as unknown as MonacoEditorHandle
    }

    // Default mock implementations
    mockGetEditor.mockReturnValue({
      getSelection: mockGetSelection,
      executeEdits: mockExecuteEdits
    })
    mockGetSelection.mockReturnValue({
      isEmpty: mockIsEmpty,
      startLineNumber: 1,
      endLineNumber: 1
    })
    mockIsEmpty.mockReturnValue(false)
  })

  describe('initial state', () => {
    it('starts with null context menu state', () => {
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      expect(result.current.editorContextMenu).toBeNull()
    })

    it('provides all expected handlers', () => {
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      expect(typeof result.current.handleEditorContextMenu).toBe('function')
      expect(typeof result.current.handleCloseEditorContextMenu).toBe('function')
      expect(typeof result.current.handleEditorCut).toBe('function')
      expect(typeof result.current.handleEditorPaste).toBe('function')
    })
  })

  describe('opening context menu', () => {
    it('sets context menu state when handleEditorContextMenu is called', () => {
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      const menuEvent: EditorContextMenuState = {
        x: 100,
        y: 200,
        selectedText: 'test selection',
        startLine: 5,
        endLine: 10
      }

      act(() => {
        result.current.handleEditorContextMenu(menuEvent)
      })

      expect(result.current.editorContextMenu).toEqual(menuEvent)
    })

    it('updates state when called multiple times', () => {
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      const firstEvent: EditorContextMenuState = {
        x: 100,
        y: 200,
        selectedText: 'first',
        startLine: 1,
        endLine: 1
      }
      const secondEvent: EditorContextMenuState = {
        x: 300,
        y: 400,
        selectedText: 'second',
        startLine: 5,
        endLine: 8
      }

      act(() => {
        result.current.handleEditorContextMenu(firstEvent)
      })
      expect(result.current.editorContextMenu).toEqual(firstEvent)

      act(() => {
        result.current.handleEditorContextMenu(secondEvent)
      })
      expect(result.current.editorContextMenu).toEqual(secondEvent)
    })

    it('preserves all event properties', () => {
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      const menuEvent: EditorContextMenuState = {
        x: 150,
        y: 250,
        selectedText: 'multi\nline\ntext',
        startLine: 10,
        endLine: 12
      }

      act(() => {
        result.current.handleEditorContextMenu(menuEvent)
      })

      expect(result.current.editorContextMenu?.x).toBe(150)
      expect(result.current.editorContextMenu?.y).toBe(250)
      expect(result.current.editorContextMenu?.selectedText).toBe('multi\nline\ntext')
      expect(result.current.editorContextMenu?.startLine).toBe(10)
      expect(result.current.editorContextMenu?.endLine).toBe(12)
    })
  })

  describe('closing context menu', () => {
    it('sets state to null when handleCloseEditorContextMenu is called', () => {
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      // First open the menu
      act(() => {
        result.current.handleEditorContextMenu({
          x: 100,
          y: 200,
          selectedText: 'test',
          startLine: 1,
          endLine: 1
        })
      })
      expect(result.current.editorContextMenu).not.toBeNull()

      // Then close it
      act(() => {
        result.current.handleCloseEditorContextMenu()
      })

      expect(result.current.editorContextMenu).toBeNull()
    })

    it('is safe to call when menu is already closed', () => {
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      expect(result.current.editorContextMenu).toBeNull()

      act(() => {
        result.current.handleCloseEditorContextMenu()
      })

      expect(result.current.editorContextMenu).toBeNull()
    })
  })

  describe('cut action', () => {
    it('deletes selected text from editor', () => {
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      const mockSelection = {
        isEmpty: () => false,
        startLineNumber: 1,
        endLineNumber: 1
      }
      mockGetSelection.mockReturnValue(mockSelection)

      act(() => {
        result.current.handleEditorCut()
      })

      expect(mockExecuteEdits).toHaveBeenCalledWith('context-menu-cut', [
        { range: mockSelection, text: '' }
      ])
    })

    it('does nothing if editor ref is null', () => {
      const nullRef = { current: null }
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: nullRef }))

      act(() => {
        result.current.handleEditorCut()
      })

      expect(mockExecuteEdits).not.toHaveBeenCalled()
    })

    it('does nothing if getEditor returns null', () => {
      mockGetEditor.mockReturnValue(null)
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      act(() => {
        result.current.handleEditorCut()
      })

      expect(mockExecuteEdits).not.toHaveBeenCalled()
    })

    it('does nothing if selection is empty', () => {
      mockGetSelection.mockReturnValue({
        isEmpty: () => true
      })
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      act(() => {
        result.current.handleEditorCut()
      })

      expect(mockExecuteEdits).not.toHaveBeenCalled()
    })
  })

  describe('paste action', () => {
    it('inserts clipboard content at selection', async () => {
      const clipboardText = 'pasted content'
      ;(navigator.clipboard.readText as ReturnType<typeof vi.fn>).mockResolvedValue(clipboardText)

      const mockSelection = {
        startLineNumber: 1,
        endLineNumber: 1
      }
      mockGetSelection.mockReturnValue(mockSelection)

      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      await act(async () => {
        await result.current.handleEditorPaste()
      })

      expect(navigator.clipboard.readText).toHaveBeenCalled()
      expect(mockExecuteEdits).toHaveBeenCalledWith('context-menu-paste', [
        { range: mockSelection, text: clipboardText }
      ])
    })

    it('does nothing if editor ref is null', async () => {
      const nullRef = { current: null }
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: nullRef }))

      await act(async () => {
        await result.current.handleEditorPaste()
      })

      expect(navigator.clipboard.readText).not.toHaveBeenCalled()
      expect(mockExecuteEdits).not.toHaveBeenCalled()
    })

    it('does nothing if clipboard is empty', async () => {
      ;(navigator.clipboard.readText as ReturnType<typeof vi.fn>).mockResolvedValue('')

      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      await act(async () => {
        await result.current.handleEditorPaste()
      })

      expect(mockExecuteEdits).not.toHaveBeenCalled()
    })

    it('does nothing if no selection', async () => {
      ;(navigator.clipboard.readText as ReturnType<typeof vi.fn>).mockResolvedValue('content')
      mockGetSelection.mockReturnValue(null)

      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      await act(async () => {
        await result.current.handleEditorPaste()
      })

      expect(mockExecuteEdits).not.toHaveBeenCalled()
    })

    it('logs error if clipboard read fails', async () => {
      const { logger } = await import('../utils/logger')
      const clipboardError = new Error('Clipboard access denied')
      ;(navigator.clipboard.readText as ReturnType<typeof vi.fn>).mockRejectedValue(clipboardError)

      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      await act(async () => {
        await result.current.handleEditorPaste()
      })

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to paste from clipboard',
        clipboardError
      )
    })
  })

  describe('cleanup on unmount', () => {
    it('cleans up context menu state', () => {
      const { result, unmount } = renderHook(() =>
        useEditorContextMenu({ editorRef: mockEditorRef })
      )

      // Open menu first
      act(() => {
        result.current.handleEditorContextMenu({
          x: 100,
          y: 200,
          selectedText: 'test',
          startLine: 1,
          endLine: 1
        })
      })

      // State should be set before unmount
      expect(result.current.editorContextMenu).not.toBeNull()

      // Unmount should clean up (no error should occur)
      unmount()
    })
  })
})
