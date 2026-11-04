// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A browser tab's local files (spec 025, 025-FR-005 rule 1, 025-FR-010; ADR
 * 0012 option 4, S-6, S-7): loads from a served folder, arms every load the
 * user starts, shows `file://` addresses and never loads a local file for
 * the page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { TabStateEventSchema } from '../../../shared/ipc/browser-tab-schema'
import { BrowserTab, type TabLocalFiles } from './BrowserTab'
import type { AppAddresses } from './browserNavigationPolicy'
import { fakeHost, fakeView, type FakeContents } from './__test-helpers__/fakeBrowserView'

const APP: AppAddresses = { rendererEntry: 'file:///app/out/renderer/index.html', resourcesDir: '/app', devServerOrigin: null }
const SERVED = 'http://127.0.0.1:41000/0123456789abcdef0123456789abcdef/'
const INDEX = `${SERVED}index.html`
const PAGE_B = `${SERVED}b.html`

let contents: FakeContents
let local: TabLocalFiles & { arm: ReturnType<typeof vi.fn<(url: string) => void>> }
/** The fake served folders' pending top-level load, by `webContents` id, as `LocalFileServers` keeps it. */
let pendingLoads: Map<number, string>
let tab: BrowserTab

function make(withLocal = true): BrowserTab {
  const view = fakeView()
  contents = view.contents
  return new BrowserTab({
    id: 'browser-tab-1',
    panelId: 'panel-1',
    host: fakeHost().host,
    view: view.view,
    projectRoot: '/p',
    caseSensitive: true,
    appAddresses: () => APP,
    resolveDomain: (h) => h,
    mediaInUse: () => ({ camera: false, microphone: false, screen: false }),
    expectDevTools: vi.fn(() => () => undefined),
    onStateChange: vi.fn(),
    onDestroyed: vi.fn(),
    ...(withLocal ? { local } : {})
  })
}

beforeEach(() => {
  pendingLoads = new Map()
  local = {
    isLocalAddress: (url) => url.startsWith(SERVED),
    arm: vi.fn<(url: string) => void>(),
    displayAddress: (url) => (url.startsWith(SERVED) ? `file:///p/site/${url.slice(SERVED.length)}` : null),
    allowsRequest: ({ topUrl }) => topUrl !== null && topUrl.startsWith(SERVED),
    setPendingLoad: (id, url) => {
      if (url !== null && url.startsWith(SERVED)) pendingLoads.set(id, url)
      else pendingLoads.delete(id)
    },
    endPendingLoad: (id, url) => {
      if (url === undefined || pendingLoads.get(id) === url) pendingLoads.delete(id)
    }
  }
  tab = make()
})

describe('navigateLocal', () => {
  it('arms the served address, loads it and shows the file:// address as pending, then committed', () => {
    tab.navigateLocal(INDEX, 'previewOpen')
    expect(local.arm).toHaveBeenCalledWith(INDEX)
    expect(contents.loadURL).toHaveBeenCalledWith(INDEX)
    expect(tab.state()).toMatchObject({ pendingUrl: 'file:///p/site/index.html', committedUrl: null, security: 'file' })
    contents.commit(INDEX)
    const state = tab.state()
    expect(state).toMatchObject({ pendingUrl: null, committedUrl: 'file:///p/site/index.html', security: 'file', origin: { kind: 'file' } })
    expect(TabStateEventSchema.safeParse(state).success).toBe(true)
    // Open in system browser never gets the loopback address: a served file is file://, which it refuses.
    expect(tab.pageAddress()).toBe('file:///p/site/index.html')
  })

  it('arms the committed local address on Reload, and the target entry on Back and Forward', () => {
    contents.commit(INDEX)
    contents.commit('https://a.test/')
    contents.commit(PAGE_B)
    tab.history('reload')
    expect(local.arm).toHaveBeenLastCalledWith(PAGE_B)
    tab.history('back')
    expect(local.arm).toHaveBeenCalledTimes(1)
    contents.index = 1
    tab.history('back')
    expect(local.arm).toHaveBeenLastCalledWith(INDEX)
    expect(tab.state().pendingUrl).toBe('file:///p/site/index.html')
    contents.index = 0
    tab.history('forward')
    expect(local.arm).toHaveBeenCalledTimes(2)
  })

  it('keeps web addresses as they are', () => {
    tab.navigate('https://a.test/x', 'address')
    expect(tab.state().pendingUrl).toBe('https://a.test/x')
    expect(local.arm).not.toHaveBeenCalled()
  })
})

describe('local files and the page (S-7)', () => {
  it('never loads a served address for the page', () => {
    expect(tab.navigateForPage(INDEX)).toEqual({ refused: 'local-file' })
    expect(contents.loadURL).not.toHaveBeenCalled()
  })

  it('refuses a page navigation or a frame to a served folder unless the page is of that folder; the page stays', () => {
    const OTHER = 'http://127.0.0.1:41001/fedcba9876543210fedcba9876543210/index.html'
    local.isLocalAddress = (url) => url.startsWith(SERVED) || url === OTHER
    const prevented = (): { preventDefault: ReturnType<typeof vi.fn> } => ({ preventDefault: vi.fn() })
    contents.commit('https://a.test/')
    const fromWeb = { ...prevented(), url: INDEX }
    contents.emit('will-navigate', fromWeb)
    expect(fromWeb.preventDefault).toHaveBeenCalled()
    contents.commit(INDEX)
    const sameFolder = { ...prevented(), url: PAGE_B }
    contents.emit('will-navigate', sameFolder)
    expect(sameFolder.preventDefault).not.toHaveBeenCalled()
    local.allowsRequest = ({ url }) => url !== OTHER
    const otherFolderFrame = { ...prevented(), url: OTHER, isMainFrame: false }
    contents.emit('will-frame-navigate', otherFolderFrame)
    expect(otherFolderFrame.preventDefault).toHaveBeenCalled()
    const web = { ...prevented(), url: 'https://b.test/' }
    contents.emit('will-navigate', web)
    expect(web.preventDefault).not.toHaveBeenCalled()
  })

  it('answers local-file for a file: URL from a user source – the cue to open it through its served folder', () => {
    expect(tab.navigate('file:///p/site/index.html', 'address')).toEqual({ refused: 'local-file' })
    expect(contents.loadURL).not.toHaveBeenCalled()
  })
})

