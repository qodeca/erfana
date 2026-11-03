// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The tab service's commit 18 parts: `tabClosed` goes to the owning window
 * once, whichever way a tab goes; the user's close and Erfana's close
 * (`byUser: false`) differ only in the leave-page prompt; and the keyring
 * notices of the first tab (025-FR-018) are strip rows answered here.
 */
import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock } from '../../../shared/clock'
import { BROWSER_TAB_EVENTS } from '../../../shared/ipc/browser-tab-channels'
import { BrowserTabService, type BrowserTabServiceDeps } from './BrowserTabService'
import { fakeHost, fakeView, type FakeHost, type FakeView } from './__test-helpers__/fakeBrowserView'
import { KEYRING_RESET_TEXT } from './site/keyringStrip'
import { LEAVE_CLOSE_TIMEOUT_MS } from './dialogs/leavePage'

const SESSION = { name: 'browser' }
let views: FakeView[]
let host: FakeHost
let other: FakeHost

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
    mediaInUse: () => ({ camera: false, microphone: false, screen: false }),
    extras: {
      clock: createManualClock(0),
      resolveDomain: (h) => h,
      menuActions: { openInSystemBrowser: vi.fn(), writeClipboardText: vi.fn() },
      newRowId: () => 'row'
    },
    ...overrides
  })
}

beforeEach(() => {
  views = []
  host = fakeHost()
  other = fakeHost()
})

async function open(service: BrowserTabService): Promise<string> {
  const response = await service.create(host.host, 'panel')
  if (!('tabId' in response)) throw new Error(response.error)
  return response.tabId
}

const closedEvents = (): unknown[] => host.send.mock.calls.filter(([channel]) => channel === BROWSER_TAB_EVENTS.tabClosed)

describe('BrowserTabService tabClosed', () => {
  it('a user close answers true and sends tabClosed once the page is gone', async () => {
    const service = make()
    const tabId = await open(service)
    expect(service.close(other.host.id, tabId)).toBe(false)
    expect(service.close(host.host.id, tabId)).toBe(true)
    expect(views[0]!.contents.close).toHaveBeenCalledWith({ waitForBeforeUnload: true })
    expect(closedEvents()).toEqual([[BROWSER_TAB_EVENTS.tabClosed, { tabId }]])
    // A second destroyed signal sends nothing more.
    views[0]!.contents.destroy()
    expect(closedEvents()).toHaveLength(1)
    expect(service.close(host.host.id, tabId)).toBe(false)
  })

  it('a leave-page prompt keeps the tab: no tabClosed until Leave', async () => {
    const service = make()
    const tabId = await open(service)
    views[0]!.contents.close.mockImplementationOnce(() => undefined)
    service.close(host.host.id, tabId)
    views[0]!.contents.emit('will-prevent-unload', { preventDefault: vi.fn() })
    expect(closedEvents()).toHaveLength(0)
    expect(service.list()).toHaveLength(1)
  })

  it('a page that neither closes nor asks within the close timeout is closed anyway', async () => {
    const clock = createManualClock(0)
    const service = make({
      extras: { clock, resolveDomain: (h) => h, menuActions: { openInSystemBrowser: vi.fn(), writeClipboardText: vi.fn() }, newRowId: () => 'row' }
    })
    const tabId = await open(service)
    views[0]!.contents.close.mockImplementationOnce(() => undefined)
    service.close(host.host.id, tabId)
    expect(closedEvents()).toHaveLength(0)
    clock.advance(LEAVE_CLOSE_TIMEOUT_MS)
    expect(closedEvents()).toEqual([[BROWSER_TAB_EVENTS.tabClosed, { tabId }]])
    expect(service.list()).toHaveLength(0)
  })

  it('byUser false closes without asking (S-31)', async () => {
    const service = make()
    const tabId = await open(service)
    expect(service.close(host.host.id, tabId, false)).toBe(true)
    expect(views[0]!.contents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false })
    expect(closedEvents()).toEqual([[BROWSER_TAB_EVENTS.tabClosed, { tabId }]])
  })

  it('a project teardown and a crashed-away page send tabClosed too', async () => {
    const service = make()
    const first = await open(service)
    const second = await open(service)
    service.closeProject('/p')
    expect(closedEvents()).toEqual([
      [BROWSER_TAB_EVENTS.tabClosed, { tabId: first }],
      [BROWSER_TAB_EVENTS.tabClosed, { tabId: second }]
    ])
  })
})

describe('BrowserTabService keyring notices (025-FR-018)', () => {
  it('shows the first tab\'s notices as strip rows and routes their answers', async () => {
    const clock = createManualClock(0)
    const take = vi.fn(async () => ({ weakProtection: true, keyringReset: true }))
    const dismissWeak = vi.fn(async () => undefined)
    const service = make({ keyring: { clock, take, dismissWeak, newId: () => 'kr' } })
    const tabId = await open(service)
    await vi.waitFor(() =>
      expect(host.send).toHaveBeenCalledWith(BROWSER_TAB_EVENTS.strip, expect.objectContaining({ op: 'add', row: expect.objectContaining({ kind: 'keyring', text: KEYRING_RESET_TEXT }) }))
    )
    clock.advance(500)
    expect(service.answerStrip(host.host.id, tabId, 'kr', 'dismiss')).toBe('accepted')
    // The weak-protection notice takes the row; its Dismiss is recorded.
    clock.advance(500)
    expect(service.answerStrip(host.host.id, tabId, 'kr', 'dismiss')).toBe('accepted')
    expect(dismissWeak).toHaveBeenCalledTimes(1)
  })

  it('a closed tab drops its notices', async () => {
    const service = make({ keyring: { clock: createManualClock(0), take: async () => ({ weakProtection: true, keyringReset: false }), dismissWeak: vi.fn() } })
    const tabId = await open(service)
    service.close(host.host.id, tabId, false)
    expect(service.answerStrip(host.host.id, tabId, 'kr', 'dismiss')).toBeNull()
  })
})
