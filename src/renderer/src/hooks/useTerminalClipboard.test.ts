// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useTerminalClipboard Hook Tests
 *
 * Tests for the terminal clipboard hook:
 * - Selection state tracking via xterm's onSelectionChange
 * - copy(): getSelection() -> textClipboard.writeText() (keeps selection)
 * - paste(): textClipboard.readText() -> terminal.paste() (unmodified text)
 * - handleKeyEvent(): Keyboard shortcut handling with SIGINT pass-through
 *
 * Clipboard transport failures are handled centrally by the textClipboard
 * service (issue #203); the hook surfaces no failure callback of its own.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTerminalClipboard } from './useTerminalClipboard'
import type { Terminal } from '@xterm/xterm'

// Mock the central clipboard service: copy writes via textClipboard.writeText
// and paste reads via textClipboard.readText (issue #203).
const mockWriteText = vi.fn()
const mockReadText = vi.fn()
vi.mock('../services/textClipboard', () => ({
  textClipboard: {
    writeText: (text: string) => mockWriteText(text),
    readText: () => mockReadText()
  }
}))

// Platform detection is resolved via the preload bridge (utils/platform);
// getClipboardAction reads it internally. Mock it so tests drive the
// macOS-vs-Windows clipboard behavior directly.
const { mockIsMacOS } = vi.hoisted(() => ({ mockIsMacOS: vi.fn() }))
vi.mock('../utils/platform', () => ({
  isMacOS: mockIsMacOS
}))

describe('useTerminalClipboard', () => {
  // Mock xterm Terminal
  const createMockXterm = (hasSelection = false, selection = ''): Terminal => {
    const mockDisposable = { dispose: vi.fn() }
    return {
      hasSelection: vi.fn().mockReturnValue(hasSelection),
      getSelection: vi.fn().mockReturnValue(selection),
      clearSelection: vi.fn(),
      paste: vi.fn(),
      onSelectionChange: vi.fn().mockReturnValue(mockDisposable)
    } as unknown as Terminal
  }

  beforeEach(() => {
    // Reset service mocks: success-by-default
    mockWriteText.mockReset().mockResolvedValue(true)
    mockReadText.mockReset().mockResolvedValue('clipboard text')

    // Default to macOS
    mockIsMacOS.mockReset().mockReturnValue(true)
  })

  describe('Initial state', () => {
    it('returns hasSelection as false initially', () => {
      const mockXterm = createMockXterm(false)
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useTerminalClipboard(xtermRef))

      expect(result.current.hasSelection).toBe(false)
    })

    it('returns hasSelection as true when xterm has selection', () => {
      const mockXterm = createMockXterm(true)
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useTerminalClipboard(xtermRef))

      expect(result.current.hasSelection).toBe(true)
    })

    it('returns copy, paste, and handleKeyEvent functions', () => {
      const mockXterm = createMockXterm()
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useTerminalClipboard(xtermRef))

      expect(typeof result.current.copy).toBe('function')
      expect(typeof result.current.paste).toBe('function')
      expect(typeof result.current.handleKeyEvent).toBe('function')
    })
  })

  describe('Selection tracking', () => {
    it('subscribes to onSelectionChange', () => {
      const mockXterm = createMockXterm()
      const xtermRef = { current: mockXterm }

      renderHook(() => useTerminalClipboard(xtermRef))

      expect(mockXterm.onSelectionChange).toHaveBeenCalledTimes(1)
      expect(mockXterm.onSelectionChange).toHaveBeenCalledWith(expect.any(Function))
    })

    it('updates hasSelection when selection changes', async () => {
      const mockXterm = createMockXterm(false)
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useTerminalClipboard(xtermRef))

      expect(result.current.hasSelection).toBe(false)

      // Simulate selection change
      const selectionChangeCallback = (mockXterm.onSelectionChange as any).mock.calls[0][0]
      ;(mockXterm.hasSelection as any).mockReturnValue(true)

      await act(async () => {
        selectionChangeCallback()
      })

      expect(result.current.hasSelection).toBe(true)
    })

    it('cleans up onSelectionChange listener on unmount', () => {
      const mockDisposable = { dispose: vi.fn() }
      const mockXterm = createMockXterm()
      ;(mockXterm.onSelectionChange as any).mockReturnValue(mockDisposable)
      const xtermRef = { current: mockXterm }

      const { unmount } = renderHook(() => useTerminalClipboard(xtermRef))

      unmount()

      expect(mockDisposable.dispose).toHaveBeenCalledTimes(1)
    })

    it('does not throw when xterm is null', () => {
      const xtermRef = { current: null }

      expect(() => {
        renderHook(() => useTerminalClipboard(xtermRef))
      }).not.toThrow()
    })
  })

  describe('copy()', () => {
    it('routes copy through textClipboard.writeText with the selection', async () => {
      const mockXterm = createMockXterm(true, 'selected text')
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useTerminalClipboard(xtermRef))

      await act(async () => {
        await result.current.copy()
      })

      expect(mockXterm.getSelection).toHaveBeenCalledTimes(1)
      expect(mockWriteText).toHaveBeenCalledTimes(1)
      expect(mockWriteText).toHaveBeenCalledWith('selected text')
    })

    it('keeps the xterm selection after copy (VS Code terminal behavior)', async () => {
      const mockXterm = createMockXterm(true, 'selected text')
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useTerminalClipboard(xtermRef))

      await act(async () => {
        await result.current.copy()
      })

      // Selection must NOT be cleared - matches VS Code terminal behavior
      expect(mockXterm.clearSelection).not.toHaveBeenCalled()
    })

    it('calls onCopy callback on success', async () => {
      const mockXterm = createMockXterm(true, 'selected text')
      const xtermRef = { current: mockXterm }
      const onCopy = vi.fn()

      const { result } = renderHook(() => useTerminalClipboard(xtermRef, { onCopy }))

      await act(async () => {
        await result.current.copy()
      })

      await waitFor(() => {
        expect(onCopy).toHaveBeenCalledTimes(1)
      })
    })

    it('does not call onCopy when the service write fails', async () => {
      const mockXterm = createMockXterm(true, 'selected text')
      const xtermRef = { current: mockXterm }
      const onCopy = vi.fn()
      mockWriteText.mockResolvedValueOnce(false)

      const { result } = renderHook(() => useTerminalClipboard(xtermRef, { onCopy }))

      await act(async () => {
        await result.current.copy()
      })

      expect(onCopy).not.toHaveBeenCalled()
    })

    it('is a no-op when there is no selection (no writeText)', async () => {
      const mockXterm = createMockXterm(false, '')
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useTerminalClipboard(xtermRef))

      await act(async () => {
        await result.current.copy()
      })

      expect(mockWriteText).not.toHaveBeenCalled()
      expect(mockXterm.clearSelection).not.toHaveBeenCalled()
    })

    it('does nothing if xterm is null', async () => {
      const xtermRef = { current: null }

      const { result } = renderHook(() => useTerminalClipboard(xtermRef))

      await act(async () => {
        await result.current.copy()
      })

      expect(mockWriteText).not.toHaveBeenCalled()
    })
  })

  describe('paste()', () => {
    it('pastes the exact string returned by textClipboard.readText, unmodified', async () => {
      const mockXterm = createMockXterm()
      const xtermRef = { current: mockXterm }
      // Contains CRLF: must be passed through verbatim (xterm owns normalization).
      const clipboardText = 'line one\r\nline two'
      mockReadText.mockResolvedValueOnce(clipboardText)

      const { result } = renderHook(() => useTerminalClipboard(xtermRef))

      await act(async () => {
        await result.current.paste()
      })

      expect(mockReadText).toHaveBeenCalledTimes(1)
      expect(mockXterm.paste).toHaveBeenCalledTimes(1)
      expect(mockXterm.paste).toHaveBeenCalledWith(clipboardText)
    })

    it('calls onPaste callback on success', async () => {
      const mockXterm = createMockXterm()
      const xtermRef = { current: mockXterm }
      const onPaste = vi.fn()
      mockReadText.mockResolvedValueOnce('clipboard content')

      const { result } = renderHook(() => useTerminalClipboard(xtermRef, { onPaste }))

      await act(async () => {
        await result.current.paste()
      })

      await waitFor(() => {
        expect(onPaste).toHaveBeenCalledTimes(1)
      })
    })

    it('does nothing if clipboard is empty', async () => {
      const mockXterm = createMockXterm()
      const xtermRef = { current: mockXterm }
      mockReadText.mockResolvedValueOnce('')

      const { result } = renderHook(() => useTerminalClipboard(xtermRef))

      await act(async () => {
        await result.current.paste()
      })

      expect(mockXterm.paste).not.toHaveBeenCalled()
    })

    it('does nothing if xterm is null', async () => {
      const xtermRef = { current: null }
      mockReadText.mockResolvedValueOnce('clipboard content')

      const { result } = renderHook(() => useTerminalClipboard(xtermRef))

      await act(async () => {
        await result.current.paste()
      })

      expect(mockReadText).not.toHaveBeenCalled()
    })
  })

  describe('handleKeyEvent()', () => {
    const createKeyboardEvent = (
      key: string,
      modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}
    ): KeyboardEvent => {
      return new KeyboardEvent('keydown', {
        key,
        ctrlKey: modifiers.ctrlKey ?? false,
        metaKey: modifiers.metaKey ?? false,
        shiftKey: modifiers.shiftKey ?? false
      })
    }

    it('returns true (pass through) if no terminal', () => {
      const xtermRef = { current: null }

      const { result } = renderHook(() => useTerminalClipboard(xtermRef))

      const event = createKeyboardEvent('c', { metaKey: true })
      const shouldPreventDefault = result.current.handleKeyEvent(event)

      expect(shouldPreventDefault).toBe(true)
    })

    describe('Copy action (macOS)', () => {
      beforeEach(() => {
        mockIsMacOS.mockReturnValue(true)
      })

      it('returns false and calls copy for Cmd+C with selection', async () => {
        const mockXterm = createMockXterm(true, 'selected')
        const xtermRef = { current: mockXterm }

        const { result } = renderHook(() => useTerminalClipboard(xtermRef))

        const event = createKeyboardEvent('c', { metaKey: true })
        const shouldPreventDefault = result.current.handleKeyEvent(event)

        expect(shouldPreventDefault).toBe(false)

        await waitFor(() => {
          expect(mockXterm.getSelection).toHaveBeenCalled()
          expect(mockWriteText).toHaveBeenCalledWith('selected')
        })
      })

      it('returns false and calls copy for Cmd+C with uppercase C', async () => {
        const mockXterm = createMockXterm(true, 'selected')
        const xtermRef = { current: mockXterm }

        const { result } = renderHook(() => useTerminalClipboard(xtermRef))

        const event = createKeyboardEvent('C', { metaKey: true })
        const shouldPreventDefault = result.current.handleKeyEvent(event)

        expect(shouldPreventDefault).toBe(false)

        await waitFor(() => {
          expect(mockWriteText).toHaveBeenCalledWith('selected')
        })
      })

      it('returns true (pass through) for Cmd+C without selection (SIGINT)', () => {
        const mockXterm = createMockXterm(false)
        const xtermRef = { current: mockXterm }

        const { result } = renderHook(() => useTerminalClipboard(xtermRef))

        const event = createKeyboardEvent('c', { metaKey: true })
        const shouldPreventDefault = result.current.handleKeyEvent(event)

        expect(shouldPreventDefault).toBe(true)
        expect(mockXterm.getSelection).not.toHaveBeenCalled()
        expect(mockWriteText).not.toHaveBeenCalled()
      })
    })

    describe('Copy action (Windows)', () => {
      beforeEach(() => {
        mockIsMacOS.mockReturnValue(false)
      })

      it('returns false and calls copy for Ctrl+C with selection', async () => {
        const mockXterm = createMockXterm(true, 'selected')
        const xtermRef = { current: mockXterm }

        const { result } = renderHook(() => useTerminalClipboard(xtermRef))

        const event = createKeyboardEvent('c', { ctrlKey: true })
        const shouldPreventDefault = result.current.handleKeyEvent(event)

        expect(shouldPreventDefault).toBe(false)

        await waitFor(() => {
          expect(mockWriteText).toHaveBeenCalledWith('selected')
        })
      })

      it('returns true (pass through) for Ctrl+C without selection (SIGINT)', () => {
        const mockXterm = createMockXterm(false)
        const xtermRef = { current: mockXterm }

        const { result } = renderHook(() => useTerminalClipboard(xtermRef))

        const event = createKeyboardEvent('c', { ctrlKey: true })
        const shouldPreventDefault = result.current.handleKeyEvent(event)

        expect(shouldPreventDefault).toBe(true)
        expect(mockWriteText).not.toHaveBeenCalled()
      })
    })

    describe('Paste action (macOS)', () => {
      beforeEach(() => {
        mockIsMacOS.mockReturnValue(true)
      })

      it('returns true for Cmd+V (lets xterm handle native paste)', () => {
        // Standard Cmd+V returns true (pass through) to let xterm handle native paste
        // This avoids double-paste issue where both our handler AND native paste event fire
        const mockXterm = createMockXterm()
        const xtermRef = { current: mockXterm }

        const { result } = renderHook(() => useTerminalClipboard(xtermRef))

        const event = createKeyboardEvent('v', { metaKey: true })
        const shouldPassThrough = result.current.handleKeyEvent(event)

        expect(shouldPassThrough).toBe(true)
        expect(mockReadText).not.toHaveBeenCalled()
        expect(mockXterm.paste).not.toHaveBeenCalled()
      })

      it('returns true for Cmd+V with uppercase V', () => {
        const mockXterm = createMockXterm()
        const xtermRef = { current: mockXterm }

        const { result } = renderHook(() => useTerminalClipboard(xtermRef))

        const event = createKeyboardEvent('V', { metaKey: true })
        const shouldPassThrough = result.current.handleKeyEvent(event)

        expect(shouldPassThrough).toBe(true)
        expect(mockXterm.paste).not.toHaveBeenCalled()
      })
    })

    describe('Paste action (Windows)', () => {
      beforeEach(() => {
        mockIsMacOS.mockReturnValue(false)
      })

      it('returns true for Ctrl+V (lets xterm handle native paste)', () => {
        // Standard Ctrl+V returns true (pass through) to let xterm handle native paste
        const mockXterm = createMockXterm()
        const xtermRef = { current: mockXterm }

        const { result } = renderHook(() => useTerminalClipboard(xtermRef))

        const event = createKeyboardEvent('v', { ctrlKey: true })
        const shouldPassThrough = result.current.handleKeyEvent(event)

        expect(shouldPassThrough).toBe(true)
        expect(mockXterm.paste).not.toHaveBeenCalled()
      })
    })

    describe('Explicit shortcuts (Ctrl+Shift+C/V)', () => {
      it('returns false and calls copy for Ctrl+Shift+C regardless of selection', async () => {
        const mockXterm = createMockXterm(false, '') // No selection
        ;(mockXterm.getSelection as any).mockReturnValue('') // Empty selection
        const xtermRef = { current: mockXterm }

        const { result } = renderHook(() => useTerminalClipboard(xtermRef))

        const event = createKeyboardEvent('c', { ctrlKey: true, shiftKey: true })
        const shouldPreventDefault = result.current.handleKeyEvent(event)

        expect(shouldPreventDefault).toBe(false)
        // Note: copy() will do nothing because selection is empty, but handleKeyEvent returns false
      })

      it('returns false and calls paste for Ctrl+Shift+V', async () => {
        const mockXterm = createMockXterm()
        const xtermRef = { current: mockXterm }
        mockReadText.mockResolvedValueOnce('paste content')

        const { result } = renderHook(() => useTerminalClipboard(xtermRef))

        const event = createKeyboardEvent('v', { ctrlKey: true, shiftKey: true })
        const shouldPreventDefault = result.current.handleKeyEvent(event)

        expect(shouldPreventDefault).toBe(false)

        await waitFor(() => {
          expect(mockXterm.paste).toHaveBeenCalledWith('paste content')
        })
        // Single paste only — the explicit shortcut must not double-fire.
        expect(mockXterm.paste).toHaveBeenCalledTimes(1)
      })
    })

    describe('Non-clipboard keys', () => {
      beforeEach(() => {
        mockIsMacOS.mockReturnValue(true)
      })

      it('returns true for regular key presses', () => {
        const mockXterm = createMockXterm()
        const xtermRef = { current: mockXterm }

        const { result } = renderHook(() => useTerminalClipboard(xtermRef))

        const event = createKeyboardEvent('a')
        expect(result.current.handleKeyEvent(event)).toBe(true)
      })

      it('returns true for Cmd+A (select all)', () => {
        const mockXterm = createMockXterm()
        const xtermRef = { current: mockXterm }

        const { result } = renderHook(() => useTerminalClipboard(xtermRef))

        const event = createKeyboardEvent('a', { metaKey: true })
        expect(result.current.handleKeyEvent(event)).toBe(true)
      })

      it('returns true for Enter key', () => {
        const mockXterm = createMockXterm()
        const xtermRef = { current: mockXterm }

        const { result } = renderHook(() => useTerminalClipboard(xtermRef))

        const event = createKeyboardEvent('Enter')
        expect(result.current.handleKeyEvent(event)).toBe(true)
      })

      it('returns true for Escape key', () => {
        const mockXterm = createMockXterm()
        const xtermRef = { current: mockXterm }

        const { result } = renderHook(() => useTerminalClipboard(xtermRef))

        const event = createKeyboardEvent('Escape')
        expect(result.current.handleKeyEvent(event)).toBe(true)
      })

      it('returns true for arrow keys', () => {
        const mockXterm = createMockXterm()
        const xtermRef = { current: mockXterm }

        const { result } = renderHook(() => useTerminalClipboard(xtermRef))

        expect(result.current.handleKeyEvent(createKeyboardEvent('ArrowUp'))).toBe(true)
        expect(result.current.handleKeyEvent(createKeyboardEvent('ArrowDown'))).toBe(true)
        expect(result.current.handleKeyEvent(createKeyboardEvent('ArrowLeft'))).toBe(true)
        expect(result.current.handleKeyEvent(createKeyboardEvent('ArrowRight'))).toBe(true)
      })
    })
  })
})
