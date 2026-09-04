// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Lifecycle tests for {@link useFileChangeSubscription}.
 *
 * Covers the subscribe/unsubscribe cycle, the two invariants that make the hook
 * safe for a read-only surface (never pauses, `[filePath]`-only subscription),
 * change delivery and the reload indicator.
 *
 * The other concerns live in sibling files, all sharing one harness:
 * `.degraded` (failure classification and unavailable reasons), `.recovery`
 * (delete re-check and `recover()`), `.slots` (start/stop balance).
 *
 * @module useFileChangeSubscription.test
 * @see __test__/fileWatchHarness.ts for the shared environment
 */

import { describe, it, expect, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { useFileChangeSubscription } from './useFileChangeSubscription'
import { INDICATOR_DURATION_MS } from '../constants/fileWatch'
import {
  installFileWatchHarness,
  renderSubscription,
  OTHER_PATH,
  WATCHED_PATH
} from './__test__/fileWatchHarness'

const h = installFileWatchHarness()

describe('useFileChangeSubscription', () => {
  describe('Subscription lifecycle', () => {
    it('starts the watch on mount and stops it on unmount', async () => {
      const { unmount } = renderSubscription()

      await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalledWith(WATCHED_PATH))
      expect(h.listenerCounts().changed).toBe(1)

      unmount()

      // The stop is queued behind the start, so it lands on a later tick.
      await waitFor(() => expect(h.fileWatch.stop).toHaveBeenCalledWith(WATCHED_PATH))
      expect(h.listenerCounts()).toEqual({ changed: 0, deleted: 0, error: 0 })
    })

    it('subscribes to nothing for an empty path', () => {
      renderSubscription('')

      expect(h.fileWatch.start).not.toHaveBeenCalled()
    })

    it('swaps the watch exactly once when the path changes', async () => {
      const { rerender } = renderHook(
        ({ path }) => useFileChangeSubscription(path, { onExternalChange: vi.fn() }),
        { initialProps: { path: WATCHED_PATH } }
      )
      await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalledTimes(1))

      rerender({ path: OTHER_PATH })

      await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalledTimes(2))
      expect(h.fileWatch.stop).toHaveBeenCalledTimes(1)
      expect(h.fileWatch.stop).toHaveBeenCalledWith(WATCHED_PATH)
      expect(h.fileWatch.start).toHaveBeenLastCalledWith(OTHER_PATH)
    })

    it('does not restart the watch when the callback identity changes', async () => {
      // Invariant 2: the effect depends on [filePath] only.
      const { rerender } = renderHook(() =>
        useFileChangeSubscription(WATCHED_PATH, { onExternalChange: () => {} })
      )
      await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalledTimes(1))

      rerender()
      rerender()

      expect(h.fileWatch.start).toHaveBeenCalledTimes(1)
      expect(h.fileWatch.stop).not.toHaveBeenCalled()
    })

    it('never pauses or resumes the watch', async () => {
      // Invariant 1: pause is global per path with no safety timeout, so a
      // read-only surface must not touch it.
      const { unmount } = renderSubscription()
      await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalled())

      h.emitChanged(WATCHED_PATH)
      h.emitDeleted(WATCHED_PATH)
      unmount()

      expect(h.fileWatch.pause).not.toHaveBeenCalled()
      expect(h.fileWatch.resume).not.toHaveBeenCalled()
    })
  })

  describe('Change events', () => {
    it('reports a change for the watched path', async () => {
      const onExternalChange = vi.fn()
      renderSubscription(WATCHED_PATH, onExternalChange)
      await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalled())

      h.emitChanged(WATCHED_PATH)

      expect(onExternalChange).toHaveBeenCalledTimes(1)
    })

    it('ignores a change for a different path', async () => {
      const onExternalChange = vi.fn()
      renderSubscription(WATCHED_PATH, onExternalChange)
      await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalled())

      h.emitChanged(OTHER_PATH)

      expect(onExternalChange).not.toHaveBeenCalled()
    })

    it('always calls the latest callback, even though the effect never re-runs', async () => {
      const first = vi.fn()
      const second = vi.fn()
      const { rerender } = renderHook(
        ({ cb }) => useFileChangeSubscription(WATCHED_PATH, { onExternalChange: cb }),
        { initialProps: { cb: first } }
      )
      await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalled())

      rerender({ cb: second })
      h.emitChanged(WATCHED_PATH)

      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalledTimes(1)
    })
  })

  describe('Reload indicator', () => {
    it('raises the indicator and clears it after the shared duration', async () => {
      vi.useFakeTimers()
      const { result } = renderSubscription()

      act(() => result.current.markReloaded())
      expect(result.current.isReloading).toBe(true)

      act(() => {
        vi.advanceTimersByTime(INDICATOR_DURATION_MS)
      })
      expect(result.current.isReloading).toBe(false)
    })

    it('clears the timer on unmount so no state update lands after teardown', async () => {
      vi.useFakeTimers()
      const { result, unmount } = renderSubscription()

      act(() => result.current.markReloaded())
      unmount()

      // No act() warning and no throw: the timer was cancelled.
      expect(() => vi.advanceTimersByTime(INDICATOR_DURATION_MS * 2)).not.toThrow()
    })
  })
})
