// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for PreviewFindController (Issue #74, work item 35).
 *
 * Covers the `finalUpdate`-only forwarding of design §1.4, the exact
 * findInPage options shape, and the zero-count-before-stopFindInPage ordering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  createPreviewFindController,
  type FoundInPageResult,
  type PreviewFindContents,
  type PreviewFindCount
} from './PreviewFindController'

interface WcMock extends PreviewFindContents {
  findInPage: ReturnType<typeof vi.fn>
  stopFindInPage: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
}

function makeHarness(): {
  wc: WcMock
  onCount: ReturnType<typeof vi.fn>
  emit: (result: FoundInPageResult) => void
} {
  let listener: ((event: unknown, result: FoundInPageResult) => void) | undefined
  const wc: WcMock = {
    findInPage: vi.fn(() => 1),
    stopFindInPage: vi.fn(),
    on: vi.fn((_event, l: (event: unknown, result: FoundInPageResult) => void) => {
      listener = l
    }),
    off: vi.fn((_event, l: (event: unknown, result: FoundInPageResult) => void) => {
      if (listener === l) {
        listener = undefined
      }
    })
  }
  const onCount = vi.fn<(count: PreviewFindCount) => void>()
  return {
    wc,
    onCount,
    emit: (result) => listener?.({}, result)
  }
}

describe('PreviewFindController', () => {
  let harness: ReturnType<typeof makeHarness>

  beforeEach(() => {
    harness = makeHarness()
  })

  it('forwards ONLY the finalUpdate:true result', () => {
    const { wc, onCount, emit } = harness
    createPreviewFindController(wc, onCount)

    emit({ requestId: 1, activeMatchOrdinal: 1, matches: 3, finalUpdate: false })
    expect(onCount).not.toHaveBeenCalled()

    emit({ requestId: 1, activeMatchOrdinal: 2, matches: 5, finalUpdate: true })
    expect(onCount).toHaveBeenCalledTimes(1)
    expect(onCount).toHaveBeenCalledWith({ total: 5, activeOrdinal: 2 })
  })

  it('passes exactly {forward, findNext, matchCase} to findInPage', () => {
    const { wc, onCount } = harness
    const controller = createPreviewFindController(wc, onCount)

    controller.find('needle', { forward: true, findNext: false, matchCase: true })

    expect(wc.findInPage).toHaveBeenCalledTimes(1)
    const [text, options] = wc.findInPage.mock.calls[0]
    expect(text).toBe('needle')
    expect(Object.keys(options as object).sort()).toEqual(['findNext', 'forward', 'matchCase'])
    expect(options).toEqual({ forward: true, findNext: false, matchCase: true })
  })

  it('clearHighlights pushes a zero count BEFORE stopFindInPage(clearSelection)', () => {
    const { wc, onCount } = harness
    const controller = createPreviewFindController(wc, onCount)

    controller.clearHighlights()

    expect(onCount).toHaveBeenCalledWith({ total: 0, activeOrdinal: 0 })
    expect(wc.stopFindInPage).toHaveBeenCalledWith('clearSelection')
    // Order: the zero count must be emitted before the selection is cleared.
    const countOrder = onCount.mock.invocationCallOrder[0]
    const stopOrder = wc.stopFindInPage.mock.invocationCallOrder[0]
    expect(countOrder).toBeLessThan(stopOrder)
  })

  it('treats an empty search as a clear (no findInPage throw path)', () => {
    const { wc, onCount } = harness
    const controller = createPreviewFindController(wc, onCount)

    controller.find('', { forward: true, findNext: false, matchCase: false })

    expect(wc.findInPage).not.toHaveBeenCalled()
    expect(onCount).toHaveBeenCalledWith({ total: 0, activeOrdinal: 0 })
    expect(wc.stopFindInPage).toHaveBeenCalledWith('clearSelection')
  })

  it('dispose() detaches the found-in-page listener and stops forwarding', () => {
    const { wc, onCount, emit } = harness
    const controller = createPreviewFindController(wc, onCount)

    controller.dispose()
    expect(wc.off).toHaveBeenCalledTimes(1)

    // Listener detached — a late event reaches no one.
    emit({ requestId: 1, activeMatchOrdinal: 1, matches: 1, finalUpdate: true })
    expect(onCount).not.toHaveBeenCalled()
  })
})
