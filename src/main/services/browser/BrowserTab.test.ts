// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One browser tab (spec 025, 025-FR-002, 003, 005, 007, 013; § 3.4, S2, A4).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { TabStateEventSchema } from '../../../shared/ipc/browser-tab-schema'
import { BrowserTab, type BrowserTabDeps } from './BrowserTab'
import type { AppAddresses } from './browserNavigationPolicy'
import { fakeHost, fakeView, type FakeContents, type FakeHost } from './__test-helpers__/fakeBrowserView'

const APP: AppAddresses = { rendererEntry: 'file:///app/out/renderer/index.html', resourcesDir: '/app', devServerOrigin: 'http://localhost:5173' }

let host: FakeHost
let contents: FakeContents
let setBounds: ReturnType<typeof vi.fn>
let deps: BrowserTabDeps
let tab: BrowserTab
let onStateChange: ReturnType<typeof vi.fn<(tab: BrowserTab) => void>>
let withdraw: ReturnType<typeof vi.fn<() => void>>

function make(overrides: Partial<BrowserTabDeps> = {}): BrowserTab {
  host = fakeHost()
  const view = fakeView()
  contents = view.contents
  setBounds = view.setBounds
  onStateChange = vi.fn<(tab: BrowserTab) => void>()
  withdraw = vi.fn<() => void>()
  deps = {
    id: 'browser-tab-1',
    panelId: 'panel-1',
    host: host.host,
    view: view.view,
    projectRoot: '/p',
    caseSensitive: true,
    appAddresses: () => APP,
    resolveDomain: (h) => h,
    expectDevTools: vi.fn((_session: unknown) => withdraw),
    onStateChange,
    onDestroyed: vi.fn(),
    ...overrides
  }
  return new BrowserTab(deps)
}

const prevented = (): { preventDefault: ReturnType<typeof vi.fn> } => ({ preventDefault: vi.fn() })

beforeEach(() => {
  tab = make()
})

describe('from creation, before any page loads', () => {
  it('denies every window open (A4)', () => {
    expect(contents.setWindowOpenHandler).toHaveBeenCalledTimes(1)
    expect(contents.windowOpenHandler!({ url: 'https://a.test/' })).toEqual({ action: 'deny' })
  })

  it('cancels the Bluetooth chooser of the page', () => {
    const event = prevented()
    const callback = vi.fn()
    contents.emit('select-bluetooth-device', event, [], callback)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(callback).toHaveBeenCalledWith('')
  })

  it('attaches the CDP session once, tells it when the tab shows and hides, and detaches it on close', () => {
    const link = { detach: vi.fn(), setVisible: vi.fn() }
    const attachCdp = vi.fn(() => link)
    const withCdp = make({ attachCdp })
    expect(attachCdp).toHaveBeenCalledWith(contents)
    withCdp.applyBounds({ x: 0, y: 0, width: 10, height: 10 }, 1, true)
    withCdp.applyBounds({ x: 0, y: 0, width: 10, height: 10 }, 2, false)
    expect(link.setVisible.mock.calls).toEqual([[true], [false]])
    withCdp.close()
    expect(link.detach).toHaveBeenCalledTimes(1)
  })

  it('works without a CDP session when none could attach', () => {
    const withoutCdp = make({ attachCdp: () => null })
    withoutCdp.applyBounds({ x: 0, y: 0, width: 10, height: 10 }, 1, true)
    expect(() => withoutCdp.close()).not.toThrow()
  })

  it('025-FR-019 reports no camera, microphone or screen in use: the state has no in-use field', () => {
    expect(tab.state()).not.toHaveProperty('inUse')
  })

  it('025-FR-057 hands Open in system browser the whole committed address, without user info', () => {
    expect(tab.pageAddress()).toBeNull()
    const long = `https://a.test/${'x'.repeat(9000)}`
    contents.commit(long.replace('https://', 'https://user:secret@'))
    expect(tab.pageAddress()).toBe(long)
    expect(tab.state().committedUrl).toHaveLength(8192)
  })

  it('starts as an empty tab that cannot go back or forward', () => {
    const state = tab.state()
    expect(TabStateEventSchema.safeParse(state).success).toBe(true)
    expect(state).toMatchObject({ committedUrl: null, pendingUrl: null, canGoBack: false, canGoForward: false, erfanaPage: 'empty', origin: null })
  })
})

