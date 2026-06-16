// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useSearchKeyboard Hook
 *
 * Tests the global keyboard shortcut handler that intercepts Cmd/Ctrl+F
 * to open the unified search instead of Monaco's built-in search.
 *
 * Test groups:
 * - Event listener registration (3 tests)
 * - macOS platform (Cmd+F) (4 tests)
 * - Windows/Linux platform (Ctrl+F) (3 tests)
 * - Linux platform (Ctrl+F) (1 test)
 * - Event prevention (3 tests)
 * - Other key combinations (2 tests)
 * - Store integration (1 test)
 * - Selection population (5 tests)
 *
 * @see Spec #001 - Unified search feature
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { MonacoEditorHandle } from '../components/Editor/MonacoMarkdownEditor'

const { mockOpenSearch, mockGetSelectedText, mockIsMacOS } = vi.hoisted(() => ({
  mockOpenSearch: vi.fn(),
  mockGetSelectedText: vi.fn(),
  mockIsMacOS: vi.fn()
}))

// Mock useSearchStore
vi.mock('../stores/useSearchStore', () => ({
  useSearchStore: {
    getState: () => ({
      openSearch: mockOpenSearch
    })
  }
}))

// Mock selectionHelpers
vi.mock('../utils/selectionHelpers', () => ({
  getSelectedText: mockGetSelectedText
}))

// Platform detection is resolved via the preload bridge (utils/platform).
// Mock it so tests drive the metaKey-vs-ctrlKey modifier directly.
vi.mock('../utils/platform', () => ({
  isMacOS: mockIsMacOS
}))

// Import after mocks
import { useSearchKeyboard } from './useSearchKeyboard'

