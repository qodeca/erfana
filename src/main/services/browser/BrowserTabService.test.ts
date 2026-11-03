// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Browser tabs per window (spec 025, 025-FR-001, 006, 007, 015; § 3.1, S2, A10).
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { BROWSER_TAB_EVENTS } from '../../../shared/ipc/browser-tab-channels'
import { BrowserTabIdSchema } from '../../../shared/ipc/browser-tab-schema'
import { BrowserProfileError } from './browserProfileGuards'
import { BrowserTabService, type BrowserTabServiceDeps } from './BrowserTabService'
import { fakeHost, fakeView, type FakeHost, type FakeView } from './__test-helpers__/fakeBrowserView'
import { EventEmitter } from 'node:events'
import { keyDown } from './input/__test-helpers__/fakeInputContents'
import type { TabInputSetup } from './BrowserTabService'
import type { TabHost } from './BrowserTab'

const SESSION = { name: 'browser' }
let views: FakeView[]
let project: { realRoot: string; caseSensitive: boolean } | null
let deps: BrowserTabServiceDeps
let service: BrowserTabService
let a: FakeHost
let b: FakeHost

function make(overrides: Partial<BrowserTabServiceDeps> = {}): BrowserTabService {
  deps = {
    openProfile: vi.fn(async () => ({ projectRoot: '/p', session: SESSION })),
    currentProject: () => project,
    prepareSession: vi.fn(),
    createView: vi.fn((session) => {
      const v = fakeView(session)
      views.push(v)
      return v.view
    }),
    expectDevTools: vi.fn(() => () => undefined),
    appAddresses: () => ({ rendererEntry: 'file:///r/index.html', resourcesDir: '/r', devServerOrigin: null }),
    resolveDomain: (h) => h,
    ...overrides
  }
  return new BrowserTabService(deps)
}

beforeEach(() => {
  views = []
  project = { realRoot: '/p', caseSensitive: true }
  a = fakeHost()
  b = fakeHost()
  service = make()
})

async function open(host = a): Promise<string> {
  const response = await service.create(host.host, 'panel')
  if (!('tabId' in response)) throw new Error(response.error)
  return response.tabId
}

describe('create', () => {
  it('opens the profile, prepares the session, builds the view, and mints valid unique ids', async () => {
    const first = await open()
    const second = await open()
    expect(BrowserTabIdSchema.safeParse(first).success).toBe(true)
    expect(first).not.toBe(second)
    expect(deps.prepareSession).toHaveBeenCalledWith(SESSION)
    expect(deps.createView).toHaveBeenCalledWith(SESSION)
    expect(service.list().map((t) => t.id)).toEqual([first, second])
    expect(service.list()[0]).toMatchObject({ panelId: 'panel', windowId: a.host.id, projectRoot: '/p' })
  })

  it('answers with the profile error message and builds no view', async () => {
    service = make({
      openProfile: vi.fn(async () => {
        throw new BrowserProfileError('locked-elsewhere', '', 'Another Erfana window has this project open')
      })
    })
    expect(await service.create(a.host, 'panel')).toEqual({ error: 'Another Erfana window has this project open' })
    expect(deps.createView).not.toHaveBeenCalled()
  })

  it('025-AC-069 names the refused folder in the error the toast shows', async () => {
    service = make({
      openProfile: vi.fn(async () => {
        throw new BrowserProfileError('link', '.erfana/browser/captures', 'A symlink or junction is not allowed here')
      })
    })
    expect(await service.create(a.host, 'panel')).toEqual({
      error: '.erfana/browser/captures: A symlink or junction is not allowed here'
    })
    expect(deps.createView).not.toHaveBeenCalled()
  })

  it('hides an unexpected error behind a generic message', async () => {
    service = make({ openProfile: vi.fn(async () => Promise.reject(new Error('/secret/path'))) })
    expect(await service.create(a.host, 'panel')).toEqual({ error: 'The browser could not start for this project' })
  })

  it('refuses when the window closed or the project changed while the profile opened', async () => {
    a.destroy()
    expect(await service.create(a.host, 'panel')).toEqual({ error: 'The window closed' })
    project = { realRoot: '/q', caseSensitive: true }
    expect(await service.create(b.host, 'panel')).toEqual({ error: 'The project changed while the browser was starting' })
    project = null
    expect(await service.create(b.host, 'panel')).toMatchObject({ error: expect.any(String) })
    expect(deps.createView).not.toHaveBeenCalled()
  })
})