describe('navigate (user sources)', () => {
  it('loads an allowed address and shows it as pending until it commits', () => {
    expect(tab.navigate('https://a.test/x', 'address')).toEqual({ ok: true })
    expect(contents.loadURL).toHaveBeenCalledWith('https://a.test/x')
    expect(tab.state()).toMatchObject({ pendingUrl: 'https://a.test/x', committedUrl: null, erfanaPage: null, security: 'secure' })
    contents.commit('https://a.test/x')
    expect(tab.state()).toMatchObject({ pendingUrl: null, committedUrl: 'https://a.test/x' })
    expect(onStateChange).toHaveBeenCalled()
  })

  it.each([
    ['file:///app/out/renderer/index.html', 'app-entry'],
    ['http://localhost:5173/', 'app-entry'],
    ['file:///Users/me/a.html', 'local-file'],
    ['javascript:alert(1)', 'scheme']
  ] as const)('refuses %s with %s and loads nothing', (url, reason) => {
    expect(tab.navigate(url, 'terminalLink')).toEqual({ refused: reason })
    expect(contents.loadURL).not.toHaveBeenCalled()
  })

  it('swallows the abort rejection of a stopped load and logs any other', async () => {
    contents.loadURL.mockRejectedValueOnce(Object.assign(new Error('aborted'), { errno: -3 }))
    tab.navigate('https://a.test/', 'address')
    contents.loadURL.mockRejectedValueOnce(Object.assign(new Error('refused'), { errno: -102 }))
    tab.navigate('https://b.test/', 'address')
    await Promise.resolve()
    await Promise.resolve()
    const { logger } = await import('../LoggingService')
    expect(logger.debug).toHaveBeenCalledWith('Browser tab load ended without a commit', { errno: '-102' })
  })

  it('reverts the pending address on a main-frame failure, a load that ends without a commit, and Stop', () => {
    tab.navigate('https://a.test/', 'address')
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://a.test/', false)
    expect(tab.state().pendingUrl).toBe('https://a.test/')
    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://a.test/', true)
    expect(tab.state().pendingUrl).toBeNull()

    tab.navigate('https://a.test/204', 'address')
    contents.emit('did-stop-loading')
    expect(tab.state().pendingUrl).toBeNull()

    tab.navigate('https://a.test/held', 'address')
    tab.history('stop')
    expect(contents.stop).toHaveBeenCalled()
    expect(tab.state().pendingUrl).toBeNull()
  })

  it('drops the pending address the moment the page starts its own navigation, not for its own start', () => {
    tab.navigate('https://a.test/', 'address')
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, initiator: null, url: 'https://a.test/' })
    expect(tab.state().pendingUrl).toBe('https://a.test/')
    contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false, initiator: {}, url: 'https://f.test/' })
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, initiator: {}, url: 'https://a.test/#x' })
    expect(tab.state().pendingUrl).toBe('https://a.test/')
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, initiator: {}, url: 'https://evil.test/' })
    expect(tab.state().pendingUrl).toBeNull()
  })

  it('navigateForPage never shows a pending address and is checked under the page source', () => {
    expect(tab.navigateForPage('https://a.test/')).toEqual({ ok: true })
    expect(tab.state().pendingUrl).toBeNull()
    expect(tab.navigateForPage('file:///x.html')).toEqual({ refused: 'local-file' })
  })

  it('updates the committed address on a same-document move of the main frame only', () => {
    contents.commit('https://a.test/')
    contents.emit('did-navigate-in-page', {}, 'https://frame.test/#y', false)
    contents.emit('did-navigate-in-page', {}, 'https://a.test/#x', true)
    expect(tab.state().committedUrl).toBe('https://a.test/#x')
  })

  it('cleans the page title and cuts a very long address to the schema cap', () => {
    contents.commit(`https://a.test/?${'q'.repeat(9000)}`)
    contents.emit('page-title-updated', {}, 'Bad‮txt.exe\u0000 title', true)
    const state = tab.state()
    expect(state.title).toBe('Badtxt.exe title')
    expect(state.committedUrl!.length).toBe(8192)
    expect(TabStateEventSchema.safeParse(state).success).toBe(true)
  })
})

