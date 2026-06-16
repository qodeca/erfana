// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useKeyboardShortcuts Hook
 *
 * Tests the keyboard shortcut handler for Cmd/Ctrl+S (save) and
 * Cmd/Ctrl+W (close tab with confirmation).
 *
 * Test groups:
 * - Event listener registration (2 tests)
 * - Save shortcut (Cmd/Ctrl+S) (6 tests)
 * - Close shortcut (Cmd/Ctrl+W) (7 tests)
 * - Platform detection (3 tests)
 * - Modifier key combinations (4 tests)
 *
 * Total: 22 tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'
import { isMacOS } from '../utils/platform'

// Platform detection is resolved via the preload bridge (utils/platform).
// Mock it so tests drive the metaKey-vs-ctrlKey modifier directly.
vi.mock('../utils/platform', () => ({
  isMacOS: vi.fn()
}))

const mockIsMacOS = vi.mocked(isMacOS)

describe('useKeyboardShortcuts', () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>
  let mockOnSave: ReturnType<typeof vi.fn>
  let mockOnClose: ReturnType<typeof vi.fn>
  let mockShowConfirm: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
    // Default to non-macOS unless a test overrides via setPlatform().
    mockIsMacOS.mockReturnValue(false)

    mockOnSave = vi.fn()
    mockOnClose = vi.fn()
    mockShowConfirm = vi.fn().mockResolvedValue(false)
  })

  // Map a legacy platform string onto the mocked isMacOS result, keeping the
  // existing call sites (`setPlatform('MacIntel')`) unchanged.
  const setPlatform = (platform: string): void => {
    mockIsMacOS.mockReturnValue(platform.toUpperCase().includes('MAC'))
  }

  const createKeyboardEvent = (
    key: string,
    options: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}
  ): KeyboardEvent => {
    return new KeyboardEvent('keydown', {
      key,
      metaKey: options.metaKey ?? false,
      ctrlKey: options.ctrlKey ?? false,
      shiftKey: options.shiftKey ?? false,
      altKey: options.altKey ?? false,
      bubbles: true,
      cancelable: true
    })
  }

  const defaultOptions = () => ({
    onSave: mockOnSave,
    onClose: mockOnClose,
    isModified: false,
    showConfirm: mockShowConfirm,
    fileName: 'test.md'
  })

  describe('event listener registration', () => {
    it('registers keydown listener on mount', () => {
      renderHook(() => useKeyboardShortcuts(defaultOptions()))

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function)
      )
    })

    it('removes keydown listener on unmount', () => {
      const { unmount } = renderHook(() => useKeyboardShortcuts(defaultOptions()))

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function)
      )
    })
  })

  describe('save shortcut (Cmd/Ctrl+S)', () => {
    beforeEach(() => {
      setPlatform('MacIntel')
    })

    it('calls onSave on Cmd+S (Mac)', () => {
      renderHook(() => useKeyboardShortcuts(defaultOptions()))

      const event = createKeyboardEvent('s', { metaKey: true })
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
      window.dispatchEvent(event)

      expect(mockOnSave).toHaveBeenCalledTimes(1)
      expect(preventDefaultSpy).toHaveBeenCalled()
    })

    it('calls onSave on Ctrl+S (Windows)', () => {
      setPlatform('Win32')
      renderHook(() => useKeyboardShortcuts(defaultOptions()))

      const event = createKeyboardEvent('s', { ctrlKey: true })
      window.dispatchEvent(event)

      expect(mockOnSave).toHaveBeenCalledTimes(1)
    })

    it('does not call onSave on plain S key', () => {
      renderHook(() => useKeyboardShortcuts(defaultOptions()))

      const event = createKeyboardEvent('s')
      window.dispatchEvent(event)

      expect(mockOnSave).not.toHaveBeenCalled()
    })

    it('does not call onSave on Cmd+Shift+S', () => {
      renderHook(() => useKeyboardShortcuts(defaultOptions()))

      const event = createKeyboardEvent('s', { metaKey: true, shiftKey: true })
      window.dispatchEvent(event)

      expect(mockOnSave).not.toHaveBeenCalled()
    })

    it('does not call onSave on Cmd+Alt+S', () => {
      renderHook(() => useKeyboardShortcuts(defaultOptions()))

      const event = createKeyboardEvent('s', { metaKey: true, altKey: true })
      window.dispatchEvent(event)

      expect(mockOnSave).not.toHaveBeenCalled()
    })

    it('uses latest onSave callback (ref pattern)', () => {
      const { rerender } = renderHook(
        (props) => useKeyboardShortcuts(props),
        { initialProps: defaultOptions() }
      )

      const newOnSave = vi.fn()
      rerender({ ...defaultOptions(), onSave: newOnSave })

      const event = createKeyboardEvent('s', { metaKey: true })
      window.dispatchEvent(event)

      expect(newOnSave).toHaveBeenCalledTimes(1)
      expect(mockOnSave).not.toHaveBeenCalled()
    })
  })

  describe('close shortcut (Cmd/Ctrl+W)', () => {
    beforeEach(() => {
      setPlatform('MacIntel')
    })

    it('calls onClose directly when not modified', async () => {
      renderHook(() => useKeyboardShortcuts(defaultOptions()))

      const event = createKeyboardEvent('w', { metaKey: true })
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
      window.dispatchEvent(event)

      // Wait for async handler
      await vi.waitFor(() => {
        expect(mockOnClose).toHaveBeenCalledTimes(1)
      })
      expect(preventDefaultSpy).toHaveBeenCalled()
      expect(mockShowConfirm).not.toHaveBeenCalled()
    })

    it('shows confirmation dialog when modified', async () => {
      renderHook(() =>
        useKeyboardShortcuts({
          ...defaultOptions(),
          isModified: true
        })
      )

      const event = createKeyboardEvent('w', { metaKey: true })
      window.dispatchEvent(event)

      await vi.waitFor(() => {
        expect(mockShowConfirm).toHaveBeenCalledTimes(1)
      })

      expect(mockShowConfirm).toHaveBeenCalledWith({
        title: 'Unsaved Changes',
        message: 'File "test.md" has unsaved changes. Close anyway?',
        confirmLabel: 'Close Without Saving',
        danger: true
      })
    })

    it('calls onClose when user confirms', async () => {
      mockShowConfirm.mockResolvedValue(true)

      renderHook(() =>
        useKeyboardShortcuts({
          ...defaultOptions(),
          isModified: true
        })
      )

      const event = createKeyboardEvent('w', { metaKey: true })
      window.dispatchEvent(event)

      await vi.waitFor(() => {
        expect(mockOnClose).toHaveBeenCalledTimes(1)
      })
    })

    it('does not call onClose when user cancels', async () => {
      mockShowConfirm.mockResolvedValue(false)

      renderHook(() =>
        useKeyboardShortcuts({
          ...defaultOptions(),
          isModified: true
        })
      )

      const event = createKeyboardEvent('w', { metaKey: true })
      window.dispatchEvent(event)

      await vi.waitFor(() => {
        expect(mockShowConfirm).toHaveBeenCalledTimes(1)
      })

      // Give time for any potential onClose call
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(mockOnClose).not.toHaveBeenCalled()
    })

    it('handles null fileName gracefully', async () => {
      renderHook(() =>
        useKeyboardShortcuts({
          ...defaultOptions(),
          isModified: true,
          fileName: null
        })
      )

      const event = createKeyboardEvent('w', { metaKey: true })
      window.dispatchEvent(event)

      await vi.waitFor(() => {
        expect(mockShowConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'File "Untitled" has unsaved changes. Close anyway?'
          })
        )
      })
    })

    it('does not trigger on Cmd+Shift+W', () => {
      renderHook(() => useKeyboardShortcuts(defaultOptions()))

      const event = createKeyboardEvent('w', { metaKey: true, shiftKey: true })
      window.dispatchEvent(event)

      expect(mockOnClose).not.toHaveBeenCalled()
    })
  })

  describe('platform detection', () => {
    it('uses metaKey on Mac', () => {
      setPlatform('MacIntel')
      renderHook(() => useKeyboardShortcuts(defaultOptions()))

      // metaKey should trigger save
      const metaEvent = createKeyboardEvent('s', { metaKey: true })
      window.dispatchEvent(metaEvent)
      expect(mockOnSave).toHaveBeenCalledTimes(1)

      // ctrlKey should not trigger save on Mac
      const ctrlEvent = createKeyboardEvent('s', { ctrlKey: true })
      window.dispatchEvent(ctrlEvent)
      expect(mockOnSave).toHaveBeenCalledTimes(1) // Still 1
    })

    it('uses ctrlKey on Windows', () => {
      setPlatform('Win32')
      renderHook(() => useKeyboardShortcuts(defaultOptions()))

      // ctrlKey should trigger save
      const ctrlEvent = createKeyboardEvent('s', { ctrlKey: true })
      window.dispatchEvent(ctrlEvent)
      expect(mockOnSave).toHaveBeenCalledTimes(1)

      // metaKey should not trigger save on Windows
      const metaEvent = createKeyboardEvent('s', { metaKey: true })
      window.dispatchEvent(metaEvent)
      expect(mockOnSave).toHaveBeenCalledTimes(1) // Still 1
    })

    it('uses ctrlKey on Linux', () => {
      setPlatform('Linux x86_64')
      renderHook(() => useKeyboardShortcuts(defaultOptions()))

      const ctrlEvent = createKeyboardEvent('s', { ctrlKey: true })
      window.dispatchEvent(ctrlEvent)
      expect(mockOnSave).toHaveBeenCalledTimes(1)
    })
  })

  describe('modifier key combinations', () => {
    beforeEach(() => {
      setPlatform('MacIntel')
    })

    it('ignores other letters with Cmd', () => {
      renderHook(() => useKeyboardShortcuts(defaultOptions()))

      const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'z']
      keys.forEach((key) => {
        const event = createKeyboardEvent(key, { metaKey: true })
        window.dispatchEvent(event)
      })

      expect(mockOnSave).not.toHaveBeenCalled()
      expect(mockOnClose).not.toHaveBeenCalled()
    })

    it('handles uppercase key values', () => {
      renderHook(() => useKeyboardShortcuts(defaultOptions()))

      // The event key is typically lowercase even with shift
      // but test uppercase just in case
      const event = createKeyboardEvent('S', { metaKey: true })
      window.dispatchEvent(event)

      // 's' !== 'S', so this should not trigger
      expect(mockOnSave).not.toHaveBeenCalled()
    })

    it('prevents default browser behavior', () => {
      renderHook(() => useKeyboardShortcuts(defaultOptions()))

      const saveEvent = createKeyboardEvent('s', { metaKey: true })
      const savePreventDefault = vi.spyOn(saveEvent, 'preventDefault')
      window.dispatchEvent(saveEvent)

      expect(savePreventDefault).toHaveBeenCalled()

      const closeEvent = createKeyboardEvent('w', { metaKey: true })
      const closePreventDefault = vi.spyOn(closeEvent, 'preventDefault')
      window.dispatchEvent(closeEvent)

      expect(closePreventDefault).toHaveBeenCalled()
    })

    it('does not prevent default for non-handled shortcuts', () => {
      renderHook(() => useKeyboardShortcuts(defaultOptions()))

      const event = createKeyboardEvent('a', { metaKey: true })
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
      window.dispatchEvent(event)

      expect(preventDefaultSpy).not.toHaveBeenCalled()
    })
  })
})
