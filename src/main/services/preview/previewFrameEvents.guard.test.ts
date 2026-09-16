// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The frame guard of one live view (issue #124, WI-14; part 2 §2.5): what a
 * `src` frame's first load and a link inside a frame may do, against the
 * token, the depth cap and the per-page count cap (S4, S12). Split from
 * `previewFrameEvents.test.ts` by topic (docs/windows/contributing.md
 * § "Test-file split policy"); both use
 * `__test-helpers__/previewFrameEventsHarness.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { describeFramesOverLimit } from '../../../shared/previewFrameBadgeText'
import { logger } from '../LoggingService'
import { makeView, own, type TestFrame } from './__test-helpers__/previewFrameEventsHarness'
import type { PreviewFrameLike } from './previewFrameGuard'

const { MAX_FRAME_DEPTH, MAX_FRAMES_PER_PAGE, FRAME_OVER_LIMIT_QUIET_MS } = PREVIEW_LIMITS

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the frame guard (S4, S12)', () => {
  it("lets a frame on this view's token load and lists nothing", () => {
    const view = makeView()

    const event = view.navigate(view.createFrame(), own('/child.html'))

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(view.entries()).toEqual([])
  })

  it('cancels a remote first load and lists it itself, as a cancelled load is silent', () => {
    const view = makeView()

    const event = view.navigate(view.createFrame(), 'https://remote.example.com/')

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(view.entries()).toEqual([{ type: 'frame-remote', resourceUrlOrHost: 'https://remote.example.com/' }])
  })

  it('loads depth 1 to MAX_FRAME_DEPTH and leaves the next level empty, listed by path', () => {
    const view = makeView()
    const allowed = view.createChain(MAX_FRAME_DEPTH)

    expect(view.navigate(allowed, own('/l3.html')).preventDefault).not.toHaveBeenCalled()
    const event = view.navigate(view.createFrame(allowed), own('/l4.html'))

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(view.entries()).toEqual([{ type: 'frame-too-deep', resourceUrlOrHost: '/l4.html' }])
  })

  it('a src frame at depth 4 under srcdoc parents stays empty and is listed', () => {
    const view = makeView()
    let parent: TestFrame | undefined
    for (let level = 1; level <= MAX_FRAME_DEPTH; level += 1) {
      parent = view.createFrame(parent)
      view.startSrcdoc(parent)
      view.commitFrame(parent, 'about:srcdoc')
    }

    const event = view.navigate(view.createFrame(parent), own('/deep.html'))

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(view.entries()).toEqual([{ type: 'frame-too-deep', resourceUrlOrHost: '/deep.html' }])
  })

  it('lists a link out of a frame that shows a document by scheme and host', () => {
    const view = makeView()
    const frame = view.createFrame()
    view.commitFrame(frame)

    const event = view.navigate(frame, 'https://evil.example/x?secret=1')

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(view.entries()).toEqual([{ type: 'frame-link-blocked', resourceUrlOrHost: 'https://evil.example' }])
  })

  it('leaves the main frame to the lifecycle guard', () => {
    const view = makeView()

    expect(view.navigate(view.main, 'https://remote.example.com/', true).preventDefault).not.toHaveBeenCalled()
  })

  it('fails closed on a frame it cannot judge: gone, or throwing when read', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const view = makeView()
    const throwing = {
      frameTreeNodeId: 50,
      get parent(): PreviewFrameLike {
        throw new Error('Render frame was disposed')
      }
    }

    expect(view.navigate(null, own('/a.html')).preventDefault).toHaveBeenCalled()
    expect(view.navigate(throwing, own('/b.html')).preventDefault).toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(view.entries()).toEqual([])
  })

  it('60 src frames: MAX_FRAMES_PER_PAGE load, the rest stay empty, listed in one entry after the quiet time', () => {
    const view = makeView()
    const cancelled: boolean[] = []
    for (let i = 1; i <= 60; i += 1) {
      cancelled.push(view.navigate(view.createFrame(), own(`/f${i}.html`)).preventDefault.mock.calls.length > 0)
    }

    expect(cancelled.filter((wasCancelled) => !wasCancelled)).toHaveLength(MAX_FRAMES_PER_PAGE)
    expect(view.entries()).toEqual([])

    vi.advanceTimersByTime(FRAME_OVER_LIMIT_QUIET_MS)
    expect(view.entries()).toEqual([
      { type: 'frame-over-limit', resourceUrlOrHost: describeFramesOverLimit(60 - MAX_FRAMES_PER_PAGE, 'src') }
    ])
  })

  it('writes the over-limit entry when the page stops loading, and past the cap reads no frame count', () => {
    const view = makeView()
    for (let i = 1; i <= MAX_FRAMES_PER_PAGE + 1; i += 1) {
      view.navigate(view.createFrame(), own(`/f${i}.html`))
    }
    const readsAtCap = view.subtreeReads()
    view.navigate(view.createFrame(), own('/late.html'))

    expect(view.subtreeReads()).toBe(readsAtCap)
    view.emit('did-stop-loading')
    expect(view.entries()).toEqual([
      { type: 'frame-over-limit', resourceUrlOrHost: describeFramesOverLimit(2, 'src') }
    ])
  })

  it('a link inside a frame on a page past the cap still works', () => {
    const view = makeView()
    const first = view.createFrame()
    view.navigate(first, own('/f1.html'))
    view.commitFrame(first)
    for (let i = 2; i <= MAX_FRAMES_PER_PAGE + 5; i += 1) {
      view.navigate(view.createFrame(), own(`/f${i}.html`))
    }

    expect(view.navigate(first, own('/next.html')).preventDefault).not.toHaveBeenCalled()
  })

  // A script-made frame first commits an inert about:blank, which is no shown document,
  // so its own-token load is still its first load and counts toward the cap.
  it('a script-made frame counts toward the cap: after its about:blank commit, the 51st load stays empty', () => {
    const view = makeView()
    const cancelled: boolean[] = []
    for (let i = 1; i <= MAX_FRAMES_PER_PAGE + 1; i += 1) {
      const frame = view.createFrame()
      view.commitFrame(frame, 'about:blank')
      cancelled.push(view.navigate(frame, own(`/f${i}.html`)).preventDefault.mock.calls.length > 0)
    }

    expect(cancelled.slice(0, MAX_FRAMES_PER_PAGE)).not.toContain(true)
    expect(cancelled[MAX_FRAMES_PER_PAGE]).toBe(true)
    vi.advanceTimersByTime(FRAME_OVER_LIMIT_QUIET_MS)
    expect(view.entries()).toEqual([
      { type: 'frame-over-limit', resourceUrlOrHost: describeFramesOverLimit(1, 'src') }
    ])
  })
})
