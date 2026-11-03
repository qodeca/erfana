// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A tab's window-open policy (025-FR-011, S-7, S-30): the page source's
 * addresses, the popup blocker and its row, and tab-or-window by what
 * Chromium created.
 */
import { EventEmitter } from 'node:events'
import type { HandlerDetails, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock } from '../../../../shared/clock'
import type { StripEvent } from '../../../../shared/ipc/browser-tab-schema'
import { ACTIVATION_WINDOW_MS, MAX_OPENS_PER_MINUTE } from './popupActivation'
import { TabWindowOpen, type TabWindowOpenDeps } from './TabWindowOpen'

const APP = { rendererEntry: 'file:///app/out/renderer/index.html', resourcesDir: '/app/resources', devServerOrigin: null }
const PAGE = 'http://app.test:8080/popups.html'

class FakeOpener extends EventEmitter {
  readonly session = { name: 'browser' }
  url = PAGE
  getURL(): string {
    return this.url
  }
  isDestroyed(): boolean {
    return false
  }
  /** A press the page received. */
  press(): void {
    this.emit('before-mouse-event', {}, { type: 'mouseDown' })
  }
}

function created(opener: object | null): WebContents & { close: ReturnType<typeof vi.fn> } {
  return { opener, close: vi.fn(), isDestroyed: () => false } as unknown as WebContents & { close: ReturnType<typeof vi.fn> }
}

function details(overrides: Partial<HandlerDetails> = {}): HandlerDetails {
  return { url: 'http://app.test:8080/child.html', frameName: '', features: '', disposition: 'foreground-tab', referrer: { url: '', policy: 'default' }, ...overrides }
}

function setup(overrides: Partial<TabWindowOpenDeps> = {}) {
  const clock = createManualClock(0)
  const strip: StripEvent[] = []
  const withdraw = vi.fn()
  const deferred: Array<() => void> = []
  const deps: TabWindowOpenDeps = {
    tabId: 'browser-tab-1',
    clock,
    resolveDomain: (host) => host,
    appAddresses: () => APP,
    isLocalAddress: (url) => url.startsWith('http://127.0.0.1:9999/'),
    isExcepted: () => false,
    saveException: vi.fn(),
    expectPageWindow: vi.fn(() => withdraw),
    isRegisteredView: () => true,
    defer: (fn) => deferred.push(fn),
    childPreferences: () => ({ sandbox: true }),
    openTab: vi.fn(() => true),
    openPopup: vi.fn(),
    emitStrip: (e) => strip.push(e),
    newRowId: () => 'pb',
    ...overrides
  }
  const open = new TabWindowOpen(deps)
  const opener = new FakeOpener()
  const { handler, startTracking } = open.handlerFor(opener, false)
  startTracking()
  return { clock, strip, withdraw, deferred, deps, open, opener, handler }
}

