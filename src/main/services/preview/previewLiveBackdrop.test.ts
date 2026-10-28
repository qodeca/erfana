// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The backdrop owner of one live preview view (Issue #124, WI-1): the colour it
 * paints on the native view and reports to the renderer, driven through its
 * injected deps. The state machine itself is pinned by `previewBackdrop.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  CHROME_BACKDROP,
  DEFAULT_PAGE_BACKDROP,
  READ_PAGE_BACKDROP_SCRIPT
} from './previewBackdrop'
import { createPreviewLiveBackdrop } from './previewLiveBackdrop'

/** `rgb(10, 20, 30)` as the view's ARGB. */
const PAGE_PAPER = '#FF0A141E'

function makeHarness() {
  const state = { defunct: false }
  const setBackgroundColor = vi.fn<(color: string) => void>()
  const backdropChanged = vi.fn<(panelId: string, css: string) => void>()
  const executeJavaScriptInIsolatedWorld = vi.fn<
    (worldId: number, scripts: { code: string }[]) => Promise<unknown>
  >(() => Promise.resolve('rgb(10, 20, 30)'))
  const backdrop = createPreviewLiveBackdrop({
    panelId: 'panel-A',
    view: { setBackgroundColor },
    contents: { executeJavaScriptInIsolatedWorld },
    emit: { backdropChanged },
    isDefunct: () => state.defunct
  })
  return { state, setBackgroundColor, backdropChanged, executeJavaScriptInIsolatedWorld, backdrop }
}

describe('createPreviewLiveBackdrop', () => {
  it('paints the chrome colour before the first load settles, and tells the renderer', () => {
    const h = makeHarness()
    h.backdrop.apply()

    expect(h.setBackgroundColor).toHaveBeenCalledWith(CHROME_BACKDROP)
    expect(h.backdropChanged).toHaveBeenCalledWith('panel-A', `#${CHROME_BACKDROP.slice(3)}`)
  })

  it('paints nothing when an edge leaves the state where it is', () => {
    // The first load's start keeps the chrome: the state machine answers the same state.
    const h = makeHarness()
    h.backdrop.move('start-loading')

    expect(h.setBackgroundColor).not.toHaveBeenCalled()
    expect(h.backdropChanged).not.toHaveBeenCalled()
  })

  it("reads the page's own paper in an isolated world, then paints it", async () => {
    const h = makeHarness()
    await h.backdrop.settle()

    const [worldId, scripts] = h.executeJavaScriptInIsolatedWorld.mock.calls[0]
    expect(worldId).toBe(998)
    expect(scripts).toEqual([{ code: READ_PAGE_BACKDROP_SCRIPT }])
    expect(h.setBackgroundColor).toHaveBeenLastCalledWith(PAGE_PAPER)
    expect(h.backdropChanged).toHaveBeenLastCalledWith('panel-A', '#0A141E')
  })

  it('puts a failed load on the page paper too', async () => {
    const h = makeHarness()
    await h.backdrop.settle('fail-load')

    expect(h.setBackgroundColor).toHaveBeenLastCalledWith(PAGE_PAPER)
  })

  it.each([
    ['a refused read', () => Promise.reject(new Error('world gone'))],
    ['an answer that is not a colour', () => Promise.resolve(42)]
  ])('falls back to the default paper after %s', async (_label, answer) => {
    const h = makeHarness()
    h.executeJavaScriptInIsolatedWorld.mockImplementationOnce(answer)
    await h.backdrop.settle()

    expect(h.setBackgroundColor).toHaveBeenLastCalledWith(DEFAULT_PAGE_BACKDROP)
    expect(h.backdropChanged).toHaveBeenLastCalledWith('panel-A', '#FFFFFF')
  })

  it('keeps the page paper across a reload, and goes back to chrome on a crash', async () => {
    const h = makeHarness()
    await h.backdrop.settle()
    h.backdrop.move('start-loading')
    expect(h.setBackgroundColor).toHaveBeenLastCalledWith(PAGE_PAPER)

    h.backdrop.move('crashed')
    expect(h.setBackgroundColor).toHaveBeenLastCalledWith(CHROME_BACKDROP)
  })

  it('paints nothing, and reads nothing, once the view is defunct', async () => {
    const h = makeHarness()
    h.state.defunct = true
    h.backdrop.apply()
    h.backdrop.move('crashed')
    await h.backdrop.settle()

    expect(h.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
    expect(h.setBackgroundColor).not.toHaveBeenCalled()
    expect(h.backdropChanged).not.toHaveBeenCalled()
  })

  it('does not repaint when the view goes defunct while the paper is read', async () => {
    const h = makeHarness()
    let answer: (value: unknown) => void = () => {}
    h.executeJavaScriptInIsolatedWorld.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve
      })
    )
    const settling = h.backdrop.settle()
    h.state.defunct = true
    answer('rgb(10, 20, 30)')
    await settling

    expect(h.setBackgroundColor).not.toHaveBeenCalled()
  })
})
