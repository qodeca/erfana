// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Opening a local file in a browser tab (spec 025, 025-FR-005 rule 1,
 * 025-FR-010; ADR 0012 option 4): through the served folders, owned by the
 * window, refused for Erfana's own files, released when the tab closes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { BrowserTabService, type BrowserTabServiceDeps } from './BrowserTabService'
import type { LocalOpenResult } from './local/LocalFileServers'
import { fakeHost, fakeView, type FakeHost, type FakeView } from './__test-helpers__/fakeBrowserView'

const SERVED = 'http://127.0.0.1:41000/0123456789abcdef0123456789abcdef/index.html'

let views: FakeView[]
let host: FakeHost
let local: NonNullable<BrowserTabServiceDeps['local']> & {
  open: ReturnType<typeof vi.fn<(r: unknown) => Promise<LocalOpenResult>>>
  releaseTab: ReturnType<typeof vi.fn<(tabId: string) => void>>
}
let service: BrowserTabService

function make(withLocal = true): BrowserTabService {
  return new BrowserTabService({
    openProfile: vi.fn(async () => ({ projectRoot: '/p', session: {} })),
    currentProject: () => ({ realRoot: '/p', caseSensitive: true }),
    prepareSession: vi.fn(),
    createView: vi.fn((session) => {
      const v = fakeView(session)
      views.push(v)
      return v.view
    }),
    expectDevTools: vi.fn(() => () => undefined),
    appAddresses: () => ({ rendererEntry: 'file:///r/index.html', resourcesDir: '/r', devServerOrigin: null }),
    resolveDomain: (h) => h,
    ...(withLocal ? { local } : {})
  })
}

beforeEach(() => {
  views = []
  host = fakeHost()
  local = {
    open: vi.fn(async () => ({ ok: true, url: SERVED, displayUrl: 'file:///p/site/index.html' }) as LocalOpenResult),
    releaseTab: vi.fn<(tabId: string) => void>(),
    isLocalAddress: (url: string) => url === SERVED,
    arm: vi.fn(),
    displayAddress: (url: string) => (url === SERVED ? 'file:///p/site/index.html' : null),
    allowsRequest: () => true,
    setPendingLoad: vi.fn(),
    endPendingLoad: vi.fn()
  }
  service = make()
})

async function open(): Promise<string> {
  const response = await service.create(host.host, 'panel')
  if (!('tabId' in response)) throw new Error(response.error)
  return response.tabId
}

describe('openLocalFile', () => {
  it('serves the folder for the tab and loads the armed address', async () => {
    const tabId = await open()
    expect(await service.openLocalFile(host.host.id, tabId, '/p/site/index.html', 'previewOpen')).toEqual({ ok: true })
    expect(local.open).toHaveBeenCalledWith({ tabId, projectRoot: '/p', caseSensitive: true, filePath: '/p/site/index.html' })
    expect(local.arm).toHaveBeenCalledWith(SERVED)
    expect(views[0]!.contents.loadURL).toHaveBeenCalledWith(SERVED)
  })

  it('refuses another window\'s tab, a source that may not open files and a service without served folders', async () => {
    const tabId = await open()
    expect(await service.openLocalFile(host.host.id + 1, tabId, '/p/a.html', 'address')).toEqual({ error: 'Request refused' })
    expect(await service.openLocalFile(host.host.id, tabId, '/p/a.html', 'terminalLink')).toEqual({ refused: 'local-file' })
    expect(local.open).not.toHaveBeenCalled()
    service = make(false)
    const plain = await open()
    expect(await service.openLocalFile(host.host.id, plain, '/p/a.html', 'address')).toEqual({ refused: 'local-file' })
  })

  it('refuses Erfana\'s renderer entry before serving anything', async () => {
    const tabId = await open()
    expect(await service.openLocalFile(host.host.id, tabId, '/r/index.html', 'address')).toEqual({ refused: 'app-entry' })
    expect(local.open).not.toHaveBeenCalled()
  })

  it('passes a refusal of the served folders through', async () => {
    const tabId = await open()
    local.open.mockResolvedValueOnce({ ok: false, reason: 'local-file' })
    expect(await service.openLocalFile(host.host.id, tabId, '/p/.erfana/x.html', 'history')).toEqual({ refused: 'local-file' })
    expect(views[0]!.contents.loadURL).not.toHaveBeenCalled()
  })

  it('releases the folder and loads nothing when the tab closed while it was served', async () => {
    const tabId = await open()
    local.open.mockImplementationOnce(async () => {
      service.close(host.host.id, tabId)
      return { ok: true, url: SERVED, displayUrl: 'file:///p/site/index.html' }
    })
    expect(await service.openLocalFile(host.host.id, tabId, '/p/site/index.html', 'address')).toEqual({ error: 'The tab closed' })
    expect(local.releaseTab).toHaveBeenLastCalledWith(tabId)
    expect(views[0]!.contents.loadURL).not.toHaveBeenCalled()
  })

  it('answers an error, never a rejection, when serving throws', async () => {
    const tabId = await open()
    local.open.mockRejectedValueOnce(new Error('/secret/path'))
    expect(await service.openLocalFile(host.host.id, tabId, '/p/site/index.html', 'address')).toEqual({ error: 'The file could not be opened' })
  })

  it('releases every folder a tab held when it closes, and shows its file:// address', async () => {
    const tabId = await open()
    await service.openLocalFile(host.host.id, tabId, '/p/site/index.html', 'address')
    views[0]!.contents.commit(SERVED)
    expect(service.tabOf(host.host.id, tabId)!.state().committedUrl).toBe('file:///p/site/index.html')
    service.close(host.host.id, tabId)
    expect(local.releaseTab).toHaveBeenCalledWith(tabId)
  })
})
