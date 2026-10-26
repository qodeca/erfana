// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `captureFresh` – the still under a comment popup (docs/designs/
 * html-preview-comments.md §3 "Stale still image under popups", §19 R3-6).
 */
import { describe, expect, it, vi } from 'vitest'
import { PreviewStillFrameCache, type PreviewCaptureContents, type PreviewNativeImage } from './PreviewStillFrameCache'

const SIZE = { width: 800, height: 600 }
const PANEL = 'panel-1'

function image(dataUrl: string, empty = false): PreviewNativeImage {
  const img: PreviewNativeImage = {
    isEmpty: () => empty,
    getSize: () => SIZE,
    resize: () => img,
    toDataURL: () => dataUrl
  }
  return img
}

function contents(...answers: Array<PreviewNativeImage | Error>): PreviewCaptureContents & { capturePage: ReturnType<typeof vi.fn> } {
  const capturePage = vi.fn(async () => {
    const next = answers.shift()
    if (next === undefined || next instanceof Error) throw next ?? new Error('no more')
    return next
  })
  return { capturePage }
}

describe('PreviewStillFrameCache.captureFresh', () => {
  it('stores an accepted capture at once, not stale, with its CSS size', async () => {
    const cache = new PreviewStillFrameCache({ now: () => 5 })
    const wc = contents(image('data:image/png;base64,A'))
    expect(await cache.captureFresh(wc, PANEL, SIZE, { cssSize: { width: 400, height: 300 }, accept: () => true })).toBe(true)
    expect(cache.get(PANEL)).toMatchObject({ dataUrl: 'data:image/png;base64,A', cssWidth: 400, cssHeight: 300 })
    expect(cache.get(PANEL)).not.toHaveProperty('stale')
    expect(wc.capturePage).toHaveBeenCalledTimes(1)
  })

  it('retries once after the caller\'s wait when the first capture is refused or empty, and keeps the retry', async () => {
    const cache = new PreviewStillFrameCache()
    const beforeRetry = vi.fn(async () => {})
    const wc = contents(image('first'), image('second'))
    expect(await cache.captureFresh(wc, PANEL, SIZE, { accept: img => img.toDataURL() !== 'first', beforeRetry })).toBe(true)
    expect(beforeRetry).toHaveBeenCalledTimes(1)
    expect(cache.get(PANEL)?.dataUrl).toBe('second')

    const empty = contents(image('', true), image('after'))
    expect(await cache.captureFresh(empty, PANEL, SIZE)).toBe(true)
    expect(cache.get(PANEL)?.dataUrl).toBe('after')
  })

  it('keeps the refused first capture when the retry fails, and stores nothing when both are empty', async () => {
    const cache = new PreviewStillFrameCache()
    expect(await cache.captureFresh(contents(image('first'), new Error('gone')), PANEL, SIZE, { accept: () => false })).toBe(true)
    expect(cache.get(PANEL)?.dataUrl).toBe('first')
    const other = new PreviewStillFrameCache()
    expect(await other.captureFresh(contents(new Error('x'), image('', true)), PANEL, SIZE)).toBe(false)
    expect(other.get(PANEL)).toBeUndefined()
  })

  it('refuses a view below the minimum size, and a capture superseded by a newer one', async () => {
    const cache = new PreviewStillFrameCache()
    expect(await cache.captureFresh(contents(image('a')), PANEL, { width: 1, height: 1 })).toBe(false)

    let release: (img: PreviewNativeImage) => void = () => {}
    const slow: PreviewCaptureContents = { capturePage: () => new Promise(resolve => (release = resolve)) }
    const first = cache.captureFresh(slow, PANEL, SIZE)
    const second = cache.captureFresh(contents(image('newer')), PANEL, SIZE)
    release(image('older'))
    expect(await first).toBe(false)
    expect(await second).toBe(true)
    expect(cache.get(PANEL)?.dataUrl).toBe('newer')
  })

  it('a capture over the data-URL budget stores nothing', async () => {
    const cache = new PreviewStillFrameCache({ maxDataUrlChars: 4 })
    expect(await cache.captureFresh(contents(image('data:too-long')), PANEL, SIZE)).toBe(false)
    expect(cache.get(PANEL)).toBeUndefined()
  })
})
