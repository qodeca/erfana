// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `browser-tab:contextAction` and the popup channels (spec 025 § 8, commits
 * 12e and 12g): trust and payload checks, the window or popup from the
 * sender, and answers that never throw.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handles, removed } = vi.hoisted(() => ({
  handles: new Map<string, (...args: unknown[]) => unknown>(),
  removed: [] as string[]
}))
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: vi.fn(() => null) } }))
vi.mock('../../services/LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../registry', () => ({
  registerHandle: (c: string, l: (...a: unknown[]) => unknown) => handles.set(c, l),
  unregisterHandle: (c: string) => removed.push(c)
}))

import { BrowserWindow } from 'electron'
import { BROWSER_TAB_POPUP_HANDLED_CHANNELS, registerBrowserTabPopupHandlers } from './popup-handlers'

const POPUP_HOST = 501
const popup = { committed: 'https://staging.test/child.html' as string | null, close: vi.fn() }
const popups = { popupByHost: vi.fn((id: number) => (id === POPUP_HOST ? popup : null)) }
const tabs = { contextAction: vi.fn(() => 'accepted' as const) }
const MENU = { tabId: 'browser-tab-1', menuId: 'abc', action: 'reload' }

const event = (senderId: number, trusted = true) => ({ sender: { id: senderId }, trusted })
const call = (channel: string, e: unknown, arg: unknown) => handles.get(channel)!(e, arg)

beforeEach(() => {
  handles.clear()
  removed.length = 0
  vi.clearAllMocks()
  popup.committed = 'https://staging.test/child.html'
  registerBrowserTabPopupHandlers({
    tabs,
    popups: popups as never,
    resolveDomain: (h) => h,
    isTrustedSender: (e) => (e as unknown as { trusted: boolean }).trusted,
    resolveWindowId: () => 3
  })
})

describe('registerBrowserTabPopupHandlers', () => {
  it('registers every channel and removes them all', () => {
    expect([...handles.keys()].sort()).toEqual([...BROWSER_TAB_POPUP_HANDLED_CHANNELS].sort())
    const unregister = registerBrowserTabPopupHandlers({ tabs, popups: popups as never, resolveDomain: (h) => h })
    unregister()
    expect(removed.sort()).toEqual([...BROWSER_TAB_POPUP_HANDLED_CHANNELS].sort())
  })

  it('025-AC-074 contextAction reaches the sender window’s tab with the menu id and action', () => {
    call('browser-tab:contextAction', event(1), MENU)
    expect(tabs.contextAction).toHaveBeenCalledWith(3, 'browser-tab-1', { menuId: 'abc', action: 'reload' })
  })

  it('contextAction refuses an untrusted sender, a bad payload and a sender with no window; a throw is logged', () => {
    call('browser-tab:contextAction', event(1, false), MENU)
    call('browser-tab:contextAction', event(1), { ...MENU, action: 'format' })
    call('browser-tab:contextAction', event(1), { ...MENU, extra: 1 })
    expect(tabs.contextAction).not.toHaveBeenCalled()
    tabs.contextAction.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(() => call('browser-tab:contextAction', event(1), MENU)).not.toThrow()

    handles.clear()
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValueOnce({ id: 8, isDestroyed: () => false } as never).mockReturnValueOnce(null)
    registerBrowserTabPopupHandlers({ tabs, popups: popups as never, resolveDomain: (h) => h, isTrustedSender: () => true })
    call('browser-tab:contextAction', event(1), MENU)
    expect(tabs.contextAction).toHaveBeenLastCalledWith(8, 'browser-tab-1', { menuId: 'abc', action: 'reload' })
    tabs.contextAction.mockClear()
    call('browser-tab:contextAction', event(1), MENU)
    expect(tabs.contextAction).not.toHaveBeenCalled()
  })

  it('popupStrip answers the sending popup’s committed address, origin and badge', () => {
    expect(call('browser-tab:popupStrip', event(POPUP_HOST), {})).toEqual({
      committedUrl: 'https://staging.test/child.html',
      origin: expect.objectContaining({ kind: 'web' }),
      security: 'secure'
    })
    popup.committed = null
    expect(call('browser-tab:popupStrip', event(POPUP_HOST), {})).toEqual({ committedUrl: null, origin: null, security: 'local' })
  })

  it('popup channels refuse a sender that is not a popup and a bad payload', () => {
    expect(call('browser-tab:popupStrip', event(1), {})).toBeNull()
    expect(call('browser-tab:popupStrip', event(POPUP_HOST), { tabId: 'browser-tab-1' })).toBeNull()
    call('browser-tab:popupClose', event(1), {})
    call('browser-tab:popupClose', event(POPUP_HOST), { now: true })
    expect(popup.close).not.toHaveBeenCalled()
  })

  it('popupClose closes the sending popup; popupAnswer finds no row yet', () => {
    call('browser-tab:popupAnswer', event(POPUP_HOST), { requestId: 'abc', answer: 'allow' })
    call('browser-tab:popupClose', event(POPUP_HOST), {})
    expect(popup.close).toHaveBeenCalledTimes(1)
  })

  it('popupStrip answers null when the address does not fit the schema', () => {
    popup.committed = `https://staging.test/${'a'.repeat(9000)}`
    expect(call('browser-tab:popupStrip', event(POPUP_HOST), {})).toBeNull()
  })
})
