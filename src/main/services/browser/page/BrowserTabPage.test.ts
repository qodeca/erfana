// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One tab's page features (025-FR-008, 025-FR-012, 025-FR-056, 025-FR-059):
 * load errors with the focus rule, crash and hang notices ending pick mode,
 * find results, zoom application and width presets.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock } from '../../../../shared/clock'
import { BrowserTabPage, CLEAR_SESSION_STORAGE_WORLD_ID } from './BrowserTabPage'
import { fakeHang, fakeOutlet, fakePageTab } from './__test-helpers__/fakePageTab'

function setup(withHang = true) {
  const tab = fakePageTab()
  const outlet = fakeOutlet()
  const hang = withHang ? fakeHang() : null
  const site = { committed: vi.fn(), zoom: vi.fn() }
  const clock = createManualClock(10_000)
  const page = new BrowserTabPage({ tab, outlet, site, clock, hang, newRowId: () => 'hungrow' })
  const startMain = (): void => {
    tab.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  }
  const failMain = (code: number, url = 'http://localhost:4100/'): void => {
    tab.contents.emit('did-fail-load', {}, code, 'ERR', url, true)
  }
  return { tab, outlet, hang, site, clock, page, startMain, failMain }
}

describe('BrowserTabPage load errors', () => {
  it('025-AC-076 shows the load-error page for a failed load the user started, focus on Reload', () => {
    const { tab, page, outlet, startMain, failMain } = setup()
    tab.pending = true
    startMain()
    tab.pending = false // the tab drops its pending address on the failure
    failMain(-102)
    expect(page.facts()).toMatchObject({ failedUrl: 'http://localhost:4100/', loadError: { code: -102, focus: 'reload' } })
    expect(outlet.stateChanged).toHaveBeenCalled()
  })

  it('025-AC-076 sends focus to the heading for a failed load the page started', () => {
    const { page, startMain, failMain } = setup()
    startMain()
    failMain(-102)
    expect(page.facts().loadError).toEqual({ code: -102, focus: 'heading' })
  })

  it('025-AC-021 leaves a certificate failure to the certificate page', () => {
    const { tab, page, failMain } = setup()
    tab.erfanaPage = 'certificate'
    failMain(-201, 'https://expired.test/')
    expect(page.facts().loadError).toBeNull()
  })

  it('ignores a cancelled load, a frame failure and an empty address', () => {
    const { tab, page, failMain } = setup()
    failMain(-3)
    tab.contents.emit('did-fail-load', {}, -102, 'ERR', 'http://x.test/', false)
    failMain(-102, '')
    expect(page.facts().loadError).toBeNull()
  })

  it('025-AC-076 Reload starts a new document, which clears the page', () => {
    const { tab, page, outlet, startMain, failMain } = setup()
    failMain(-102)
    outlet.stateChanged.mockClear()
    startMain()
    expect(page.facts().loadError).toBeNull()
    expect(outlet.stateChanged).toHaveBeenCalledTimes(1)
    startMain()
    expect(outlet.stateChanged).toHaveBeenCalledTimes(1)
    // A same-document navigation does not clear a page.
    failMain(-7)
    tab.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    expect(page.facts().loadError).not.toBeNull()
  })
})

describe('BrowserTabPage crash and hang', () => {
  it('025-AC-072 a crash shows the crashed page, ends pick mode and takes the hung notice away', () => {
    const { tab, page, outlet, hang, clock } = setup()
    hang!.fire('hung')
    clock.advance(1)
    tab.contents.emit('render-process-gone', {}, { reason: 'killed', exitCode: 9 })
    expect(page.facts().crashed).toBe(true)
    expect(outlet.endPick).toHaveBeenCalledTimes(2)
    expect(outlet.strip).toHaveBeenLastCalledWith({ tabId: tab.id, op: 'withdraw', requestId: 'hungrow' })
  })

  it('ignores the process ending of a closed page', () => {
    const { tab, page } = setup()
    tab.contents.destroyed = true
    tab.contents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 })
    expect(page.facts().crashed).toBe(false)
  })

  it('025-AC-072 a hang shows the notice and ends pick mode; the page answering takes it away', () => {
    const { tab, outlet, hang } = setup()
    hang!.fire('hung')
    expect(outlet.endPick).toHaveBeenCalledTimes(1)
    expect(outlet.strip).toHaveBeenCalledWith(expect.objectContaining({ op: 'add', row: expect.objectContaining({ kind: 'hung' }) }))
    hang!.fire('responsive')
    expect(outlet.strip).toHaveBeenLastCalledWith({ tabId: tab.id, op: 'withdraw', requestId: 'hungrow' })
  })

  it('shows no hung notice over a crashed page', () => {
    const { tab, outlet, hang } = setup()
    tab.contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    hang!.fire('hung')
    expect(outlet.strip).not.toHaveBeenCalled()
  })

  it('025-AC-072 Wait re-arms the probe after the input guard; Reload ends the hung process and reloads, with no crashed page', () => {
    const { tab, page, hang, clock } = setup()
    hang!.fire('hung')
    expect(page.answerStrip('hungrow', 'wait')).toBe('guarded')
    clock.advance(500)
    expect(page.answerStrip('hungrow', 'wait')).toBe('accepted')
    expect(hang!.waitHang).toHaveBeenCalledTimes(1)
    hang!.fire('hung')
    clock.advance(500)
    expect(page.answerStrip('hungrow', 'reload')).toBe('accepted')
    expect(tab.contents.forcefullyCrashRenderer).toHaveBeenCalledTimes(1)
    expect(tab.history).toHaveBeenCalledWith('reload')
    tab.contents.emit('render-process-gone', {}, { reason: 'killed', exitCode: 9 })
    expect(page.facts().crashed).toBe(false)
    tab.contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    expect(page.facts().crashed).toBe(true)
  })

  it('answers null for a row that is not its own, and works without a hang source', () => {
    const { page } = setup(false)
    expect(page.answerStrip('other', 'allow')).toBeNull()
  })
})

