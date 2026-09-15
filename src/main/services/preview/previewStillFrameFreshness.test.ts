// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Still-picture freshness (issue #124, WI-10; RU3, part 1 §1.5): real input –
 * a wheel, a key, a click, a touch – marks the cached still stale and a pause
 * refreshes it; a pointer crossing the page does neither. The same watch keeps
 * the tab history's gesture clock: one gesture buys one in-page step, inside
 * the window and never on a clock that ran backwards (QG-7 S1, QG-8 T1). The
 * last block runs the still's whole main-side path – real bounds, visibility,
 * cache and freshness over a fake page – for the `stale` flag and the CSS size
 * a hide publishes. Fake timers only.
 */
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../LoggingService', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))

import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { PreviewStillFrameCache, type PreviewNativeImage } from './PreviewStillFrameCache'
import type { PreviewViewHandle } from './PreviewSessionFactory'
import { createPreviewLiveBounds } from './previewLiveBounds'
import { createPreviewLiveVisibility } from './previewLiveVisibility'
import {
  STILL_FRAME_STALE_INPUT_TYPES,
  attachStillFrameFreshness,
  marksStillFrameStale,
  type PreviewInputEventSource
} from './previewStillFrameFreshness'

const IDLE = PREVIEW_LIMITS.STILL_FRAME_IDLE_REFRESH_MS
const WINDOW = PREVIEW_LIMITS.HISTORY_GESTURE_WINDOW_MS
const PANEL = 'preview-a'
const RECT = { x: 0, y: 40, width: 800, height: 600 }

/** A fake page that emits `input-event` like Electron: `(event, input)`. */
function makePage(): {
  source: PreviewInputEventSource
  input: (type: string) => void
  listeners: () => number
} {
  const emitter = new EventEmitter()
  return {
    source: emitter as unknown as PreviewInputEventSource,
    input: (type) => {
      emitter.emit('input-event', {}, { type })
    },
    listeners: () => emitter.listenerCount('input-event')
  }
}

