// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for PreviewStillFrameCache (Issue #74, work item 34).
 *
 * Covers the defined-fallback contract of design §1.4: over-budget, skipped
 * (`isBeingCaptured`) and throwing captures all emit NO frame (never a blank),
 * downscale runs via `NativeImage.resize`, and a good capture is stored.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { PREVIEW } from '../../../shared/constants'

import {
  createPreviewStillFrameCache,
  type PreviewCaptureContents,
  type PreviewNativeImage
} from './PreviewStillFrameCache'

const SIZE = { width: 800, height: 600 }
const PANEL = 'panel-1'
const SHORT_DATA_URL = 'data:image/png;base64,AAAA'

interface ImageMock extends PreviewNativeImage {
  resize: ReturnType<typeof vi.fn>
  toDataURL: ReturnType<typeof vi.fn>
  getSize: ReturnType<typeof vi.fn>
  isEmpty: ReturnType<typeof vi.fn>
}

function makeImage(
  size: { width: number; height: number },
  dataUrl: string,
  resized?: ImageMock
): ImageMock {
  const img: ImageMock = {
    isEmpty: vi.fn(() => false),
    getSize: vi.fn(() => size),
    resize: vi.fn(() => resized ?? img),
    toDataURL: vi.fn(() => dataUrl)
  }
  return img
}

interface WcMock extends PreviewCaptureContents {
  isBeingCaptured: ReturnType<typeof vi.fn>
  capturePage: ReturnType<typeof vi.fn>
}

function makeWc(capturePage: WcMock['capturePage'], beingCaptured = false): WcMock {
  return {
    isBeingCaptured: vi.fn(() => beingCaptured),
    capturePage
  }
}