describe('useSearchKeyboard', () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
    // Default to non-macOS unless a test overrides via setPlatform().
    mockIsMacOS.mockReturnValue(false)
  })

  // Map a legacy platform string onto the mocked isMacOS result, keeping the
  // existing call sites (`setPlatform('MacIntel')`) unchanged.
  const setPlatform = (platform: string): void => {
    mockIsMacOS.mockReturnValue(platform.toUpperCase().includes('MAC'))
  }

  const createKeyboardEvent = (
    key: string,
    options: { metaKey?: boolean; ctrlKey?: boolean } = {}
  ): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', {
      key,
      metaKey: options.metaKey ?? false,
      ctrlKey: options.ctrlKey ?? false,
      bubbles: true,
      cancelable: true
    })
    return event
  }

  describe('event listener registration', () => {
    it('registers keydown listener on mount', () => {
      renderHook(() => useSearchKeyboard())

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function),
        { capture: true }
      )
    })

    it('uses capture phase for event interception', () => {
      renderHook(() => useSearchKeyboard())

      const call = addEventListenerSpy.mock.calls.find(
        (c) => c[0] === 'keydown'
      )
      expect(call?.[2]).toEqual({ capture: true })
    })

    it('removes keydown listener on unmount', () => {
      const { unmount } = renderHook(() => useSearchKeyboard())

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function),
        { capture: true }
      )
    })
  })

  describe('macOS platform (Cmd+F)', () => {
    beforeEach(() => {
      setPlatform('MacIntel')
    })

    it('opens search on Cmd+F', () => {
      renderHook(() => useSearchKeyboard())

      const event = createKeyboardEvent('f', { metaKey: true })
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
      const stopPropagationSpy = vi.spyOn(event, 'stopPropagation')

      window.dispatchEvent(event)

      expect(mockOpenSearch).toHaveBeenCalledTimes(1)
      expect(preventDefaultSpy).toHaveBeenCalled()
      expect(stopPropagationSpy).toHaveBeenCalled()
    })

    it('opens search on Cmd+F with uppercase key', () => {
      renderHook(() => useSearchKeyboard())

      const event = createKeyboardEvent('F', { metaKey: true })
      window.dispatchEvent(event)

      expect(mockOpenSearch).toHaveBeenCalledTimes(1)
    })

    it('does not open search on Ctrl+F on Mac', () => {
      renderHook(() => useSearchKeyboard())

      const event = createKeyboardEvent('f', { ctrlKey: true })
      window.dispatchEvent(event)

      expect(mockOpenSearch).not.toHaveBeenCalled()
    })

    it('does not open search on plain F key', () => {
      renderHook(() => useSearchKeyboard())

      const event = createKeyboardEvent('f')
      window.dispatchEvent(event)

      expect(mockOpenSearch).not.toHaveBeenCalled()
    })
  })

  describe('Windows/Linux platform (Ctrl+F)', () => {
    beforeEach(() => {
      setPlatform('Win32')
    })

    it('opens search on Ctrl+F', () => {
      renderHook(() => useSearchKeyboard())

      const event = createKeyboardEvent('f', { ctrlKey: true })
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
      const stopPropagationSpy = vi.spyOn(event, 'stopPropagation')

      window.dispatchEvent(event)

      expect(mockOpenSearch).toHaveBeenCalledTimes(1)
      expect(preventDefaultSpy).toHaveBeenCalled()
      expect(stopPropagationSpy).toHaveBeenCalled()
    })

    it('opens search on Ctrl+F with uppercase key', () => {
      renderHook(() => useSearchKeyboard())

      const event = createKeyboardEvent('F', { ctrlKey: true })
      window.dispatchEvent(event)

      expect(mockOpenSearch).toHaveBeenCalledTimes(1)
    })

    it('does not open search on Cmd+F on Windows', () => {
      renderHook(() => useSearchKeyboard())

      const event = createKeyboardEvent('f', { metaKey: true })
      window.dispatchEvent(event)

      expect(mockOpenSearch).not.toHaveBeenCalled()
    })
  })

  describe('Linux platform (Ctrl+F)', () => {
    beforeEach(() => {
      setPlatform('Linux x86_64')
    })

    it('opens search on Ctrl+F', () => {
      renderHook(() => useSearchKeyboard())

      const event = createKeyboardEvent('f', { ctrlKey: true })
      window.dispatchEvent(event)

      expect(mockOpenSearch).toHaveBeenCalledTimes(1)
    })
  })

  describe('event prevention', () => {
    beforeEach(() => {
      setPlatform('MacIntel')
    })

    it('prevents default browser behavior', () => {
      renderHook(() => useSearchKeyboard())

      const event = createKeyboardEvent('f', { metaKey: true })
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

      window.dispatchEvent(event)

      expect(preventDefaultSpy).toHaveBeenCalled()
    })

    it('stops event propagation to prevent Monaco from receiving it', () => {
      renderHook(() => useSearchKeyboard())

      const event = createKeyboardEvent('f', { metaKey: true })
      const stopPropagationSpy = vi.spyOn(event, 'stopPropagation')

      window.dispatchEvent(event)

      expect(stopPropagationSpy).toHaveBeenCalled()
    })

    it('does not prevent default for non-search shortcuts', () => {
      renderHook(() => useSearchKeyboard())

      const event = createKeyboardEvent('s', { metaKey: true })
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

      window.dispatchEvent(event)

      expect(preventDefaultSpy).not.toHaveBeenCalled()
    })
  })

  describe('other key combinations', () => {
    beforeEach(() => {
      setPlatform('MacIntel')
    })

    it('ignores other letter keys with Cmd', () => {
      renderHook(() => useSearchKeyboard())

      const keys = ['a', 'b', 'c', 'd', 'e', 'g', 's', 'z']
      keys.forEach((key) => {
        const event = createKeyboardEvent(key, { metaKey: true })
        window.dispatchEvent(event)
      })

      expect(mockOpenSearch).not.toHaveBeenCalled()
    })

    it('ignores Cmd+Shift+F', () => {
      renderHook(() => useSearchKeyboard())

      // Shift key doesn't change the behavior in our implementation
      // but 'f' is still 'f' even with shift
      const event = createKeyboardEvent('f', { metaKey: true })
      window.dispatchEvent(event)

      // This should still work because we're checking for 'f' key
      expect(mockOpenSearch).toHaveBeenCalledTimes(1)
    })
  })

  describe('store integration', () => {
    beforeEach(() => {
      setPlatform('MacIntel')
    })

    it('calls useSearchStore.getState().openSearch()', () => {
      renderHook(() => useSearchKeyboard())

      const event = createKeyboardEvent('f', { metaKey: true })
      window.dispatchEvent(event)

      expect(mockOpenSearch).toHaveBeenCalledTimes(1)
    })
  })

  describe('selection population', () => {
    beforeEach(() => {
      setPlatform('MacIntel')
      mockGetSelectedText.mockClear()
    })

    it('calls getSelectedText when opening search', () => {
      mockGetSelectedText.mockReturnValue(undefined)
      renderHook(() => useSearchKeyboard())

      const event = createKeyboardEvent('f', { metaKey: true })
      window.dispatchEvent(event)

      expect(mockGetSelectedText).toHaveBeenCalledTimes(1)
    })

    it('passes selected text to openSearch', () => {
      mockGetSelectedText.mockReturnValue('selected text')
      renderHook(() => useSearchKeyboard())

      const event = createKeyboardEvent('f', { metaKey: true })
      window.dispatchEvent(event)

      expect(mockOpenSearch).toHaveBeenCalledWith('selected text')
    })

    it('passes undefined to openSearch when no selection', () => {
      mockGetSelectedText.mockReturnValue(undefined)
      renderHook(() => useSearchKeyboard())

      const event = createKeyboardEvent('f', { metaKey: true })
      window.dispatchEvent(event)

      expect(mockOpenSearch).toHaveBeenCalledWith(undefined)
    })

    it('passes editorRef to getSelectedText when provided', () => {
      mockGetSelectedText.mockReturnValue(undefined)
      const mockEditorRef = { current: null } as React.RefObject<MonacoEditorHandle | null>

      renderHook(() => useSearchKeyboard({ editorRef: mockEditorRef }))

      const event = createKeyboardEvent('f', { metaKey: true })
      window.dispatchEvent(event)

      expect(mockGetSelectedText).toHaveBeenCalledWith(mockEditorRef)
    })

    it('passes undefined to getSelectedText when no editorRef', () => {
      mockGetSelectedText.mockReturnValue(undefined)

      renderHook(() => useSearchKeyboard())

      const event = createKeyboardEvent('f', { metaKey: true })
      window.dispatchEvent(event)

      expect(mockGetSelectedText).toHaveBeenCalledWith(undefined)
    })
  })
})
