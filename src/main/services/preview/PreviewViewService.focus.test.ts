// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `preview:focusPage` through the whole service (issue #124, QG-8 U1): the
 * keyboard's way into a previewed page, and every state in which there is no
 * page to go into.
 *
 * Over the shared navigation harness, so the view under test is a real
 * `PreviewLiveView` with a real registry behind it — the refusals that matter
 * (a hidden view, a suspended one, a closed one, another window's) are decided
 * by the same code the app runs, not by a stand-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeHarness, removeProjects } from './__test-helpers__/previewViewServiceNavHarness'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  removeProjects()
})

describe('PreviewViewService.focusPage', () => {
  it('gives the live, drawn page keyboard focus', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')

    expect(h.service.focusPage('panel-A', h.window.id)).toBe(true)
    expect(page.contents.focus).toHaveBeenCalledTimes(1)
  })

  it('refuses while the view is hidden, and focuses nothing', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')

    await h.service.setVisibility('panel-A', false, 'tab-hidden')

    expect(h.service.focusPage('panel-A', h.window.id)).toBe(false)
    expect(page.contents.focus).not.toHaveBeenCalled()
  })

  it('focuses the page again once the view is shown', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')

    await h.service.setVisibility('panel-A', false, 'tab-hidden')
    await h.service.setVisibility('panel-A', true, 'tab-activated')

    expect(h.service.focusPage('panel-A', h.window.id)).toBe(true)
    expect(page.contents.focus).toHaveBeenCalledTimes(1)
  })

  it('refuses while a window-edge resize hold hides the view, and focuses nothing', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')

    // The hold hides the view without telling the renderer, so the view is
    // still WANTED while it is not drawn – the case a wanted-only check misses.
    h.service.setResizeHold(h.window.id, true)

    expect(h.service.focusPage('panel-A', h.window.id)).toBe(false)
    expect(page.contents.focus).not.toHaveBeenCalled()
  })

  it('focuses the page again once the settled push ends the hold', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')

    h.service.setResizeHold(h.window.id, true)
    h.service.setResizeHold(h.window.id, false)
    // The renderer's forced push answering the ask: it releases the hold.
    h.service.setBounds('panel-A', { x: 0, y: 0, width: 120, height: 60 }, 1, false, true)

    expect(h.service.focusPage('panel-A', h.window.id)).toBe(true)
    expect(page.contents.focus).toHaveBeenCalledTimes(1)
  })

  it('refuses a panel whose view belongs to another window', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')

    // Panel ids are path-derived, so a second window previewing the same file
    // mints the SAME id; focus must never cross the window that asked.
    expect(h.service.focusPage('panel-A', h.window.id + 1)).toBe(false)
    expect(page.contents.focus).not.toHaveBeenCalled()
  })

  it('refuses a panel with no live view at all', async () => {
    const h = makeHarness()
    await h.openCommitted('a.html')

    expect(h.service.focusPage('panel-unknown', h.window.id)).toBe(false)
  })

  it('refuses a closed panel', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')

    await h.service.close('panel-A')

    expect(h.service.focusPage('panel-A', h.window.id)).toBe(false)
    expect(page.contents.focus).not.toHaveBeenCalled()
  })

  it('refuses a panel suspended by the live-view budget', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')

    await h.suspendByBudget('panel-A')

    expect(h.service.focusPage('panel-A', h.window.id)).toBe(false)
    expect(page.contents.focus).not.toHaveBeenCalled()
  })
})
