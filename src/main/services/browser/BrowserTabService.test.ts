// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Browser tabs per window (spec 025, 025-FR-001, 006, 007, 015; § 3.1, S2, A10).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { BROWSER_TAB_EVENTS } from '../../../shared/ipc/browser-tab-channels'
import { BrowserTabIdSchema } from '../../../shared/ipc/browser-tab-schema'
import { BrowserProfileError } from './browserProfileGuards'
import { BrowserTabService, type BrowserTabServiceDeps } from './BrowserTabService'
import { fakeHost, fakeView, type FakeHost, type FakeView } from './__test-helpers__/fakeBrowserView'

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
