// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link useReloadAction} (QG-11a H4).
 *
 * The finding these pin: a Reload that fails used to change nothing at all, so
 * the user could not tell the click had registered.
 *
 * @module useReloadAction.test
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { useReloadAction } from './useReloadAction'
import { INDICATOR_DURATION_MS } from '../../../../constants/fileWatch'

afterEach(() => {
  vi.useRealTimers()
})

describe('useReloadAction', () => {
  it('re-reads the file when recovery succeeds and reports no failure', async () => {
    const recover = vi.fn().mockResolvedValue(true)
    const refresh = vi.fn()
    const { result } = renderHook(() => useReloadAction({ recover, refresh }))

    await act(async () => {
      result.current.reload()
    })

    expect(recover).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(result.current.hasReloadFailed).toBe(false)
    expect(result.current.isReloadPending).toBe(false)
  })

  it('raises a transient failure flag when recovery fails, and never re-reads', async () => {
    const recover = vi.fn().mockResolvedValue(false)
    const refresh = vi.fn()
    const { result } = renderHook(() => useReloadAction({ recover, refresh }))

    await act(async () => {
      result.current.reload()
    })

    expect(result.current.hasReloadFailed).toBe(true)
    expect(refresh).not.toHaveBeenCalled()

    // Self-clearing on the same budget as the success confirmation.
    await waitFor(() => expect(result.current.hasReloadFailed).toBe(false), {
      timeout: INDICATOR_DURATION_MS + 1500
    })
  })

  it('treats a throwing recover as a failure rather than leaving the button stuck', async () => {
    const recover = vi.fn().mockRejectedValue(new Error('IPC died'))
    const { result } = renderHook(() => useReloadAction({ recover, refresh: vi.fn() }))

    await act(async () => {
      try {
        result.current.reload()
      } catch {
        /* the hook owns the rejection; the click handler must not */
      }
      await Promise.resolve()
    })

    await waitFor(() => expect(result.current.isReloadPending).toBe(false))
    expect(result.current.hasReloadFailed).toBe(true)
  })

  it('disables itself while an attempt is in flight', async () => {
    let release: (value: boolean) => void = () => {}
    const recover = vi.fn().mockReturnValue(
      new Promise<boolean>((resolve) => {
        release = resolve
      })
    )
    const { result } = renderHook(() => useReloadAction({ recover, refresh: vi.fn() }))

    act(() => result.current.reload())
    expect(result.current.isReloadPending).toBe(true)

    // A second click while pending must not start a second recovery.
    act(() => result.current.reload())
    expect(recover).toHaveBeenCalledTimes(1)

    await act(async () => {
      release(true)
      await Promise.resolve()
    })
    expect(result.current.isReloadPending).toBe(false)
  })

  it('clears a previous verdict when a new attempt starts', async () => {
    const recover = vi.fn().mockResolvedValue(false)
    const { result } = renderHook(() => useReloadAction({ recover, refresh: vi.fn() }))

    await act(async () => {
      result.current.reload()
    })
    expect(result.current.hasReloadFailed).toBe(true)

    let release: (value: boolean) => void = () => {}
    recover.mockReturnValue(
      new Promise<boolean>((resolve) => {
        release = resolve
      })
    )
    act(() => result.current.reload())

    // Stale news is gone the moment a fresh attempt is running.
    expect(result.current.hasReloadFailed).toBe(false)
    await act(async () => {
      release(true)
      await Promise.resolve()
    })
  })

  it('does not update state after unmount', async () => {
    let release: (value: boolean) => void = () => {}
    const recover = vi.fn().mockReturnValue(
      new Promise<boolean>((resolve) => {
        release = resolve
      })
    )
    const { result, unmount } = renderHook(() => useReloadAction({ recover, refresh: vi.fn() }))

    act(() => result.current.reload())
    unmount()

    // A tab closed mid-attempt must not schedule the self-clearing timer.
    await act(async () => {
      release(false)
      await Promise.resolve()
    })
    expect(result.current.hasReloadFailed).toBe(false)
  })
})