describe('ownership', () => {
  it('gives a tab only to the window that created it', async () => {
    const id = await open(a)
    expect(service.tabOf(a.host.id, id)?.id).toBe(id)
    expect(service.tabOf(b.host.id, id)).toBeNull()
    expect(service.tabOf(a.host.id, 'browser-tab-999')).toBeNull()
    service.close(b.host.id, id)
    expect(views[0].contents.close).not.toHaveBeenCalled()
    service.close(a.host.id, id)
    expect(views[0].contents.close).toHaveBeenCalled()
    expect(service.list()).toEqual([])
  })

  it('sends the empty tab\'s first state on create', async () => {
    const id = await open(a)
    expect(a.send).toHaveBeenCalledWith(
      BROWSER_TAB_EVENTS.state,
      expect.objectContaining({ tabId: id, committedUrl: null, canGoBack: false, canGoForward: false, erfanaPage: 'empty' })
    )
  })

  it('sends state only to the owning window, checked against the schema', async () => {
    await open(a)
    views[0].contents.commit('https://a.test/')
    expect(a.send).toHaveBeenCalledWith(BROWSER_TAB_EVENTS.state, expect.objectContaining({ committedUrl: 'https://a.test/' }))
    expect(b.send).not.toHaveBeenCalled()
  })

  it('sends nothing to a closed window', async () => {
    await open(a)
    a.destroy()
    a.send.mockClear()
    views[0].contents.commit('https://a.test/')
    expect(a.send).not.toHaveBeenCalled()
  })
})

describe('teardown', () => {
  it('closes a closing window\'s tabs only', async () => {
    await open(a)
    await open(b)
    service.closeWindow(a.host.id)
    expect(views[0].contents.close).toHaveBeenCalled()
    expect(views[1].contents.close).not.toHaveBeenCalled()
    expect(service.list()).toHaveLength(1)
  })

  it('closes the old project\'s tabs on a project change and keeps nothing to restore (025-FR-006)', async () => {
    await open(a)
    service = make({ openProfile: vi.fn(async () => ({ projectRoot: '/q', session: SESSION })) })
    project = { realRoot: '/q', caseSensitive: true }
    const other = await open(a)
    service.closeProject('/p')
    expect(service.list().map((t) => t.id)).toEqual([other])
    service.closeProject('/q')
    expect(service.list()).toEqual([])
  })

  it('forgets a tab whose page was destroyed elsewhere, and survives a close that throws', async () => {
    const id = await open(a)
    views[0].contents.destroy()
    expect(service.tabOf(a.host.id, id)).toBeNull()
    await open(a)
    views[1].contents.close.mockImplementation(() => {
      throw new Error('gone')
    })
    expect(() => service.closeWindow(a.host.id)).not.toThrow()
    expect(service.list()).toEqual([])
  })
})

describe('createFromPage (S2)', () => {
  it('creates the tab in main, in the opener\'s window and session, under the page source, and announces it', async () => {
    const opener = await open(a)
    const id = service.createFromPage(opener, 'https://b.test/', true)
    expect(id).not.toBeNull()
    expect(views[1].contents.loadURL).toHaveBeenCalledWith('https://b.test/')
    expect(service.tabOf(a.host.id, id!)?.state().pendingUrl).toBeNull()
    expect(service.tabOf(a.host.id, id!)?.panelId).toBeNull()
    expect(a.send).toHaveBeenCalledWith(BROWSER_TAB_EVENTS.tabAdded, { tabId: id, openerTabId: opener, background: true })
  })

  it('refuses a refused address (and closes the tab it made), an unknown opener and a closed window', async () => {
    const opener = await open(a)
    expect(service.createFromPage(opener, 'file:///etc/passwd', false)).toBeNull()
    expect(views[1].contents.close).toHaveBeenCalled()
    expect(service.createFromPage('browser-tab-999', 'https://b.test/', false)).toBeNull()
    a.destroy()
    expect(service.createFromPage(opener, 'https://b.test/', false)).toBeNull()
    views[0].contents.destroy()
    expect(service.createFromPage(opener, 'https://b.test/', false)).toBeNull()
  })
})