describe('page-started navigations (the page source, S2)', () => {
  it('cancels a main-frame navigation to a refused scheme or an app address, lets http(s) through', () => {
    for (const url of ['vscode://file/x', 'file:///etc/passwd', 'http://localhost:5173/', 'chrome://gpu']) {
      const event = { ...prevented(), url }
      contents.emit('will-navigate', event, url)
      expect(event.preventDefault).toHaveBeenCalled()
    }
    const ok = { ...prevented(), url: 'https://b.test/' }
    contents.emit('will-navigate', ok, ok.url)
    expect(ok.preventDefault).not.toHaveBeenCalled()
  })

  it('checks frames under the frame rules, own-origin blob: included, and leaves the main frame to will-navigate', () => {
    contents.commit('https://a.test/')
    const blob = { ...prevented(), url: 'blob:https://a.test/1', isMainFrame: false }
    const foreignBlob = { ...prevented(), url: 'blob:https://b.test/1', isMainFrame: false }
    const main = { ...prevented(), url: 'about:blank', isMainFrame: true }
    contents.emit('will-frame-navigate', blob)
    contents.emit('will-frame-navigate', foreignBlob)
    contents.emit('will-frame-navigate', main)
    expect(blob.preventDefault).not.toHaveBeenCalled()
    expect(foreignBlob.preventDefault).toHaveBeenCalled()
    expect(main.preventDefault).not.toHaveBeenCalled()
  })

  it('refuses blob: frames before any page committed', () => {
    const blob = { ...prevented(), url: 'blob:https://a.test/1', isMainFrame: false }
    contents.emit('will-frame-navigate', blob)
    expect(blob.preventDefault).toHaveBeenCalled()
  })

  it('checks redirects of the main frame and of frames', () => {
    const main = { ...prevented(), url: 'file:///etc/passwd', isMainFrame: true }
    const frame = { ...prevented(), url: 'data:text/html,x', isMainFrame: false }
    contents.emit('will-redirect', main, main.url)
    contents.emit('will-redirect', frame, frame.url)
    expect(main.preventDefault).toHaveBeenCalled()
    expect(frame.preventDefault).not.toHaveBeenCalled()
  })
})

describe('history (025-FR-003)', () => {
  beforeEach(() => {
    contents.commit('https://a.test/')
    contents.commit('https://b.test/')
  })

  it('goes back and forward with the target as pending, and does nothing at either end', () => {
    tab.history('back')
    expect(contents.navigationHistory.goBack).toHaveBeenCalled()
    expect(tab.state().pendingUrl).toBe('https://a.test/')
    contents.commit('https://a.test/')
    contents.index = 0
    contents.entries = [{ url: 'https://a.test/' }, { url: 'https://b.test/' }]
    expect(tab.state()).toMatchObject({ canGoBack: false, canGoForward: true })
    tab.history('back')
    expect(contents.navigationHistory.goBack).toHaveBeenCalledTimes(1)
    tab.history('forward')
    expect(contents.navigationHistory.goForward).toHaveBeenCalled()
    expect(tab.state().pendingUrl).toBe('https://b.test/')
    contents.index = 1
    contents.navigationHistory.goForward.mockClear()
    tab.history('forward')
    expect(contents.navigationHistory.goForward).not.toHaveBeenCalled()
  })

  it('reloads with the committed address as pending', () => {
    tab.history('reload')
    expect(contents.reload).toHaveBeenCalled()
    expect(tab.state().pendingUrl).toBe('https://b.test/')
  })

  it('reports loading while the page loads', () => {
    contents.loading = true
    contents.emit('did-start-loading')
    expect(tab.state().loading).toBe(true)
  })
})

