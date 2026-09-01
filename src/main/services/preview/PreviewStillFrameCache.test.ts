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

  it('emits NO frame when isBeingCaptured() is true (skip)', async () => {
    const capturePage = vi.fn()
    const wc = makeWc(capturePage, true)
    const cache = createPreviewStillFrameCache()

    await cache.captureIfStale(wc, PANEL, SIZE)

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
