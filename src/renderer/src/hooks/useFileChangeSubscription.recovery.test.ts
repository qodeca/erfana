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

import { DELETED_FILE_PROBE_INTERVAL_MS } from '../../../shared/deletedFileProbe'
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
    expect(h.getStats).toHaveBeenCalledWith({ filePath: WATCHED_PATH })
  })

  it('recovers and reports a change when the file is actually still there', async () => {
    // A tmp→rename slower than the main process's 100 ms window.
    const onExternalChange = vi.fn()
    const { result } = renderSubscription(WATCHED_PATH, onExternalChange)
    await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalledTimes(1))

    h.emitDeleted(WATCHED_PATH)

    await waitFor(() => expect(onExternalChange).toHaveBeenCalledTimes(1))
    expect(result.current.isFileDeleted).toBe(false)
    // Main dropped the watch with the delete, so the slot forgot its hold:
    // the re-start rebuilds the count from zero, and no `stop` goes out that
    // could take another consumer's count for the same file (#252).
    expect(h.fileWatch.start).toHaveBeenCalledTimes(2)
    expect(h.fileWatch.stop).not.toHaveBeenCalled()
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
    // After a delete only the acquire talks to main: the hold was forgotten
    // when main dropped the watch (#252).
    expect(h.fileWatch.start).toHaveBeenCalledTimes(2)
    expect(h.fileWatch.stop).not.toHaveBeenCalled()
  })

  it('releases a live watch before re-acquiring, after a watcher error', async () => {
    const { result } = renderSubscription()
    await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalledTimes(1))
    h.emitError(WATCHED_PATH, 'watcher died')

    await act(async () => {
      await result.current.recover()
    })

    // Never two live subscriptions for one consumer
    expect(h.fileWatch.stop).toHaveBeenCalledTimes(1)
    expect(h.fileWatch.start).toHaveBeenCalledTimes(2)
    expect(h.fileWatch.stop.mock.invocationCallOrder[0]).toBeLessThan(
      h.fileWatch.start.mock.invocationCallOrder[1]
    )
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

describe('useFileChangeSubscription – a deleted file that comes back (#450)', () => {
  /** One probe interval passes and everything it started settles. */
  async function nextProbe(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELETED_FILE_PROBE_INTERVAL_MS)
    })
  }

  /** Mounted, watching, then deleted for real: the tab shows the deleted state. */
  async function renderDeleted(onExternalChange = vi.fn()) {
    vi.useFakeTimers()
    h.getStats.mockRejectedValue(new Error('ENOENT'))
    const rendered = renderSubscription(WATCHED_PATH, onExternalChange)
    await act(async () => {})
    h.emitDeleted(WATCHED_PATH)
    await act(async () => {})
    expect(rendered.result.current.isFileDeleted).toBe(true)
    h.getStats.mockClear()
    return rendered
  }

  it('keeps looking, and keeps the deleted state, while the file stays gone', async () => {
    const onExternalChange = vi.fn()
    const { result } = await renderDeleted(onExternalChange)

    await nextProbe()
    await nextProbe()

    expect(h.getStats).toHaveBeenCalledTimes(2)
    expect(result.current.isFileDeleted).toBe(true)
    expect(onExternalChange).not.toHaveBeenCalled()
    expect(h.fileWatch.start).toHaveBeenCalledTimes(1)
  })

  it('recovers on its own and reports a change once the file is back, then stops looking', async () => {
    const onExternalChange = vi.fn()
    const { result } = await renderDeleted(onExternalChange)
    await nextProbe()

    h.getStats.mockResolvedValue({ size: 2048 })
    await nextProbe()

    expect(result.current.isFileDeleted).toBe(false)
    expect(onExternalChange).toHaveBeenCalledTimes(1)
    // A fresh watch, and no `stop` for the one main already ended (#252)
    expect(h.fileWatch.start).toHaveBeenCalledTimes(2)
    expect(h.fileWatch.stop).not.toHaveBeenCalled()

    const asked = h.getStats.mock.calls.length
    await nextProbe()
    expect(h.getStats).toHaveBeenCalledTimes(asked)
  })

  it('stops looking when the tab closes', async () => {
    const { unmount } = await renderDeleted()

    unmount()
    await nextProbe()

    expect(h.getStats).not.toHaveBeenCalled()
  })
})
