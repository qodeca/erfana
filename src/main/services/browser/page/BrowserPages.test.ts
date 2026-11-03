// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page features project-wide (025-FR-008, 025-FR-012, 025-FR-023,
 * 025-FR-063): zoom shared per site within a project, history from commits,
 * Clear for one project only, Forget, planted clearing faults and terminal
 * addresses.
 */
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock } from '../../../../shared/clock'
import { BrowserProfileError } from '../browserProfileGuards'
import { tempHome, tempProject, testSigner } from '../site/__test-helpers__/siteFakes'
import { BrowserPages, type BrowserPagesDeps } from './BrowserPages'
import { BrowserZoomStore } from './zoomStore'
import { fakeOutlet, fakePageTab, type FakePageTab } from './__test-helpers__/fakePageTab'

let projectA: string
let projectB: string
let home: string

beforeEach(() => {
  projectA = tempProject('erfana-pages-a-')
  projectB = tempProject('erfana-pages-b-')
  home = tempHome()
})

afterEach(() => {
  for (const dir of [projectA, projectB, home]) rmSync(dir, { recursive: true, force: true })
})

function fakeSession() {
  return {
    clearStorageData: vi.fn(async () => undefined),
    clearCache: vi.fn(async () => undefined),
    clearAuthCache: vi.fn(async () => undefined),
    closeAllConnections: vi.fn(async () => undefined)
  }
}

function setup(over: Partial<BrowserPagesDeps> = {}) {
  const session = fakeSession()
  const site = {
    clearCertificates: vi.fn(async () => undefined),
    clearCredentials: vi.fn(async () => undefined),
    clearPermissions: vi.fn(async () => undefined)
  }
  const deps: BrowserPagesDeps = {
    clock: createManualClock(0),
    signer: testSigner('k'),
    homeDir: home,
    site,
    openProfile: vi.fn(async () => ({ projectRoot: projectA, session })),
    deleteBrowserData: vi.fn(async () => 'deleted' as const),
    closeProject: vi.fn(),
    noticeToRenderer: vi.fn(),
    ...over
  }
  const pages = new BrowserPages(deps)
  const attach = (tab: FakePageTab) => {
    const outlet = fakeOutlet()
    return { tab, outlet, page: pages.attachTab(tab, outlet, null) }
  }
  return { pages, deps, session, site, attach }
}

/** Wait until `check` passes: the stores open and write on their own schedule. */
const until = (check: () => Promise<void> | void): Promise<void> => vi.waitFor(check, { timeout: 5000, interval: 10 })

describe('BrowserPages zoom', () => {
  it('025-AC-008 two tabs on the same site share the level; another site and another project do not', async () => {
    const { attach } = setup()
    const a1 = attach(fakePageTab(projectA, 'http://app.test/one'))
    const a2 = attach(fakePageTab(projectA, 'http://app.test:9999/two'))
    const other = attach(fakePageTab(projectA, 'http://other.test/'))
    const b = attach(fakePageTab(projectB, 'http://app.test/'))
    a1.page.zoom('in')
    expect(a1.tab.contents.zoom).toBe(1.1)
    expect(a2.tab.contents.zoom).toBe(1.1)
    expect(other.tab.contents.zoom).toBe(1)
    expect(b.tab.contents.zoom).toBe(1)
    a2.page.zoom('in')
    expect(a1.tab.contents.zoom).toBe(1.25)
    a1.page.zoom('reset')
    expect(a2.tab.contents.zoom).toBe(1)
  })

  it('025-AC-008 keeps the site level for the project, and applies it when a tab commits that site', async () => {
    const { attach } = setup()
    const a = attach(fakePageTab(projectA, 'http://app.test/'))
    a.page.zoom('in')
    a.page.zoom('in')
    await until(async () => expect((await BrowserZoomStore.open(projectA, home, testSigner('k'))).level('app.test')).toBe(125))
    const later = attach(fakePageTab(projectA, 'http://app.test/later'))
    later.tab.contents.emit('did-navigate', {}, 'http://app.test/later')
    await until(() => expect(later.tab.contents.zoom).toBe(1.25))
  })

  it('025-AC-008 Plus at 500% and Minus at 25% do nothing', () => {
    const { attach } = setup()
    const a = attach(fakePageTab(projectA, 'http://app.test/'))
    a.tab.contents.zoom = 5
    a.page.zoom('in')
    expect(a.tab.contents.zoom).toBe(5)
    a.tab.contents.zoom = 0.25
    a.page.zoom('out')
    expect(a.tab.contents.zoom).toBe(0.25)
  })

  it('zooms a page without a site (about:blank) on its own, and resets it to 100% on commit', () => {
    const { attach } = setup()
    const blank = attach(fakePageTab(projectA, 'about:blank'))
    blank.page.zoom('out')
    expect(blank.tab.contents.zoom).toBe(0.9)
    blank.tab.contents.emit('did-navigate', {}, 'about:blank')
    expect(blank.tab.contents.zoom).toBe(1)
  })

  it('025-AC-012 a width preset resets the site zoom to 100%', () => {
    const { attach } = setup()
    const a = attach(fakePageTab(projectA, 'http://app.test/'))
    a.page.zoom('in')
    a.page.zoom('in')
    a.page.widthPreset('tablet')
    expect(a.tab.contents.zoom).toBe(1)
    expect(a.tab.viewFrame.widthPreset).toBe('tablet')
  })
})

