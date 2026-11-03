// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The page-feature `browser-tab:*` handlers of commit 12h (spec 025, § 8):
 * trust and payload checks, tab ownership by the sender's window, and
 * answers that never throw.
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

import { BROWSER_TAB_PAGE_CHANNELS, registerBrowserTabPageHandlers } from './page-handlers'

const TAB = 'browser-tab-1'
const page = { find: vi.fn(), stopFind: vi.fn(), zoom: vi.fn(), widthPreset: vi.fn() }
const tabs = { pageFor: vi.fn((windowId: number, tabId: string) => (windowId === 3 && tabId === TAB ? page : null)) }
const pages = {
  clearData: vi.fn(async () => ({ failed: [] })),
  forget: vi.fn(async () => ({ deleted: 'deleted' as const })),
  suggest: vi.fn(async () => ['http://app.test/'])
}
let trusted = true
let windowId: number | null = 3
let project: { realRoot: string; caseSensitive: boolean } | null = { realRoot: '/p', caseSensitive: true }
const EVENT = { sender: {} } as never
let unregister: () => void

beforeEach(() => {
  vi.clearAllMocks()
  handles.clear()
  removed.length = 0
  trusted = true
  windowId = 3
  project = { realRoot: '/p', caseSensitive: true }
  unregister = registerBrowserTabPageHandlers({
    tabs: tabs as never,
    pages: pages as never,
    currentProject: () => project,
    isTrustedSender: () => trusted,
    resolveWindowId: () => windowId
  })
})

const invoke = (channel: string, arg: unknown): unknown => handles.get(channel)!(EVENT, arg)

describe('browser-tab page handlers', () => {
  it('registers exactly its channels and removes them again', () => {
    expect([...handles.keys()].sort()).toEqual([...BROWSER_TAB_PAGE_CHANNELS].sort())
    unregister()
    expect(removed.sort()).toEqual([...BROWSER_TAB_PAGE_CHANNELS].sort())
  })

  it('025-AC-008 passes find, stopFind, zoom and widthPreset to the owned tab', () => {
    invoke('browser-tab:find', { tabId: TAB, text: 'needle', forward: false, findNext: true })
    expect(page.find).toHaveBeenCalledWith('needle', false, true)
    invoke('browser-tab:stopFind', { tabId: TAB })
    expect(page.stopFind).toHaveBeenCalled()
    invoke('browser-tab:zoom', { tabId: TAB, step: 'in' })
    expect(page.zoom).toHaveBeenCalledWith('in')
    invoke('browser-tab:widthPreset', { tabId: TAB, preset: 'phone' })
    expect(page.widthPreset).toHaveBeenCalledWith('phone')
  })

  it('refuses an untrusted sender, a bad payload, an unknown window and another window\'s tab', () => {
    trusted = false
    invoke('browser-tab:zoom', { tabId: TAB, step: 'in' })
    trusted = true
    invoke('browser-tab:zoom', { tabId: TAB, step: 'sideways' })
    invoke('browser-tab:find', { tabId: TAB, text: '', forward: true, findNext: true })
    invoke('browser-tab:zoom', { tabId: TAB, step: 'in', extra: 1 })
    windowId = null
    invoke('browser-tab:zoom', { tabId: TAB, step: 'in' })
    windowId = 4
    invoke('browser-tab:zoom', { tabId: TAB, step: 'in' })
    expect(page.zoom).not.toHaveBeenCalled()
    expect(page.find).not.toHaveBeenCalled()
  })

  it('logs instead of throwing when the tab call fails', () => {
    page.zoom.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(() => invoke('browser-tab:zoom', { tabId: TAB, step: 'in' })).not.toThrow()
  })

  it('025-AC-023 clears the ticked kinds only, and refuses nothing ticked', async () => {
    const answer = await invoke('browser-tab:clearData', {
      categories: { cookies: true, cache: false, permissions: true, credentials: false, captures: true }
    })
    expect(answer).toEqual({ failed: [] })
    expect(pages.clearData).toHaveBeenCalledWith(new Set(['cookies', 'permissions', 'captures']))
    const none = await invoke('browser-tab:clearData', {
      categories: { cookies: false, cache: false, permissions: false, credentials: false, captures: false }
    })
    expect(none).toEqual({ error: 'Request refused' })
    pages.clearData.mockRejectedValueOnce(new Error('x'))
    expect(await invoke('browser-tab:clearData', { categories: { cookies: true, cache: false, permissions: false, credentials: false, captures: false } })).toEqual({
      error: 'The browsing data could not be cleared'
    })
  })

  it('025-AC-023 forgets for a trusted sender only, and never throws', async () => {
    expect(await invoke('browser-tab:forget', {})).toEqual({ deleted: 'deleted' })
    trusted = false
    expect(await invoke('browser-tab:forget', {})).toEqual({ error: 'Request refused', path: null })
    trusted = true
    pages.forget.mockRejectedValueOnce(new Error('x'))
    expect(await invoke('browser-tab:forget', {})).toEqual({ error: "The project's browser data could not be forgotten", path: null })
  })

  it('025-AC-078 suggests from the open project\'s history, and nothing without one', async () => {
    expect(await invoke('browser-tab:suggest', { prefix: 'app' })).toEqual({ rows: [{ url: 'http://app.test/' }] })
    expect(pages.suggest).toHaveBeenCalledWith('/p', true, 'app')
    project = null
    expect(await invoke('browser-tab:suggest', { prefix: 'app' })).toEqual({ rows: [] })
    project = { realRoot: '/p', caseSensitive: true }
    expect(await invoke('browser-tab:suggest', { prefix: 5 })).toEqual({ rows: [] })
    pages.suggest.mockRejectedValueOnce(new Error('x'))
    expect(await invoke('browser-tab:suggest', { prefix: '' })).toEqual({ rows: [] })
  })
})

describe('browser-tab:pageClipboard (025-FR-009, S-17)', () => {
  function withClipboard(isPageWritten: () => Promise<boolean>): void {
    registerBrowserTabPageHandlers({
      tabs: tabs as never,
      pages: pages as never,
      pageClipboard: { isPageWritten },
      currentProject: () => project,
      isTrustedSender: () => trusted,
      resolveWindowId: () => windowId
    })
  }

  it('answers whether a page wrote the clipboard text', async () => {
    withClipboard(async () => true)
    expect(await invoke('browser-tab:pageClipboard', {})).toEqual({ pageWritten: true })
    withClipboard(async () => false)
    expect(await invoke('browser-tab:pageClipboard', {})).toEqual({ pageWritten: false })
  })

  it('answers "page-written" when refused or failing, so the terminal asks instead of typing', async () => {
    withClipboard(async () => false)
    trusted = false
    expect(await invoke('browser-tab:pageClipboard', {})).toEqual({ pageWritten: true })
    trusted = true
    expect(await invoke('browser-tab:pageClipboard', { text: 'smuggled' })).toEqual({ pageWritten: true })
    withClipboard(async () => {
      throw new Error('clipboard gone')
    })
    expect(await invoke('browser-tab:pageClipboard', {})).toEqual({ pageWritten: true })
  })

  it('answers "not page-written" without the marks (no browser runtime)', async () => {
    expect(await invoke('browser-tab:pageClipboard', {})).toEqual({ pageWritten: false })
  })
})