describe('PreviewStillFrameCache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stores a downscaled frame from a good capture', async () => {
    const resized = makeImage({ width: 1024, height: 512 }, SHORT_DATA_URL)
    const captured = makeImage({ width: 2048, height: 1024 }, 'unused', resized)
    const wc = makeWc(vi.fn(async () => captured))
    const cache = createPreviewStillFrameCache({ now: () => 123, maxEdgePx: 1024 })

    await cache.captureIfStale(wc, PANEL, SIZE)

    const frame = cache.get(PANEL)
    expect(frame).toEqual({ dataUrl: SHORT_DATA_URL, width: 1024, height: 512, capturedAt: 123 })
  })

  it('captures before the view is hidden by passing stayHidden:true', async () => {
    const img = makeImage({ width: 100, height: 100 }, SHORT_DATA_URL)
    const wc = makeWc(vi.fn(async () => img))
    const cache = createPreviewStillFrameCache()

    await cache.captureIfStale(wc, PANEL, SIZE)

    expect(wc.capturePage).toHaveBeenCalledWith(
      { x: 0, y: 0, width: 800, height: 600 },
      { stayHidden: true }
    )
  })

  it('captures from the PAGE origin, never from the view position in the window', async () => {
    // The caller's only rect is `PreviewLiveView.lastBounds` — window-relative
    // DIPs. `capturePage`'s rect is page-relative, so an offset origin asks for
    // a box past the page edge; Chromium clips it and returns a narrow sliver,
    // which the still-frame `<img>` then stretches and letterboxes in black.
    // The size-only signature is the fix; this pins what it produces.
    const img = makeImage({ width: 100, height: 100 }, SHORT_DATA_URL)
    const wc = makeWc(vi.fn(async () => img))
    const cache = createPreviewStillFrameCache()

    await cache.captureIfStale(wc, PANEL, { width: 723, height: 910 })

    const [rect] = wc.capturePage.mock.calls[0]
    expect(rect).toEqual({ x: 0, y: 0, width: 723, height: 910 })
  })

  it('downscales via NativeImage.resize when the longest edge exceeds the cap', async () => {
    const resized = makeImage({ width: 1024, height: 512 }, SHORT_DATA_URL)
    const captured = makeImage({ width: 2048, height: 1024 }, 'unused', resized)
    const wc = makeWc(vi.fn(async () => captured))
    const cache = createPreviewStillFrameCache({ maxEdgePx: 1024 })

    await cache.captureIfStale(wc, PANEL, SIZE)

    expect(captured.resize).toHaveBeenCalledWith({ width: 1024, height: 512, quality: 'good' })
  })

  it('keeps the previous frame when the caller says to discard the new one', async () => {
    // `isEmpty()` catches a ZERO-DIMENSION image and nothing else, so an
    // all-black picture at the right size would overwrite a good frame — and
    // nothing invalidates it afterwards. The caller knows whether its subject
    // was still on screen for the whole capture; it is asked at the last moment.
    const first = makeImage({ width: 10, height: 10 }, SHORT_DATA_URL)
    const wc = makeWc(vi.fn(async () => first))
    const cache = createPreviewStillFrameCache({ now: () => 7 })

    await cache.captureIfStale(wc, PANEL, SIZE)
    expect(cache.get(PANEL)?.capturedAt).toBe(7)

    const second = makeImage({ width: 10, height: 10 }, 'data:image/png;base64,BBBB')
    const wc2 = makeWc(vi.fn(async () => second))
    await cache.captureIfStale(wc2, PANEL, SIZE, { shouldKeep: () => false })

    // Untouched — still the first frame, not the discarded one.
    expect(cache.get(PANEL)?.dataUrl).toBe(SHORT_DATA_URL)
  })

  it('emits NO frame, and asks for nothing, when the view has no size', async () => {
    // A view that was never laid out reports 0x0. Capturing that is a wasted
    // round trip with no time budget behind it, and the answer is knowable here.
    const capturePage = vi.fn()
    const wc = makeWc(capturePage)
    const cache = createPreviewStillFrameCache()

    await cache.captureIfStale(wc, PANEL, { width: 0, height: 0 })

    expect(capturePage).not.toHaveBeenCalled()
    expect(cache.get(PANEL)).toBeUndefined()
  })

  it('captures even when Electron reports the page as captured by something else', async () => {
    // `isBeingCaptured()` is Chromium's capturer count, and other things raise
    // it. On Windows it read true from the first frame of a fresh preview, so
    // no still frame was ever taken and an evicted tab showed a flat colour
    // block (2026-09-03). Only a capture THIS cache started may skip the next.
    const capturePage = vi.fn(async () => makeImage({ width: 64, height: 32 }, SHORT_DATA_URL))
    const wc = makeWc(capturePage, true)
    const cache = createPreviewStillFrameCache()

    await cache.captureIfStale(wc, PANEL, SIZE)

    expect(capturePage).toHaveBeenCalledTimes(1)
    expect(cache.get(PANEL)).toBeDefined()
  })

  it('skips only while its own capture of that panel is in flight', async () => {
    let finish: () => void = () => undefined
    const capturePage = vi.fn(
      () =>
        new Promise<PreviewNativeImage>((resolve) => {
          finish = () => resolve(makeImage({ width: 64, height: 32 }, SHORT_DATA_URL))
        })
    )
    const wc = makeWc(capturePage)
    const cache = createPreviewStillFrameCache()

    const first = cache.captureIfStale(wc, PANEL, SIZE)
    await cache.captureIfStale(wc, PANEL, SIZE)
    expect(capturePage).toHaveBeenCalledTimes(1)

    finish()
    await first
    await cache.captureIfStale(wc, PANEL, SIZE)
    expect(capturePage).toHaveBeenCalledTimes(2)
  })

  it('abandons a capture that never resolves after the bound, keeps the previous frame, and recovers', async () => {
    vi.useFakeTimers()
    try {
      const good = vi.fn(async () => makeImage({ width: 64, height: 32 }, SHORT_DATA_URL))
      const cache = createPreviewStillFrameCache()
      await cache.captureIfStale(makeWc(good), PANEL, SIZE)
      const before = cache.get(PANEL)
      expect(before).toBeDefined()

      const hang = vi.fn(() => new Promise<PreviewNativeImage>(() => {}))
      const pending = cache.captureIfStale(makeWc(hang), PANEL, SIZE)
      await vi.advanceTimersByTimeAsync(PREVIEW.CAPTURE_TIMEOUT_MS + 1)
      await pending

      expect(cache.get(PANEL)).toBe(before)
      // The panel is capturable again: the hung capture no longer blocks it.
      await cache.captureIfStale(makeWc(good), PANEL, SIZE)
      expect(good).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries once, after a pause, when the first capture comes back empty', async () => {
    // Windows, 2026-09-03: the capture taken at 'ready' was an empty image for
    // three pages in a row — Chromium had not produced a frame yet — and each
    // of those tabs later parked as a flat colour block.
    vi.useFakeTimers()
    try {
      const empty = makeImage({ width: 800, height: 600 }, SHORT_DATA_URL)
      empty.isEmpty.mockReturnValue(true)
      const good = makeImage({ width: 64, height: 32 }, SHORT_DATA_URL)
      const capturePage = vi.fn().mockResolvedValueOnce(empty).mockResolvedValueOnce(good)
      const cache = createPreviewStillFrameCache()

      const pending = cache.captureIfStale(makeWc(capturePage), PANEL, SIZE)
      await vi.advanceTimersByTimeAsync(PREVIEW.CAPTURE_RETRY_DELAY_MS + 1)
      await pending

      expect(capturePage).toHaveBeenCalledTimes(2)
      expect(cache.get(PANEL)?.width).toBe(64)
    } finally {
      vi.useRealTimers()
    }
  })

  it('asks for nothing below the minimum frame size (the 1×1 seed rect)', async () => {
    // `preview:open` seeds the view at 1×1 before the placeholder is laid out;
    // a frame taken then is a single pixel stretched over the whole panel.
    const capturePage = vi.fn(async () => makeImage({ width: 1, height: 1 }, SHORT_DATA_URL))
    const cache = createPreviewStillFrameCache()

    await cache.captureIfStale(makeWc(capturePage), PANEL, { width: 1, height: 1 })
    await cache.captureIfStale(makeWc(capturePage), PANEL, {
      width: PREVIEW.MIN_STILL_FRAME_PX - 1,
      height: 600
    })

    expect(capturePage).not.toHaveBeenCalled()
    expect(cache.get(PANEL)).toBeUndefined()
  })

  it('emits NO frame when the data URL is over budget', async () => {
    const img = makeImage({ width: 100, height: 100 }, 'x'.repeat(100))
    const wc = makeWc(vi.fn(async () => img))
    const cache = createPreviewStillFrameCache({ maxDataUrlChars: 10 })

    await cache.captureIfStale(wc, PANEL, SIZE)

    expect(cache.get(PANEL)).toBeUndefined()
  })

  it('emits NO frame (does not throw) when capture rejects', async () => {
    const wc = makeWc(vi.fn(async () => Promise.reject(new Error('gpu gone'))))
    const cache = createPreviewStillFrameCache()

    await expect(cache.captureIfStale(wc, PANEL, SIZE)).resolves.toBeUndefined()
    expect(cache.get(PANEL)).toBeUndefined()
  })

  it('emits NO frame when the captured image is empty', async () => {
    const img = makeImage({ width: 0, height: 0 }, SHORT_DATA_URL)
    img.isEmpty.mockReturnValue(true)
    const wc = makeWc(vi.fn(async () => img))
    const cache = createPreviewStillFrameCache()

    await cache.captureIfStale(wc, PANEL, SIZE)

    expect(cache.get(PANEL)).toBeUndefined()
  })

  it('invalidate() drops a stored frame', async () => {
    const img = makeImage({ width: 100, height: 100 }, SHORT_DATA_URL)
    const wc = makeWc(vi.fn(async () => img))
    const cache = createPreviewStillFrameCache()

    await cache.captureIfStale(wc, PANEL, SIZE)
    expect(cache.get(PANEL)).toBeDefined()

    cache.invalidate(PANEL)
    expect(cache.get(PANEL)).toBeUndefined()
  })
})
