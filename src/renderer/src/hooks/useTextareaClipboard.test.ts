/**
 * Tests for useTextareaClipboard Hook
 *
 * Tests clipboard operations (cut/copy/paste) with error handling,
 * toast notifications, and character limit enforcement.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTextareaClipboard } from './useTextareaClipboard'
import { showGlobalToast } from '../components/Toast/toastService'

// Mock toast service
vi.mock('../components/Toast/toastService', () => ({
  showGlobalToast: vi.fn()
}))

describe('useTextareaClipboard', () => {
  let mockRef: { current: HTMLTextAreaElement | HTMLInputElement | null }
  let mockSetValue: ReturnType<typeof vi.fn>
  let mockClipboard: {
    writeText: ReturnType<typeof vi.fn>
    readText: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock element
    mockRef = {
      current: {
        selectionStart: 0,
        selectionEnd: 0,
        focus: vi.fn(),
        setSelectionRange: vi.fn()
      } as unknown as HTMLTextAreaElement
    }

    mockSetValue = vi.fn()

    // Mock clipboard API
    mockClipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue('pasted text')
    }

    Object.defineProperty(navigator, 'clipboard', {
      value: mockClipboard,
      writable: true,
      configurable: true
    })

    // Mock requestAnimationFrame
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 0
    })
  })

  describe('handleCopy', () => {
    it('should copy selected text to clipboard', async () => {
      mockRef.current!.selectionStart = 0
      mockRef.current!.selectionEnd = 5

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'hello world',
          setValue: mockSetValue
        })
      )

      await act(async () => {
        await result.current.handleCopy()
      })

      expect(mockClipboard.writeText).toHaveBeenCalledWith('hello')
      expect(showGlobalToast).toHaveBeenCalledWith({
        type: 'info',
        title: 'Copied to clipboard',
        message: 'Text copied successfully'
      })
    })

    it('should not copy when no selection', async () => {
      mockRef.current!.selectionStart = 5
      mockRef.current!.selectionEnd = 5

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'hello world',
          setValue: mockSetValue
        })
      )

      await act(async () => {
        await result.current.handleCopy()
      })

      expect(mockClipboard.writeText).not.toHaveBeenCalled()
      expect(showGlobalToast).not.toHaveBeenCalled()
    })

    it('should show error toast on clipboard failure', async () => {
      mockRef.current!.selectionStart = 0
      mockRef.current!.selectionEnd = 5
      mockClipboard.writeText.mockRejectedValueOnce(new Error('Permission denied'))

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'hello world',
          setValue: mockSetValue
        })
      )

      await act(async () => {
        await result.current.handleCopy()
      })

      expect(showGlobalToast).toHaveBeenCalledWith({
        type: 'error',
        title: 'Failed to copy',
        message: 'Clipboard access denied'
      })
    })

    it('should do nothing when ref is null', async () => {
      mockRef.current = null

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'hello world',
          setValue: mockSetValue
        })
      )

      await act(async () => {
        await result.current.handleCopy()
      })

      expect(mockClipboard.writeText).not.toHaveBeenCalled()
    })
  })

  describe('handleCut', () => {
    it('should cut selected text to clipboard and update value', async () => {
      mockRef.current!.selectionStart = 0
      mockRef.current!.selectionEnd = 6

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'hello world',
          setValue: mockSetValue
        })
      )

      await act(async () => {
        await result.current.handleCut()
      })

      expect(mockClipboard.writeText).toHaveBeenCalledWith('hello ')
      expect(mockSetValue).toHaveBeenCalledWith('world')
      expect(showGlobalToast).toHaveBeenCalledWith({
        type: 'info',
        title: 'Cut to clipboard',
        message: 'Text cut successfully'
      })
    })

    it('should set cursor position after cut', async () => {
      mockRef.current!.selectionStart = 6
      mockRef.current!.selectionEnd = 11

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'hello world',
          setValue: mockSetValue
        })
      )

      await act(async () => {
        await result.current.handleCut()
      })

      await waitFor(() => {
        expect(mockRef.current!.focus).toHaveBeenCalled()
        expect(mockRef.current!.setSelectionRange).toHaveBeenCalledWith(6, 6)
      })
    })

    it('should show error toast on clipboard failure', async () => {
      mockRef.current!.selectionStart = 0
      mockRef.current!.selectionEnd = 5
      mockClipboard.writeText.mockRejectedValueOnce(new Error('Permission denied'))

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'hello world',
          setValue: mockSetValue
        })
      )

      await act(async () => {
        await result.current.handleCut()
      })

      expect(mockSetValue).not.toHaveBeenCalled()
      expect(showGlobalToast).toHaveBeenCalledWith({
        type: 'error',
        title: 'Failed to cut',
        message: 'Clipboard access denied'
      })
    })
  })

  describe('handlePaste', () => {
    it('should paste text from clipboard', async () => {
      mockRef.current!.selectionStart = 6
      mockRef.current!.selectionEnd = 6

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'hello world',
          setValue: mockSetValue
        })
      )

      await act(async () => {
        await result.current.handlePaste()
      })

      expect(mockSetValue).toHaveBeenCalledWith('hello pasted textworld')
      expect(showGlobalToast).toHaveBeenCalledWith({
        type: 'info',
        title: 'Pasted from clipboard',
        message: 'Text pasted successfully'
      })
    })

    it('should replace selected text when pasting', async () => {
      mockRef.current!.selectionStart = 0
      mockRef.current!.selectionEnd = 5

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'hello world',
          setValue: mockSetValue
        })
      )

      await act(async () => {
        await result.current.handlePaste()
      })

      expect(mockSetValue).toHaveBeenCalledWith('pasted text world')
    })

    it('should set cursor position after paste', async () => {
      mockRef.current!.selectionStart = 0
      mockRef.current!.selectionEnd = 0
      mockClipboard.readText.mockResolvedValueOnce('test')

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'hello',
          setValue: mockSetValue
        })
      )

      await act(async () => {
        await result.current.handlePaste()
      })

      await waitFor(() => {
        expect(mockRef.current!.focus).toHaveBeenCalled()
        expect(mockRef.current!.setSelectionRange).toHaveBeenCalledWith(4, 4)
      })
    })

    it('should enforce maxLength and show warning', async () => {
      mockRef.current!.selectionStart = 0
      mockRef.current!.selectionEnd = 0
      mockClipboard.readText.mockResolvedValueOnce('very long text that exceeds limit')

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'hello',
          setValue: mockSetValue,
          maxLength: 10
        })
      )

      await act(async () => {
        await result.current.handlePaste()
      })

      expect(mockSetValue).not.toHaveBeenCalled()
      expect(showGlobalToast).toHaveBeenCalledWith({
        type: 'warning',
        title: 'Paste would exceed character limit',
        message: 'Maximum 10 characters allowed'
      })
    })

    it('should allow paste when within maxLength', async () => {
      mockRef.current!.selectionStart = 0
      mockRef.current!.selectionEnd = 0
      mockClipboard.readText.mockResolvedValueOnce('hi')

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'hello',
          setValue: mockSetValue,
          maxLength: 10
        })
      )

      await act(async () => {
        await result.current.handlePaste()
      })

      expect(mockSetValue).toHaveBeenCalledWith('hihello')
    })

    it('should show error toast on clipboard failure', async () => {
      mockClipboard.readText.mockRejectedValueOnce(new Error('Permission denied'))

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'hello',
          setValue: mockSetValue
        })
      )

      await act(async () => {
        await result.current.handlePaste()
      })

      expect(mockSetValue).not.toHaveBeenCalled()
      expect(showGlobalToast).toHaveBeenCalledWith({
        type: 'error',
        title: 'Failed to paste from clipboard',
        message: 'Clipboard access denied'
      })
    })
  })

  describe('hasSelection', () => {
    it('should return true when text is selected', () => {
      mockRef.current!.selectionStart = 0
      mockRef.current!.selectionEnd = 5

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'hello world',
          setValue: mockSetValue
        })
      )

      expect(result.current.hasSelection()).toBe(true)
    })

    it('should return false when no text is selected', () => {
      mockRef.current!.selectionStart = 5
      mockRef.current!.selectionEnd = 5

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'hello world',
          setValue: mockSetValue
        })
      )

      expect(result.current.hasSelection()).toBe(false)
    })

    it('should return false when ref is null', () => {
      mockRef.current = null

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'hello world',
          setValue: mockSetValue
        })
      )

      expect(result.current.hasSelection()).toBe(false)
    })
  })

  describe('input element support', () => {
    it('should work with HTMLInputElement', async () => {
      const inputRef = {
        current: {
          selectionStart: 0,
          selectionEnd: 5,
          focus: vi.fn(),
          setSelectionRange: vi.fn()
        } as unknown as HTMLInputElement
      }

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: inputRef,
          value: 'hello world',
          setValue: mockSetValue
        })
      )

      await act(async () => {
        await result.current.handleCopy()
      })

      expect(mockClipboard.writeText).toHaveBeenCalledWith('hello')
    })
  })
})
