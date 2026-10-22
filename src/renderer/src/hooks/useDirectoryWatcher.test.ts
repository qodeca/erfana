// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
import { DIRECTORY_WATCHER } from '../components/ProjectTree/constants'

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
    // The hook debounces refresh by DIRECTORY_WATCHER.DEBOUNCE_DELAY (250 ms)
    // per lens-review Finding 2 on PR #241 – consumer-side throttle so multi-
    // file write storms collapse into a single tree re-list. Tests advance
    // fake timers to validate the debounced behavior.
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

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

      // Refresh is debounced – not yet called
      expect(onRefresh).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(DIRECTORY_WATCHER.DEBOUNCE_DELAY + 1)
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
        vi.advanceTimersByTime(DIRECTORY_WATCHER.DEBOUNCE_DELAY + 1)
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
        vi.advanceTimersByTime(DIRECTORY_WATCHER.DEBOUNCE_DELAY + 1)
      })

      expect(onRefresh).not.toHaveBeenCalled()

      // Reset internal operation flag
      isInternalOperationRef.current = false

      // Now onRefresh should be called after debounce expires
      act(() => {
        callback({ eventCount: 2, summary: { add: 1, change: 1 }, structural: true })
        vi.advanceTimersByTime(DIRECTORY_WATCHER.DEBOUNCE_DELAY + 1)
      })

      expect(onRefresh).toHaveBeenCalledTimes(1)
    })

    it('resume then immediate pause – catch-up still refreshes (#210)', () => {
      // The main process sends a catch-up at resume, but the next operation may
      // already have set the internal-operation flag when it arrives. It reports
      // external changes the pause dropped, so it must not be skipped.
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
        callback({ eventCount: 0, summary: {}, catchUp: true })
      })
      expect(onRefresh).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(DIRECTORY_WATCHER.DEBOUNCE_DELAY + 1)
      })

      expect(onRefresh).toHaveBeenCalledTimes(1)
    })

    it('debounces rapid directory change events into a single refresh (lens-review Finding 2)', () => {
      // Validates that consumer-side throttling collapses a multi-file write
      // storm (e.g., prettier --write src/, snapshot updates) into one
      // recursive readDirectory IPC walk rather than N. Each broadcast that
      // arrives within DEBOUNCE_DELAY restarts the timer; refresh fires once
      // the storm settles.
      const onRefresh = vi.fn()

      renderHook(() =>
        useDirectoryWatcher({
          projectPath: '/proj',
          initialLoadComplete: true,
          isInternalOperationRef: { current: false },
          onRefresh,
          onProjectDeleted: vi.fn(),
          onError: vi.fn()
        })
      )

      const callback = mockOnDirectoryChanged.mock.calls[0][0]

      // Three rapid events within the debounce window
      act(() => {
        callback({ eventCount: 1, summary: { add: 1 }, structural: true })
        vi.advanceTimersByTime(50)
        callback({ eventCount: 1, summary: { unlink: 1 }, structural: true })
        vi.advanceTimersByTime(50)
        callback({ eventCount: 1, summary: { addDir: 1 }, structural: true })
      })

      // Not yet — last event reset the timer
      act(() => {
        vi.advanceTimersByTime(DIRECTORY_WATCHER.DEBOUNCE_DELAY - 1)
      })
      expect(onRefresh).not.toHaveBeenCalled()

      // Cross the boundary
      act(() => {
        vi.advanceTimersByTime(2)
      })
      expect(onRefresh).toHaveBeenCalledTimes(1)
    })

    it('refreshes on an event with empty summary (hook is summary-shape-agnostic, lens-review Finding 10)', () => {
      // The hook does not inspect the summary contents – isInternalOperationRef
      // and the `structural` flag (absent counts as structural) are what gate
      // refresh. This pins the contract so a future change that starts
      // depending on summary shape surfaces a test failure rather than silent drift.
      const onRefresh = vi.fn()

      renderHook(() =>
        useDirectoryWatcher({
          projectPath: '/proj',
          initialLoadComplete: true,
          isInternalOperationRef: { current: false },
          onRefresh,
          onProjectDeleted: vi.fn(),
          onError: vi.fn()
        })
      )

      const callback = mockOnDirectoryChanged.mock.calls[0][0]

      act(() => {
        callback({ eventCount: 0, summary: {} })
        vi.advanceTimersByTime(DIRECTORY_WATCHER.DEBOUNCE_DELAY + 1)
      })

      expect(onRefresh).toHaveBeenCalledTimes(1)
    })

    describe('structural flag (content-only batches skip the tree)', () => {
      function mountWatcher(): { onRefresh: ReturnType<typeof vi.fn>; callback: (data: unknown) => void } {
        const onRefresh = vi.fn()
        renderHook(() =>
          useDirectoryWatcher({
            projectPath: '/proj',
            initialLoadComplete: true,
            isInternalOperationRef: { current: false },
            onRefresh,
            onProjectDeleted: vi.fn(),
            onError: vi.fn()
          })
        )
        return { onRefresh, callback: mockOnDirectoryChanged.mock.calls[0][0] }
      }

      it('does not re-read the tree for a content-only batch', () => {
        const { onRefresh, callback } = mountWatcher()

        act(() => {
          callback({ eventCount: 3, summary: { change: 3 }, structural: false })
          vi.advanceTimersByTime(DIRECTORY_WATCHER.MAX_WAIT * 2)
        })

        expect(onRefresh).not.toHaveBeenCalled()
      })

      it.each([
        ['add', { add: 1 }],
        ['unlink', { unlink: 1 }],
        ['addDir', { addDir: 1 }],
        ['unlinkDir', { unlinkDir: 1 }]
      ])('re-reads the tree for a structural %s batch', (_type, summary) => {
        const { onRefresh, callback } = mountWatcher()

        act(() => {
          callback({ eventCount: 1, summary, structural: true })
          vi.advanceTimersByTime(DIRECTORY_WATCHER.DEBOUNCE_DELAY + 1)
        })

        expect(onRefresh).toHaveBeenCalledTimes(1)
      })

      it('a catch-up refresh re-reads the tree even if marked non-structural', () => {
        const { onRefresh, callback } = mountWatcher()

        act(() => {
          callback({ eventCount: 0, summary: {}, structural: false, catchUp: true })
          vi.advanceTimersByTime(DIRECTORY_WATCHER.DEBOUNCE_DELAY + 1)
        })

        expect(onRefresh).toHaveBeenCalledTimes(1)
      })

      it('a content-only batch does not restart a pending structural refresh', () => {
        const { onRefresh, callback } = mountWatcher()

        act(() => {
          callback({ eventCount: 1, summary: { add: 1 }, structural: true })
          vi.advanceTimersByTime(DIRECTORY_WATCHER.DEBOUNCE_DELAY - 10)
          callback({ eventCount: 1, summary: { change: 1 }, structural: false })
          vi.advanceTimersByTime(11)
        })

        expect(onRefresh).toHaveBeenCalledTimes(1)
      })
    })

    describe('max wait', () => {
      it('refreshes within MAX_WAIT under a steady stream of structural events', () => {
        const onRefresh = vi.fn()
        renderHook(() =>
          useDirectoryWatcher({
            projectPath: '/proj',
            initialLoadComplete: true,
            isInternalOperationRef: { current: false },
            onRefresh,
            onProjectDeleted: vi.fn(),
            onError: vi.fn()
          })
        )
        const callback = mockOnDirectoryChanged.mock.calls[0][0]

        // One event every 100 ms keeps restarting the 250 ms debounce
        act(() => {
          for (let elapsed = 0; elapsed < DIRECTORY_WATCHER.MAX_WAIT; elapsed += 100) {
            callback({ eventCount: 1, summary: { add: 1 }, structural: true })
            vi.advanceTimersByTime(100)
          }
        })

        expect(onRefresh).toHaveBeenCalledTimes(1)

        // The stream goes on: the next burst is capped the same way
        act(() => {
          for (let elapsed = 0; elapsed < DIRECTORY_WATCHER.MAX_WAIT; elapsed += 100) {
            callback({ eventCount: 1, summary: { add: 1 }, structural: true })
            vi.advanceTimersByTime(100)
          }
        })

        expect(onRefresh).toHaveBeenCalledTimes(2)
      })

      it('stretches the max wait to twice the last read on a slow project', async () => {
        // Each tree read takes 3 s: the next forced refresh waits 6 s, not 1 s
        const READ_MS = 3000
        const onRefresh = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, READ_MS)))
        renderHook(() =>
          useDirectoryWatcher({
            projectPath: '/proj',
            initialLoadComplete: true,
            isInternalOperationRef: { current: false },
            onRefresh,
            onProjectDeleted: vi.fn(),
            onError: vi.fn()
          })
        )
        const callback = mockOnDirectoryChanged.mock.calls[0][0]

        // First read: debounced as usual, then it runs for 3 s
        await act(async () => {
          callback({ eventCount: 1, summary: { add: 1 }, structural: true })
          await vi.advanceTimersByTimeAsync(DIRECTORY_WATCHER.DEBOUNCE_DELAY + 1 + READ_MS)
        })
        expect(onRefresh).toHaveBeenCalledTimes(1)

        // A steady stream for 5 s: still inside the 6 s max wait
        await act(async () => {
          for (let elapsed = 0; elapsed < 5000; elapsed += 100) {
            callback({ eventCount: 1, summary: { add: 1 }, structural: true })
            await vi.advanceTimersByTimeAsync(100)
          }
        })
        expect(onRefresh).toHaveBeenCalledTimes(1)

        await act(async () => {
          for (let elapsed = 0; elapsed < 1100; elapsed += 100) {
            callback({ eventCount: 1, summary: { add: 1 }, structural: true })
            await vi.advanceTimersByTimeAsync(100)
          }
        })
        expect(onRefresh).toHaveBeenCalledTimes(2)
      })
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
