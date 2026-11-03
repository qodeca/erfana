// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const gateway = vi.hoisted(() => ({
  create: vi.fn(),
  close: vi.fn()
}))
const views = vi.hoisted(() => ({ register: vi.fn(), unregister: vi.fn() }))

vi.mock('../browserTabGateway', () => ({ browserTabGateway: gateway }))
vi.mock('./browserViewBounds', () => ({ browserViewBounds: views }))
vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

import {
  browserTabClosedByMain,
  closeBrowserTab,
  ensureBrowserTab,
  requestBrowserPanelClose,
  resetBrowserTabLifecycle
} from './browserTabLifecycle'
import { useBrowserChromeStore } from '../../stores/useBrowserChromeStore'
import { useBrowserTabStore } from '../../stores/useBrowserTabStore'
import { logger } from '../../utils/logger'

const store = useBrowserTabStore.getState

beforeEach(() => {
  gateway.create.mockResolvedValue({ tabId: 'browser-tab-1' })
  gateway.close.mockResolvedValue(undefined)
})

afterEach(() => {
  resetBrowserTabLifecycle()
  vi.clearAllMocks()
  useBrowserTabStore.setState({
    byTab: new Map(),
    tabByPanel: new Map(),
    unhosted: new Map(),
    closing: new Set()
  })
})

describe('ensureBrowserTab', () => {
  it('creates the tab once per panel, hosts it and registers its view', async () => {
    const first = ensureBrowserTab('browser-panel-1')
    const second = ensureBrowserTab('browser-panel-1')
    expect(second).toBe(first)
    await expect(first).resolves.toEqual({ tabId: 'browser-tab-1' })
    expect(gateway.create).toHaveBeenCalledExactlyOnceWith('browser-panel-1')
    expect(store().tabOf('browser-panel-1')).toBe('browser-tab-1')
    expect(views.register).toHaveBeenCalledWith('browser-tab-1', 'browser-panel-1')
  })

  it('adopts a tab main already made without asking for one', async () => {
    await expect(ensureBrowserTab('browser-panel-2', 'browser-tab-7')).resolves.toEqual({
      tabId: 'browser-tab-7'
    })
    expect(gateway.create).not.toHaveBeenCalled()
    expect(store().tabOf('browser-panel-2')).toBe('browser-tab-7')
  })

  it('passes main’s refusal through and hosts nothing', async () => {
    gateway.create.mockResolvedValue({ error: 'No project' })
    await expect(ensureBrowserTab('browser-panel-1')).resolves.toEqual({ error: 'No project' })
    expect(views.register).not.toHaveBeenCalled()
  })

  it('turns a rejected create into an error and logs it', async () => {
    gateway.create.mockRejectedValue(new Error('ipc gone'))
    await expect(ensureBrowserTab('browser-panel-1')).resolves.toEqual({
      error: 'The browser tab could not open'
    })
    expect(logger.error).toHaveBeenCalled()
  })

  it('closes a tab whose editor tab went before main answered', async () => {
    let answer: (value: { tabId: string }) => void = () => {}
    gateway.create.mockReturnValue(new Promise(resolve => (answer = resolve)))
    const pending = ensureBrowserTab('browser-panel-1')
    closeBrowserTab('browser-panel-1')
    answer({ tabId: 'browser-tab-3' })
    await expect(pending).resolves.toEqual({ error: 'The tab closed' })
    expect(gateway.close).toHaveBeenCalledWith('browser-tab-3', false)
    expect(views.register).not.toHaveBeenCalled()
    expect(store().closing.size).toBe(0)
  })
})

describe('closeBrowserTab', () => {
  it('covers the page before unregistering, then closes it in main and forgets it', async () => {
    await ensureBrowserTab('browser-panel-1')
    const order: string[] = []
    const unsubscribe = useBrowserTabStore.subscribe(s => {
      if (s.closing.has('browser-panel-1')) order.push('covered')
    })
    views.unregister.mockImplementation(() => order.push('unregister'))
    closeBrowserTab('browser-panel-1')
    unsubscribe()
    expect(order).toEqual(['covered', 'unregister'])
    // The editor tab is already gone: Erfana's close, which never asks (S-31).
    expect(gateway.close).toHaveBeenCalledWith('browser-tab-1', false)
    expect(store().tabOf('browser-panel-1')).toBeNull()
  })

  it('ignores a panel that hosts nothing', () => {
    closeBrowserTab('browser-panel-404')
    expect(gateway.close).not.toHaveBeenCalled()
  })

  it('logs a close main rejects', async () => {
    await ensureBrowserTab('browser-panel-1')
    gateway.close.mockRejectedValue(new Error('gone'))
    closeBrowserTab('browser-panel-1')
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled())
  })
})

describe('requestBrowserPanelClose (commit 18)', () => {
  it('asks main and keeps the editor tab until main reports the tab gone', async () => {
    await ensureBrowserTab('browser-panel-1')
    gateway.close.mockResolvedValue(true)
    const remove = vi.fn()
    requestBrowserPanelClose('browser-panel-1', remove)
    expect(gateway.close).toHaveBeenCalledWith('browser-tab-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(remove).not.toHaveBeenCalled()
    expect(store().closing.has('browser-panel-1')).toBe(false)
  })

  it('removes the editor tab at once when main holds no tab, the request fails, or nothing is hosted', async () => {
    await ensureBrowserTab('browser-panel-1')
    gateway.close.mockResolvedValue(false)
    const remove = vi.fn()
    requestBrowserPanelClose('browser-panel-1', remove)
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
    gateway.close.mockRejectedValue(new Error('gone'))
    requestBrowserPanelClose('browser-panel-1', remove)
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(2))
    requestBrowserPanelClose('browser-panel-404', remove)
    expect(remove).toHaveBeenCalledTimes(3)
  })
})

describe('browserTabClosedByMain (commit 18)', () => {
  it('covers the page first, removes the editor tab and does not close the tab again', async () => {
    await ensureBrowserTab('browser-panel-1')
    useBrowserChromeStore.getState().applyFind({ tabId: 'browser-tab-1', active: 1, total: 1 })
    const order: string[] = []
    const removePanel = vi.fn((panelId: string) => {
      order.push(store().closing.has(panelId) ? 'covered-then-removed' : 'removed')
      closeBrowserTab(panelId) // dockview's onDidRemovePanel
    })
    browserTabClosedByMain('browser-tab-1', removePanel)
    expect(order).toEqual(['covered-then-removed'])
    expect(gateway.close).not.toHaveBeenCalled()
    expect(store().tabOf('browser-panel-1')).toBeNull()
    expect(useBrowserChromeStore.getState().find.has('browser-tab-1')).toBe(false)
  })

  it('forgets the panel itself when dockview no longer had it, and ignores an unhosted tab', async () => {
    await ensureBrowserTab('browser-panel-1')
    browserTabClosedByMain('browser-tab-1', vi.fn())
    expect(store().tabOf('browser-panel-1')).toBeNull()
    expect(views.unregister).toHaveBeenCalledWith('browser-tab-1')
    const removePanel = vi.fn()
    browserTabClosedByMain('browser-tab-99', removePanel)
    expect(removePanel).not.toHaveBeenCalled()
  })
})