describe('the pending top-level load (ADR 0012 amendment 2026-11-04)', () => {
  const pending = (): string | undefined => pendingLoads.get(contents.id)
  const startNavigation = (url: string, initiator?: string): void => {
    contents.emit('did-start-navigation', { url, isMainFrame: true, isSameDocument: false, ...(initiator ? { initiator } : {}) })
  }

  it('records the load Erfana starts, keeps it through its own start, and clears it on commit', () => {
    contents.commit('https://a.test/')
    tab.navigateLocal(INDEX, 'previewOpen')
    expect(pending()).toBe(INDEX)
    startNavigation(INDEX)
    expect(pending()).toBe(INDEX)
    contents.commit(INDEX)
    expect(pending()).toBeUndefined()
  })

  it('records Reload, Back and Forward of a served entry, and clears it for a web entry', () => {
    contents.commit(INDEX)
    contents.commit('https://a.test/')
    contents.index = 1
    tab.history('back')
    expect(pending()).toBe(INDEX)
    contents.index = 0
    tab.history('forward')
    expect(pending()).toBeUndefined()
    contents.index = 1
    tab.history('reload')
    expect(pending()).toBeUndefined()
  })

  it('clears it on its own failure, but not on the failure of an older load it replaced', () => {
    tab.navigateLocal(INDEX, 'previewOpen')
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://older.test/', true)
    expect(pending()).toBe(INDEX)
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', INDEX, false)
    expect(pending()).toBe(INDEX)
    contents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', INDEX, true)
    expect(pending()).toBeUndefined()
  })

  it('clears it on Stop, at the end of loading and when the tab is destroyed', () => {
    tab.navigateLocal(INDEX, 'previewOpen')
    tab.history('stop')
    expect(pending()).toBeUndefined()
    tab.navigateLocal(INDEX, 'previewOpen')
    contents.emit('did-stop-loading')
    expect(pending()).toBeUndefined()
    tab.navigateLocal(INDEX, 'previewOpen')
    contents.destroy()
    expect(pending()).toBeUndefined()
  })

  it('clears it on a newer navigation: a web address, a page-opened load, or the page leaving the folder', () => {
    tab.navigateLocal(INDEX, 'previewOpen')
    tab.navigate('https://a.test/x', 'address')
    expect(pending()).toBeUndefined()
    tab.navigateLocal(INDEX, 'previewOpen')
    expect(tab.navigateForPage('https://b.test/')).toEqual({ ok: true })
    expect(pending()).toBeUndefined()
    tab.navigateLocal(INDEX, 'previewOpen')
    startNavigation('https://c.test/', 'https://a.test')
    expect(pending()).toBeUndefined()
    tab.navigateLocal(INDEX, 'previewOpen')
    startNavigation('https://c.test/')
    expect(pending()).toBeUndefined()
  })

  it('records the page\'s own navigation within its folder, and never one from a page elsewhere', () => {
    contents.commit(INDEX)
    startNavigation(PAGE_B, new URL(SERVED).origin)
    expect(pending()).toBe(PAGE_B)
    contents.commit(PAGE_B)
    expect(pending()).toBeUndefined()
    contents.commit('https://a.test/')
    startNavigation(INDEX, 'https://a.test')
    expect(pending()).toBeUndefined()
  })

  it('ignores frame and same-document navigations', () => {
    tab.navigateLocal(INDEX, 'previewOpen')
    contents.emit('did-start-navigation', { url: 'https://frame.test/', isMainFrame: false, isSameDocument: false, initiator: 'https://a.test' })
    contents.emit('did-start-navigation', { url: 'https://a.test/#x', isMainFrame: true, isSameDocument: true, initiator: 'https://a.test' })
    expect(pending()).toBe(INDEX)
  })

  it('passes the tab\'s webContents id to the gate for a frame, so a frame of the pending folder goes ahead', () => {
    const allowsRequest = vi.fn(() => true)
    local.allowsRequest = allowsRequest
    contents.commit(INDEX)
    contents.emit('will-frame-navigate', { url: PAGE_B, isMainFrame: false, preventDefault: vi.fn() })
    expect(allowsRequest).toHaveBeenLastCalledWith({ url: PAGE_B, resourceType: 'subFrame', topUrl: INDEX, contentsId: contents.id })
  })
})

describe('without served folders', () => {
  it('shows every address as it is and arms nothing', () => {
    const plain = make(false)
    plain.history('reload')
    plain.navigateLocal(INDEX, 'address')
    expect(plain.state().pendingUrl).toBe(INDEX)
    expect(plain.navigateForPage('https://a.test/')).toEqual({ ok: true })
  })
})
