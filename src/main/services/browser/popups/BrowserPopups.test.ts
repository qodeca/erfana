// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The process-wide popups (025-FR-011, 025-FR-023): per-tab policies, popup
 * windows by host, closing with their tab, and pop-up exceptions per project.
 */
import { EventEmitter } from 'node:events'
import { rmSync } from 'node:fs'
import type { HandlerDetails, WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock } from '../../../../shared/clock'
import type { StripEvent } from '../../../../shared/ipc/browser-tab-schema'
import { tempHome, tempProject, testSigner } from '../site/__test-helpers__/siteFakes'
import { BrowserPopups, type BrowserPopupsDeps } from './BrowserPopups'
import type { PopupHost } from './BrowserPopupWindow'

const APP = { rendererEntry: 'file:///app/out/renderer/index.html', resourcesDir: '/app/resources', devServerOrigin: null }

class FakePage extends EventEmitter {
  static nextId = 100
  readonly id = FakePage.nextId++
  readonly session = {}
  destroyed = false
  opener: object | null = {}
  url = 'http://app.test/popups.html'
  close = vi.fn(() => {
    this.destroyed = true
    this.emit('destroyed')
  })
  setWindowOpenHandler = vi.fn()
  getURL(): string {
    return this.url
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
}

function fakeHost(hostId: number): PopupHost {
  const host = new EventEmitter() as EventEmitter & Record<string, unknown>
  let destroyed = false
  let size = [800, 600]
  Object.assign(host, {
    id: hostId,
    webContents: { id: hostId, isDestroyed: () => destroyed, once: vi.fn() },
    contentView: { addChildView: vi.fn() },
    isDestroyed: () => destroyed,
    setTitle: vi.fn(),
    setContentSize: (w: number, h: number) => (size = [w, h]),
    getContentSize: () => size,
    getBounds: () => ({ x: 0, y: 0, width: size[0], height: size[1] }),
    show: vi.fn(),
    center: vi.fn(),
    destroy: () => {
      destroyed = true
      host.emit('closed')
    }
  })
  return host as unknown as PopupHost
}

const details = (overrides: Partial<HandlerDetails> = {}): HandlerDetails => ({
  url: 'http://app.test/child.html',
  frameName: 'x',
  features: 'width=400,height=300',
  disposition: 'new-window',
  referrer: { url: '', policy: 'default' },
  ...overrides
})

let root: string
let home: string

beforeEach(() => {
  root = tempProject('erfana-popups-svc-')
  home = tempHome()
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

function setup(overrides: Partial<BrowserPopupsDeps> = {}) {
  let hostId = 900
  const strip: StripEvent[] = []
  const deps: BrowserPopupsDeps = {
    clock: createManualClock(0),
    signer: testSigner(null),
    homeDir: home,
    resolveDomain: (h) => h,
    appAddresses: () => APP,
    isLocalAddress: () => false,
    expectPageWindow: () => () => undefined,
    isRegisteredView: () => true,
    childPreferences: () => ({}),
    defer: (fn) => fn(),
    windows: {
      stripHeight: 0,
      originMinWidth: 0,
      workArea: () => ({ width: 1440, height: 900 }),
      createHost: () => fakeHost(++hostId),
      createView: (contents) => ({ webContents: contents, setBounds: vi.fn() }),
      registerHost: vi.fn()
    },
    newRowId: () => 'pb',
    ...overrides
  }
  const popups = new BrowserPopups(deps)
  const outlet = { strip: (e: StripEvent) => strip.push(e), openTab: vi.fn(() => true) }
  const link = popups.attachTab({ id: 'browser-tab-1', projectRoot: root }, outlet)
  const tabPage = new FakePage()
  const { handler, startTracking } = link.handlerFor(tabPage as never)
  startTracking()
  /** A press, then an open whose createWindow gets `page`. */
  const openPopup = (page: FakePage, openerPage: FakePage = tabPage): void => {
    openerPage.emit('before-mouse-event', {}, { type: 'mouseDown' })
    const answer = handler(details()) as { createWindow?: (o: object) => WebContents }
    answer.createWindow?.({ webContents: page })
  }
  return { deps, popups, link, outlet, strip, tabPage, handler, openPopup }
}

describe('BrowserPopups', () => {
  it('025-AC-011 opens a popup window for an opener-keeping open, found by its host, and closes it with its tab', () => {
    const { link, openPopup, popups } = setup()
    const page = new FakePage()
    openPopup(page)
    const [popup] = popups.list()
    expect(popup?.openerTabId).toBe('browser-tab-1')
    expect(popups.popupByHost(popup!.host.webContents.id)).toBe(popup)
    expect(popups.popupsOf('browser-tab-1')).toEqual([popup])
    expect(popups.popupByHost(1)).toBeNull()
    link.detach()
    expect(page.close).toHaveBeenCalled()
    expect(popups.list()).toEqual([])
  })

  it('a popup that closes itself leaves the list; its own opens follow the same policy', () => {
    const { openPopup, popups, outlet } = setup()
    const page = new FakePage()
    openPopup(page)
    const nestedHandler = page.setWindowOpenHandler.mock.calls[0]![0] as (d: HandlerDetails) => { action: string }
    expect(nestedHandler(details()).action).toBe('deny')
    page.emit('before-mouse-event', {}, { type: 'mouseDown' })
    const nested = nestedHandler(details()) as unknown as { createWindow: (o: object) => WebContents }
    const tabBound = new FakePage()
    tabBound.opener = null
    nested.createWindow({ webContents: tabBound })
    expect(outlet.openTab).toHaveBeenCalledWith('http://app.test/child.html', false, tabBound)
    page.close()
    expect(popups.list()).toEqual([])
  })

  it('a popup that cannot be built closes its webContents', () => {
    const { openPopup, popups } = setup({
      windows: {
        stripHeight: 0,
        originMinWidth: 0,
        workArea: () => ({ width: 1440, height: 900 }),
        createHost: () => {
          throw new Error('no window')
        },
        createView: vi.fn(),
        registerHost: vi.fn()
      }
    })
    const page = new FakePage()
    openPopup(page)
    expect(popups.list()).toEqual([])
    expect(page.close).toHaveBeenCalledWith({ waitForBeforeUnload: false })
  })

  it('025-AC-011 Always allow saves the site for the project; 025-AC-023 Clear forgets it', async () => {
    const clock = createManualClock(0)
    const { handler, link, popups } = setup({ clock })
    expect(handler(details()).action).toBe('deny')
    clock.advance(500)
    expect(link.answerStrip('pb', 'alwaysAllow')).toBe('accepted')
    await vi.waitFor(() => expect(handler(details()).action).toBe('allow'))
    await popups.clearExceptions(root)
    expect(handler(details()).action).toBe('deny')
    await popups.clearExceptions('/never/opened')
  })

  it('withdraws an unused page-window expectation on a later task by default', async () => {
    const withdraw = vi.fn()
    const { openPopup, popups } = setup({ defer: undefined, expectPageWindow: () => withdraw })
    openPopup(new FakePage())
    expect(popups.list()).toHaveLength(1)
    expect(withdraw).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(withdraw).toHaveBeenCalled())
  })

  it('a new document takes the tab row away', () => {
    const { handler, link, strip } = setup()
    handler(details())
    link.newDocument()
    expect(strip.at(-1)).toMatchObject({ op: 'withdraw' })
  })
})
