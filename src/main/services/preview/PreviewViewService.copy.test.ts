// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `preview:copySelection` through the whole service (#463): the HTML preview
 * menu's Copy selection runs the page's own Copy command, on the right page,
 * and never on a page that is gone or belongs to another window.
 *
 * Over the shared navigation harness, so the view under test is a real
 * `PreviewLiveView` with a real registry behind it.
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

describe('PreviewViewService.copySelection', () => {
  it("runs Copy in the live page of the asking window's panel", async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')

    expect(h.service.copySelection('panel-A', h.window.id)).toBe(true)
    expect(page.contents.copy).toHaveBeenCalledTimes(1)
  })

  it('copies while the view is hidden: the menu that asks hides the page behind its still frame', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')

    await h.service.setVisibility('panel-A', false, 'menu')

    expect(h.service.copySelection('panel-A', h.window.id)).toBe(true)
    expect(page.contents.copy).toHaveBeenCalledTimes(1)
  })

  it('copies on the panel named, not on another live one', async () => {
    const h = makeHarness()
    const first = await h.openCommitted('a.html')
    const second = await h.openCommitted('b.html', 'panel-B')

    expect(h.service.copySelection('panel-B', h.window.id)).toBe(true)
    expect(second.contents.copy).toHaveBeenCalledTimes(1)
    expect(first.contents.copy).not.toHaveBeenCalled()
  })

  it('refuses a panel whose view belongs to another window', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')

    // Panel ids are path-derived, so a second window previewing the same file
    // mints the SAME id; a copy must never act on the other window's page.
    expect(h.service.copySelection('panel-A', h.window.id + 1)).toBe(false)
    expect(page.contents.copy).not.toHaveBeenCalled()
  })

  it('refuses a panel with no live view at all', async () => {
    const h = makeHarness()
    await h.openCommitted('a.html')

    expect(h.service.copySelection('panel-unknown', h.window.id)).toBe(false)
  })

  it('refuses a closed panel', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')

    await h.service.close('panel-A')

    expect(h.service.copySelection('panel-A', h.window.id)).toBe(false)
    expect(page.contents.copy).not.toHaveBeenCalled()
  })

  it('refuses a panel suspended by the live-view budget', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')

    await h.suspendByBudget('panel-A')

    expect(h.service.copySelection('panel-A', h.window.id)).toBe(false)
    expect(page.contents.copy).not.toHaveBeenCalled()
  })
})