describe('applyBounds (025-FR-007)', () => {
  const RECT = { x: 10, y: 20, width: 300, height: 200 }

  it('attaches the view once at zoom-corrected bounds, and drops stale pushes', () => {
    host.zoom = 1.5
    tab.applyBounds(RECT, 1, true)
    tab.applyBounds(RECT, 2, true)
    expect(host.addChildView).toHaveBeenCalledTimes(1)
    expect(setBounds).toHaveBeenLastCalledWith({ x: 15, y: 30, width: 450, height: 300 })
    tab.applyBounds({ ...RECT, x: 0 }, 2, true)
    tab.applyBounds({ ...RECT, x: 0 }, 1, true)
    expect(setBounds).toHaveBeenCalledTimes(2)
    expect(tab.isAttached()).toBe(true)
  })

  it('detaches a hidden tab without touching its page, and shows it again', () => {
    tab.applyBounds(RECT, 1, true)
    tab.applyBounds(RECT, 2, false)
    expect(host.removeChildView).toHaveBeenCalledTimes(1)
    expect(tab.isAttached()).toBe(false)
    expect(contents.close).not.toHaveBeenCalled()
    expect(contents.reload).not.toHaveBeenCalled()
    tab.applyBounds(RECT, 3, true)
    expect(host.addChildView).toHaveBeenCalledTimes(2)
  })

  it('hands keyboard focus to the window when a page that held it is hidden, and only then (ADR 0011)', () => {
    tab.applyBounds(RECT, 1, true)
    tab.applyBounds(RECT, 2, false)
    expect(host.focus).not.toHaveBeenCalled()
    tab.applyBounds(RECT, 3, true)
    contents.focused = true
    tab.applyBounds(RECT, 4, false)
    expect(host.focus).toHaveBeenCalledOnce()
    tab.applyBounds(RECT, 5, true)
    host.destroy()
    tab.applyBounds(RECT, 6, false)
    expect(host.focus).toHaveBeenCalledOnce()
  })

  it('detaches when the rectangle clamps to nothing, and ignores pushes once the window is gone', () => {
    tab.applyBounds(RECT, 1, true)
    tab.applyBounds({ x: 5000, y: 0, width: 10, height: 10 }, 2, true)
    expect(tab.isAttached()).toBe(false)
    host.destroy()
    tab.applyBounds(RECT, 3, true)
    expect(host.addChildView).toHaveBeenCalledTimes(1)
  })

  it('answers what it did: shown, hidden, or null for a dropped push (the ack answer)', () => {
    expect(tab.applyBounds(RECT, 1, true)).toBe(true)
    expect(tab.applyBounds(RECT, 1, false)).toBeNull()
    expect(tab.applyBounds(RECT, 2, false)).toBe(false)
    expect(tab.applyBounds({ x: 5000, y: 0, width: 10, height: 10 }, 3, true)).toBe(false)
    host.destroy()
    expect(tab.applyBounds(RECT, 4, true)).toBeNull()
  })

  it('025-AC-061 reports a shown page whose top edge moved (a row above it appeared or went), and nothing else', () => {
    const onPageMoved = vi.fn()
    const moving = make({ onPageMoved })
    moving.applyBounds(RECT, 1, true)
    moving.applyBounds({ ...RECT, width: 280 }, 2, true)
    expect(onPageMoved).not.toHaveBeenCalled()
    moving.applyBounds({ ...RECT, y: 60, height: 160 }, 3, true)
    expect(onPageMoved).toHaveBeenCalledTimes(1)
    // Shown again after being hidden: a fresh placement, not a shift.
    moving.applyBounds(RECT, 4, false)
    moving.applyBounds(RECT, 5, true)
    expect(onPageMoved).toHaveBeenCalledTimes(1)
    // Without the hook a move is harmless.
    tab.applyBounds(RECT, 1, true)
    expect(() => tab.applyBounds({ ...RECT, y: 60 }, 2, true)).not.toThrow()
  })

  it('focuses the page only while it is shown', () => {
    tab.focusPage()
    expect(contents.focus).not.toHaveBeenCalled()
    tab.applyBounds(RECT, 1, true)
    tab.focusPage()
    expect(contents.focus).toHaveBeenCalledTimes(1)
  })
})

describe('DevTools (025-FR-013)', () => {
  it('expects the front end in the tab session, opens it detached, and withdraws the expectation once open', () => {
    tab.devTools()
    expect(deps.expectDevTools).toHaveBeenCalledWith(contents.session)
    expect(contents.openDevTools).toHaveBeenCalledWith({ mode: 'detach', activate: true })
    contents.emit('devtools-opened')
    expect(withdraw).toHaveBeenCalled()
    expect(tab.state().devToolsOpen).toBe(true)
  })

  it('closes DevTools on the second toggle', () => {
    tab.devTools()
    tab.devTools()
    expect(contents.closeDevTools).toHaveBeenCalled()
    contents.emit('devtools-closed')
    expect(tab.state().devToolsOpen).toBe(false)
  })

  it('inspects an element, opening DevTools first only when it is closed', () => {
    tab.devTools({ x: 10.4, y: 20.6 })
    expect(contents.openDevTools).toHaveBeenCalledTimes(1)
    expect(contents.inspectElement).toHaveBeenCalledWith(10, 21)
    tab.devTools({ x: 1, y: 2 })
    expect(contents.openDevTools).toHaveBeenCalledTimes(1)
    expect(contents.inspectElement).toHaveBeenCalledTimes(2)
  })

  it('closes DevTools with the tab', () => {
    tab.applyBounds({ x: 0, y: 0, width: 10, height: 10 }, 1, true)
    tab.devTools()
    tab.close()
    expect(contents.closeDevTools).toHaveBeenCalled()
    expect(contents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false })
    expect(host.removeChildView).toHaveBeenCalled()
    expect(withdraw).toHaveBeenCalled()
    tab.close()
    expect(contents.close).toHaveBeenCalledTimes(1)
  })
})

