// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Wait until the page has drawn what was just changed on it (spec 025,
 * 025-FR-053, 025-AC-034): the screenshot of a pick must not show Erfana's
 * live outline.
 *
 * `Overlay.hideHighlight` answers before the engine has drawn a frame
 * without the outline, and `capturePage` copies the last frame drawn – so
 * the outline could still be in the image (seen on Linux, 1 run in 4). Two
 * animation frames in the page mean the frame after the hide has been drawn
 * (the proxy the still-image drop uses too, ADR 0011 decision 3).
 *
 * The wait runs in an isolated world of its own, so a page cannot shadow
 * `requestAnimationFrame`. A page whose main thread is busy draws no frame:
 * the wait ends at {@link PAINT_WAIT_CAP_MS} and the capture goes ahead.
 */
import type { Clock, TimerHandle } from '../../../../shared/clock'

/** The isolated world of the frame wait (the tab's other fixed scripts use 995 and 996). */
export const PAINT_WAIT_WORLD_ID = 994

/** Two animation frames: the first runs before the frame after the change is drawn, the second after it. */
export const PAINT_WAIT_SCRIPT = 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(0))))'

/** Longest the capture waits for the two frames. */
export const PAINT_WAIT_CAP_MS = 250

/** The page surface the wait needs. */
export interface PaintContents {
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: Array<{ code: string }>): Promise<unknown>
}

/**
 * Resolves once the page drew two animation frames (`painted`), or at the
 * cap (`capped`); `failed` when the script could not run (a page going away).
 * Never rejects.
 */
export async function pagePainted(contents: PaintContents, clock: Pick<Clock, 'setTimeout' | 'clearTimeout'>): Promise<'painted' | 'capped' | 'failed'> {
  let timer: TimerHandle | undefined
  const cap = new Promise<'capped'>((resolve) => {
    timer = clock.setTimeout(() => resolve('capped'), PAINT_WAIT_CAP_MS)
  })
  const painted = contents.executeJavaScriptInIsolatedWorld(PAINT_WAIT_WORLD_ID, [{ code: PAINT_WAIT_SCRIPT }]).then(
    () => 'painted' as const,
    () => 'failed' as const
  )
  try {
    return await Promise.race([painted, cap])
  } finally {
    clock.clearTimeout(timer)
  }
}