describe('site requests (025-FR-019, 025-FR-020)', () => {
  function withSite() {
    const link = { answerStrip: vi.fn(() => 'accepted' as const), answerCertificate: vi.fn(() => 'accepted' as const), detach: vi.fn() }
    const site = { attachTab: vi.fn(() => link), showDownload: vi.fn(() => true) }
    service = make({ site })
    return { site, link }
  }

  it('attaches each tab before its first load and sends its strip and notices to the owning window only', async () => {
    const { site } = withSite()
    const tabId = await open()
    expect(site.attachTab).toHaveBeenCalledTimes(1)
    const [tab, outlet] = site.attachTab.mock.calls[0] as unknown as [{ id: string }, {
      strip(e: unknown): void
      notice(e: unknown): void
      parentWindow(): unknown
    }]
    expect(tab.id).toBe(tabId)
    expect(views[0].contents.loadURL).not.toHaveBeenCalled()
    a.send.mockClear()
    outlet.strip({ tabId, op: 'withdraw', requestId: 'r1' })
    outlet.notice({ tabId: null, kind: 'downloadDone', text: 'Downloaded a.pdf' })
    outlet.strip({ tabId, op: 'nonsense' })
    expect(a.send.mock.calls).toEqual([
      [BROWSER_TAB_EVENTS.strip, { tabId, op: 'withdraw', requestId: 'r1' }],
      [BROWSER_TAB_EVENTS.notice, { tabId: null, kind: 'downloadDone', text: 'Downloaded a.pdf' }]
    ])
    expect(b.send).not.toHaveBeenCalled()
    expect(outlet.parentWindow()).toBe(a.host)
    a.destroy()
    expect(outlet.parentWindow()).toBeNull()
  })

  it('takes strip answers only from the window that owns the tab', async () => {
    const { link } = withSite()
    const tabId = await open()
    expect(service.answerStrip(b.host.id, tabId, 'r1', 'allow')).toBeNull()
    expect(link.answerStrip).not.toHaveBeenCalled()
    expect(service.answerStrip(a.host.id, tabId, 'r1', 'allow')).toBe('accepted')
    expect(link.answerStrip).toHaveBeenCalledWith('r1', 'allow', undefined)
    const fields = { username: 'u', password: 'p', remember: true }
    service.answerStrip(a.host.id, tabId, 'r2', 'signIn', fields)
    expect(link.answerStrip).toHaveBeenLastCalledWith('r2', 'signIn', fields)
  })

  it('025-AC-021 takes certificate decisions only from the window that owns the tab', async () => {
    const { link } = withSite()
    const tabId = await open()
    expect(service.answerCertificate(b.host.id, tabId, 'd1', true)).toBeNull()
    expect(link.answerCertificate).not.toHaveBeenCalled()
    expect(service.answerCertificate(a.host.id, tabId, 'd1', true)).toBe('accepted')
    expect(link.answerCertificate).toHaveBeenCalledWith('d1', true)
  })

  it('answers unknown for a certificate decision when no site is wired', async () => {
    const tabId = await open()
    expect(service.answerCertificate(a.host.id, tabId, 'd1', false)).toBe('unknown')
  })

  it('detaches a tab from the site when it closes', async () => {
    const { link } = withSite()
    const tabId = await open()
    service.close(a.host.id, tabId)
    expect(link.detach).toHaveBeenCalledTimes(1)
  })

  it('passes Show in folder to the site with the sender window', () => {
    const { site } = withSite()
    expect(service.showDownload(a.host.id, 'dl1')).toBe(true)
    expect(site.showDownload).toHaveBeenCalledWith(a.host.id, 'dl1')
  })

  it('works without a site: answers are unknown and Show in folder does nothing', async () => {
    const tabId = await open()
    expect(service.answerStrip(a.host.id, tabId, 'r1', 'allow')).toBe('unknown')
    expect(service.showDownload(a.host.id, 'dl1')).toBe(false)
  })
})

