/**
 * Tests for useDirectoryWatcher Hook
 *
 * Tests the directory watching lifecycle including:
 * - Event handling (directory changes, project deletion, errors)
 * - Internal operation suppression (AC-010)
 * - Lifecycle management (start/stop watcher)
 * - Subscription management (subscribe/unsubscribe listeners)
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useDirectoryWatcher } from './useDirectoryWatcher'

// Hoist logger mock so vi.mock can reference it
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))

vi.mock('../utils/logger', () => ({ logger: mockLogger }))

describe('useDirectoryWatcher hook', () => {
  // Mock directoryWatch API methods
  const mockStart = vi.fn()
  const mockStop = vi.fn()
  const mockOnDirectoryChanged = vi.fn()
  const mockOnProjectDeleted = vi.fn()
  const mockOnDirectoryError = vi.fn()

  // Save original window.api
  const originalApi = (window as { api?: unknown }).api

  beforeEach(() => {
    vi.clearAllMocks()

    mockStart.mockResolvedValue(undefined)
    mockOnDirectoryChanged.mockReturnValue(() => {})
    mockOnProjectDeleted.mockReturnValue(() => {})
    mockOnDirectoryError.mockReturnValue(() => {})

    ;(window as { api?: unknown }).api = {
      directoryWatch: {
        start: mockStart,
        stop: mockStop,
        onDirectoryChanged: mockOnDirectoryChanged,
        onProjectDeleted: mockOnProjectDeleted,
        onDirectoryError: mockOnDirectoryError
      }
    }
  })

  afterEach(() => {
    // Clean up React components BEFORE restoring window.api
    // Otherwise, useEffect cleanup runs with undefined api
    cleanup()
  })

  afterAll(() => {
    ;(window as { api?: unknown }).api = originalApi
  })

  describe('event handling', () => {
    it('calls onRefresh when directory change event received (AC-001 renderer side)', () => {
      const onRefresh = vi.fn()
      const isInternalOperationRef = { current: false }

      renderHook(() =>
        useDirectoryWatcher({
          projectPath: '/proj',
          initialLoadComplete: true,
          isInternalOperationRef,
          onRefresh,
          onProjectDeleted: vi.fn(),
          onError: vi.fn()
        })
      )

      // Capture the callback passed to onDirectoryChanged
      const callback = mockOnDirectoryChanged.mock.calls[0][0]

      act(() => {
        callback({ eventCount: 1, summary: { add: 1 } })
      })

      expect(onRefresh).toHaveBeenCalledTimes(1)
    })

    it('does not call onRefresh when isInternalOperation is true (AC-010)', () => {
      const onRefresh = vi.fn()
      const isInternalOperationRef = { current: true }

      renderHook(() =>
        useDirectoryWatcher({
          projectPath: '/proj',
          initialLoadComplete: true,
          isInternalOperationRef,
          onRefresh,
          onProjectDeleted: vi.fn(),
          onError: vi.fn()
        })
      )

      const callback = mockOnDirectoryChanged.mock.calls[0][0]

      act(() => {
        callback({ eventCount: 1, summary: { add: 1 } })
      })

      expect(onRefresh).not.toHaveBeenCalled()
    })

    it('resumes calling onRefresh after isInternalOperation resets to false (AC-010)', () => {
      const onRefresh = vi.fn()
      const isInternalOperationRef = { current: true }

      renderHook(() =>
        useDirectoryWatcher({
          projectPath: '/proj',
          initialLoadComplete: true,
          isInternalOperationRef,
          onRefresh,
          onProjectDeleted: vi.fn(),
          onError: vi.fn()
        })
      )

      const callback = mockOnDirectoryChanged.mock.calls[0][0]

      // While internal operation is active, onRefresh should not be called
      act(() => {
        callback({ eventCount: 1, summary: { add: 1 } })
      })

      expect(onRefresh).not.toHaveBeenCalled()

      // Reset internal operation flag
      isInternalOperationRef.current = false

      // Now onRefresh should be called
      act(() => {
        callback({ eventCount: 2, summary: { modify: 1 } })
      })

      expect(onRefresh).toHaveBeenCalledTimes(1)
    })

    it('calls onProjectDeleted when project deletion event received', () => {
      const onProjectDeleted = vi.fn()

      renderHook(() =>
        useDirectoryWatcher({
          projectPath: '/proj',
          initialLoadComplete: true,
          isInternalOperationRef: { current: false },
          onRefresh: vi.fn(),
          onProjectDeleted,
          onError: vi.fn()
        })
      )

      const callback = mockOnProjectDeleted.mock.calls[0][0]

      act(() => {
        callback()
      })

      expect(onProjectDeleted).toHaveBeenCalledTimes(1)
    })

    it('calls onError when directory error event received', () => {
      const onError = vi.fn()

      renderHook(() =>
        useDirectoryWatcher({
          projectPath: '/proj',
          initialLoadComplete: true,
          isInternalOperationRef: { current: false },
          onRefresh: vi.fn(),
          onProjectDeleted: vi.fn(),
          onError
        })
      )

      const callback = mockOnDirectoryError.mock.calls[0][0]

      act(() => {
        callback({ error: 'watch failed' })
      })

      expect(onError).toHaveBeenCalledWith('watch failed')
    })
  })

  describe('lifecycle', () => {
    it('starts watcher on mount with valid projectPath', () => {
      renderHook(() =>
        useDirectoryWatcher({
          projectPath: '/proj',
          initialLoadComplete: true,
          isInternalOperationRef: { current: false },
          onRefresh: vi.fn(),
          onProjectDeleted: vi.fn(),
          onError: vi.fn()
        })
      )

      expect(mockStart).toHaveBeenCalledWith('/proj')
    })

    it('stops watcher on unmount', () => {
      const { unmount } = renderHook(() =>
        useDirectoryWatcher({
          projectPath: '/proj',
          initialLoadComplete: true,
          isInternalOperationRef: { current: false },
          onRefresh: vi.fn(),
          onProjectDeleted: vi.fn(),
          onError: vi.fn()
        })
      )

      unmount()

      expect(mockStop).toHaveBeenCalledWith('/proj')
    })

    it('does not start watcher when projectPath is null', () => {
      renderHook(() =>
        useDirectoryWatcher({
          projectPath: null,
          initialLoadComplete: true,
          isInternalOperationRef: { current: false },
          onRefresh: vi.fn(),
          onProjectDeleted: vi.fn(),
          onError: vi.fn()
        })
      )

      expect(mockStart).not.toHaveBeenCalled()
    })

    it('does not start watcher when initialLoadComplete is false', () => {
      renderHook(() =>
        useDirectoryWatcher({
          projectPath: '/proj',
          initialLoadComplete: false,
          isInternalOperationRef: { current: false },
          onRefresh: vi.fn(),
          onProjectDeleted: vi.fn(),
          onError: vi.fn()
        })
      )

      expect(mockStart).not.toHaveBeenCalled()
    })
  })

  describe('subscriptions', () => {
    it('subscribes to all three event listeners', () => {
      renderHook(() =>
        useDirectoryWatcher({
          projectPath: '/proj',
          initialLoadComplete: true,
          isInternalOperationRef: { current: false },
          onRefresh: vi.fn(),
          onProjectDeleted: vi.fn(),
          onError: vi.fn()
        })
      )

      expect(mockOnDirectoryChanged).toHaveBeenCalledTimes(1)
      expect(mockOnProjectDeleted).toHaveBeenCalledTimes(1)
      expect(mockOnDirectoryError).toHaveBeenCalledTimes(1)
    })

    it('unsubscribes all listeners on unmount', () => {
      const unsubscribeChanged = vi.fn()
      const unsubscribeDeleted = vi.fn()
      const unsubscribeError = vi.fn()

      mockOnDirectoryChanged.mockReturnValue(unsubscribeChanged)
      mockOnProjectDeleted.mockReturnValue(unsubscribeDeleted)
      mockOnDirectoryError.mockReturnValue(unsubscribeError)

      const { unmount } = renderHook(() =>
        useDirectoryWatcher({
          projectPath: '/proj',
          initialLoadComplete: true,
          isInternalOperationRef: { current: false },
          onRefresh: vi.fn(),
          onProjectDeleted: vi.fn(),
          onError: vi.fn()
        })
      )

      unmount()

      expect(unsubscribeChanged).toHaveBeenCalledTimes(1)
      expect(unsubscribeDeleted).toHaveBeenCalledTimes(1)
      expect(unsubscribeError).toHaveBeenCalledTimes(1)
    })
  })
})
