// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * How many repaint-confirmation scripts one live view keeps in the page (#120).
 * The rule: the newest asking push starts its script AT ONCE (the renderer's
 * deadline is absolute), at most two scripts are alive, a third push waits for
 * either to settle, and a view that is gone starts nothing and keeps no timer.
 *
 * Split from `previewLiveBounds.test.ts`, which holds the drop-log cases.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

import { PREVIEW } from '../../../shared/constants'
import type { PreviewBounds } from '../../../shared/ipc/preview-types'
import { createPreviewLiveBounds } from './previewLiveBounds'

const CONTENT = { x: 0, y: 0, width: 800, height: 600 }
const RECT: PreviewBounds = { x: 10, y: 20, width: 300, height: 200 }
const at = (seq: number): PreviewBounds => ({ ...RECT, y: 20 + seq })

/** A page whose scripts are answered by hand (`answer`) or by `pageMs` of fake time. */
function setup(pageMs?: number) {
  let defunct = false
  const resolvers: Array<(value: unknown) => void> = []
  const boundsApplied = vi.fn<(panelId: string, seq: number) => void>()
  const exec = vi.fn(
    () =>
      new Promise((resolve) => {
        if (pageMs === undefined) {
          resolvers.push(resolve)
        } else {
          setTimeout(() => resolve(CONTENT.height), pageMs)
        }
      })
  )
  const bounds = createPreviewLiveBounds({
    panelId: 'panel',
    view: { setBounds: vi.fn() },
    window: { getContentBounds: () => CONTENT, webContents: { getZoomFactor: () => 1 } },
    contents: { executeJavaScriptInIsolatedWorld: exec },
    emit: { boundsApplied },
    getZoomFactor: () => 1,
    isDefunct: () => defunct,
    now: () => 0
  })
  return {
    bounds,
    boundsApplied,
    scripts: (): number => exec.mock.calls.length,
    setDefunct: (value: boolean): void => {
      defunct = value
    },
    /** The page answers its OLDEST unanswered script. */
    answer: async (): Promise<void> => {
      resolvers.shift()?.(CONTENT.height)
      await vi.advanceTimersByTimeAsync(0)
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('repaint confirmation scripts', () => {
  it('starts the newest asking push at once, and never keeps more than two alive', async () => {
    const h = setup()

    h.bounds.apply(at(1), 1, true)
    h.bounds.apply(at(2), 2, true)
    expect(h.scripts()).toBe(2)

    // Two alive: the rest only record the newest wanted.
    for (let seq = 3; seq <= 6; seq += 1) {
      h.bounds.apply(at(seq), seq, true)
    }
    expect(h.scripts()).toBe(2)

    // Either settling starts the newest wanted, and only that one.
    await h.answer()
    expect(h.scripts()).toBe(3)
    await h.answer()
    await h.answer()
    expect(h.boundsApplied).toHaveBeenCalledTimes(1)
    expect(h.boundsApplied).toHaveBeenCalledWith('panel', 6)
    expect(h.scripts()).toBe(3)
  })

  it('confirms a second push within about one script time, not two', async () => {
    const PAGE_MS = 130
    const h = setup(PAGE_MS)

    h.bounds.apply(at(1), 1, true)
    await vi.advanceTimersByTimeAsync(16)
    h.bounds.apply(at(2), 2, true)

    // Its script began when the push arrived; it does not queue behind the first.
    await vi.advanceTimersByTimeAsync(PAGE_MS)

    expect(h.boundsApplied).toHaveBeenCalledWith('panel', 2)
  })

  it('starts nothing once the view is defunct, and keeps no timer', async () => {
    const h = setup()
    h.bounds.apply(at(1), 1, true)
    h.bounds.apply(at(2), 2, true)
    h.bounds.apply(at(3), 3, true)
    expect(h.scripts()).toBe(2)

    h.setDefunct(true)
    await h.answer()
    await h.answer()

    expect(h.scripts()).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears every timer on dispose, and starts nothing afterwards', async () => {
    const h = setup()
    h.bounds.apply(at(1), 1, true)
    h.bounds.apply(at(2), 2, true)
    h.bounds.apply(at(3), 3, true)

    h.bounds.dispose()
    expect(vi.getTimerCount()).toBe(0)

    await h.answer()
    expect(h.scripts()).toBe(2)
  })

  it('frees a slot a page never answers, after the shared deadline', async () => {
    const h = setup()
    h.bounds.apply(at(1), 1, true)
    h.bounds.apply(at(2), 2, true)
    h.bounds.apply(at(3), 3, true)
    expect(h.scripts()).toBe(2)

    await vi.advanceTimersByTimeAsync(PREVIEW.BOUNDS_ACK_TIMEOUT_MS)

    expect(h.scripts()).toBe(3)
  })

  it('lets a late answer from an expired run free nothing a later run holds', async () => {
    const h = setup()
    h.bounds.apply(at(1), 1, true)
    await vi.advanceTimersByTimeAsync(PREVIEW.BOUNDS_ACK_TIMEOUT_MS) // run 1 expires
    h.bounds.apply(at(2), 2, true) // run 2
    h.bounds.apply(at(3), 3, true) // run 3: two alive
    expect(h.scripts()).toBe(3)

    await h.answer() // run 1 answers late: seq 1 was overtaken, nothing is emitted
    expect(h.boundsApplied).not.toHaveBeenCalled()
    // The count is still right: two alive, so two more asks start nothing.
    h.bounds.apply(at(4), 4, true)
    h.bounds.apply(at(5), 5, true)
    expect(h.scripts()).toBe(3)

    await h.answer() // run 2: overtaken
    await h.answer() // run 3: overtaken by 5; the wanted 5 starts as run 4
    await h.answer()
    expect(h.boundsApplied.mock.calls).toEqual([['panel', 5]])

    await vi.advanceTimersByTimeAsync(PREVIEW.BOUNDS_ACK_TIMEOUT_MS)
    expect(vi.getTimerCount()).toBe(0)
  })
})
