/**
 * useTerminalClipboard Hook Tests
 *
 * Tests for the terminal clipboard hook:
 * - Selection state tracking via xterm's onSelectionChange
 * - copy(): getSelection() -> clipboard.writeText() (keeps selection)
 * - paste(): clipboard.readText() -> terminal.paste()
 * - handleKeyEvent(): Keyboard shortcut handling with SIGINT pass-through
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTerminalClipboard } from './useTerminalClipboard'
import type { Terminal } from '@xterm/xterm'

describe('useTerminalClipboard', () => {
  // Mock clipboard API
  const mockWriteText = vi.fn()
  const mockReadText = vi.fn()

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

  let originalPlatform: string

  beforeEach(() => {
    originalPlatform = navigator.platform

    // Reset mocks and set default implementations
    mockWriteText.mockReset().mockResolvedValue(undefined)
    mockReadText.mockReset().mockResolvedValue('clipboard text')

    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
        readText: mockReadText
      }
    })

    // Default to macOS
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      writable: true,
      configurable: true
    })
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true
    })
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
    it('copies selected text to clipboard', async () => {
      const mockXterm = createMockXterm(true, 'selected text')
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useTerminalClipboard(xtermRef))

      await act(async () => {
        await result.current.copy()
      })

      expect(mockXterm.getSelection).toHaveBeenCalledTimes(1)
      expect(mockWriteText).toHaveBeenCalledWith('selected text')
    })

    it('keeps selection after copy (VS Code terminal behavior)', async () => {
      const mockXterm = createMockXterm(true, 'selected text')
      const xtermRef = { current: mockXterm }

      const { result } = renderHook(() => useTerminalClipboard(xtermRef))

      await act(async () => {
        await result.current.copy()
      })

      // Selection should NOT be cleared - matches VS Code terminal behavior
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

    it('does nothing if no selection', async () => {
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

    it('calls onError callback on clipboard failure', async () => {
      const mockXterm = createMockXterm(true, 'selected text')
      const xtermRef = { current: mockXterm }
      const onError = vi.fn()
      const clipboardError = new Error('Clipboard access denied')
      mockWriteText.mockRejectedValueOnce(clipboardError)

      const { result } = renderHook(() => useTerminalClipboard(xtermRef, { onError }))

      await act(async () => {
        await result.current.copy()
      })

      await waitFor(() => {
        expect(onError).toHaveBeenCalledTimes(1)
        expect(onError).toHaveBeenCalledWith(clipboardError)
      })
    })

    it('converts non-Error to Error in onError callback', async () => {
      const mockXterm = createMockXterm(true, 'selected text')
      const xtermRef = { current: mockXterm }
      const onError = vi.fn()
      mockWriteText.mockRejectedValueOnce('string error')

      const { result } = renderHook(() => useTerminalClipboard(xtermRef, { onError }))

      await act(async () => {
        await result.current.copy()
      })

      await waitFor(() => {
        expect(onError).toHaveBeenCalledTimes(1)
        expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
        expect(onError.mock.calls[0][0].message).toBe('string error')
      })
    })
  })

  describe('paste()', () => {
    it('reads from clipboard and pastes to terminal', async () => {
      const mockXterm = createMockXterm()
      const xtermRef = { current: mockXterm }
      mockReadText.mockResolvedValueOnce('clipboard content')

      const { result } = renderHook(() => useTerminalClipboard(xtermRef))

      await act(async () => {
        await result.current.paste()
      })

      expect(mockReadText).toHaveBeenCalledTimes(1)
      expect(mockXterm.paste).toHaveBeenCalledWith('clipboard content')
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

    it('calls onError callback on clipboard failure', async () => {
      const mockXterm = createMockXterm()
      const xtermRef = { current: mockXterm }
      const onError = vi.fn()
      const clipboardError = new Error('Clipboard read denied')
      mockReadText.mockRejectedValueOnce(clipboardError)

      const { result } = renderHook(() => useTerminalClipboard(xtermRef, { onError }))

      await act(async () => {
        await result.current.paste()
      })

      await waitFor(() => {
        expect(onError).toHaveBeenCalledTimes(1)
        expect(onError).toHaveBeenCalledWith(clipboardError)
      })
    })

    it('converts non-Error to Error in onError callback', async () => {
      const mockXterm = createMockXterm()
      const xtermRef = { current: mockXterm }
      const onError = vi.fn()
      mockReadText.mockRejectedValueOnce('string error')

      const { result } = renderHook(() => useTerminalClipboard(xtermRef, { onError }))

      await act(async () => {
        await result.current.paste()
      })

      await waitFor(() => {
        expect(onError).toHaveBeenCalledTimes(1)
        expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
        expect(onError.mock.calls[0][0].message).toBe('string error')
      })
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
        Object.defineProperty(navigator, 'platform', {
          value: 'MacIntel',
          writable: true,
          configurable: true
        })
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
        Object.defineProperty(navigator, 'platform', {
          value: 'Win32',
          writable: true,
          configurable: true
        })
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
        Object.defineProperty(navigator, 'platform', {
          value: 'MacIntel',
          writable: true,
          configurable: true
        })
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
        Object.defineProperty(navigator, 'platform', {
          value: 'Win32',
          writable: true,
          configurable: true
        })
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
      })
    })

    describe('Non-clipboard keys', () => {
      beforeEach(() => {
        Object.defineProperty(navigator, 'platform', {
          value: 'MacIntel',
          writable: true,
          configurable: true
        })
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
