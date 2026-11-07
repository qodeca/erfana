// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What main asked the built-in browser's chrome to draw (spec 025, 025-FR-008,
 * 025-FR-054, 025-FR-057; solution design § 9.1, commit 18): each tab's strip
 * rows (`browser-tab:strip`), the requests held while a pick menu is open, the
 * newest find result, and the one page right-click menu that is open.
 *
 * Main is the record: this store only mirrors events, fed once per window by
 * `services/browser/browserTabEvents.ts`. A row keeps the renderer clock time
 * it appeared or changed, for the strip's input guard (`stripRows.logic.ts`);
 * main enforces the same guard on its own clock.
 */
import { create } from 'zustand'
import type { ContextMenuEvent, FindResultEvent } from '../../../shared/ipc/browser-tab-bridge-types'
import type { StripEvent, StripRow } from '../../../shared/ipc/browser-tab-schema'

/** A strip row as the renderer holds it. */
export interface ShownStripRow {
  readonly row: StripRow
  /** `performance.now()` when the row appeared or its content changed. */
  readonly since: number
}

/** Store contract. */
export interface BrowserChromeStoreState {
  /** Strip rows by tab, in arrival order (the strip sorts them by kind). */
  readonly rows: ReadonlyMap<string, readonly ShownStripRow[]>
  /** Site requests held while a pick menu or dialog is open, by tab (S-28). */
  readonly held: ReadonlyMap<string, number>
  /** The newest find result by tab. */
  readonly find: ReadonlyMap<string, FindResultEvent>
  /** The open page right-click menu, at most one per window. */
  readonly menu: ContextMenuEvent | null
  applyStrip: (event: StripEvent, now?: number) => void
  applyFind: (event: FindResultEvent) => void
  clearFind: (tabId: string) => void
  openMenu: (event: ContextMenuEvent) => void
  closeMenu: () => void
  /** The tab is gone: forget everything drawn for it. */
  dropTab: (tabId: string) => void
}

function without<T>(map: ReadonlyMap<string, T>, key: string): ReadonlyMap<string, T> {
  if (!map.has(key)) return map
  const next = new Map(map)
  next.delete(key)
  return next
}

function withValue<T>(map: ReadonlyMap<string, T>, key: string, value: T): ReadonlyMap<string, T> {
  const next = new Map(map)
  next.set(key, value)
  return next
}

/**
 * The tab's rows after one strip event.
 *
 * @param rows - The rows before
 * @param event - `add`, `change` or `withdraw` (`held` is not a row)
 * @param now - The renderer clock
 * @returns The rows after; an `add` of a known id replaces it
 */
export function nextRows(
  rows: readonly ShownStripRow[],
  event: Exclude<StripEvent, { op: 'held' }>,
  now: number
): readonly ShownStripRow[] {
  if (event.op === 'withdraw') return rows.filter(shown => shown.row.requestId !== event.requestId)
  const known = rows.findIndex(shown => shown.row.requestId === event.row.requestId)
  if (known < 0) return [...rows, { row: event.row, since: now }]
  const before = rows[known]
  // A change of the waiting count alone keeps the guard (main keeps `shownAt` then).
  const sameRequest = before.row.shownAt !== undefined && before.row.shownAt === event.row.shownAt
  const updated = { row: event.row, since: sameRequest ? before.since : now }
  return rows.map((shown, index) => (index === known ? updated : shown))
}

export const useBrowserChromeStore = create<BrowserChromeStoreState>(set => ({
  rows: new Map(),
  held: new Map(),
  find: new Map(),
  menu: null,

  applyStrip: (event, now = performance.now()) =>
    set(state => {
      if (event.op === 'held') {
        return {
          held: event.count === 0 ? without(state.held, event.tabId) : withValue(state.held, event.tabId, event.count)
        }
      }
      const rows = nextRows(state.rows.get(event.tabId) ?? [], event, now)
      return { rows: rows.length === 0 ? without(state.rows, event.tabId) : withValue(state.rows, event.tabId, rows) }
    }),

  applyFind: event => set(state => ({ find: withValue(state.find, event.tabId, event) })),

  clearFind: tabId => set(state => ({ find: without(state.find, tabId) })),

  openMenu: event => set({ menu: event }),

  closeMenu: () => set(state => (state.menu === null ? state : { menu: null })),

  dropTab: tabId =>
    set(state => ({
      rows: without(state.rows, tabId),
      held: without(state.held, tabId),
      find: without(state.find, tabId),
      menu: state.menu?.tabId === tabId ? null : state.menu
    }))
}))
