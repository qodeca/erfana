// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'
import { STILL_MAX_EDGE, StillResponseSchema } from '../../../../shared/ipc/browser-tab-pick-schema'
import { takeSurfaceStill } from './surfaceStill'

/** A captured image of `width` × `height` px whose every pixel has alpha `alpha`. */
function image(width: number, height: number, alpha = 255) {
  const data = Buffer.alloc(width * height * 4, 0)
  for (let i = 3; i < data.length; i += 4) data[i] = alpha
  return { toBitmap: () => data, getSize: () => ({ width, height }) }
}

describe('takeSurfaceStill', () => {
  it('answers the page as a raw bitmap the schema accepts', async () => {
    const contents = { isDestroyed: () => false, capturePage: vi.fn(async () => image(4, 3)) }
    const still = await takeSurfaceStill(contents)
    expect(StillResponseSchema.safeParse(still).success).toBe(true)
    expect(still).toMatchObject({ width: 4, height: 3 })
    expect('still' in still && still.still.byteLength).toBe(48)
  })

  it('retries one empty first capture, then refuses', async () => {
    const contents = { isDestroyed: () => false, capturePage: vi.fn().mockResolvedValueOnce(image(2, 2, 0)).mockResolvedValueOnce(image(2, 2)) }
    expect(await takeSurfaceStill(contents)).toMatchObject({ width: 2, height: 2 })
    const empty = { isDestroyed: () => false, capturePage: vi.fn(async () => image(2, 2, 0)) }
    expect(await takeSurfaceStill(empty)).toEqual({ error: 'The page could not be captured' })
    expect(empty.capturePage).toHaveBeenCalledTimes(2)
  })

  it('downscales a page past the edge cap and refuses a destroyed page', async () => {
    const wide = { isDestroyed: () => false, capturePage: vi.fn(async () => image(STILL_MAX_EDGE * 2, 2)) }
    expect(await takeSurfaceStill(wide)).toMatchObject({ width: STILL_MAX_EDGE, height: 1 })
    const gone = { isDestroyed: () => true, capturePage: vi.fn() }
    expect(await takeSurfaceStill(gone)).toEqual({ error: 'The page is gone' })
    expect(gone.capturePage).not.toHaveBeenCalled()
  })
})
