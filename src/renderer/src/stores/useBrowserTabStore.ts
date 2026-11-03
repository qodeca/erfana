// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The built-in browser's tabs as the renderer knows them (spec 025, solution
 * design § 9.1, commit 17): which editor panel hosts which main-minted tab,
 * the newest `browser-tab:state` of each, whether its page has keyboard focus,
 * and the local addresses the project's terminals printed this session
 * (025-FR-063).
 *
 * Main is the record: this store only mirrors what main sent. It outlives a
 * panel's React tree – an error-boundary remount must not lose the tab – and
 * an entry goes only when the editor tab is closed
 * (`services/browser/browserTabLifecycle.ts`).
 *
 * The site icon arrives as PNG bytes; it is kept as a `data:` URL (the
 * renderer's CSP allows `data:` images, not `blob:`), and only when the bytes
 * start with the PNG signature.
 */
import { create } from 'zustand'
import type { TabStateEvent } from '../../../shared/ipc/browser-tab-schema'

/** A tab's state without the icon bytes (kept as {@link BrowserTabEntry.iconUrl}). */
export type BrowserTabState = Omit<TabStateEvent, 'icon'>

/** One browser tab hosted by an editor panel. */
export interface BrowserTabEntry {
  readonly tabId: string
  readonly panelId: string
  /** `null` until main's first state event. */
  readonly state: BrowserTabState | null
  /** The site icon as a `data:` URL, or `null` for the generic icon. */
  readonly iconUrl: string | null
  /** Whether the page (not the toolbar) has keyboard focus. */
  readonly pageFocused: boolean
}

/**
 * How many not-yet-hosted tabs' newest states are kept. Main sends a new
 * tab's first state before `create` answers, and a page-opened tab's before
 * its editor tab mounts, so a state can arrive for a tab no panel hosts yet.
 */
export const UNHOSTED_STATE_LIMIT = 32

/** How many local addresses the empty tab can list; older ones drop off. */
export const LOCAL_ADDRESS_LIMIT = 20

/** Store contract. */
export interface BrowserTabStoreState {
  readonly byTab: ReadonlyMap<string, BrowserTabEntry>
  readonly tabByPanel: ReadonlyMap<string, string>
  /** Newest state of tabs no panel hosts yet, applied when one does. */
  readonly unhosted: ReadonlyMap<string, BrowserTabEntry>
  /** Panels whose editor tab is closing: their page is hidden at once. */
  readonly closing: ReadonlySet<string>
  /** Local addresses seen in this window's terminals this session, newest first. */
  readonly localAddresses: readonly string[]
  /** Panels whose page area shows a still image over the page (ADR 0011, commit 19). */
  readonly stillCovers: ReadonlySet<string>
  /** `tabId` is now hosted by `panelId`. */
  attach: (panelId: string, tabId: string) => void
  /** Apply main's state event; kept aside for a tab no panel hosts yet. */
  applyState: (event: TabStateEvent) => void
  setPageFocused: (tabId: string, focused: boolean) => void
  /** The editor tab is closing: hide its page before anything else happens. */
  markClosing: (panelId: string) => void
  /** Forget a panel and its tab. */
  removePanel: (panelId: string) => void
  /** Record a local address seen in a terminal (`localAddressSeen` notice). */
  addLocalAddress: (address: string) => void
  /** The still image has painted over the page (`true`), or the page may come back (`false`). */
  setStillCover: (panelId: string, covered: boolean) => void
  /** The tab hosted by `panelId`, or `null`. */
  tabOf: (panelId: string) => string | null
  /**
   * Whether Erfana's own DOM – not the page – fills the panel's page area: no
   * tab or no state yet, an Erfana page (empty, certificate, load error,
   * crashed – ADR 0011 decision 5), a still image under an Erfana surface
   * (ADR 0011 decision 3), or the editor tab is closing. Fails closed: an
   * unknown panel counts as covered.
   */
  coversPage: (panelId: string) => boolean
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Bytes per `String.fromCharCode` call, under the engine's argument limit. */
const BASE64_CHUNK = 0x8000

/**
 * A PNG's `data:` URL, or `null` when the bytes are not a PNG.
 *
 * @param bytes - The icon main sent (at most 64 KiB, schema-checked)
 * @returns The `data:image/png;base64,…` URL, or `null`
 *
 * @example
 * ```ts
 * pngDataUrl(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) // 'data:image/png;base64,iVBORw0KGgo='
 * pngDataUrl(new Uint8Array([1, 2, 3])) // null
 * ```
 */
export function pngDataUrl(bytes: Uint8Array): string | null {
  if (bytes.byteLength < PNG_SIGNATURE.length) return null
  if (PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) return null
  let binary = ''
  for (let start = 0; start < bytes.byteLength; start += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + BASE64_CHUNK))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

/** The icon after an event: `undefined` keeps the current one, `null` clears it. */
function nextIcon(current: string | null, icon: TabStateEvent['icon']): string | null {
  if (icon === undefined) return current
  return icon === null ? null : pngDataUrl(icon)
}

function withEntry(
  byTab: ReadonlyMap<string, BrowserTabEntry>,
  entry: BrowserTabEntry
): ReadonlyMap<string, BrowserTabEntry> {
  const next = new Map(byTab)
  next.set(entry.tabId, entry)
  return next
}

export const useBrowserTabStore = create<BrowserTabStoreState>((set, get) => ({
  byTab: new Map(),
  tabByPanel: new Map(),
  unhosted: new Map(),
  closing: new Set(),
  localAddresses: [],
  stillCovers: new Set(),

  attach: (panelId, tabId) =>
    set(state => {
      if (state.tabByPanel.get(panelId) === tabId) return state
      const tabByPanel = new Map(state.tabByPanel)
      tabByPanel.set(panelId, tabId)
      const early = state.unhosted.get(tabId)
      const entry: BrowserTabEntry = {
        tabId,
        panelId,
        state: early?.state ?? null,
        iconUrl: early?.iconUrl ?? null,
        pageFocused: false
      }
      const unhosted = new Map(state.unhosted)
      unhosted.delete(tabId)
      return {
        tabByPanel,
        unhosted,
        byTab: withEntry(state.byTab, state.byTab.get(tabId) ?? entry)
      }
    }),

  applyState: event =>
    set(state => {
      const { icon, ...rest } = event
      const entry = state.byTab.get(event.tabId)
      if (entry !== undefined) {
        return {
          byTab: withEntry(state.byTab, {
            ...entry,
            state: rest,
            iconUrl: nextIcon(entry.iconUrl, icon)
          })
        }
      }
      const early = state.unhosted.get(event.tabId)
      const unhosted = new Map(state.unhosted)
      unhosted.delete(event.tabId)
      unhosted.set(event.tabId, {
        tabId: event.tabId,
        panelId: '',
        state: rest,
        iconUrl: nextIcon(early?.iconUrl ?? null, icon),
        pageFocused: false
      })
      // Oldest first in insertion order: drop from the front past the cap.
      for (const oldest of unhosted.keys()) {
        if (unhosted.size <= UNHOSTED_STATE_LIMIT) break
        unhosted.delete(oldest)
      }
      return { unhosted }
    }),

  setPageFocused: (tabId, focused) =>
    set(state => {
      const entry = state.byTab.get(tabId)
      if (entry === undefined || entry.pageFocused === focused) return state
      return { byTab: withEntry(state.byTab, { ...entry, pageFocused: focused }) }
    }),

  markClosing: panelId =>
    set(state => {
      if (state.closing.has(panelId)) return state
      const closing = new Set(state.closing)
      closing.add(panelId)
      return { closing }
    }),

  removePanel: panelId =>
    set(state => {
      const tabId = state.tabByPanel.get(panelId)
      if (tabId === undefined && !state.closing.has(panelId)) return state
      const tabByPanel = new Map(state.tabByPanel)
      tabByPanel.delete(panelId)
      const byTab = new Map(state.byTab)
      if (tabId !== undefined) byTab.delete(tabId)
      const closing = new Set(state.closing)
      closing.delete(panelId)
      const stillCovers = new Set(state.stillCovers)
      stillCovers.delete(panelId)
      return { tabByPanel, byTab, closing, stillCovers }
    }),

  addLocalAddress: address =>
    set(state => {
      const trimmed = address.trim()
      if (trimmed === '' || state.localAddresses[0] === trimmed) return state
      const rest = state.localAddresses.filter(seen => seen !== trimmed)
      return { localAddresses: [trimmed, ...rest].slice(0, LOCAL_ADDRESS_LIMIT) }
    }),

  setStillCover: (panelId, covered) =>
    set(state => {
      if (state.stillCovers.has(panelId) === covered) return state
      const stillCovers = new Set(state.stillCovers)
      if (covered) stillCovers.add(panelId)
      else stillCovers.delete(panelId)
      return { stillCovers }
    }),

  tabOf: panelId => get().tabByPanel.get(panelId) ?? null,

  coversPage: panelId => {
    const { closing, tabByPanel, byTab, stillCovers } = get()
    if (closing.has(panelId) || stillCovers.has(panelId)) return true
    const tabId = tabByPanel.get(panelId)
    const pageState = tabId === undefined ? null : (byTab.get(tabId)?.state ?? null)
    return pageState === null || pageState.erfanaPage !== null
  }
}))