describe('input routing (025-FR-014, 025-FR-047 to 025-FR-052)', () => {
  /** A fired key, as `before-input-event` delivers it; returns whether it was prevented. */
  function fire(target: EventEmitter, input: ReturnType<typeof keyDown>): boolean {
    let prevented = false
    target.emit('before-input-event', { preventDefault: () => (prevented = true) }, input)
    return prevented
  }

  let windowContents: EventEmitter
  let macAppKeys: Mock<TabInputSetup['macAppKeys']>

  beforeEach(() => {
    windowContents = Object.assign(new EventEmitter(), { send: a.send, isDestroyed: () => false })
    ;(a.host as { webContents: unknown }).webContents = Object.assign(windowContents, {
      getZoomFactor: () => 1
    })
    macAppKeys = vi.fn((_host: TabHost) => ({ quit: vi.fn(), hide: vi.fn(), hideOthers: vi.fn(), minimize: vi.fn() }))
    const input: TabInputSetup = { platform: 'darwin', clock: { now: () => 0 }, macAppKeys }
    service = make({
      input,
      createView: vi.fn((session) => {
        const v = fakeView(session)
        Object.assign(v.contents, {
          isFocused: () => false,
          setIgnoreMenuShortcuts: vi.fn(),
          executeJavaScriptInIsolatedWorld: vi.fn(async () => undefined)
        })
        views.push(v)
        return v.view
      })
    })
  })

  it('025-AC-014 gives each tab its routers before the first load and sends forwarded keys and page focus to the owning window only', async () => {
    const tabId = await open()
    const contents = views[0]!.contents
    expect(macAppKeys).toHaveBeenCalledWith(a.host)
    expect(service.inputFor(service.list()[0]!)).not.toBeNull()
    contents.emit('focus')
    expect(fire(contents, keyDown('l', ['meta']))).toBe(true)
    expect(a.send).toHaveBeenCalledWith(BROWSER_TAB_EVENTS.focus, { tabId, pageFocused: true })
    expect(a.send).toHaveBeenCalledWith(BROWSER_TAB_EVENTS.forwardedKey, { tabId, action: 'focusAddress' })
    contents.emit('did-navigate', {}, 'https://a.test/')
    fire(contents, keyDown('e', ['meta']))
    expect(a.send).toHaveBeenCalledWith(BROWSER_TAB_EVENTS.pick, { tabId, kind: 'mode', on: true })
    expect(b.send).not.toHaveBeenCalled()
  })

  it('025-AC-065 points the window\'s browser keys at the tab whose toolbar has focus, for its own window only', async () => {
    const tabId = await open()
    expect(fire(windowContents, keyDown('r', ['meta']))).toBe(false)
    service.toolbarFocus(b.host.id, tabId, true)
    expect(fire(windowContents, keyDown('r', ['meta']))).toBe(false)
    service.toolbarFocus(a.host.id, tabId, true)
    expect(fire(windowContents, keyDown('r', ['meta']))).toBe(true)
    expect(a.send).toHaveBeenCalledWith(BROWSER_TAB_EVENTS.forwardedKey, { tabId, action: 'reload' })
    service.toolbarFocus(a.host.id, tabId, false)
    expect(fire(windowContents, keyDown('t', ['meta']))).toBe(false)
    expect(service.inputFor(service.list()[0]!)!.state().focus).toBe('out')
  })

  it('025-AC-062 passes where focus came from to the tab\'s input', async () => {
    const tabId = await open()
    const contents = views[0]!.contents
    contents.emit('did-navigate', {}, 'https://a.test/')
    contents.emit('focus')
    fire(contents, keyDown('e', ['meta']))
    contents.emit('blur')
    service.focusOrigin(b.host.id, tabId, 'outside')
    service.focusOrigin(a.host.id, tabId, 'toolbar')
    contents.emit('focus')
    expect(service.inputFor(service.list()[0]!)!.state().firstClickOnlyFocuses).toBe(false)
  })

  it('records a row shift for the click guard when the shown page moves', async () => {
    await open()
    const tab = service.list()[0]!
    const contents = views[0]!.contents
    contents.emit('before-mouse-event', { preventDefault: vi.fn() }, { type: 'mouseMove' })
    tab.applyBounds({ x: 0, y: 40, width: 400, height: 300 }, 1, true)
    tab.applyBounds({ x: 0, y: 80, width: 400, height: 260 }, 2, true)
    expect(service.inputFor(tab)!.state().clickGuardUntil).toBeGreaterThan(0)
  })

  it('removes the routers when a tab closes and the window listener when its window closes', async () => {
    const tabId = await open()
    const contents = views[0]!.contents
    service.toolbarFocus(a.host.id, tabId, true)
    service.close(a.host.id, tabId)
    expect(contents.listenerCount('before-input-event')).toBe(0)
    expect(fire(windowContents, keyDown('r', ['meta']))).toBe(false)
    service.toolbarFocus(a.host.id, tabId, true)
    service.closeWindow(a.host.id)
    expect(windowContents.listenerCount('before-input-event')).toBe(0)
  })

  it('opens a tab without a window listener when the window is already going', async () => {
    windowContents = Object.assign(windowContents, { isDestroyed: () => true })
    await open()
    expect(windowContents.listenerCount('before-input-event')).toBe(0)
  })

  it('has no routers without the input setup', async () => {
    service = make()
    await open()
    expect(service.inputFor(service.list()[0]!)).toBeNull()
    expect(() => service.toolbarFocus(a.host.id, service.list()[0]!.id, true)).not.toThrow()
  })
})
