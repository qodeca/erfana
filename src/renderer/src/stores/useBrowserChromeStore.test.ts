// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it } from 'vitest'
import type { StripRow } from '../../../shared/ipc/browser-tab-schema'
import { nextRows, useBrowserChromeStore } from './useBrowserChromeStore'

const TAB = 'browser-tab-1'
const row = (requestId: string, patch: Partial<StripRow> = {}): StripRow => ({
  requestId,
  kind: 'permission',
  text: 'a.test wants to use your camera',
  answers: ['block', 'allow'],
  takesFocus: false,
  shownAt: 10,
  ...patch
})
const store = useBrowserChromeStore.getState

afterEach(() => {
  useBrowserChromeStore.setState({ rows: new Map(), held: new Map(), find: new Map(), menu: null })
})

describe('nextRows', () => {
  it('adds, changes in place and withdraws rows', () => {
    const added = nextRows([], { tabId: TAB, op: 'add', row: row('a') }, 1)
    expect(added).toEqual([{ row: row('a'), since: 1 }])
    const two = nextRows(added, { tabId: TAB, op: 'add', row: row('b') }, 2)
    expect(two.map(r => r.row.requestId)).toEqual(['a', 'b'])
    expect(nextRows(two, { tabId: TAB, op: 'withdraw', requestId: 'a' }, 3).map(r => r.row.requestId)).toEqual(['b'])
  })

  it('keeps the guard when only the waiting count changed, restarts it when the request changed', () => {
    const start = nextRows([], { tabId: TAB, op: 'add', row: row('a') }, 1)
    const counted = nextRows(start, { tabId: TAB, op: 'change', row: row('a', { waiting: 2 }) }, 5)
    expect(counted[0]).toEqual({ row: row('a', { waiting: 2 }), since: 1 })
    const advanced = nextRows(counted, { tabId: TAB, op: 'change', row: row('a', { shownAt: 900 }) }, 9)
    expect(advanced[0]?.since).toBe(9)
    const noTime = nextRows([{ row: row('a', { shownAt: undefined }), since: 1 }], { tabId: TAB, op: 'change', row: row('a', { shownAt: undefined }) }, 7)
    expect(noTime[0]?.since).toBe(7)
  })
})

describe('useBrowserChromeStore', () => {
  it('holds strip rows and the held count per tab, and drops a tab', () => {
    store().applyStrip({ tabId: TAB, op: 'add', row: row('a') }, 1)
    store().applyStrip({ tabId: TAB, op: 'held', count: 2 })
    expect(store().rows.get(TAB)).toHaveLength(1)
    expect(store().held.get(TAB)).toBe(2)
    store().applyStrip({ tabId: TAB, op: 'held', count: 0 })
    expect(store().held.has(TAB)).toBe(false)
    store().applyStrip({ tabId: TAB, op: 'withdraw', requestId: 'a' })
    expect(store().rows.has(TAB)).toBe(false)
    store().applyStrip({ tabId: TAB, op: 'add', row: row('b') })
    store().applyFind({ tabId: TAB, active: 1, total: 2 })
    store().openMenu({ tabId: TAB, menuId: 'm', items: ['reload'], linkOrigin: null, at: { x: 1, y: 1 } })
    store().dropTab(TAB)
    expect(store().rows.has(TAB)).toBe(false)
    expect(store().find.has(TAB)).toBe(false)
    expect(store().menu).toBeNull()
  })

  it('keeps another tab\'s menu when a tab is dropped, and closes the menu once', () => {
    const menu = { tabId: 'browser-tab-2', menuId: 'm', items: ['reload' as const], linkOrigin: null, at: { x: 1, y: 1 } }
    store().openMenu(menu)
    store().dropTab(TAB)
    expect(store().menu).toEqual(menu)
    store().closeMenu()
    const before = useBrowserChromeStore.getState()
    store().closeMenu()
    expect(useBrowserChromeStore.getState()).toBe(before)
    store().applyFind({ tabId: TAB, active: 0, total: 0 })
    store().clearFind(TAB)
    expect(store().find.size).toBe(0)
  })
})
