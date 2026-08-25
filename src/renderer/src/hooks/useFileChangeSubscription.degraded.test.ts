// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Degraded-state tests for {@link useFileChangeSubscription}.
 *
 * Invariant 4: every way a watch can die produces an honest reason. The cap and
 * a broken watcher send the user to different remedies, so blaming the wrong
 * one is a real cost – "too many files are open" sends someone off closing tabs
 * that were never the problem.
 *
 * @module useFileChangeSubscription.degraded.test
 * @see __test__/fileWatchHarness.ts for the shared environment
 */

import { describe, it, expect } from 'vitest'
import { waitFor } from '@testing-library/react'

import { classifyWatchStartFailure } from './useFileChangeSubscription'
import {
  installFileWatchHarness,
  renderSubscription,
  CAP_ERROR,
  JOIN_ERROR,
  OTHER_PATH,
  WATCHED_PATH
} from './__test__/fileWatchHarness'

const h = installFileWatchHarness()

describe('useFileChangeSubscription – degraded states', () => {
  it('reports a start refused by the cap as the limit case without throwing', async () => {
    h.fileWatch.start.mockResolvedValue({ success: false, error: CAP_ERROR })
    const { result } = renderSubscription()

    await waitFor(() => expect(result.current.isWatchUnavailable).toBe(true))
    expect(result.current.unavailableReason).toBe('limit')
  })

  it('reports a rejected start as a watcher error, not the limit', async () => {
    // A rejected IPC call carries no cap evidence, so blaming the cap would
    // send the user closing tabs that were never the problem.
    h.fileWatch.start.mockRejectedValue(new Error('IPC failed'))
    const { result } = renderSubscription()

    await waitFor(() => expect(result.current.isWatchUnavailable).toBe(true))
    expect(result.current.unavailableReason).toBe('watcher-error')
  })

  it('reports a non-cap start failure as a watcher error', async () => {
    // `start` gained a second failure with the atomic-save re-arm: the entry
    // can disappear while a second consumer joins it. That is a watcher
    // fault, not the watched-files cap.
    h.fileWatch.start.mockResolvedValue({ success: false, error: JOIN_ERROR })
    const { result } = renderSubscription()

    await waitFor(() => expect(result.current.isWatchUnavailable).toBe(true))
    expect(result.current.unavailableReason).toBe('watcher-error')
  })

  it('reports a watcher error as its own reason', async () => {
    const { result } = renderSubscription()
    await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalled())

    h.emitError(WATCHED_PATH, 'watcher died')

    expect(result.current.isWatchUnavailable).toBe(true)
    expect(result.current.unavailableReason).toBe('watcher-error')
  })

  it('ignores a watcher error for another path', async () => {
    const { result } = renderSubscription()
    await waitFor(() => expect(h.fileWatch.start).toHaveBeenCalled())

    h.emitError(OTHER_PATH, 'watcher died')

    expect(result.current.isWatchUnavailable).toBe(false)
  })
})

describe('classifyWatchStartFailure', () => {
  it('attributes only the watched-files cap to the limit', () => {
    expect(classifyWatchStartFailure(CAP_ERROR)).toBe('limit')
  })

  it('attributes an ended-while-joining failure to the watcher', () => {
    expect(classifyWatchStartFailure(JOIN_ERROR)).toBe('watcher-error')
  })

  it('attributes a missing error string to the watcher', () => {
    // A rejected IPC call resolves with `cause` and no `error`; there is no
    // evidence of the cap, so the honest answer is "the watcher is broken".
    expect(classifyWatchStartFailure(undefined)).toBe('watcher-error')
    expect(classifyWatchStartFailure('')).toBe('watcher-error')
  })

  it('attributes an unrelated watcher fault to the watcher', () => {
    expect(classifyWatchStartFailure('File does not exist: /proj/icon.png')).toBe('watcher-error')
    expect(classifyWatchStartFailure('EMFILE: too many open files')).toBe('watcher-error')
  })
})