describe('BrowserPages history', () => {
  it('025-AC-078 records committed addresses, suggests them, and keeps them per project', async () => {
    const { pages, attach } = setup()
    const a = attach(fakePageTab(projectA, 'http://localhost:4100/'))
    a.tab.contents.emit('did-navigate', {}, 'http://localhost:4100/')
    a.tab.committedUrl = 'https://docs.test/guide'
    a.tab.contents.emit('did-navigate', {}, 'https://docs.test/guide')
    await until(async () => expect(await pages.suggest(projectA, true, '')).toEqual(['https://docs.test/guide', 'http://localhost:4100/']))
    expect(await pages.suggest(projectA, true, 'local')).toEqual(['http://localhost:4100/'])
    expect(await pages.suggest(projectB, true, '')).toEqual([])
  })

  it('matches the project case-insensitively on a case-insensitive volume', async () => {
    const { pages } = setup()
    const tab = fakePageTab(projectA)
    ;(tab as { caseSensitive: boolean }).caseSensitive = false
    pages.attachTab(tab, fakeOutlet(), null)
    tab.contents.emit('did-navigate', {}, 'http://app.test/')
    await until(async () => expect(await pages.suggest(projectA.toUpperCase(), false, '')).toEqual(['http://app.test/']))
  })
})

