// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** The `browser-tab:*` handlers of commit 7 (spec 025, § 8). */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handles, ons, removed } = vi.hoisted(() => ({
  handles: new Map<string, (...args: unknown[]) => unknown>(),
  ons: new Map<string, (...args: unknown[]) => unknown>(),
  removed: [] as string[]
}))
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: vi.fn(() => null) } }))
vi.mock('../services/LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./registry', () => ({
  registerHandle: (c: string, l: (...a: unknown[]) => unknown) => handles.set(c, l),
  registerOn: (c: string, l: (...a: unknown[]) => unknown) => ons.set(c, l),
  unregisterHandle: (c: string) => removed.push(c),
  unregisterOn: (c: string) => removed.push(c)
}))

import { BROWSER_TAB_HANDLED_CHANNELS, registerBrowserTabHandlers } from './browser-tab-handlers'

const TAB = 'browser-tab-1'
const host = { id: 3, isDestroyed: () => false }
const tab = {
  navigate: vi.fn(() => ({ ok: true })),
  history: vi.fn(),
  applyBounds: vi.fn((): boolean | null => true),
  focusPage: vi.fn(),
  devTools: vi.fn()
}
const service = {
  create: vi.fn(async () => ({ tabId: TAB })),
  close: vi.fn(),
  tabOf: vi.fn((windowId: number, tabId: string) => (windowId === 3 && tabId === TAB ? tab : null)),
  answerStrip: vi.fn(() => 'accepted'),
  answerCertificate: vi.fn(() => 'accepted'),
  showDownload: vi.fn(() => true),
  focusOrigin: vi.fn(),
  toolbarFocus: vi.fn()
}
let trusted = true
let windowFor: typeof host | null = host
const EVENT = { sender: { send: vi.fn(), isDestroyed: () => false } } as never

beforeEach(() => {
  vi.clearAllMocks()
  handles.clear()
  ons.clear()
  removed.length = 0
  trusted = true
  windowFor = host
  registerBrowserTabHandlers({
    service: service as never,
    isTrustedSender: () => trusted,
    resolveWindow: () => windowFor as never
  })
})

const invoke = (channel: string, arg: unknown): unknown => handles.get(channel)!(EVENT, arg)