describe('destruction', () => {
  it('reports a page destroyed by someone else once, and sends no state after', () => {
    contents.destroy()
    expect(deps.onDestroyed).toHaveBeenCalledWith(tab)
    onStateChange.mockClear()
    contents.emit('did-start-loading')
    expect(onStateChange).not.toHaveBeenCalled()
    tab.close()
    expect(contents.close).not.toHaveBeenCalled()
  })
})

describe('certificate page and sign-in hooks (025-FR-021, 025-FR-022)', () => {
  const WARNING = { decisionId: 'd1', host: 'selfsigned.test', code: -202, shownAt: 5 }

  it('025-AC-021 shows the certificate page with its parts and the warning-up badge, then the page again', () => {
    onStateChange.mockClear()
    tab.setCertificateState({ warning: WARNING, sign: null })
    expect(onStateChange).toHaveBeenCalledTimes(1)
    const state = tab.state()
    expect(TabStateEventSchema.safeParse(state).success).toBe(true)
    expect(state).toMatchObject({ erfanaPage: 'certificate', security: 'warningUp', certificate: WARNING })
    tab.setCertificateState({ warning: null, sign: null })
    expect(tab.state().erfanaPage).toBe('empty')
    expect(tab.state()).not.toHaveProperty('certificate')
  })

  it('025-AC-021 names the failed address in the bar and the tab after its host while the warning is up', () => {
    contents.commit('https://a.test/x')
    contents.emit('page-title-updated', {}, 'Page A', true)
    tab.setCertificateState({ warning: WARNING, sign: null, failedUrl: 'https://selfsigned.test/login' })
    const state = tab.state()
    expect(TabStateEventSchema.safeParse(state).success).toBe(true)
    expect(state).toMatchObject({
      committedUrl: 'https://a.test/x',
      pendingUrl: 'https://selfsigned.test/login',
      title: '',
      origin: { kind: 'web', registrableDomain: 'selfsigned.test' },
      erfanaPage: 'certificate'
    })
    // Back to safety: the committed page, its title and its address return.
    tab.setCertificateState({ warning: null, sign: null })
    expect(tab.state()).toMatchObject({ committedUrl: 'https://a.test/x', pendingUrl: null, title: 'Page A', erfanaPage: null })
  })

  it('025-AC-021 shows the warning sign for a proceeded host or a failed subresource', () => {
    contents.commit('https://selfsigned.test/')
    tab.setCertificateState({ warning: null, sign: 'proceeded' })
    expect(tab.state()).toMatchObject({ security: 'proceeded', erfanaPage: null })
    tab.setCertificateState({ warning: null, sign: 'subresourceFailed' })
    expect(tab.state().security).toBe('subresourceFailed')
    tab.setCertificateState({ warning: null, sign: null })
    expect(tab.state().security).toBe('secure')
  })

  it('reports a pending user navigation, reloads after Proceed anyway and goes back for Back to safety', () => {
    expect(tab.hasPendingUserNavigation()).toBe(false)
    tab.reloadAt('https://selfsigned.test/page')
    expect(contents.loadURL).toHaveBeenCalledWith('https://selfsigned.test/page')
    expect(tab.hasPendingUserNavigation()).toBe(true)
    contents.commit('https://a.test/')
    contents.commit('https://b.test/')
    tab.goBack()
    expect(contents.navigationHistory.goBack).toHaveBeenCalledTimes(1)
  })
})

describe('user info (attacker pass F7, issue #448)', () => {
  it('never sends user info to the renderer, pending or committed, and still loads the full address', () => {
    expect(tab.navigate('https://accounts.example.com:pw@evil.test/login', 'address')).toEqual({ ok: true })
    expect(contents.loadURL).toHaveBeenCalledWith('https://accounts.example.com:pw@evil.test/login')
    expect(tab.state()).toMatchObject({ pendingUrl: 'https://evil.test/login', committedUrl: null })
    contents.commit('https://u@evil.test/login')
    const state = tab.state()
    expect(state.committedUrl).toBe('https://evil.test/login')
    expect(JSON.stringify(state)).not.toContain('@')
    expect(state.origin).toMatchObject({ kind: 'web', registrableDomain: 'evil.test' })
  })
})
