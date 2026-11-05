// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The tab service's wiring of window open, the leave-page prompt and the
 * right-click menu (commits 12e–g; 025-FR-011, 025-FR-057, 025-FR-058):
 * page-opened tabs adopting Chromium's `webContents`, the user's close
 * asking first, strip answers and menu actions routed by window ownership,
 * and **Open link in new tab** under `contextMenuLink`.
 */
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock } from '../../../shared/clock'
import { BROWSER_TAB_EVENTS } from '../../../shared/ipc/browser-tab-channels'
import { BrowserTabService, type BrowserTabServiceDeps } from './BrowserTabService'
import { fakeHost, fakeView, type FakeContents, type FakeHost, type FakeView } from './__test-helpers__/fakeBrowserView'
import type { TabPopupLink } from './popups/BrowserPopups'
import { keyDown } from './input/__test-helpers__/fakeInputContents'

const SESSION = { name: 'browser' }

let views: FakeView[]
let host: FakeHost
let other: FakeHost
let outlets: Array<{ openTab: (url: string, background: boolean, adopt: WebContents | null) => boolean }>
let popupLink: TabPopupLink

function make(overrides: Partial<BrowserTabServiceDeps> = {}): BrowserTabService {
  return new BrowserTabService({
    openProfile: vi.fn(async () => ({ projectRoot: '/p', session: SESSION })),
    currentProject: () => ({ realRoot: '/p', caseSensitive: true }),
    prepareSession: vi.fn(),
    createView: vi.fn((session, adopt?: WebContents) => {
      const v = fakeView(session)
      if (adopt !== undefined) (v.view as unknown as { webContents: unknown }).webContents = adopt
      views.push(v)
      return v.view
    }),
    expectDevTools: vi.fn(() => () => undefined),
    appAddresses: () => ({ rendererEntry: 'file:///r/index.html', resourcesDir: '/r', devServerOrigin: null }),
    resolveDomain: (h) => h,
    extras: {
      clock: createManualClock(0),
      resolveDomain: (h) => h,
      popups: {
        attachTab: vi.fn((_tab, outlet) => {
          outlets.push(outlet)
          return popupLink
        })
      },
      menuActions: { openInSystemBrowser: vi.fn(), writeClipboardText: vi.fn() },
      newRowId: () => 'row'
    },
    ...overrides
  })
}

beforeEach(() => {
  views = []
  outlets = []
  host = fakeHost()
  other = fakeHost()
  popupLink = {
    handlerFor: vi.fn(() => ({ handler: () => ({ action: 'deny' as const }), startTracking: vi.fn() })),
    answerStrip: vi.fn((id: string) => (id === 'pb' ? ('accepted' as const) : null)),
    newDocument: vi.fn(),
    detach: vi.fn()
  }
})

async function open(service: BrowserTabService, on = host): Promise<string> {
  const response = await service.create(on.host, 'panel')
  if (!('tabId' in response)) throw new Error(response.error)
  return response.tabId
}

const contentsOf = (i: number): FakeContents => views[i]!.contents