describe('BrowserPages clear and forget', () => {
  it('025-AC-023 Cookies and other site data clears the history and reloads only this project\'s tabs', async () => {
    const { pages, attach, session } = setup()
    const a = attach(fakePageTab(projectA, 'http://app.test/'))
    const b = attach(fakePageTab(projectB, 'http://app.test/'))
    a.tab.contents.emit('did-navigate', {}, 'http://app.test/')
    await until(async () => expect(await pages.suggest(projectA, true, '')).toEqual(['http://app.test/']))
    expect(await pages.clearData(new Set(['cookies']))).toEqual({ failed: [] })
    expect(session.clearStorageData).toHaveBeenCalled()
    expect(await pages.suggest(projectA, true, '')).toEqual([])
    expect(a.outlet.endPick).toHaveBeenCalled()
    expect(a.tab.history).toHaveBeenCalledWith('reload')
    expect(a.tab.contents.executeJavaScriptInIsolatedWorld).toHaveBeenCalled()
    expect(b.tab.history).not.toHaveBeenCalled()
    expect(b.outlet.endPick).not.toHaveBeenCalled()
  })

  it('025-AC-023 clears permissions, certificate exceptions, sign-ins and captures of this project only', async () => {
    const { pages, site, deps } = setup()
    await pages.clearData(new Set(['permissions', 'credentials', 'captures']))
    expect(site.clearPermissions).toHaveBeenCalledWith(projectA)
    expect(site.clearCertificates).toHaveBeenCalledWith(projectA)
    expect(site.clearCredentials).toHaveBeenCalledWith(projectA)
    expect(deps.deleteBrowserData).toHaveBeenCalledWith(['captures'])
  })

  it('025-AC-023 a planted timeout or failure is reported by kind and leaves the other kinds working', async () => {
    const { pages, session } = setup({ clearStepTimeoutMs: 20 })
    pages.clearFaults.set('cache', 'timeout')
    pages.clearFaults.set('captures', 'fail')
    const result = await pages.clearData(new Set(['cookies', 'cache', 'captures']))
    expect(result).toEqual({
      failed: [
        { category: 'cache', reason: 'timeout' },
        { category: 'captures', reason: 'failed' }
      ]
    })
    expect(session.clearStorageData).toHaveBeenCalled()
    expect(session.clearCache).not.toHaveBeenCalled()
    pages.clearFaults.clear()
    expect(await pages.clearData(new Set(['cache']))).toEqual({ failed: [] })
  })

  it('plants faults on every kind it names', async () => {
    const { pages } = setup({ clearStepTimeoutMs: 20 })
    for (const kind of ['cookies', 'permissions', 'credentials'] as const) pages.clearFaults.set(kind, 'fail')
    const result = await pages.clearData(new Set(['cookies', 'permissions', 'credentials']))
    expect(result).toEqual({ failed: ['cookies', 'permissions', 'credentials'].map((category) => ({ category, reason: 'failed' })) })
  })

  it('answers an error when the profile cannot be reached', async () => {
    const refused = new BrowserProfileError('no-project', '', 'No project is open')
    const { pages } = setup({ openProfile: vi.fn(async () => Promise.reject(refused)) })
    expect(await pages.clearData(new Set(['cache']))).toEqual({ error: 'No project is open' })
    expect(await pages.forget()).toEqual({ error: 'No project is open', path: null })
    const other = setup({ openProfile: vi.fn(async () => Promise.reject(new Error('x'))) })
    expect(await other.pages.clearData(new Set(['cache']))).toEqual({ error: 'The browser data could not be reached' })
  })

  it('025-AC-023 Forget closes the project\'s tabs, clears the session and the stores, then deletes the folder', async () => {
    const { pages, attach, deps, session } = setup()
    const a = attach(fakePageTab(projectA, 'http://app.test/'))
    a.page.zoom('in')
    a.tab.contents.emit('did-navigate', {}, 'http://app.test/')
    await until(async () => expect(await pages.suggest(projectA, true, '')).toEqual(['http://app.test/']))
    expect(await pages.forget()).toEqual({ deleted: 'deleted' })
    expect(deps.closeProject).toHaveBeenCalledWith(projectA)
    expect(session.clearStorageData).toHaveBeenCalledWith()
    expect(deps.deleteBrowserData).toHaveBeenCalledWith([])
    expect(await pages.suggest(projectA, true, '')).toEqual([])
  })

  it('025-AC-023 Forget passes a Windows deferral on, and names the path a failed delete could not remove', async () => {
    const deferred = setup({ deleteBrowserData: vi.fn(async () => 'pending' as const) })
    expect(await deferred.pages.forget()).toEqual({ deleted: 'pending' })
    const failing = setup({
      deleteBrowserData: vi.fn(async () => Promise.reject(new BrowserProfileError('delete-failed', '.erfana/browser', 'Deleting failed (EACCES)')))
    })
    expect(await failing.pages.forget()).toEqual({ error: 'Deleting failed (EACCES)', path: '.erfana/browser' })
    const unknown = setup({ deleteBrowserData: vi.fn(async () => Promise.reject(new Error('x'))) })
    expect(await unknown.pages.forget()).toEqual({ error: 'The browser folder could not be deleted', path: null })
  })
})

describe('BrowserPages terminal addresses', () => {
  it('025-AC-078 sends each new local address to the terminal\'s window, and starts over on a project change', () => {
    const { pages, deps } = setup()
    pages.terminalOutput(7, 't1', 'ready on http://localhost:5173/\n')
    pages.terminalOutput(7, 't1', 'http://localhost:5173/\n')
    expect(deps.noticeToRenderer).toHaveBeenCalledTimes(1)
    expect(deps.noticeToRenderer).toHaveBeenCalledWith(7, 'http://localhost:5173/')
    expect(pages.localAddresses()).toEqual(['http://localhost:5173/'])
    pages.terminalOutput(7, 't2', 'http://127.0.0.1:')
    pages.terminalGone('t2')
    pages.terminalOutput(7, 't2', '8000/\n')
    expect(pages.localAddresses()).toEqual(['http://localhost:5173/'])
    pages.projectChanged()
    expect(pages.localAddresses()).toEqual([])
  })

  it('forgets a detached tab', () => {
    const { pages, attach } = setup()
    const a = attach(fakePageTab(projectA, 'http://app.test/'))
    const b = attach(fakePageTab(projectA, 'http://app.test/'))
    pages.detachTab(b.page)
    a.page.zoom('in')
    expect(b.tab.contents.zoom).toBe(1)
  })
})