describe('TabWindowOpen', () => {
  it('025-AC-011 refuses an open without a user action and shows "Pop-up blocked" in the strip', () => {
    const { deps, handler, strip } = setup()
    expect(handler(details())).toEqual({ action: 'deny' })
    expect(strip).toMatchObject([{ op: 'add', row: { kind: 'popupBlocked', requester: { origin: { kind: 'web' }, inside: null } } }])
    expect(deps.expectPageWindow).not.toHaveBeenCalled()
  })

  it('a press lets one open through within 5 s, with the frozen settings and the page window expected', () => {
    const { clock, deferred, deps, handler, opener, withdraw } = setup()
    opener.press()
    clock.advance(ACTIVATION_WINDOW_MS)
    const answer = handler(details())
    expect(answer).toMatchObject({ action: 'allow', outlivesOpener: false, overrideBrowserWindowOptions: { show: false, webPreferences: { sandbox: true } } })
    expect(deps.expectPageWindow).toHaveBeenCalledWith(opener.session)
    deferred.forEach((fn) => fn())
    expect(withdraw).toHaveBeenCalled()
    // One open per press.
    expect(handler(details())).toEqual({ action: 'deny' })
  })

  it('a press older than 5 s does not count', () => {
    const { clock, handler, opener } = setup()
    opener.press()
    clock.advance(ACTIVATION_WINDOW_MS + 1)
    expect(handler(details()).action).toBe('deny')
  })

  it('025-AC-011 a sixth activated open in a minute is blocked', () => {
    const { handler, opener, strip } = setup()
    for (let i = 0; i < MAX_OPENS_PER_MINUTE; i += 1) {
      opener.press()
      expect(handler(details()).action).toBe('allow')
    }
    opener.press()
    expect(handler(details()).action).toBe('deny')
    expect(strip).toHaveLength(1)
  })

  it('025-AC-011 a site with a pop-up exception opens without a user action and without a row', () => {
    const isExcepted = vi.fn((origin: string) => origin === 'http://app.test:8080')
    const { handler, opener, strip } = setup({ isExcepted })
    expect(handler(details()).action).toBe('allow')
    opener.url = 'http://other.test/'
    expect(handler(details()).action).toBe('deny')
    expect(strip).toHaveLength(1)
  })

  it('refuses addresses the page source may not open, with no row (S-7)', () => {
    const { handler, opener, strip } = setup()
    for (const url of ['javascript:alert(1)', 'chrome://gpu', 'file:///etc/passwd', 'http://127.0.0.1:9999/a.html', APP.rendererEntry, 'data:text/html,x']) {
      opener.press()
      expect(handler(details({ url })).action).toBe('deny')
    }
    expect(strip).toEqual([])
    opener.press()
    expect(handler(details({ url: 'about:blank' })).action).toBe('allow')
  })

  it('025-AC-011 createWindow: no opener (link, noopener, middle-click) makes a tab adopting the webContents', () => {
    const { deps, handler, opener } = setup()
    opener.press()
    const answer = handler(details()) as { createWindow: (o: object) => WebContents }
    const link = created(null)
    expect(answer.createWindow({ webContents: link })).toBe(link)
    expect(deps.openTab).toHaveBeenCalledWith('http://app.test:8080/child.html', false, link)
    expect(deps.openPopup).not.toHaveBeenCalled()

    opener.press()
    const middle = handler(details({ disposition: 'background-tab' })) as { createWindow: (o: object) => WebContents }
    const background = created(null)
    middle.createWindow({ webContents: background })
    expect(deps.openTab).toHaveBeenLastCalledWith('http://app.test:8080/child.html', true, background)

    opener.press()
    const noopener = handler(details({ features: 'noopener,width=500', disposition: 'new-window' })) as { createWindow: (o: object) => WebContents }
    const kept = created({})
    noopener.createWindow({ webContents: kept })
    expect(deps.openTab).toHaveBeenLastCalledWith('http://app.test:8080/child.html', false, kept)
  })

  it('025-AC-011 createWindow: an opener kept makes a popup window with the features and the opener address', () => {
    const { deps, handler, opener } = setup()
    opener.press()
    const answer = handler(details({ features: 'width=500,height=600', disposition: 'new-window' })) as { createWindow: (o: object) => WebContents }
    const popup = created({})
    expect(answer.createWindow({ webContents: popup })).toBe(popup)
    expect(deps.openPopup).toHaveBeenCalledWith({ contents: popup, features: { width: 500, height: 600, noopener: false }, openerUrl: PAGE })
  })

  it('createWindow closes a tab-bound webContents when the tab cannot open, and builds nothing around an unregistered one', () => {
    const openTab = vi.fn(() => false)
    const { deps, handler, opener } = setup({ openTab, isRegisteredView: (c) => (c as unknown as { opener: unknown }).opener !== 'stranger' })
    opener.press()
    const lost = created(null)
    ;(handler(details()) as { createWindow: (o: object) => WebContents }).createWindow({ webContents: lost })
    expect(lost.close).toHaveBeenCalledWith({ waitForBeforeUnload: false })

    opener.press()
    const stranger = created('stranger' as unknown as object)
    ;(handler(details()) as { createWindow: (o: object) => WebContents }).createWindow({ webContents: stranger })
    expect(deps.openPopup).not.toHaveBeenCalled()
    expect(openTab).toHaveBeenCalledTimes(1)

    opener.press()
    expect(() => (handler(details()) as { createWindow: (o: object) => WebContents }).createWindow({})).toThrow()
  })

  it('025-AC-011 Allow once opens the blocked address as a tab; Always allow also saves the site', () => {
    const { clock, deps, handler, open } = setup()
    handler(details({ url: 'http://app.test:8080/one.html' }))
    clock.advance(500)
    expect(open.answerStrip('pb', 'allowOnce')).toBe('accepted')
    expect(deps.openTab).toHaveBeenCalledWith('http://app.test:8080/one.html', false, null)
    handler(details({ url: 'http://app.test:8080/two.html' }))
    clock.advance(500)
    expect(open.answerStrip('pb', 'alwaysAllow')).toBe('accepted')
    expect(deps.saveException).toHaveBeenCalledWith('http://app.test:8080')
  })

  it('a page with no site origin can be allowed once but saves no exception; a failed open is logged', () => {
    const { clock, deps, handler, open, opener } = setup({ openTab: vi.fn(() => false) })
    opener.url = 'about:blank'
    handler(details())
    clock.advance(500)
    expect(open.answerStrip('pb', 'alwaysAllow')).toBe('accepted')
    expect(deps.saveException).not.toHaveBeenCalled()
    expect(deps.openTab).toHaveBeenCalled()
  })

  it('a new document takes the row away; detach stops tracking presses', () => {
    const { handler, open, opener, strip } = setup()
    handler(details())
    open.newDocument()
    expect(strip.at(-1)).toEqual({ tabId: 'browser-tab-1', op: 'withdraw', requestId: 'pb' })
    open.detach()
    expect(opener.listenerCount('before-mouse-event')).toBe(0)
    expect(open.answerStrip('nope', 'allowOnce')).toBeNull()
  })

  it('a popup handler tracks presses at once', () => {
    const { open } = setup()
    const popupPage = new FakeOpener()
    const { handler } = open.handlerFor(popupPage, true)
    popupPage.press()
    expect(handler(details()).action).toBe('allow')
  })
})
