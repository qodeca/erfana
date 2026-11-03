// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page as a still image for an Erfana surface that must draw over the
 * page area – the page right-click menu, More, the address suggestions and
 * the target chooser (spec 025, 025-FR-054; ADR 0011 decisions 1 and 3;
 * commit 19). A native view is composited above Erfana's DOM, so the
 * renderer shows this picture in the page area and the native-view guard
 * takes the page off screen while the surface is open.
 *
 * The same shape as the pick's `captured` still: a raw BGRA bitmap at the
 * page's largest scale factor, downscaled to {@link STILL_MAX_EDGE} on its
 * longest side, never PNG-encoded (design § 6.1). An empty first capture
 * (macOS) is retried once, as the pick's screenshot is.
 */
import { STILL_MAX_EDGE, type StillResponse } from '../../../../shared/ipc/browser-tab-pick-schema'
import { downscaleBitmap, isEmptyBitmap } from './captureImage'
import { toBitmap, type CapturedImage } from '../pick/pickCaptureReads'

/** The page `webContents` surface a still image needs. */
export interface StillContents {
  isDestroyed(): boolean
  capturePage(): Promise<CapturedImage>
}

/** Captures tried before the still counts as failed: one retry for the empty first capture. */
const STILL_ATTEMPTS = 2

/**
 * Take the page's still image.
 *
 * @param contents - The tab's page
 * @returns The bitmap and its size, or `{ error }` (the surface then opens over Erfana's background)
 *
 * @example
 * ```ts
 * const still = await takeSurfaceStill(tab.contents) // { still, width, height } | { error }
 * ```
 */
export async function takeSurfaceStill(contents: StillContents): Promise<StillResponse> {
  for (let attempt = 0; attempt < STILL_ATTEMPTS; attempt++) {
    if (contents.isDestroyed()) return { error: 'The page is gone' }
    const bitmap = toBitmap(await contents.capturePage())
    if (isEmptyBitmap(bitmap)) continue
    const still = downscaleBitmap(bitmap, STILL_MAX_EDGE, STILL_MAX_EDGE)
    return { still: still.data, width: still.width, height: still.height }
  }
  return { error: 'The page could not be captured' }
}
