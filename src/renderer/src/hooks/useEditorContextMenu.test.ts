// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
 * - Copy action (2 tests)
 * - Cut action (4 tests)
 * - Paste action (4 tests)
 * - Cleanup on unmount (1 test)
 *
 * Copy, cut, and paste now delegate to the shared pure commands in
 * `monacoClipboardCommands.ts` via `buildMonacoClipboardDeps`, so the menu path
 * and the keybinding path cannot diverge (issue #203 review). Transport
 * failures (logging/toast) are owned by the central clipboard service, so the
 * hook never logs — that assertion lives in the service's own test. Cut deletes
 * ONLY after a successful clipboard write (write-guards-delete).
 *
 * @see Spec #002 - Editor context menu with AI prompts
 * @see docs/design/issue-203-clipboard-service.md §10
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEditorContextMenu, type EditorContextMenuState } from './useEditorContextMenu'
import type { MonacoEditorHandle } from '../components/Editor/MonacoMarkdownEditor'

// Mock the central clipboard service. Cut writes via writeText (and deletes
// only on success); paste reads via readText (issue #203).
const mockReadText = vi.fn()
const mockWriteText = vi.fn()
vi.mock('../services/textClipboard', () => ({
  textClipboard: {
    readText: () => mockReadText(),
    writeText: (text: string) => mockWriteText(text)
  }
}))

// Create mock editor functions
const mockGetEditor = vi.fn()
const mockGetSelection = vi.fn()
const mockExecuteEdits = vi.fn()
const mockGetValueInRange = vi.fn()
const mockIsEmpty = vi.fn()

/**
 * Build a mock editor compatible with `buildMonacoClipboardDeps`, which calls
 * `getSelection`, `getModel().getValueInRange`, `getOption(readOnly)`,
 * `executeEdits`, plus `monaco.Range.lift(sel).isEmpty()` / `new
 * monaco.Selection(...)` / `monaco.editor.EditorOption.readOnly`.
 */
function makeEditor(readOnly = false): unknown {
  return {
    getSelection: mockGetSelection,
    getModel: () => ({ getValueInRange: mockGetValueInRange }),
    getOption: () => readOnly,
    executeEdits: mockExecuteEdits
  }
}

/**
 * Minimal fake monaco namespace returned by the handle's getMonaco(). Provides
 * the pieces buildMonacoClipboardDeps uses at runtime.
 */
const fakeMonaco = {
  Range: {
    lift: (r: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }) => ({
      isEmpty: () => r.startLineNumber === r.endLineNumber && r.startColumn === r.endColumn
    })
  },
  Selection: class {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number
    ) {}
  },
  editor: { EditorOption: { readOnly: 91 } }
}

