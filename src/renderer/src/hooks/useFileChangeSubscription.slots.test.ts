// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Watch-slot balance tests for {@link useFileChangeSubscription}
 * (security MEDIUM-1, arch H1).
 *
 * The main process refcounts watches per path. One stop too many deafens
 * another panel that is still watching the same file; one stop too few leaks a
 * slot out of a capped pool until the window is closed. Both are silent, so
 * the balance is asserted here rather than reasoned about.
 *
 * @module useFileChangeSubscription.slots.test
 * @see __test__/fileWatchHarness.ts for the shared environment
 */

import { describe, it, expect } from 'vitest'
import { act, waitFor } from '@testing-library/react'

import {
  installFileWatchHarness,
  renderSubscription,
  CAP_ERROR
} from './__test__/fileWatchHarness'

const h = installFileWatchHarness()

describe('useFileChangeSubscription – watch-slot balance', () => {
  it('sends exactly one stop per start across mount, N recoveries and unmount', async () => {
    const { result, unmount } = renderSubscription()
    await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalledTimes(1))

    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await result.current.recover()
      })
    }

    unmount()
    await waitFor(() =>
      expect(h.fileWatch.stop.mock.calls.length).toBe(h.fileWatch.start.mock.calls.length)
    )
    // 1 mount + 3 recoveries; every one of them released before re-acquiring.
    expect(h.fileWatch.start).toHaveBeenCalledTimes(4)
  })

  it('sends no stop when the start was refused', async () => {
    h.fileWatch.start.mockResolvedValue({ success: false, error: CAP_ERROR })
    const { result, unmount } = renderSubscription()
    await waitFor(() => expect(result.current.isWatchUnavailable).toBe(true))

    unmount()

    // Decrementing a count we never acquired would deafen another panel.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.fileWatch.stop).not.toHaveBeenCalled()
  })

  it('sends no stop when the start rejected', async () => {
    h.fileWatch.start.mockRejectedValue(new Error('IPC failed'))
    const { result, unmount } = renderSubscription()
    await waitFor(() => expect(result.current.isWatchUnavailable).toBe(true))

    unmount()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.fileWatch.stop).not.toHaveBeenCalled()
  })

  it('never lets a stop overtake its start on a fast mount then unmount', async () => {
    // The start stays in flight until the test releases it, so an unordered
    // teardown would send `stop` first and leak the slot permanently.
    let releaseStart: (value: { success: boolean }) => void = () => {}
    h.fileWatch.start.mockReturnValue(
      new Promise<{ success: boolean }>((resolve) => {
        releaseStart = resolve
      })
    )

    const { unmount } = renderSubscription()
    unmount()
    expect(h.fileWatch.stop).not.toHaveBeenCalled()

    await act(async () => {
      releaseStart({ success: true })
    })

    await waitFor(() => expect(h.fileWatch.stop).toHaveBeenCalledTimes(1))
    expect(h.fileWatch.start).toHaveBeenCalledTimes(1)
  })
})
