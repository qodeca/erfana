// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Deletion and recovery tests for {@link useFileChangeSubscription}.
 *
 * Invariant 3: a delete event is a claim, not a fact. An atomic save is a
 * delete followed by a rename, so the hook re-checks the disk before it tells
 * the user the file is gone – and `recover()` is the manual version of the same
 * re-check.
 *
 * @module useFileChangeSubscription.recovery.test
 * @see __test__/fileWatchHarness.ts for the shared environment
 */

import { describe, it, expect, vi } from 'vitest'
import { act, waitFor } from '@testing-library/react'

import {
  installFileWatchHarness,
  renderSubscription,
  CAP_ERROR,
  JOIN_ERROR,
  WATCHED_PATH
} from './__test__/fileWatchHarness'

const h = installFileWatchHarness()

describe('useFileChangeSubscription – deletion', () => {
  it('believes a delete only after re-checking the disk', async () => {
    h.getStats.mockRejectedValue(new Error('ENOENT'))
    const { result } = renderSubscription()
    await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalled())

    h.emitDeleted(WATCHED_PATH)

    await waitFor(() => expect(result.current.isFileDeleted).toBe(true))
    expect(h.getStats).toHaveBeenCalledWith(WATCHED_PATH)
  })

  it('recovers and reports a change when the file is actually still there', async () => {
    // A tmp→rename slower than the main process's 100 ms window.
    const onExternalChange = vi.fn()
    const { result } = renderSubscription(WATCHED_PATH, onExternalChange)
    await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalledTimes(1))

    h.emitDeleted(WATCHED_PATH)

    await waitFor(() => expect(onExternalChange).toHaveBeenCalledTimes(1))
    expect(result.current.isFileDeleted).toBe(false)
    // The re-start is preceded by a release, so the subscriber count this
    // consumer holds main-side stays at exactly one (security MEDIUM-1).
    expect(h.fileWatch.start).toHaveBeenCalledTimes(2)
    expect(h.fileWatch.stop).toHaveBeenCalledTimes(1)
  })

  it('clears a stale deleted state on the next change event', async () => {
    h.getStats.mockRejectedValue(new Error('ENOENT'))
    const { result } = renderSubscription()
    await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalled())
    h.emitDeleted(WATCHED_PATH)
    await waitFor(() => expect(result.current.isFileDeleted).toBe(true))

    h.emitChanged(WATCHED_PATH)

    expect(result.current.isFileDeleted).toBe(false)
  })
})

describe('useFileChangeSubscription – recover()', () => {
  it('re-stats, restarts the watch and clears both degraded states', async () => {
    h.getStats.mockRejectedValueOnce(new Error('ENOENT'))
    const { result } = renderSubscription()
    await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalledTimes(1))
    h.emitDeleted(WATCHED_PATH)
    await waitFor(() => expect(result.current.isFileDeleted).toBe(true))

    let recovered = false
    await act(async () => {
      recovered = await result.current.recover()
    })

    expect(recovered).toBe(true)
    expect(result.current.isFileDeleted).toBe(false)
    expect(result.current.isWatchUnavailable).toBe(false)
    // Release then re-acquire: never two live subscriptions for one consumer.
    expect(h.fileWatch.start).toHaveBeenCalledTimes(2)
    expect(h.fileWatch.stop).toHaveBeenCalledTimes(1)
  })

  it('stays deleted when the file is still gone', async () => {
    h.getStats.mockRejectedValue(new Error('ENOENT'))
    const { result } = renderSubscription()
    await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalledTimes(1))

    let recovered = true
    await act(async () => {
      recovered = await result.current.recover()
    })

    expect(recovered).toBe(false)
    expect(result.current.isFileDeleted).toBe(true)
    // Only the mount call: recover must not start a watch on a missing file.
    expect(h.fileWatch.start).toHaveBeenCalledTimes(1)
  })

  it('reports a restart refused by the cap as the limit case', async () => {
    const { result } = renderSubscription()
    await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalledTimes(1))
    h.fileWatch.start.mockResolvedValue({ success: false, error: CAP_ERROR })

    let recovered = true
    await act(async () => {
      recovered = await result.current.recover()
    })

    expect(recovered).toBe(false)
    expect(result.current.unavailableReason).toBe('limit')
  })

  it('reports a non-cap restart failure as a watcher error', async () => {
    const { result } = renderSubscription()
    await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalledTimes(1))
    h.fileWatch.start.mockResolvedValue({ success: false, error: JOIN_ERROR })

    await act(async () => {
      await result.current.recover()
    })

    expect(result.current.unavailableReason).toBe('watcher-error')
  })

  it('lets a genuine cap refusal follow a watcher error', async () => {
    // The failure decides the reason, so a restart the cap really did refuse
    // still says so - the watcher-error state is not sticky by itself.
    const { result } = renderSubscription()
    await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalledTimes(1))

    h.emitError(WATCHED_PATH, 'watcher died')
    expect(result.current.unavailableReason).toBe('watcher-error')

    h.fileWatch.start.mockResolvedValue({ success: false, error: CAP_ERROR })
    await act(async () => {
      await result.current.recover()
    })

    expect(result.current.unavailableReason).toBe('limit')
  })

  it('keeps a watcher-error reason instead of blaming the watch limit', async () => {
    // L4: a failed restart after a watcher fault must not tell the user that
    // "too many files are open" - that sends them off closing tabs for nothing.
    const { result } = renderSubscription()
    await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalledTimes(1))

    h.emitError(WATCHED_PATH, 'watcher died')
    expect(result.current.unavailableReason).toBe('watcher-error')

    h.fileWatch.start.mockResolvedValue({ success: false, error: 'still broken' })
    await act(async () => {
      await result.current.recover()
    })

    expect(result.current.unavailableReason).toBe('watcher-error')
  })

  it('is a no-op without a path', async () => {
    const { result } = renderSubscription('')

    let recovered = true
    await act(async () => {
      recovered = await result.current.recover()
    })

    expect(recovered).toBe(false)
    expect(h.fileWatch.start).not.toHaveBeenCalled()
  })
})