describe('BrowserTabPage find, zoom and presets', () => {
  it('025-AC-008 passes find requests through and reports every result, "0 of 0" with no match', () => {
    const { tab, page, outlet } = setup()
    page.find('needle', true, true)
    expect(tab.contents.findInPage).toHaveBeenCalledWith('needle', { forward: true, findNext: true })
    tab.contents.emit('found-in-page', {}, { activeMatchOrdinal: 1, matches: 3, finalUpdate: true })
    expect(outlet.findResult).toHaveBeenLastCalledWith({ tabId: tab.id, active: 1, total: 3 })
    tab.contents.emit('found-in-page', {}, { matches: 0 })
    expect(outlet.findResult).toHaveBeenLastCalledWith({ tabId: tab.id, active: 0, total: 0 })
    tab.contents.emit('found-in-page', {}, { activeMatchOrdinal: 9, matches: 2 })
    expect(outlet.findResult).toHaveBeenLastCalledWith({ tabId: tab.id, active: 2, total: 2 })
    page.stopFind()
    expect(tab.contents.stopFindInPage).toHaveBeenCalledWith('clearSelection')
  })

  it('does nothing on a closed page', () => {
    const { tab, page } = setup()
    tab.contents.destroyed = true
    page.find('x', true, true)
    page.stopFind()
    page.applyZoom(150)
    expect(tab.contents.findInPage).not.toHaveBeenCalled()
    expect(tab.contents.setZoomFactor).not.toHaveBeenCalled()
    expect(page.facts().zoomPercent).toBe(100)
  })

  it('025-AC-008 hands zoom steps to the site and applies a level, only when it changes', () => {
    const { tab, page, site, outlet } = setup()
    page.zoom('in')
    expect(site.zoom).toHaveBeenCalledWith(page, 'in')
    page.applyZoom(110)
    expect(tab.contents.setZoomFactor).toHaveBeenCalledWith(1.1)
    expect(page.facts().zoomPercent).toBe(110)
    page.applyZoom(110)
    expect(tab.contents.setZoomFactor).toHaveBeenCalledTimes(1)
    expect(outlet.stateChanged).toHaveBeenCalledTimes(2)
  })

  it('025-AC-012 a new preset re-places the view and resets the zoom; the same preset does nothing', () => {
    const { tab, page, site } = setup()
    page.widthPreset('phone')
    expect(tab.viewFrame.setPreset).toHaveBeenCalledWith('phone')
    expect(site.zoom).toHaveBeenCalledWith(page, 'reset')
    page.widthPreset('phone')
    expect(tab.viewFrame.setPreset).toHaveBeenCalledTimes(1)
  })

  it('tells the site of every commit', () => {
    const { tab, page, site } = setup()
    tab.contents.emit('did-navigate', {}, 'http://app.test/')
    expect(site.committed).toHaveBeenCalledWith(page)
    expect(page.shownUrl()).toBe('http://app.test/')
  })
})

describe('BrowserTabPage after Clear and on close', () => {
  it('025-AC-023 ends pick mode, empties session storage when site data went, and reloads a tab with a page', async () => {
    const { tab, page, outlet } = setup()
    await page.reloadAfterClear(true)
    expect(outlet.endPick).toHaveBeenCalled()
    expect(tab.contents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(CLEAR_SESSION_STORAGE_WORLD_ID, [
      { code: expect.stringContaining('sessionStorage.clear()') }
    ])
    expect(tab.history).toHaveBeenCalledWith('reload')
  })

  it('reloads without touching session storage when site data stayed, and still reloads if the script fails', async () => {
    const { tab, page } = setup()
    await page.reloadAfterClear(false)
    expect(tab.contents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
    tab.contents.executeJavaScriptInIsolatedWorld.mockRejectedValueOnce(new Error('gone'))
    await page.reloadAfterClear(true)
    expect(tab.history).toHaveBeenCalledTimes(2)
  })

  it('does not reload an empty tab', async () => {
    const { tab, page } = setup()
    tab.committedUrl = null
    await page.reloadAfterClear(true)
    expect(tab.history).not.toHaveBeenCalled()
  })

  it('stops listening on detach, once', () => {
    const { tab, page, hang, outlet } = setup()
    hang!.fire('hung')
    page.detach()
    page.detach()
    expect(hang!.listeners).toBe(0)
    expect(tab.contents.listenerCount('did-fail-load')).toBe(0)
    expect(outlet.strip).toHaveBeenCalledTimes(2)
  })
})
