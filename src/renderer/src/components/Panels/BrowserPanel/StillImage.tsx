// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page's still image in the page area (spec 025, 025-FR-054; ADR 0011
 * decisions 1 and 3; design § Page area and frame; commit 19), shown while an
 * Erfana surface draws over the page: the pick's capture under the
 * prompt-actions panel and the dialog, a fresh picture under a menu or the
 * suggestions.
 *
 * Main sends a raw BGRA bitmap at the page's device scale; it is drawn once
 * per picture on a canvas (the renderer's CSP allows no `blob:` images, and
 * a PNG encode would cost the confirm-to-menu budget, design § 6.1). The
 * canvas takes the page's own size in CSS px – the bitmap's size over the
 * device pixel ratio, never wider than the area – so a width preset narrower
 * than the panel stays centred as the live page was.
 *
 * Over a pick's capture the picked element gets the Element picker card's
 * two-tone outline – outline only, no fill (owner decision Q2) – from the
 * summary's box in page CSS px, scaled by the tab's zoom.
 */
import { useLayoutEffect, useRef } from 'react'
import type { StillBitmap } from '../../../stores/useBrowserStillStore'
import type { BrowserRect } from '../../../../../shared/ipc/browser-tab-schema'
import { BROWSER_TEST_IDS } from './browserTestIds'

/** Props for {@link StillImage}. */
export interface StillImageProps {
  readonly image: StillBitmap
  /** The picked element's box in page CSS px, outlined on the picture; `null` for none. */
  readonly outline: BrowserRect | null
  /** The tab's zoom, in percent: page CSS px to view px. */
  readonly zoomPercent: number
}

/** Whether this machine stores a 32-bit word low byte first (every platform Electron ships on does). */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1

/**
 * A copy of `bgra` with red and blue swapped – the order `ImageData` takes.
 * A trailing partial pixel stays zero.
 *
 * Up to 33 MB arrive per still, converted before the first paint, so the swap
 * is one pass over 32-bit words on the copy's own aligned buffer rather than
 * four byte writes per pixel (performance review, spec 025); a big-endian
 * machine takes the byte loop.
 *
 * @param bgra - Main's bitmap bytes (any byte offset)
 * @returns RGBA bytes
 */
export function bgraToRgba(bgra: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  const whole = bgra.length - (bgra.length % 4)
  const rgba = new Uint8ClampedArray(new ArrayBuffer(bgra.length))
  if (!LITTLE_ENDIAN) {
    for (let i = 0; i < whole; i += 4) {
      rgba[i] = bgra[i + 2]
      rgba[i + 1] = bgra[i + 1]
      rgba[i + 2] = bgra[i]
      rgba[i + 3] = bgra[i + 3]
    }
    return rgba
  }
  rgba.set(bgra.subarray(0, whole))
  // Little-endian bytes B G R A read as the word 0xAARRGGBB: keep A and G, swap the R and B bytes.
  const words = new Uint32Array(rgba.buffer, 0, whole / 4)
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    words[i] = (word & 0xff00ff00) | ((word >>> 16) & 0xff) | ((word & 0xff) << 16)
  }
  return rgba
}

/**
 * Draws the picture and, for a pick, the outline.
 *
 * @param props - {@link StillImageProps}
 * @returns The still layer
 */
export function StillImage({ image, outline, zoomPercent }: StillImageProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (canvas === null || context === null || context === undefined) return
    canvas.width = image.width
    canvas.height = image.height
    context.putImageData(new ImageData(bgraToRgba(image.data), image.width, image.height), 0, 0)
  }, [image])

  const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
  const width = image.width / ratio
  const height = image.height / ratio
  const scale = zoomPercent / 100
  return (
    <div className="erf-brw-still" data-testid={BROWSER_TEST_IDS.STILL}>
      <div className="erf-brw-still__page" style={{ width, maxWidth: '100%', aspectRatio: `${image.width} / ${image.height}` }}>
        <canvas ref={canvasRef} className="erf-brw-still__canvas" aria-hidden="true" />
        {outline !== null && (
          <div
            className="erf-brw-still__outline"
            aria-hidden="true"
            style={{
              left: `${((outline.x * scale) / width) * 100}%`,
              top: `${((outline.y * scale) / height) * 100}%`,
              width: `${((outline.width * scale) / width) * 100}%`,
              height: `${((outline.height * scale) / height) * 100}%`
            }}
          />
        )}
      </div>
    </div>
  )
}
