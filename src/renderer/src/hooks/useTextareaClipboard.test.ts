// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useTextareaClipboard Hook
 *
 * The hook routes clipboard operations through the central `textClipboard`
 * service (issue #203): copy/cut via `writeText`, paste via `readText`.
 * Transport failures (and any toast/log) are owned by the service, so the hook
 * adds no catch/toast. The `maxLength` over-limit paste remains a SILENT product
 * rule (no toast). These tests assert the routing, value mutation, cursor
 * restore, and the silent no-ops.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTextareaClipboard } from './useTextareaClipboard'
import { showErrorToast } from '../utils/toastHelpers'

// Mock the central clipboard service: copy/cut write via writeText, paste reads
// via readText (issue #203).
const mockWriteText = vi.fn()
const mockReadText = vi.fn()
vi.mock('../services/textClipboard', () => ({
  textClipboard: {
    writeText: (text: string) => mockWriteText(text),
    readText: () => mockReadText()
  }
}))

// Spy on the toast helper to assert silent no-ops never surface a toast.
vi.mock('../utils/toastHelpers', () => ({
  showErrorToast: vi.fn()
}))

describe('useTextareaClipboard', () => {
  let mockRef: { current: HTMLTextAreaElement | HTMLInputElement | null }
  let mockSetValue: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()

    // Service is success-by-default.
    mockWriteText.mockReset().mockResolvedValue(true)
    mockReadText.mockReset().mockResolvedValue('pasted text')

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

    // Mock requestAnimationFrame
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 0
    })
  })

  describe('handleCopy', () => {
    it('routes copy through textClipboard.writeText with the selection', async () => {
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

      expect(mockWriteText).toHaveBeenCalledWith('hello')
    })

    it('does not copy or toast when there is no selection', async () => {
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

      expect(mockWriteText).not.toHaveBeenCalled()
      expect(showErrorToast).not.toHaveBeenCalled()
    })

    it('does nothing when ref is null', async () => {
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

      expect(mockWriteText).not.toHaveBeenCalled()
    })
  })

  describe('handleCut', () => {
    it('routes cut through textClipboard.writeText and updates value', async () => {
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

      expect(mockWriteText).toHaveBeenCalledWith('hello ')
      expect(mockSetValue).toHaveBeenCalledWith('world')
    })

    it('restores the cursor to the cut location after cut', async () => {
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

    it('does not mutate the value when the write fails (transport failure)', async () => {
      mockRef.current!.selectionStart = 0
      mockRef.current!.selectionEnd = 5
      mockWriteText.mockResolvedValueOnce(false)

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

      // Value untouched; the service (not the hook) owns the failure toast/log.
      expect(mockSetValue).not.toHaveBeenCalled()
    })
  })

  describe('handlePaste', () => {
    it('routes paste through textClipboard.readText', async () => {
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

      expect(mockReadText).toHaveBeenCalled()
      expect(mockSetValue).toHaveBeenCalledWith('hello pasted textworld')
    })

    it('replaces the selected text when pasting', async () => {
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

    it('positions the cursor after the pasted text', async () => {
      mockRef.current!.selectionStart = 0
      mockRef.current!.selectionEnd = 0
      mockReadText.mockResolvedValueOnce('test')

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

    it('truncates an over-limit paste, inserting only what fits (no toast)', async () => {
      mockRef.current!.selectionStart = 0
      mockRef.current!.selectionEnd = 0
      mockReadText.mockResolvedValueOnce('very long text that exceeds limit')

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

      // value 'hello' (5) + remaining capacity 5 → insert first 5 chars 'very '.
      // Truncate-and-insert: silent product rule, still no toast.
      expect(mockSetValue).toHaveBeenCalledWith('very hello')
      expect(showErrorToast).not.toHaveBeenCalled()
      await waitFor(() => {
        expect(mockRef.current!.setSelectionRange).toHaveBeenCalledWith(5, 5)
      })
    })

    it('truncates against the selection it replaces when computing capacity', async () => {
      // Selecting 'hello' (5 chars) frees capacity: limit 10 - (5 - 5) = 10.
      mockRef.current!.selectionStart = 0
      mockRef.current!.selectionEnd = 5
      mockReadText.mockResolvedValueOnce('0123456789ABCDEF')

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

      // Whole value selected → capacity = 10; insert first 10 chars.
      expect(mockSetValue).toHaveBeenCalledWith('0123456789')
    })

    it('does not split a surrogate pair when truncation lands mid-emoji (drops the partial char)', async () => {
      // '😀' is U+1F600 = two UTF-16 units (😀). With remaining capacity
      // of 1 unit, a naive slice would insert a lone high surrogate; surrogate-
      // safe truncation drops the whole char instead.
      mockRef.current!.selectionStart = 1
      mockRef.current!.selectionEnd = 1
      mockReadText.mockResolvedValueOnce('😀')

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'X',
          setValue: mockSetValue,
          maxLength: 2 // remaining = 2 - (1 - 0) = 1 unit → cannot fit the emoji
        })
      )

      await act(async () => {
        await result.current.handlePaste()
      })

      // Nothing fits whole → value unchanged, no lone surrogate inserted.
      expect(mockSetValue).toHaveBeenCalledWith('X')
      // The kept string contains no unpaired surrogate.
      const inserted = (mockSetValue.mock.calls[0][0] as string).slice(1)
      expect(inserted).toBe('')
    })

    it('keeps a complete emoji when it fits within the remaining capacity', async () => {
      mockRef.current!.selectionStart = 1
      mockRef.current!.selectionEnd = 1
      mockReadText.mockResolvedValueOnce('😀b')

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'X',
          setValue: mockSetValue,
          maxLength: 3 // remaining = 2 units → the 2-unit emoji fits, 'b' does not
        })
      )

      await act(async () => {
        await result.current.handlePaste()
      })

      expect(mockSetValue).toHaveBeenCalledWith('X😀')
    })

    it('is a no-op when there is no remaining capacity', async () => {
      mockRef.current!.selectionStart = 0
      mockRef.current!.selectionEnd = 0
      mockReadText.mockResolvedValueOnce('x')

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: mockRef as React.RefObject<HTMLTextAreaElement>,
          value: 'fulltext!!',
          setValue: mockSetValue,
          maxLength: 10
        })
      )

      await act(async () => {
        await result.current.handlePaste()
      })

      // Already at the limit and nothing selected → nothing fits, no mutation.
      expect(mockSetValue).not.toHaveBeenCalled()
      expect(showErrorToast).not.toHaveBeenCalled()
    })

    it('allows a paste that stays within maxLength', async () => {
      mockRef.current!.selectionStart = 0
      mockRef.current!.selectionEnd = 0
      mockReadText.mockResolvedValueOnce('hi')

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

    it('is a no-op when the clipboard is empty', async () => {
      mockReadText.mockResolvedValueOnce('')

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
      expect(showErrorToast).not.toHaveBeenCalled()
    })
  })

  describe('hasSelection', () => {
    it('returns true when text is selected', () => {
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

    it('returns false when no text is selected', () => {
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

    it('returns false when ref is null', () => {
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
    it('works with HTMLInputElement and preserves cursor position', async () => {
      const inputRef = {
        current: {
          selectionStart: 0,
          selectionEnd: 0,
          focus: vi.fn(),
          setSelectionRange: vi.fn()
        } as unknown as HTMLInputElement
      }
      mockReadText.mockResolvedValueOnce('ab')

      const { result } = renderHook(() =>
        useTextareaClipboard({
          textareaRef: inputRef,
          value: 'hello',
          setValue: mockSetValue
        })
      )

      await act(async () => {
        await result.current.handlePaste()
      })

      expect(mockSetValue).toHaveBeenCalledWith('abhello')
      await waitFor(() => {
        expect(inputRef.current!.setSelectionRange).toHaveBeenCalledWith(2, 2)
      })
    })
  })
})