function watch(): {
  page: ReturnType<typeof makePage>
  markStale: ReturnType<typeof vi.fn>
  refresh: ReturnType<typeof vi.fn>
  dispose: () => void
  takeRecentGesture: () => boolean
  setNow: (ms: number) => void
} {
  const page = makePage()
  const markStale = vi.fn()
  const refresh = vi.fn()
  let clock = 0
  const freshness = attachStillFrameFreshness({
    contents: page.source,
    markStale,
    refresh,
    now: () => clock
  })
  return {
    page,
    markStale,
    refresh,
    dispose: () => freshness.dispose(),
    takeRecentGesture: () => freshness.takeRecentGesture(),
    setNow: (ms) => {
      clock = ms
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('marksStillFrameStale', () => {
  it.each([
    ['a wheel', 'mouseWheel'],
    ['a scroll', 'gestureScrollBegin'],
    ['a scroll', 'gestureScrollUpdate'],
    ['a scroll', 'gestureScrollEnd'],
    ['a fling', 'gestureFlingStart'],
    ['a fling', 'gestureFlingCancel'],
    ['a pinch', 'gesturePinchBegin'],
    ['a pinch', 'gesturePinchUpdate'],
    ['a pinch', 'gesturePinchEnd'],
    ['a key', 'rawKeyDown'],
    ['a key', 'keyDown'],
    ['typed text', 'char'],
    ['a click', 'mouseDown'],
    ['a click', 'mouseUp'],
    ['a touch', 'touchStart'],
    ['a touch', 'touchMove'],
    ['a touch', 'touchEnd'],
    ['a touch', 'touchCancel']
  ])('%s (%s) makes the picture stale', (_what, type) => {
    expect(marksStillFrameStale(type)).toBe(true)
  })

  it.each([
    'mouseMove',
    'pointerMove',
    'mouseEnter',
    'mouseLeave',
    'pointerRawUpdate',
    'contextMenu',
    'gestureTap',
    'keyUp'
  ])('%s leaves it fresh', (type) => {
    expect(marksStillFrameStale(type)).toBe(false)
  })

  it('leaves it fresh for a type that is not a string', () => {
    expect(marksStillFrameStale(undefined)).toBe(false)
    expect(marksStillFrameStale(7)).toBe(false)
  })

  it('names exactly the eighteen types of part 1 §1.5', () => {
    expect(STILL_FRAME_STALE_INPUT_TYPES.size).toBe(18)
  })
})

describe('attachStillFrameFreshness', () => {
  it.each(['mouseWheel', 'keyDown', 'mouseDown', 'touchStart'])(
    '%s marks the frame stale, and a pause refreshes it',
    (type) => {
      const { page, markStale, refresh } = watch()

      page.input(type)

      expect(markStale).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(IDLE - 1)
      expect(refresh).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(refresh).toHaveBeenCalledTimes(1)
    }
  )

  it.each(['mouseMove', 'pointerMove', 'mouseEnter', 'mouseLeave'])(
    '%s neither marks nor refreshes: a pointer crossing the page on its way to a splitter',
    (type) => {
      const { page, markStale, refresh } = watch()

      page.input(type)
      vi.advanceTimersByTime(IDLE * 2)

      expect(markStale).not.toHaveBeenCalled()
      expect(refresh).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('restarts the pause at every real input, so a scroll refreshes once, after it stops', () => {
    const { page, markStale, refresh } = watch()

    page.input('gestureScrollBegin')
    vi.advanceTimersByTime(IDLE - 100)
    page.input('gestureScrollUpdate')
    vi.advanceTimersByTime(IDLE - 100)
    page.input('gestureScrollEnd')
    // A pointer move does not restart it.
    vi.advanceTimersByTime(IDLE - 100)
    page.input('mouseMove')
    vi.advanceTimersByTime(99)
    expect(refresh).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(markStale).toHaveBeenCalledTimes(3)
  })

  it('dispose stops listening and drops a pending refresh', () => {
    const { page, markStale, refresh, dispose } = watch()
    page.input('keyDown')

    dispose()
    vi.advanceTimersByTime(IDLE)
    page.input('keyDown')

    expect(refresh).not.toHaveBeenCalled()
    expect(markStale).toHaveBeenCalledTimes(1)
    expect(page.listeners()).toBe(0)
  })
})

describe('takeRecentGesture — the gesture tab history spends (QG-7 S1, QG-8 T1)', () => {
  it('is false until a gesture reaches the page', () => {
    expect(watch().takeRecentGesture()).toBe(false)
  })

  it.each(['mouseDown', 'rawKeyDown', 'keyDown', 'touchEnd'])(
    '%s is a gesture: true once inside the window, then spent – no second step without new input',
    (type) => {
      const w = watch()
      w.setNow(1_000)
      w.page.input(type)
      w.setNow(1_000 + WINDOW)

      expect(w.takeRecentGesture()).toBe(true)
      expect(w.takeRecentGesture()).toBe(false)
    }
  )

  it('a new gesture buys one more step', () => {
    const w = watch()
    w.page.input('mouseDown')
    expect(w.takeRecentGesture()).toBe(true)

    w.page.input('keyDown')

    expect(w.takeRecentGesture()).toBe(true)
    expect(w.takeRecentGesture()).toBe(false)
  })

  it('is false for a gesture past the window', () => {
    const w = watch()
    w.page.input('mouseDown')
    w.setNow(WINDOW + 1)

    expect(w.takeRecentGesture()).toBe(false)
  })

  it('is false when the clock went backwards, and the gesture does not count once it catches up', () => {
    const w = watch()
    w.setNow(5_000)
    w.page.input('mouseDown')

    w.setNow(4_999)
    expect(w.takeRecentGesture()).toBe(false)
    w.setNow(5_000)
    expect(w.takeRecentGesture()).toBe(false)
  })

  it.each([
    'mouseWheel',
    'gestureScrollUpdate',
    'gesturePinchBegin',
    'mouseMove',
    'mouseUp',
    'char',
    'touchStart',
    'keyUp'
  ])('%s is no gesture: a scroll spy moving the hash as the reader scrolls took no step', (type) => {
    const w = watch()

    w.page.input(type)

    expect(w.takeRecentGesture()).toBe(false)
  })

  it('counts from the latest gesture', () => {
    const w = watch()
    w.page.input('mouseDown')
    w.setNow(30)
    w.page.input('keyDown')
    w.setNow(30 + WINDOW)

    expect(w.takeRecentGesture()).toBe(true)
  })

  it('a later scroll does not renew the gesture', () => {
    const w = watch()
    w.page.input('mouseDown')
    w.setNow(500)
    w.page.input('mouseWheel')
    w.setNow(WINDOW + 1)

    expect(w.takeRecentGesture()).toBe(false)
  })
})

describe('the still picture end to end: its stale flag and CSS size', () => {
  function makeImage(): PreviewNativeImage {
    const image: PreviewNativeImage = {
      isEmpty: () => false,
      getSize: () => ({ width: 800, height: 600 }),
      resize: () => image,
      toDataURL: () => 'data:image/png;base64,AAAA'
    }
    return image
  }

  /** One view's still path: real bounds, visibility, cache and freshness. */
  function makeStill(zoom = 1) {
    const emit = { boundsApplied: vi.fn(), visibilityApplied: vi.fn(), stillFrameChanged: vi.fn() }
    const page = makePage()
    const capturePage = vi.fn(async () => makeImage())
    const native = { setBounds: vi.fn(), setVisible: vi.fn(), setBackgroundColor: vi.fn() }
    const cache = new PreviewStillFrameCache({ now: () => 7 })
    const bounds = createPreviewLiveBounds({
      panelId: PANEL,
      view: native,
      window: {
        getContentBounds: () => ({ x: 0, y: 0, width: 1600, height: 1200 }),
        webContents: { getZoomFactor: () => zoom }
      },
      contents: { executeJavaScriptInIsolatedWorld: vi.fn(() => Promise.resolve(0)) },
      emit,
      getZoomFactor: () => zoom,
      isDefunct: () => false,
      now: () => 0
    })
    const visibility = createPreviewLiveVisibility({
      panelId: PANEL,
      view: native as unknown as PreviewViewHandle,
      window: {
        isDestroyed: () => false,
        contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }
      },
      contents: { capturePage },
      emit,
      stillFrameCache: cache,
      lastRect: () => bounds.lastRect(),
      lastCssSize: () => bounds.lastCssSize(),
      isDefunct: () => false
    })
    attachStillFrameFreshness({
      contents: page.source,
      markStale: () => cache.markStale(PANEL),
      refresh: () => visibility.captureWhileVisible(),
      now: () => 0
    })
    /** Apply a push and take the still, as the load pipeline does. */
    const capture = async (rect = RECT, seq = 1): Promise<void> => {
      bounds.apply(rect, seq, false)
      visibility.captureWhileVisible()
      await visibility.whenCaptureSettled()
    }
    return { emit, page, bounds, visibility, cache, capturePage, capture }
  }

  it("records the view's CSS size: its DIP size over the zoom it was sized with", async () => {
    const still = makeStill(1.25)

    await still.capture()

    // 1000 × 750 DIPs at 125 %: the renderer draws the still at 800 × 600 CSS px.
    expect(still.capturePage).toHaveBeenCalledWith(
      { x: 0, y: 0, width: 1000, height: 750 },
      { stayHidden: true }
    )
    expect(still.cache.get(PANEL)).toMatchObject({ cssWidth: 800, cssHeight: 600 })
    expect(still.cache.get(PANEL)).not.toHaveProperty('stale')
  })

  it('keeps the CSS size in step with a rect the window clamped', async () => {
    const still = makeStill()

    await still.capture({ x: 1000, y: 0, width: 800, height: 600 })

    expect(still.cache.get(PANEL)).toMatchObject({ cssWidth: 600, cssHeight: 600 })
  })

  it('sizes a still at zoom 1 when the zoom is not a positive number, like the clamp', async () => {
    const still = makeStill(Number.NaN)

    await still.capture()

    expect(still.bounds.lastCssSize()).toEqual({ width: 800, height: 600 })
  })

  it('a push that never reached the view reports false, so it never counts for a resize hold', () => {
    const still = makeStill()

    expect(still.bounds.apply(RECT, 2, false)).toBe(true)
    expect(still.bounds.apply(RECT, 2, false)).toBe(false)
    expect(still.bounds.apply({ x: 5000, y: 0, width: 10, height: 10 }, 3, false)).toBe(false)
  })

  it('real input after the capture: the next hide publishes the picture as stale', async () => {
    const still = makeStill()
    await still.capture()

    still.page.input('mouseWheel')
    still.visibility.set(false)

    expect(still.emit.stillFrameChanged).toHaveBeenCalledWith(
      PANEL,
      expect.objectContaining({ stale: true, cssWidth: 800, cssHeight: 600 })
    )
  })

  it('a pointer crossing the page keeps the picture fresh', async () => {
    const still = makeStill()
    await still.capture()

    still.page.input('mouseMove')
    still.visibility.set(false)

    const [, frame] = still.emit.stillFrameChanged.mock.calls[0]
    expect(frame).not.toHaveProperty('stale')
  })

  it('the pause after real input refreshes the picture, fresh again', async () => {
    const still = makeStill()
    await still.capture()
    still.page.input('keyDown')
    expect(still.cache.get(PANEL)?.stale).toBe(true)

    await vi.advanceTimersByTimeAsync(IDLE)
    await still.visibility.whenCaptureSettled()

    expect(still.capturePage).toHaveBeenCalledTimes(2)
    expect(still.cache.get(PANEL)).not.toHaveProperty('stale')
  })
})