describe('registerBrowserTabHandlers', () => {
  it('registers its channels and removes them all', () => {
    expect([...handles.keys(), ...ons.keys()].sort()).toEqual([...BROWSER_TAB_HANDLED_CHANNELS].sort())
    expect(ons.has('browser-tab:bounds')).toBe(true)
    // The unregister function is the return value of a fresh registration.
    const unregister = registerBrowserTabHandlers({ service: service as never })
    unregister()
    expect(removed.sort()).toEqual([...BROWSER_TAB_HANDLED_CHANNELS].sort())
  })

  it('creates a tab in the sender\'s window', async () => {
    expect(await invoke('browser-tab:create', { panelId: 'p' })).toEqual({ tabId: TAB })
    expect(service.create).toHaveBeenCalledWith(host, 'p')
  })

  it('refuses an untrusted sender, a bad payload and a sender with no window, without calling the service', async () => {
    trusted = false
    expect(await invoke('browser-tab:create', { panelId: 'p' })).toEqual({ error: 'Request refused' })
    trusted = true
    expect(await invoke('browser-tab:create', { panelId: 'p', extra: 1 })).toEqual({ error: 'Request refused' })
    windowFor = null
    expect(await invoke('browser-tab:create', { panelId: 'p' })).toEqual({ error: 'Request refused' })
    expect(service.create).not.toHaveBeenCalled()
  })

  it('answers a create that throws with an error, never a rejection', async () => {
    service.create.mockRejectedValueOnce(new Error('x'))
    expect(await invoke('browser-tab:create', { panelId: 'p' })).toEqual({ error: 'The browser tab could not open' })
  })

  it('classifies typed input: refused rules answer at once, searches and addresses load', () => {
    expect(invoke('browser-tab:navigate', { tabId: TAB, input: 'javascript:alert(1)', source: 'address' })).toEqual({ refused: 'scheme' })
    expect(invoke('browser-tab:navigate', { tabId: TAB, input: '\\\\host\\share', source: 'address' })).toEqual({ refused: 'network-path' })
    expect(tab.navigate).not.toHaveBeenCalled()
    expect(invoke('browser-tab:navigate', { tabId: TAB, input: 'localhost:5173', source: 'address' })).toEqual({ ok: true })
    expect(tab.navigate).toHaveBeenLastCalledWith('http://localhost:5173', 'address')
    invoke('browser-tab:navigate', { tabId: TAB, input: 'two words', source: 'history' })
    expect(tab.navigate).toHaveBeenLastCalledWith('https://duckduckgo.com/?q=two%20words', 'history')
    tab.navigate.mockReturnValueOnce({ refused: 'app-entry' } as never)
    expect(invoke('browser-tab:navigate', { tabId: TAB, input: 'file:///r/index.html', source: 'address' })).toEqual({ refused: 'app-entry' })
  })

  it('never accepts the page source from the renderer', () => {
    expect(invoke('browser-tab:navigate', { tabId: TAB, input: 'https://a.test', source: 'page' })).toEqual({ error: 'Request refused' })
  })

  it('refuses a request naming another window\'s tab', () => {
    windowFor = { id: 4, isDestroyed: () => false }
    expect(invoke('browser-tab:navigate', { tabId: TAB, input: 'https://a.test', source: 'address' })).toEqual({ error: 'Request refused' })
    invoke('browser-tab:history', { tabId: TAB, step: 'back' })
    invoke('browser-tab:devTools', { tabId: TAB })
    invoke('browser-tab:focusPage', { tabId: TAB })
    expect(tab.history).not.toHaveBeenCalled()
    expect(tab.devTools).not.toHaveBeenCalled()
    expect(tab.focusPage).not.toHaveBeenCalled()
  })

  it('routes history, focus, DevTools, bounds and close to the tab', () => {
    invoke('browser-tab:history', { tabId: TAB, step: 'stop' })
    invoke('browser-tab:focusPage', { tabId: TAB })
    invoke('browser-tab:devTools', { tabId: TAB, inspectAt: { x: 1, y: 2 } })
    invoke('browser-tab:close', { tabId: TAB })
    const rect = { x: 0, y: 0, width: 10, height: 10 }
    ons.get('browser-tab:bounds')!(EVENT, { tabId: TAB, bounds: rect, seq: 4, ack: true, visible: false, clip: rect })
    expect(tab.history).toHaveBeenCalledWith('stop')
    expect(tab.focusPage).toHaveBeenCalled()
    expect(tab.devTools).toHaveBeenCalledWith({ x: 1, y: 2 })
    expect(service.close).toHaveBeenCalledWith(3, TAB)
    expect(tab.applyBounds).toHaveBeenCalledWith(rect, 4, false)
  })

  it('logs instead of throwing when the tab throws', () => {
    tab.history.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(() => invoke('browser-tab:history', { tabId: TAB, step: 'reload' })).not.toThrow()
    tab.navigate.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(invoke('browser-tab:navigate', { tabId: TAB, input: 'a.test', source: 'address' })).toEqual({ error: 'The address could not be opened' })
  })

  it('answers a bounds push that asks for an ack with boundsApplied, to the sender only', () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 }
    const sender = { send: vi.fn(), isDestroyed: () => false }
    const event = { sender } as never
    const push = (seq: number, ack: boolean): void => {
      ons.get('browser-tab:bounds')!(event, { tabId: TAB, bounds: rect, seq, ack, visible: true, clip: rect })
    }

    tab.applyBounds.mockReturnValueOnce(true)
    push(5, true)
    expect(sender.send).toHaveBeenCalledExactlyOnceWith('browser-tab:boundsApplied', { tabId: TAB, seq: 5, visible: true })

    tab.applyBounds.mockReturnValueOnce(true)
    push(6, false)
    tab.applyBounds.mockReturnValueOnce(null)
    push(7, true)
    expect(sender.send).toHaveBeenCalledTimes(1)
  })

  it('sends no ack to a sender that is gone, and none when the tab throws', () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 }
    const sender = { send: vi.fn(), isDestroyed: () => true }
    tab.applyBounds.mockReturnValueOnce(false)
    ons.get('browser-tab:bounds')!({ sender } as never, { tabId: TAB, bounds: rect, seq: 8, ack: true, visible: false, clip: rect })
    const live = { send: vi.fn(), isDestroyed: () => false }
    tab.applyBounds.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    ons.get('browser-tab:bounds')!({ sender: live } as never, { tabId: TAB, bounds: rect, seq: 9, ack: true, visible: true, clip: rect })
    expect(sender.send).not.toHaveBeenCalled()
    expect(live.send).not.toHaveBeenCalled()
  })

  it('drops a malformed bounds push', () => {
    ons.get('browser-tab:bounds')!(EVENT, { tabId: TAB, seq: -1 })
    expect(tab.applyBounds).not.toHaveBeenCalled()
  })

  it('025-AC-019 passes a strip answer with the sender\'s window; the service checks ownership and the guard', () => {
    invoke('browser-tab:answerStrip', { tabId: TAB, requestId: 'r1', answer: 'allowOnce' })
    expect(service.answerStrip).toHaveBeenCalledWith(3, TAB, 'r1', 'allowOnce', undefined)
  })

  it('025-AC-022 passes a sign-in answer\'s fields to the service', () => {
    const fields = { username: 'staging', password: 'pw', remember: true }
    invoke('browser-tab:answerStrip', { tabId: TAB, requestId: 'r1', answer: 'signIn', fields })
    expect(service.answerStrip).toHaveBeenCalledWith(3, TAB, 'r1', 'signIn', fields)
    invoke('browser-tab:answerStrip', { tabId: TAB, requestId: 'r1', answer: 'signIn', fields: { username: 'x', token: 'y' } })
    expect(service.answerStrip).toHaveBeenCalledTimes(1)
  })

  it('025-AC-021 passes Proceed anyway and Back to safety with the sender\'s window, refusing bad payloads', () => {
    invoke('browser-tab:certificate', { tabId: TAB, decisionId: 'd1', proceed: true })
    expect(service.answerCertificate).toHaveBeenCalledWith(3, TAB, 'd1', true)
    trusted = false
    invoke('browser-tab:certificate', { tabId: TAB, decisionId: 'd1', proceed: false })
    trusted = true
    invoke('browser-tab:certificate', { tabId: TAB, decisionId: 'd 1', proceed: true })
    invoke('browser-tab:certificate', { tabId: TAB, decisionId: 'd1', proceed: 'yes' })
    invoke('browser-tab:certificate', { tabId: TAB, decisionId: 'd1', proceed: true, host: 'a.test' })
    expect(service.answerCertificate).toHaveBeenCalledTimes(1)
    service.answerCertificate.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(() => invoke('browser-tab:certificate', { tabId: TAB, decisionId: 'd2', proceed: false })).not.toThrow()
  })

  it('refuses a strip answer from an untrusted sender or with fields that do not parse', () => {
    trusted = false
    invoke('browser-tab:answerStrip', { tabId: TAB, requestId: 'r1', answer: 'allow' })
    trusted = true
    invoke('browser-tab:answerStrip', { tabId: TAB, requestId: 'r 1', answer: 'allow' })
    invoke('browser-tab:answerStrip', { tabId: TAB, requestId: 'r1', answer: 'grantEverything' })
    invoke('browser-tab:answerStrip', { tabId: TAB, requestId: 'r1', answer: 'allow', origin: 'https://a.test' })
    expect(service.answerStrip).not.toHaveBeenCalled()
  })

  it('025-AC-020 passes Show in folder with the sender\'s window, and logs instead of throwing', () => {
    invoke('browser-tab:showDownload', { downloadId: 'dl1' })
    expect(service.showDownload).toHaveBeenCalledWith(3, 'dl1')
    invoke('browser-tab:showDownload', { downloadId: '../x' })
    expect(service.showDownload).toHaveBeenCalledTimes(1)
    service.showDownload.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(() => invoke('browser-tab:showDownload', { downloadId: 'dl2' })).not.toThrow()
    service.answerStrip.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(() => invoke('browser-tab:answerStrip', { tabId: TAB, requestId: 'r1', answer: 'allow' })).not.toThrow()
  })

  it('passes where focus came from and toolbar focus with the sender\'s window', () => {
    invoke('browser-tab:focusOrigin', { tabId: TAB, from: 'toolbar' })
    expect(service.focusOrigin).toHaveBeenCalledWith(3, TAB, 'toolbar')
    ons.get('browser-tab:toolbarFocus')!(EVENT, { tabId: TAB, focused: true })
    expect(service.toolbarFocus).toHaveBeenCalledWith(3, TAB, true)
  })

  it('refuses a focus report from an untrusted sender or with fields that do not parse, and logs instead of throwing', () => {
    trusted = false
    invoke('browser-tab:focusOrigin', { tabId: TAB, from: 'outside' })
    ons.get('browser-tab:toolbarFocus')!(EVENT, { tabId: TAB, focused: true })
    trusted = true
    invoke('browser-tab:focusOrigin', { tabId: TAB, from: 'page' })
    ons.get('browser-tab:toolbarFocus')!(EVENT, { tabId: TAB, focused: 'yes' })
    expect(service.focusOrigin).not.toHaveBeenCalled()
    expect(service.toolbarFocus).not.toHaveBeenCalled()
    service.toolbarFocus.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(() => ons.get('browser-tab:toolbarFocus')!(EVENT, { tabId: TAB, focused: false })).not.toThrow()
  })
})
