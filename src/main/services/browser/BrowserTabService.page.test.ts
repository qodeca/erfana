// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The tab service's wiring of the page features (commit 12h; 025-FR-008,
 * 025-FR-012, 025-FR-056, 025-FR-059): each tab's page side attached with the
 * CDP hang source, its events going to the owning window only, its facts in
 * the state, hung-notice answers routed first, zoom keys reaching it, and the
 * clipping parent used for the page view.
 */
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { BROWSER_TAB_EVENTS } from '../../../shared/ipc/browser-tab-channels'
import { NO_PAGE_FACTS, type PageFacts } from './page/tabPageState'
import type { PageHangSource, TabPageOutlet } from './page/BrowserTabPage'
import { BrowserTabService, type BrowserTabServiceDeps, type TabCdpLink, type TabInputSetup } from './BrowserTabService'
import { fakeHost, fakeView, type FakeHost, type FakeView } from './__test-helpers__/fakeBrowserView'
import { keyDown } from './input/__test-helpers__/fakeInputContents'

const SESSION = { name: 'browser' }

interface FakePage {
  facts: () => PageFacts
  zoom: ReturnType<typeof vi.fn>
  answerStrip: ReturnType<typeof vi.fn>
  outlet: TabPageOutlet
  hang: PageHangSource | null
}

let views: FakeView[]
let host: FakeHost
let other: FakeHost
let attached: FakePage[]
let facts: PageFacts
let site: { attachTab: ReturnType<typeof vi.fn>; showDownload: ReturnType<typeof vi.fn>; answer: ReturnType<typeof vi.fn> }
let pages: { attachTab: ReturnType<typeof vi.fn>; detachTab: ReturnType<typeof vi.fn> }

function make(overrides: Partial<BrowserTabServiceDeps> = {}): BrowserTabService {
  return new BrowserTabService({
    openProfile: vi.fn(async () => ({ projectRoot: '/p', session: SESSION })),
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
    mediaInUse: () => ({ camera: false, microphone: false, screen: false }),
    site: site as never,
    pages: pages as never,
    ...overrides
  })
}

beforeEach(() => {
  views = []
  attached = []
  facts = NO_PAGE_FACTS
  host = fakeHost()
  other = fakeHost()
  site = {
    answer: vi.fn(() => 'accepted'),
    attachTab: vi.fn(() => ({ answerStrip: site.answer, answerCertificate: vi.fn(), holdRequests: vi.fn(), detach: vi.fn() })),
    showDownload: vi.fn()
  }
  pages = {
    attachTab: vi.fn((_tab, outlet: TabPageOutlet, hang: PageHangSource | null) => {
      const page: FakePage = { facts: () => facts, zoom: vi.fn(), answerStrip: vi.fn(() => null), outlet, hang }
      attached.push(page)
      return page
    }),
    detachTab: vi.fn()
  }
})

async function open(service: BrowserTabService, on = host): Promise<string> {
  const response = await service.create(on.host, 'panel')
  if (!('tabId' in response)) throw new Error(response.error)
  return response.tabId
}

