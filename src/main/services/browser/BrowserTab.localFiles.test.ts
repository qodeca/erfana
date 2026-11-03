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
    expectDevTools: vi.fn(() => () => undefined),
    onStateChange: vi.fn(),
    onDestroyed: vi.fn(),
    ...(withLocal ? { local } : {})
  })
}

beforeEach(() => {
  local = {
    isLocalAddress: (url) => url.startsWith(SERVED),
    arm: vi.fn<(url: string) => void>(),
    displayAddress: (url) => (url.startsWith(SERVED) ? `file:///p/site/${url.slice(SERVED.length)}` : null),
    allowsRequest: ({ topUrl }) => topUrl !== null && topUrl.startsWith(SERVED)
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

describe('without served folders', () => {
  it('shows every address as it is and arms nothing', () => {
    const plain = make(false)
    plain.history('reload')
    plain.navigateLocal(INDEX, 'address')
    expect(plain.state().pendingUrl).toBe(INDEX)
    expect(plain.navigateForPage('https://a.test/')).toEqual({ ok: true })
  })
})
