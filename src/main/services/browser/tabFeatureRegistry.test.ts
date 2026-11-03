// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { logger } = vi.hoisted(() => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../LoggingService', () => ({ logger }))

import { BROWSER_TAB_EVENTS } from '../../../shared/ipc/browser-tab-channels'
import type { TabHost } from './BrowserTab'
import { TabFeatureList, tabOutlet, type TabFeature } from './tabFeatureRegistry'

function feature(name: string, order: string[], owns: string | null = null, result: 'accepted' | 'unknown' = 'accepted'): TabFeature {
  return {
    name,
    answerStrip: (id) => (owns === null || id === owns ? result : null),
    detach: () => void order.push(name)
  }
}

describe('TabFeatureList', () => {
  beforeEach(() => vi.clearAllMocks())

  it('answers a strip row from the newest feature that owns it; null when none does', () => {
    const list = new TabFeatureList()
    const asked: string[] = []
    const spy = (f: TabFeature): TabFeature => ({ ...f, answerStrip: (id, a, fields) => (asked.push(f.name), f.answerStrip!(id, a, fields)) })
    list.add(spy(feature('site', [], 'site-row', 'unknown')))
    list.add(spy(feature('page', [], 'page-row')))
    list.add({ name: 'input', detach: () => undefined })
    list.add(spy(feature('extras', [], 'extras-row')))
    expect(list.answerStrip('page-row', 'allow')).toBe('accepted')
    expect(asked).toEqual(['extras', 'page'])
    // The site is asked last, and its "unknown" is the answer.
    expect(list.answerStrip('nobody', 'allow')).toBe(null)
    expect(list.answerStrip('site-row', 'allow')).toBe('unknown')
  })

  it('passes the sign-in fields through to the feature', () => {
    const list = new TabFeatureList()
    const answerStrip = vi.fn(() => 'accepted' as const)
    list.add({ name: 'site', answerStrip, detach: () => undefined })
    list.answerStrip('r', 'signIn', { username: 'u', password: 'p' })
    expect(answerStrip).toHaveBeenCalledWith('r', 'signIn', { username: 'u', password: 'p' })
  })

  it('detaches newest first, once; a failing detach is logged and the rest still run', () => {
    const order: string[] = []
    const list = new TabFeatureList()
    list.add(feature('input', order))
    list.add({
      name: 'site',
      detach: () => {
        throw new Error('gone')
      }
    })
    list.add(feature('page', order))
    list.detachAll()
    list.detachAll()
    expect(order).toEqual(['page', 'input'])
    expect(logger.error).toHaveBeenCalledWith('A browser tab feature failed to detach', expect.any(Error), { feature: 'site' })
    expect(list.answerStrip('x', 'allow')).toBeNull()
  })
})

describe('tabOutlet', () => {
  it('sends each event kind on its channel, schema-checked, to the owning window only', () => {
    const send = vi.fn()
    const host = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } } as unknown as TabHost
    const outlet = tabOutlet(host)
    expect(outlet.host).toBe(host)
    outlet.findResult({ tabId: 'browser-tab-1', active: 1, total: 2 })
    outlet.tabClosed({ tabId: 'browser-tab-1' })
    outlet.tabAdded({ tabId: 'browser-tab-2', openerTabId: 'browser-tab-1', background: false })
    expect(send.mock.calls.map(([channel]) => channel)).toEqual([BROWSER_TAB_EVENTS.findResult, BROWSER_TAB_EVENTS.tabClosed, BROWSER_TAB_EVENTS.tabAdded])
    outlet.findResult({ tabId: 'not-a-tab', active: 1, total: 2 })
    expect(send).toHaveBeenCalledTimes(3)
  })
})