describe('BrowserTabService page features', () => {
  it('attaches each tab\'s page side and sends its strip rows and find results to the owning window only', async () => {
    const service = make()
    const tabId = await open(service)
    expect(attached).toHaveLength(1)
    attached[0]!.outlet.findResult({ tabId, active: 1, total: 3 })
    expect(host.send).toHaveBeenCalledWith(BROWSER_TAB_EVENTS.findResult, { tabId, active: 1, total: 3 })
    attached[0]!.outlet.strip({ tabId, op: 'withdraw', requestId: 'r1' })
    expect(host.send).toHaveBeenCalledWith(BROWSER_TAB_EVENTS.strip, { tabId, op: 'withdraw', requestId: 'r1' })
    expect(other.send).not.toHaveBeenCalled()
    expect(service.pageFor(host.host.id, tabId)).toBe(attached[0])
    expect(service.pageFor(other.host.id, tabId)).toBeNull()
  })

  it('025-AC-076 puts the page facts into the state the window gets', async () => {
    const service = make()
    const tabId = await open(service)
    facts = { failedUrl: 'http://localhost:4100/', loadError: { code: -102, focus: 'reload' }, crashed: false, zoomPercent: 110 }
    attached[0]!.outlet.stateChanged()
    expect(host.send).toHaveBeenLastCalledWith(
      BROWSER_TAB_EVENTS.state,
      expect.objectContaining({ tabId, erfanaPage: 'loadError', committedUrl: 'http://localhost:4100/', zoomPercent: 110 })
    )
    expect(service.stateOf(service.list()[0]!).loadError).toEqual({ code: -102, focus: 'reload' })
  })

  it('025-AC-072 routes an answer to the hung notice first, and to the site when it is not the notice', async () => {
    const service = make()
    const tabId = await open(service)
    attached[0]!.answerStrip.mockReturnValueOnce('accepted')
    expect(service.answerStrip(host.host.id, tabId, 'hung', 'wait')).toBe('accepted')
    expect(site.answer).not.toHaveBeenCalled()
    expect(service.answerStrip(host.host.id, tabId, 'perm', 'allow')).toBe('accepted')
    expect(site.answer).toHaveBeenCalledWith('perm', 'allow', undefined)
  })

  it('hands the CDP session\'s hang events to the page side, and none without them', async () => {
    const onHang = vi.fn(() => () => undefined)
    const waitHang = vi.fn()
    const link: TabCdpLink = { setVisible: vi.fn(), detach: vi.fn(), onHang, waitHang }
    await open(make({ attachCdp: () => link }))
    attached[0]!.hang!.waitHang()
    expect(waitHang).toHaveBeenCalled()
    await open(make({ attachCdp: () => ({ setVisible: vi.fn(), detach: vi.fn() }) }))
    expect(attached[1]!.hang).toBeNull()
    await open(make())
    expect(attached[2]!.hang).toBeNull()
  })

  it('detaches the page side when the tab closes', async () => {
    const service = make()
    const tabId = await open(service)
    service.close(host.host.id, tabId)
    expect(pages.detachTab).toHaveBeenCalledWith(attached[0])
    expect(service.pageFor(host.host.id, tabId)).toBeNull()
  })

  it('ADR 0011 decision 6 puts the page view in its clipping parent', async () => {
    const clip = { setBounds: vi.fn(), addChildView: vi.fn() }
    const service = make({ createClip: () => clip })
    const tabId = await open(service)
    expect(clip.addChildView).toHaveBeenCalledWith(views[0]!.view)
    const area = { x: 10, y: 20, width: 300, height: 200 }
    service.tabOf(host.host.id, tabId)!.applyBounds(area, 1, true, area)
    expect(host.addChildView).toHaveBeenCalledWith(clip)
    expect(clip.setBounds).toHaveBeenCalledWith(area)
  })

  it('025-AC-008 a zoom key from the page reaches the page side; crash and hang end pick mode silently', async () => {
    const windowContents = Object.assign(new EventEmitter(), { send: host.send, isDestroyed: () => false, getZoomFactor: () => 1 })
    ;(host.host as { webContents: unknown }).webContents = windowContents
    const input: TabInputSetup = {
      platform: 'darwin',
      clock: { now: () => 0 },
      macAppKeys: () => ({ quit: vi.fn(), hide: vi.fn(), hideOthers: vi.fn(), minimize: vi.fn() })
    }
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
    const contents = views[0]!.contents
    contents.emit('focus')
    contents.emit('before-input-event', { preventDefault: vi.fn() }, keyDown('=', ['meta']))
    expect(attached[0]!.zoom).toHaveBeenCalledWith('in')
    contents.emit('did-navigate', {}, 'https://a.test/')
    contents.emit('before-input-event', { preventDefault: vi.fn() }, keyDown('e', ['meta']))
    expect(host.send).toHaveBeenCalledWith(BROWSER_TAB_EVENTS.pick, { tabId, kind: 'mode', on: true })
    attached[0]!.outlet.endPick()
    expect(host.send).toHaveBeenLastCalledWith(BROWSER_TAB_EVENTS.pick, { tabId, kind: 'mode', on: false })
  })
})
