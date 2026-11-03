// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromId, createFromBitmap, logger } = vi.hoisted(() => ({
  fromId: vi.fn(),
  createFromBitmap: vi.fn(() => ({ toPNG: () => Buffer.from([137, 80]) })),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('electron', () => ({ BrowserWindow: { fromId }, nativeImage: { createFromBitmap } }))
vi.mock('../../LoggingService', () => ({ logger }))
vi.mock('../../../ipc/browserTab/pick-handlers', () => ({ registerBrowserTabPickHandlers: vi.fn() }))

import { createManualClock } from '../../../../shared/clock'
import { BROWSER_TAB_EVENTS } from '../../../../shared/ipc/browser-tab-channels'
import type { BrowserTab } from '../BrowserTab'
import { encodePng, installBrowserPicks, registerPickSession } from './pickAppSetup'
import { FakePickCdp } from './__test-helpers__/fakePickCdp'

function session() {
  const listeners: Array<(prev: unknown, next: { realRoot: string } | null) => void> = []
  return { onChange: vi.fn((l: (typeof listeners)[number]) => (listeners.push(l), () => undefined)), current: () => null }
}

describe('pickAppSetup', () => {
  beforeEach(() => vi.clearAllMocks())

  it('encodes a BGRA bitmap as PNG through Electron', () => {
    const data = new Uint8Array(16)
    expect(encodePng({ data, width: 2, height: 2 })).toEqual(new Uint8Array([137, 80]))
    expect(createFromBitmap).toHaveBeenCalledWith(expect.any(Buffer), { width: 2, height: 2 })
  })

  it('registers the pick channels over the lazily reached tab service, and follows the project for expiry', () => {
    const registerHandlers = vi.fn()
    const service = { tabOf: vi.fn(() => null), inputFor: vi.fn(() => null) }
    const projectSession = session()
    const setup = installBrowserPicks({ clock: createManualClock(), tabs: () => service as never, projectSession: projectSession as never, terminals: () => null, registerHandlers })
    const { tabs, picks } = registerHandlers.mock.calls[0][0]
    expect(picks).toBe(setup.picks)
    tabs.tabOf(1, 'browser-tab-1')
    tabs.inputFor({})
    expect(service.tabOf).toHaveBeenCalledWith(1, 'browser-tab-1')
    expect(service.inputFor).toHaveBeenCalled()
    expect(projectSession.onChange).toHaveBeenCalledTimes(1)
  })

  it('attaches the pick pipeline after the page features, sending schema-checked events to the owning window only', () => {
    const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false })
    const cdp = new FakePickCdp()
    registerPickSession(contents, cdp)
    const send = vi.fn()
    const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } }
    fromId.mockReturnValue(window)
    const input = { state: vi.fn(), dispatch: vi.fn(), attachPick: vi.fn() }
    const setup = installBrowserPicks({
      clock: createManualClock(),
      tabs: () => ({ tabOf: () => null, inputFor: () => input }) as never,
      projectSession: session() as never,
      terminals: () => null,
      registerHandlers: vi.fn()
    })
    const features = { attachTab: vi.fn(() => 'page'), detachTab: vi.fn() }
    const wrapped = setup.withPicks(features)
    const tab = { id: 'browser-tab-1', windowId: 3, contents, projectRoot: '/p', viewFrame: { placement: () => null, widthPreset: 'full' } } as unknown as BrowserTab
    expect(wrapped.attachTab(tab, 'events', 'hang')).toBe('page')
    expect(features.attachTab).toHaveBeenCalledWith(tab, 'events', 'hang')
    expect(input.attachPick).toHaveBeenCalledTimes(1)
    const pick = setup.picks.forTab(tab)!
    expect(pick).not.toBeNull()

    // A valid event reaches the owner; one that fails its schema is dropped and logged.
    ;(pick as unknown as { deps: { events: { pick(e: unknown): void } } }).deps.events.pick({ tabId: 'browser-tab-1', kind: 'mode', on: true })
    expect(send).toHaveBeenCalledWith(BROWSER_TAB_EVENTS.pick, { tabId: 'browser-tab-1', kind: 'mode', on: true })
    ;(pick as unknown as { deps: { events: { pick(e: unknown): void } } }).deps.events.pick({ tabId: 'browser-tab-1', kind: 'mode', on: 'yes' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith('Dropped a browser pick event that does not match its schema', undefined, { kind: 'mode' })

    // The window went: nothing is sent.
    fromId.mockReturnValue(null)
    ;(pick as unknown as { deps: { events: { pick(e: unknown): void } } }).deps.events.pick({ tabId: 'browser-tab-1', kind: 'mode', on: false })
    expect(send).toHaveBeenCalledTimes(1)

    wrapped.detachTab('page')
    expect(features.detachTab).toHaveBeenCalledWith('page')
  })

  it('attaches no pipeline for a tab whose window is gone', () => {
    fromId.mockReturnValue({ isDestroyed: () => true })
    const input = { state: vi.fn(), dispatch: vi.fn(), attachPick: vi.fn() }
    const setup = installBrowserPicks({
      clock: createManualClock(),
      tabs: () => ({ tabOf: () => null, inputFor: () => input }) as never,
      projectSession: session() as never,
      terminals: () => null,
      registerHandlers: vi.fn()
    })
    setup.withPicks({ attachTab: () => 'page', detachTab: () => undefined }).attachTab({ id: 'browser-tab-2', windowId: 4 } as unknown as BrowserTab, null, null)
    expect(input.attachPick).not.toHaveBeenCalled()
  })
})
