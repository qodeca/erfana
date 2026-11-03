// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The tab input factory wires each router event to the owning window and
 * gives the router a way to pull OS keyboard focus back to the window
 * (025-AC-071).
 *
 * @see tabInputFactory.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({ deps: null as null | Record<string, unknown> }))
const send = vi.hoisted(() => vi.fn())

vi.mock('./BrowserTabInput', () => ({
  BrowserTabInput: class {
    constructor(deps: Record<string, unknown>) {
      captured.deps = deps
    }
  }
}))
vi.mock('../tabEventSend', () => ({ sendTabEvent: send }))

import { BROWSER_TAB_EVENTS } from '../../../../shared/ipc/browser-tab-channels'
import type { TabHost } from '../BrowserTab'
import { newTabInput } from './tabInputFactory'

let destroyed: boolean
const focus = vi.fn()
const host = { isDestroyed: () => destroyed, webContents: { focus } } as unknown as TabHost
const macAppKeys = { quit: vi.fn(), hide: vi.fn(), hideOthers: vi.fn(), minimize: vi.fn() }

function deps(): Record<string, unknown> {
  newTabInput(
    { id: 'browser-tab-1', contents: {} } as never,
    host,
    { platform: 'darwin', clock: { now: () => 0 }, macAppKeys: () => macAppKeys },
    vi.fn()
  )
  return captured.deps!
}

beforeEach(() => {
  vi.clearAllMocks()
  destroyed = false
})

describe('newTabInput', () => {
  it('focusWindow gives the keyboard to the host window, and does nothing once the window is gone', () => {
    const { focusWindow } = deps() as { focusWindow: () => void }
    focusWindow()
    expect(focus).toHaveBeenCalledTimes(1)
    destroyed = true
    focusWindow()
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('sends forwarded keys, page focus and pick events to the host window', () => {
    const { events, tabId, platform, macAppKeys: keys } = deps() as {
      events: { forwardedKey(a: string): void; pageFocus(f: boolean): void; pick(e: unknown): void }
      tabId: string
      platform: string
      macAppKeys: unknown
    }
    expect([tabId, platform, keys]).toEqual(['browser-tab-1', 'darwin', macAppKeys])
    events.forwardedKey('newTab')
    events.pageFocus(true)
    events.pick({ tabId: 'browser-tab-1', on: true })
    expect(send.mock.calls.map((call) => [call[0], call[1], call[3]])).toEqual([
      [host, BROWSER_TAB_EVENTS.forwardedKey, { tabId: 'browser-tab-1', action: 'newTab' }],
      [host, BROWSER_TAB_EVENTS.focus, { tabId: 'browser-tab-1', pageFocused: true }],
      [host, BROWSER_TAB_EVENTS.pick, { tabId: 'browser-tab-1', on: true }]
    ])
  })
})
