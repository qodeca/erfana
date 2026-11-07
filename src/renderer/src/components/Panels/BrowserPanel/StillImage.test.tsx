// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StillImage, bgraToRgba } from './StillImage'
import { BROWSER_TEST_IDS } from './browserTestIds'

describe('bgraToRgba', () => {
  it('swaps blue and red and keeps green and alpha', () => {
    expect([...bgraToRgba(new Uint8Array([1, 2, 3, 4, 10, 20, 30, 40]))]).toEqual([3, 2, 1, 4, 30, 20, 10, 40])
    expect(bgraToRgba(new Uint8Array(0))).toHaveLength(0)
  })

  it('leaves a trailing partial pixel at zero', () => {
    expect([...bgraToRgba(new Uint8Array([1, 2, 3, 4, 5]))]).toEqual([3, 2, 1, 4, 0])
  })

  it('converts a view at an odd byte offset, and full-range bytes without sign trouble', () => {
    const backing = new Uint8Array([9, 255, 128, 0, 254, 1, 2, 3, 4])
    expect([...bgraToRgba(backing.subarray(1))]).toEqual([0, 128, 255, 254, 3, 2, 1, 4])
  })

  it('matches a per-byte swap across a whole bitmap', () => {
    const bgra = new Uint8Array(64 * 4)
    for (let i = 0; i < bgra.length; i++) bgra[i] = (i * 37) % 256
    const expected = [...bgra].map((_, i) => bgra[i - (i % 4) + [2, 1, 0, 3][i % 4]])
    expect([...bgraToRgba(bgra)]).toEqual(expected)
  })
})

describe('StillImage', () => {
  const image = { data: new Uint8Array(400 * 200 * 4), width: 400, height: 200 }

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('paints the bitmap once at its own size', () => {
    const putImageData = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ putImageData } as unknown as CanvasRenderingContext2D)
    vi.stubGlobal('ImageData', class {
      constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
    })
    const { rerender } = render(<StillImage image={image} outline={null} zoomPercent={100} />)
    const canvas = screen.getByTestId(BROWSER_TEST_IDS.STILL).querySelector('canvas')
    expect(canvas).toMatchObject({ width: 400, height: 200 })
    expect(putImageData).toHaveBeenCalledOnce()
    expect(putImageData.mock.calls[0][0]).toMatchObject({ width: 400, height: 200 })
    rerender(<StillImage image={image} outline={null} zoomPercent={150} />)
    expect(putImageData).toHaveBeenCalledOnce()
  })

  it('sizes the picture to the page in CSS px and outlines the picked element in percent', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    render(<StillImage image={image} outline={{ x: 40, y: 20, width: 100, height: 50 }} zoomPercent={100} />)
    const still = screen.getByTestId(BROWSER_TEST_IDS.STILL)
    const page = still.firstElementChild as HTMLElement
    expect(page.style.width).toBe(`${400 / window.devicePixelRatio}px`)
    const outline = page.querySelector<HTMLElement>('.erf-brw-still__outline')
    const ratio = window.devicePixelRatio
    expect(outline?.style.left).toBe(`${(40 / (400 / ratio)) * 100}%`)
    expect(outline?.style.height).toBe(`${(50 / (200 / ratio)) * 100}%`)
  })

  it('draws no outline without a pick', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    render(<StillImage image={image} outline={null} zoomPercent={100} />)
    expect(screen.getByTestId(BROWSER_TEST_IDS.STILL).querySelector('.erf-brw-still__outline')).toBeNull()
  })
})