describe('BrowserTabService window open, leave-page prompt and right-click menu', () => {
  it('025-AC-011 a page-opened tab adopts the webContents Chromium created and does not load it again', async () => {
    const service = make()
    const opener = await open(service)
    const adopted = fakeView(SESSION).contents
    expect(outlets[0]!.openTab('https://app.test/child.html', true, adopted as unknown as WebContents)).toBe(true)
    expect(service.list()[1]!.contents).toBe(adopted)
    expect(adopted.loadURL).not.toHaveBeenCalled()
    expect(host.send).toHaveBeenCalledWith(BROWSER_TAB_EVENTS.tabAdded, expect.objectContaining({ openerTabId: opener, background: true }))
  })

  it('a page-opened tab with no webContents loads the address under the page source, and a refused one closes', async () => {
    const service = make()
    await open(service)
    expect(outlets[0]!.openTab('https://app.test/child.html', false, null)).toBe(true)
    expect(contentsOf(1).loadURL).toHaveBeenCalledWith('https://app.test/child.html')
    expect(outlets[0]!.openTab('about:blank', false, null)).toBe(false)
    expect(service.list()).toHaveLength(2)
  })

  it('025-AC-075 a close the user asks for lets the page ask; Erfana’s own closes never do (S-31)', async () => {
    const service = make()
    const tabId = await open(service)
    service.close(other.host.id, tabId)
    expect(contentsOf(0).close).not.toHaveBeenCalled()
    contentsOf(0).close.mockImplementationOnce(() => undefined)
    service.close(host.host.id, tabId)
    expect(contentsOf(0).close).toHaveBeenCalledWith({ waitForBeforeUnload: true })
    expect(service.list()).toHaveLength(1)
    // The page asks: the leave-page row goes to the owning window.
    contentsOf(0).emit('will-prevent-unload', { preventDefault: vi.fn() })
    expect(host.send).toHaveBeenCalledWith(BROWSER_TAB_EVENTS.strip, expect.objectContaining({ op: 'add', row: expect.objectContaining({ kind: 'leavePage' }) }))
    service.closeProject('/p')
    expect(contentsOf(0).close).toHaveBeenLastCalledWith({ waitForBeforeUnload: false })
  })

  it('without the extras a user close closes at once', async () => {
    const service = make({ extras: undefined })
    const tabId = await open(service)
    expect(service.contextAction(host.host.id, tabId, { menuId: 'm', action: 'reload' })).toBe('unknown')
    service.close(host.host.id, tabId)
    expect(contentsOf(0).close).toHaveBeenCalledWith({ waitForBeforeUnload: false })
  })

  it('routes the "Pop-up blocked" answer after the page features, by window ownership', async () => {
    const service = make()
    const tabId = await open(service)
    expect(service.answerStrip(host.host.id, tabId, 'pb', 'allowOnce')).toBe('accepted')
    expect(service.answerStrip(other.host.id, tabId, 'pb', 'allowOnce')).toBeNull()
    expect(service.answerStrip(host.host.id, tabId, 'nope', 'allowOnce')).toBe('unknown')
  })

  it('025-AC-074 sends the menu to the owning window and runs Open link in new tab as a contextMenuLink tab', async () => {
    const service = make()
    const tabId = await open(service)
    contentsOf(0).emit('context-menu', {}, { x: 1, y: 2, linkURL: 'https://app.test/a', srcURL: '', mediaType: 'none', selectionText: '', isEditable: false })
    expect(host.send).toHaveBeenCalledWith(BROWSER_TAB_EVENTS.contextMenu, expect.objectContaining({ tabId, menuId: 'row' }))
    expect(service.contextAction(other.host.id, tabId, { menuId: 'row', action: 'openLinkInNewTab' })).toBeNull()
    expect(service.contextAction(host.host.id, tabId, { menuId: 'row', action: 'openLinkInNewTab' })).toBe('accepted')
    expect(contentsOf(1).loadURL).toHaveBeenCalledWith('https://app.test/a')
    expect(host.send).toHaveBeenCalledWith(BROWSER_TAB_EVENTS.tabAdded, expect.objectContaining({ openerTabId: tabId, background: false }))
  })

  it('a refused link tab closes, and no tab opens after the window is gone', async () => {
    const service = make()
    const tabId = await open(service)
    const menu = (linkURL: string): void => {
      contentsOf(0).emit('context-menu', {}, { x: 1, y: 2, linkURL, srcURL: '', mediaType: 'none', selectionText: '', isEditable: false })
    }
    menu('https://127.0.0.1:1/')
    service.contextAction(host.host.id, tabId, { menuId: 'row', action: 'openLinkInNewTab' })
    expect(service.list()).toHaveLength(2)
    host.destroy()
    menu('https://app.test/b')
    service.contextAction(host.host.id, tabId, { menuId: 'row', action: 'openLinkInNewTab' })
    expect(service.list()).toHaveLength(2)
  })

  it('no page menu in pick mode; closing the tab detaches its popups', async () => {
    const input = { platform: 'darwin', clock: createManualClock(0), macAppKeys: () => ({}) as never }
    ;(host.host as { webContents: unknown }).webContents = Object.assign(new EventEmitter(), {
      send: host.send,
      isDestroyed: () => false,
      getZoomFactor: () => 1
    })
    const service = make({
      input,
      createView: vi.fn((session) => {
        const v = fakeView(session)
        Object.assign(v.contents, { isFocused: () => false, setIgnoreMenuShortcuts: vi.fn(), executeJavaScriptInIsolatedWorld: vi.fn(async () => undefined) })
        views.push(v)
        return v.view
      })
    })
    const tabId = await open(service)
    contentsOf(0).emit('focus')
    contentsOf(0).emit('did-navigate', {}, 'https://a.test/')
    contentsOf(0).emit('before-input-event', { preventDefault: vi.fn() }, keyDown('e', ['meta']))
    expect(service.inputFor(service.list()[0]!)!.state().pick).toBe(true)
    contentsOf(0).emit('context-menu', {}, { x: 1, y: 2, linkURL: '', srcURL: '', mediaType: 'none', selectionText: '', isEditable: false })
    expect(host.send).not.toHaveBeenCalledWith(BROWSER_TAB_EVENTS.contextMenu, expect.anything())
    service.closeWindow(host.host.id)
    expect(popupLink.detach).toHaveBeenCalled()
    expect(service.tabOf(host.host.id, tabId)).toBeNull()
  })

  it('arms the leave-page prompt before a load the user starts', async () => {
    const service = make()
    const tabId = await open(service)
    const tab = service.tabOf(host.host.id, tabId)!
    tab.navigate('https://app.test/next', 'address')
    contentsOf(0).emit('will-prevent-unload', { preventDefault: vi.fn() })
    expect(host.send).toHaveBeenCalledWith(BROWSER_TAB_EVENTS.strip, expect.objectContaining({ row: expect.objectContaining({ kind: 'leavePage' }) }))
  })
})
