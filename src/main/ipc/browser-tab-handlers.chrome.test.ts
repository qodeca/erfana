// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The commit 18 parts of the `browser-tab:*` handlers (spec 025, § 8):
 * `close` answers whether the window holds the tab and carries `byUser`, and
 * `openExternal` (025-FR-057) hands only `http` and `https` addresses of the
 * sender's own tab to the checked external-open path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handles } = vi.hoisted(() => ({ handles: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: vi.fn(() => null) } }))
vi.mock('../services/LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./registry', () => ({
  registerHandle: (c: string, l: (...a: unknown[]) => unknown) => handles.set(c, l),
  registerOn: vi.fn(),
  unregisterHandle: vi.fn(),
  unregisterOn: vi.fn()
}))

import { registerBrowserTabHandlers, SYSTEM_BROWSER_CHANNEL, systemBrowserUrl } from './browser-tab-handlers'
import { BROWSER_TAB_CHANNELS } from '../../shared/ipc/browser-tab-channels'

const TAB = 'browser-tab-1'
const host = { id: 3, isDestroyed: () => false }
let committedUrl: string | null = 'https://www.example.test/docs'
const tab = { windowId: 3, state: () => ({ committedUrl }) }
const service = {
  close: vi.fn((): boolean => true),
  tabOf: vi.fn((windowId: number, tabId: string) => (windowId === 3 && tabId === TAB ? tab : null))
}
const openInSystemBrowser = vi.fn(async (): Promise<void> => undefined)
let trusted = true
const EVENT = { sender: {} } as never

beforeEach(() => {
  vi.clearAllMocks()
  handles.clear()
  trusted = true
  committedUrl = 'https://www.example.test/docs'
  registerBrowserTabHandlers({
    service: service as never,
    isTrustedSender: () => trusted,
    resolveWindow: () => host as never,
    openInSystemBrowser
  })
})

const invoke = (channel: string, arg: unknown): unknown => handles.get(channel)!(EVENT, arg)

describe('browser-tab:close', () => {
  it('passes byUser through and answers whether the window holds the tab', () => {
    expect(invoke('browser-tab:close', { tabId: TAB })).toBe(true)
    expect(service.close).toHaveBeenLastCalledWith(3, TAB, true)
    expect(invoke('browser-tab:close', { tabId: TAB, byUser: false })).toBe(true)
    expect(service.close).toHaveBeenLastCalledWith(3, TAB, false)
    service.close.mockReturnValueOnce(false)
    expect(invoke('browser-tab:close', { tabId: 'browser-tab-9' })).toBe(false)
  })

  it('answers false for a bad payload, an untrusted sender or a throwing service', () => {
    expect(invoke('browser-tab:close', { tabId: TAB, extra: 1 })).toBe(false)
    trusted = false
    expect(invoke('browser-tab:close', { tabId: TAB })).toBe(false)
    trusted = true
    service.close.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(invoke('browser-tab:close', { tabId: TAB })).toBe(false)
  })
})

describe('browser-tab:openExternal', () => {
  it('opens the tab\'s committed address, or the menu link, when it is http or https', async () => {
    expect(await invoke('browser-tab:openExternal', { tabId: TAB })).toEqual({ ok: true })
    expect(openInSystemBrowser).toHaveBeenLastCalledWith('https://www.example.test/docs')
    expect(await invoke('browser-tab:openExternal', { tabId: TAB, url: 'http://localhost:5173/a' })).toEqual({ ok: true })
    expect(openInSystemBrowser).toHaveBeenLastCalledWith('http://localhost:5173/a')
  })

  it('refuses every other scheme, an empty tab and another window\'s tab', async () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'mailto:a@b.test', 'not a url']) {
      expect(await invoke('browser-tab:openExternal', { tabId: TAB, url })).toEqual({
        error: 'Only http and https addresses open in your system browser'
      })
    }
    committedUrl = null
    expect(await invoke('browser-tab:openExternal', { tabId: TAB })).toHaveProperty('error')
    expect(await invoke('browser-tab:openExternal', { tabId: 'browser-tab-2' })).toEqual({ error: 'Request refused' })
    trusted = false
    expect(await invoke('browser-tab:openExternal', { tabId: TAB })).toEqual({ error: 'Request refused' })
    expect(openInSystemBrowser).not.toHaveBeenCalled()
  })

  it('reports a failed open', async () => {
    openInSystemBrowser.mockRejectedValueOnce(new Error('no handler'))
    expect(await invoke('browser-tab:openExternal', { tabId: TAB })).toEqual({ error: 'Your system browser did not open it' })
  })

  it('is refused without an external-open path', async () => {
    handles.clear()
    registerBrowserTabHandlers({ service: service as never, isTrustedSender: () => true, resolveWindow: () => host as never })
    expect(await invoke('browser-tab:openExternal', { tabId: TAB })).toEqual({ error: 'Request refused' })
  })
})

describe('SYSTEM_BROWSER_CHANNEL', () => {
  it('is the openExternal channel', () => {
    expect(Object.values(BROWSER_TAB_CHANNELS)).toContain(SYSTEM_BROWSER_CHANNEL)
    expect(SYSTEM_BROWSER_CHANNEL).toBe('browser-tab:openExternal')
  })
})

describe('systemBrowserUrl', () => {
  it('keeps http and https only', () => {
    expect(systemBrowserUrl('https://a.test/')).toBe('https://a.test/')
    expect(systemBrowserUrl('HTTP://a.test/')).toBe('HTTP://a.test/')
    expect(systemBrowserUrl('ftp://a.test/')).toBeNull()
    expect(systemBrowserUrl(undefined)).toBeNull()
    expect(systemBrowserUrl(null)).toBeNull()
  })
})