describe('useEditorContextMenu', () => {
  let mockEditorRef: React.RefObject<MonacoEditorHandle | null>

  beforeEach(() => {
    vi.clearAllMocks()

    // Defaults: read resolves empty, write succeeds, selection has text.
    mockReadText.mockResolvedValue('')
    mockWriteText.mockResolvedValue(true)
    mockGetValueInRange.mockReturnValue('selected text')

    // Setup mock editor ref
    mockEditorRef = {
      current: {
        getEditor: mockGetEditor,
        getMonaco: () => fakeMonaco
      } as unknown as MonacoEditorHandle
    }

    // Default mock implementations
    mockGetEditor.mockReturnValue(makeEditor())
    mockGetSelection.mockReturnValue({
      isEmpty: mockIsEmpty,
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 6
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

  describe('copy action', () => {
    it('writes the live selection via the shared command without mutating the doc', async () => {
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      await act(async () => {
        await result.current.handleEditorCopy()
      })

      // Copy routes through the shared clipboardCopy → getValueInRange (live
      // selection), writes via the service, and never edits the document.
      expect(mockWriteText).toHaveBeenCalledWith('selected text')
      expect(mockExecuteEdits).not.toHaveBeenCalled()
    })

    it('does nothing if editor ref is null', async () => {
      const nullRef = { current: null }
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: nullRef }))

      await act(async () => {
        await result.current.handleEditorCopy()
      })

      expect(mockWriteText).not.toHaveBeenCalled()
    })
  })

  describe('cut action', () => {
    it('writes the selection then deletes it via executeEdits on success', async () => {
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      await act(async () => {
        await result.current.handleEditorCut()
      })

      expect(mockWriteText).toHaveBeenCalledWith('selected text')
      // The shared command supplies an endCursorState as the 3rd executeEdits arg.
      expect(mockExecuteEdits).toHaveBeenCalledTimes(1)
      const [source, edits] = mockExecuteEdits.mock.calls[0]
      expect(source).toBe('erfana-clipboard')
      expect(edits).toEqual([{ range: expect.anything(), text: '' }])
    })

    it('does NOT delete when the clipboard write fails', async () => {
      mockWriteText.mockResolvedValue(false)
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      await act(async () => {
        await result.current.handleEditorCut()
      })

      expect(mockWriteText).toHaveBeenCalledTimes(1)
      expect(mockExecuteEdits).not.toHaveBeenCalled()
    })

    it('does nothing if editor ref is null', async () => {
      const nullRef = { current: null }
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: nullRef }))

      await act(async () => {
        await result.current.handleEditorCut()
      })

      expect(mockWriteText).not.toHaveBeenCalled()
      expect(mockExecuteEdits).not.toHaveBeenCalled()
    })

    it('does nothing if selection is empty', async () => {
      // start === end → Range.lift(...).isEmpty() is true.
      mockGetSelection.mockReturnValue({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 1
      })
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      await act(async () => {
        await result.current.handleEditorCut()
      })

      expect(mockWriteText).not.toHaveBeenCalled()
      expect(mockExecuteEdits).not.toHaveBeenCalled()
    })
  })

  describe('paste action', () => {
    it('inserts clipboard content from the service at selection', async () => {
      const clipboardText = 'pasted content'
      mockReadText.mockResolvedValue(clipboardText)

      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      await act(async () => {
        await result.current.handleEditorPaste()
      })

      // Paste must await the SERVICE, not navigator.clipboard
      expect(mockReadText).toHaveBeenCalledTimes(1)
      expect(mockExecuteEdits).toHaveBeenCalledTimes(1)
      const [source, edits] = mockExecuteEdits.mock.calls[0]
      expect(source).toBe('erfana-clipboard')
      expect(edits).toEqual([{ range: expect.anything(), text: clipboardText }])
    })

    it('does nothing if editor ref is null', async () => {
      const nullRef = { current: null }
      const { result } = renderHook(() => useEditorContextMenu({ editorRef: nullRef }))

      await act(async () => {
        await result.current.handleEditorPaste()
      })

      expect(mockReadText).not.toHaveBeenCalled()
      expect(mockExecuteEdits).not.toHaveBeenCalled()
    })

    it('does nothing if clipboard is empty', async () => {
      mockReadText.mockResolvedValue('')

      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      await act(async () => {
        await result.current.handleEditorPaste()
      })

      expect(mockReadText).toHaveBeenCalledTimes(1)
      expect(mockExecuteEdits).not.toHaveBeenCalled()
    })

    it('does nothing if no selection', async () => {
      mockReadText.mockResolvedValue('content')
      mockGetSelection.mockReturnValue(null)

      const { result } = renderHook(() => useEditorContextMenu({ editorRef: mockEditorRef }))

      await act(async () => {
        await result.current.handleEditorPaste()
      })

      // Read-before-mutation order lock at the hook seam: with no insertion
      // target the clipboard is never read (no wasted IPC round-trip).
      expect(mockReadText).not.toHaveBeenCalled()
      expect(mockExecuteEdits).not.toHaveBeenCalled()
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
