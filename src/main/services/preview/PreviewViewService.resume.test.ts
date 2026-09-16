// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A panel's history survives a suspend, and the service reopens it on main's
 * page (issue #124, WI-17b; RS6, RX2-6, RX3-1): the page's Back and Forward
 * come back with it, a suspend in the middle of a move writes nothing, a tab
 * that names another page is overruled and logged, and a page that no longer
 * passes the gate falls back to the tab's own – which is judged in its turn
 * (QG-7 item 11), so an ineligible one, or one that is no `.html`, installs no
 * view at all. Split from `PreviewViewService.navigation.test.ts` by topic;
 * the harness is shared.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../../shared/errors'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import {
  makeHarness,
  removeProjects,
  type FakePage,
  type NavHarness
} from './__test-helpers__/previewViewServiceNavHarness'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  removeProjects()
})

/** Move panel A from a.html to b.html, then let the budget suspend it. */
async function movedThenSuspended(h: NavHarness): Promise<void> {
  const page = await h.openCommitted('a.html')
  await h.move('b.html')
  page.commit(h.url('b.html'))
  await h.suspendByBudget()
}

/** Reopen panel A as the tab asks, naming `name`; the woken page. */
async function reopen(h: NavHarness, name: string): Promise<FakePage> {
  expect(await h.service.open(h.request('panel-A', name), h.window)).toEqual({ ok: true })
  return h.pages.at(-1)!
}

describe('PreviewViewService — resume (issue #124)', () => {
  it("wakes a panel that slept on main's page, with its Back (P3-AC2)", async () => {
    const h = makeHarness()
    await movedThenSuspended(h)

    const woken = await reopen(h, 'b.html')
    expect(woken.contents.loadURL).toHaveBeenCalledWith(h.url('b.html'))
    woken.commit(h.url('b.html'))

    const change = h.emit.pageChanged.mock.calls.at(-1)
    expect(change).toEqual([
      'panel-A',
      expect.objectContaining({
        filePath: h.file('b.html'),
        sameDocument: true,
        canGoBack: true,
        backTarget: { filePath: h.file('a.html'), anchor: null }
      })
    ])
    const back = await h.service.navigate(
      { panelId: 'panel-A', phase: 'check', action: 'back', generation: change![1].generation },
      1
    )
    expect(back).toEqual(
      expect.objectContaining({ ok: true, target: { filePath: h.file('a.html'), anchor: null } })
    )
  })

  it('a suspend while a move is on its way writes nothing: the panel wakes on the page it showed', async () => {
    const h = makeHarness()
    const page = await h.openCommitted('a.html')
    await h.move('b.html')
    await h.suspendByBudget()
    page.commit(h.url('b.html')) // late: the view is gone

    const woken = await reopen(h, 'a.html')
    expect(woken.contents.loadURL).toHaveBeenCalledWith(h.url('a.html'))
    woken.commit(h.url('a.html'))

    expect(h.emit.pageChanged).toHaveBeenLastCalledWith(
      'panel-A',
      expect.objectContaining({ filePath: h.file('a.html'), canGoBack: false })
    )
    expect(h.emit.pageChanged).not.toHaveBeenCalledWith(
      'panel-A',
      expect.objectContaining({ filePath: h.file('b.html') })
    )
  })

  it("wakes on main's page when the tab named another, and logs it", async () => {
    const h = makeHarness()
    await movedThenSuspended(h)
    const warn = vi.spyOn(logger, 'warn')

    const woken = await reopen(h, 'a.html')
    woken.commit(h.url('b.html'))

    expect(warn).toHaveBeenCalledWith(
      "Preview resume: the tab named another page; main's history wins",
      { panelId: stablePathDigest('panel-A') }
    )
    expect(woken.contents.loadURL).toHaveBeenCalledWith(h.url('b.html'))
    expect(h.emit.pageChanged).toHaveBeenLastCalledWith(
      'panel-A',
      expect.objectContaining({ filePath: h.file('b.html'), sameDocument: false })
    )
  })

  it("falls back to the tab's own page, one generation on, when main's page no longer passes the gate", async () => {
    const h = makeHarness()
    await movedThenSuspended(h)
    const before = h.emit.pageChanged.mock.calls.at(-1)![1].generation
    h.checkEligibility.mockImplementation(async (filePath) =>
      filePath === h.file('b.html') ? { eligible: false, reason: 'gitignored' } : { eligible: true }
    )
    const warn = vi.spyOn(logger, 'warn')

    const woken = await reopen(h, 'a.html')
    woken.commit(h.url('a.html'))

    expect(warn).toHaveBeenCalledWith(
      "Preview resume: main's page did not pass the gate; trying the tab's own",
      { panelId: stablePathDigest('panel-A'), errorCode: ErrorCode.PREVIEW_NAV_TARGET_REFUSED }
    )
    expect(woken.contents.loadURL).toHaveBeenCalledWith(h.url('a.html'))
    expect(h.emit.pageChanged).toHaveBeenLastCalledWith(
      'panel-A',
      expect.objectContaining({
        filePath: h.file('a.html'),
        canGoBack: false,
        generation: before + 1
      })
    )
  })

  describe("the tab's own page is gated too (QG-7 item 11)", () => {
    /** Suspend panel A on b.html, then refuse b.html, so the resume must fall back. */
    async function suspendedWithMainsPageRefused(h: NavHarness): Promise<void> {
      await movedThenSuspended(h)
      h.checkEligibility.mockImplementation(async (filePath) =>
        filePath === h.file('b.html') ? { eligible: false, reason: 'gitignored' } : { eligible: true }
      )
    }

    /** Reopen panel A on `name`, expecting the gate to refuse it; the page built and dropped. */
    async function refusedReopen(h: NavHarness, name: string): Promise<FakePage> {
      const built = h.pages.length
      expect(await h.service.open(h.request('panel-A', name), h.window)).toEqual({
        ok: false,
        errorCode: ErrorCode.PREVIEW_NAV_TARGET_REFUSED
      })
      expect(h.pages.length).toBe(built + 1)
      return h.pages.at(-1)!
    }

    it('refuses the open, and discards the session it had built, when the page is ineligible', async () => {
      const h = makeHarness()
      await movedThenSuspended(h)
      h.checkEligibility.mockResolvedValue({ eligible: false, reason: 'gitignored' })

      const dropped = await refusedReopen(h, 'a.html')

      expect(dropped.contents.loadURL).not.toHaveBeenCalled()
      expect(dropped.contents.isDestroyed()).toBe(true)
      await expect(
        h.service.navigate({ panelId: 'panel-A', phase: 'check', action: 'back', generation: 0 }, 1)
      ).resolves.toEqual({ ok: false, errorCode: ErrorCode.PREVIEW_NAV_UNAVAILABLE })
    })

    it('refuses the open when the tab names a page that is no .html', async () => {
      const h = makeHarness()
      await suspendedWithMainsPageRefused(h)
      writeFileSync(join(h.projectPath, 'notes.md'), '# notes')

      const dropped = await refusedReopen(h, 'notes.md')

      expect(dropped.contents.loadURL).not.toHaveBeenCalled()
    })

    it('refuses the open when the eligibility check throws: the gate fails closed', async () => {
      const h = makeHarness()
      await movedThenSuspended(h)
      h.checkEligibility.mockRejectedValue(new Error('EACCES'))

      const dropped = await refusedReopen(h, 'a.html')

      expect(dropped.contents.loadURL).not.toHaveBeenCalled()
    })
  })
})
