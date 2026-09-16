// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link usePreviewMoveAnnouncer}: what a landed same-tab move says,
 * and when (issue #124, part 3 §3.8, UX spec §6). Frames are stepped by hand.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  previewMoveAnnouncementText,
  usePreviewMoveAnnouncer,
  type PreviewFrameScheduler
} from './usePreviewMoveAnnouncer'
import type { PreviewPageChangedPayload } from '../../../../../../shared/ipc/preview-navigation-schema'
import {
  usePreviewTabStore,
  type PreviewMoveAnnouncement
} from '../../../../stores/usePreviewTabStore'

const PRICING = { filePath: '/proj/pricing.html', anchor: null }

/** A scheduler whose frames run only when the test says so. */
function manualFrames(): { schedule: PreviewFrameScheduler; next: () => void; pending: () => number } {
  let queue: Array<() => void> = []
  return {
    schedule: (callback) => {
      queue.push(callback)
      return () => {
        queue = queue.filter((entry) => entry !== callback)
      }
    },
    next: () => {
      const run = queue
      queue = []
      act(() => run.forEach((callback) => callback()))
    },
    pending: () => queue.length
  }
}

function announce(partial: Partial<PreviewMoveAnnouncement> = {}): void {
  usePreviewTabStore.getState().setAnnouncement('preview-1', {
    origin: 'chrome',
    closedCount: 0,
    target: PRICING,
    focusMoved: false,
    ...partial
  })
}

function changed(partial: Partial<PreviewPageChangedPayload> = {}): PreviewPageChangedPayload {
  return {
    panelId: 'preview-1',
    filePath: PRICING.filePath,
    anchor: null,
    sameDocument: false,
    canGoBack: true,
    canGoForward: false,
    backTarget: null,
    forwardTarget: null,
    generation: 1,
    failed: false,
    ...partial
  }
}

const stored = (): PreviewMoveAnnouncement | null =>
  usePreviewTabStore.getState().getTab('preview-1').announcement

afterEach(() => usePreviewTabStore.getState().reset())

describe('previewMoveAnnouncementText (UX spec §6)', () => {
  it.each([
    ['chrome', 0, 'Showing pricing.html.'],
    ['chrome', 1, 'Showing pricing.html. Closed the other tab that showed it.'],
    ['chrome', 3, 'Showing pricing.html. Closed 3 other tabs that showed it.'],
    ['page', 1, 'Closed the other tab that showed it.'],
    ['page', 2, 'Closed 2 other tabs that showed it.'],
    ['page', 0, '']
  ] as const)('%s-started, %i closed: "%s"', (origin, closedCount, words) => {
    expect(
      previewMoveAnnouncementText({ origin, closedCount, target: PRICING, focusMoved: false })
    ).toBe(words)
  })

  it('names "the page" when the target has no file name', () => {
    expect(
      previewMoveAnnouncementText({
        origin: 'chrome',
        closedCount: 0,
        target: { filePath: '/', anchor: null },
        focusMoved: false
      })
    ).toBe('Showing the page.')
  })
})

describe('usePreviewMoveAnnouncer', () => {
  it('says nothing, and touches nothing, when no move is announced', () => {
    const frames = manualFrames()
    const { result } = renderHook(() => usePreviewMoveAnnouncer('preview-1', frames.schedule))

    act(() => result.current.onPageChanged(changed()))
    expect(frames.pending()).toBe(0)
    expect(result.current.text).toBe('')
  })

  it('speaks a landed move one frame later, and clears the store', () => {
    const frames = manualFrames()
    const { result } = renderHook(() => usePreviewMoveAnnouncer('preview-1', frames.schedule))
    announce()

    act(() => result.current.onPageChanged(changed()))
    expect(stored()).toBeNull()
    expect(result.current.text).toBe('')

    frames.next()
    expect(result.current.text).toBe('Showing pricing.html.')
  })

  it.each([
    ['another page', { filePath: '/proj/other.html' }],
    ['another anchor on the same page', { anchor: 'section', sameDocument: true }],
    ['a failed commit', { failed: true }]
  ])('clears the announcement without a word on %s', (_label, partial) => {
    const frames = manualFrames()
    const { result } = renderHook(() => usePreviewMoveAnnouncer('preview-1', frames.schedule))
    announce()

    act(() => result.current.onPageChanged(changed(partial)))
    frames.next()
    expect(stored()).toBeNull()
    expect(result.current.text).toBe('')
  })

  it('says nothing for a link inside the page that closed nothing', () => {
    const frames = manualFrames()
    const { result } = renderHook(() => usePreviewMoveAnnouncer('preview-1', frames.schedule))
    announce({ origin: 'page' })

    act(() => result.current.onPageChanged(changed()))
    expect(stored()).toBeNull()
    expect(frames.pending()).toBe(0)
  })

  it('holds the text until a focus move lands, then writes it one frame later', () => {
    const frames = manualFrames()
    const { result } = renderHook(() => usePreviewMoveAnnouncer('preview-1', frames.schedule))
    announce()

    act(() => {
      result.current.expectFocus()
      result.current.onPageChanged(changed())
    })
    frames.next()
    expect(result.current.text).toBe('')

    act(() => result.current.focusSettled())
    expect(result.current.text).toBe('')
    frames.next()
    expect(result.current.text).toBe('Showing pricing.html.')
  })

  it('still holds the text when the focus move is announced after its frame was asked for', () => {
    const frames = manualFrames()
    const { result } = renderHook(() => usePreviewMoveAnnouncer('preview-1', frames.schedule))
    announce()

    act(() => result.current.onPageChanged(changed()))
    act(() => result.current.expectFocus())
    frames.next()
    expect(result.current.text).toBe('')

    act(() => result.current.focusSettled())
    frames.next()
    expect(result.current.text).toBe('Showing pricing.html.')
  })

  it('clears the region first, so the same sentence twice is spoken twice', () => {
    const frames = manualFrames()
    const { result } = renderHook(() => usePreviewMoveAnnouncer('preview-1', frames.schedule))
    announce()
    act(() => result.current.onPageChanged(changed()))
    frames.next()
    expect(result.current.text).toBe('Showing pricing.html.')

    announce()
    act(() => result.current.onPageChanged(changed({ generation: 2 })))
    expect(result.current.text).toBe('')
    frames.next()
    expect(result.current.text).toBe('Showing pricing.html.')
  })

  it('schedules nothing when a focus move settles with nothing to say', () => {
    const frames = manualFrames()
    const { result } = renderHook(() => usePreviewMoveAnnouncer('preview-1', frames.schedule))

    act(() => {
      result.current.expectFocus()
      result.current.focusSettled()
    })
    expect(frames.pending()).toBe(0)
  })

  it('cancels a pending frame on unmount', () => {
    const frames = manualFrames()
    const { result, unmount } = renderHook(() =>
      usePreviewMoveAnnouncer('preview-1', frames.schedule)
    )
    announce()
    act(() => result.current.onPageChanged(changed()))
    expect(frames.pending()).toBe(1)

    unmount()
    expect(frames.pending()).toBe(0)
  })
})
