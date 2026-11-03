// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pick mode of each built-in browser tab as the renderer knows it (spec 025,
 * 025-FR-025 to 025-FR-031, 025-FR-053, 025-FR-065; solution design § 9.1,
 * commit 19). Main is the record: this store mirrors its `browser-tab:pick`
 * events – pick mode on or off, the hovered element's label, the status-slot
 * notes, "Capturing…", the held capture's summary, the freeze and the end of
 * a capture. The still image itself lives in `useBrowserStillStore`.
 *
 * - **`captured`** holds the capture's id and summary; the panel opens on it.
 * - **`refined`** replaces the summary and stamps the change, so the panel
 *   marks the element chip as changed for 1 s (deck *Path – current*).
 * - **`ended`** ends the capture. `pageChanged` – the page navigated while
 *   the panel or the dialog was open, and main kept the capture – keeps it,
 *   marked `afterNavigation`: the dialog may still send it, the panel closes
 *   (025-FR-053).
 * - A **note** carries a sequence number, so the same note twice restarts
 *   its timer.
 */
import { create } from 'zustand'
import type { PickEvent } from '../../../shared/ipc/browser-tab-schema'

export type PickNote = Extract<PickEvent, { kind: 'note' }>['note']
/** A status-slot note: main's, or the renderer's own "page changed" (025-FR-053). */
export type StatusNote = PickNote | 'pageChanged'
export type PickSummary = Extract<PickEvent, { kind: 'captured' }>['summary']
export type PickEndReason = Extract<PickEvent, { kind: 'ended' }>['reason']

/** The capture main holds for the open panel or dialog. */
export interface HeldCapture {
  readonly captureId: string
  readonly summary: PickSummary
  /** Renderer clock (`performance.now()`) of the last refinement, or `null`. */
  readonly changedAt: number | null
  /** The page navigated since the pick; only the dialog may still send it. */
  readonly afterNavigation: boolean
}

/** One tab's pick state. */
export interface BrowserPickTab {
  readonly on: boolean
  /** The hovered element's label (025-FR-026), echoed in the status slot. */
  readonly label: string | null
  readonly note: StatusNote | null
  /** Bumped with every note, so a repeated note restarts its timer. */
  readonly noteSeq: number
  readonly capturing: boolean
  readonly capture: HeldCapture | null
  readonly frozen: boolean
}

export const IDLE_PICK: BrowserPickTab = Object.freeze({
  on: false,
  label: null,
  note: null,
  noteSeq: 0,
  capturing: false,
  capture: null,
  frozen: false
})

/** Store contract. */
export interface BrowserPickStoreState {
  readonly byTab: ReadonlyMap<string, BrowserPickTab>
  /** Apply one `browser-tab:pick` event. */
  apply: (event: PickEvent, now?: number) => void
  /** Show a note the renderer itself decided (a refused Pick element on an empty tab). */
  showNote: (tabId: string, note: StatusNote) => void
  /** The note `seq` timed out; a newer note stays. */
  clearNote: (tabId: string, seq: number) => void
  /** The renderer closed the panel or dialog: the capture is no longer shown. */
  dropCapture: (tabId: string, captureId: string) => void
  /** The tab is gone. */
  forget: (tabId: string) => void
}

function update(
  byTab: ReadonlyMap<string, BrowserPickTab>,
  tabId: string,
  change: (tab: BrowserPickTab) => BrowserPickTab
): ReadonlyMap<string, BrowserPickTab> {
  const next = new Map(byTab)
  next.set(tabId, change(byTab.get(tabId) ?? IDLE_PICK))
  return next
}

/** What an `ended` event leaves: nothing held, except a page change's capture (025-FR-053). */
function ended(tab: BrowserPickTab, reason: PickEndReason): BrowserPickTab {
  const keep = reason === 'pageChanged' && tab.capture !== null
  return {
    ...tab,
    capturing: false,
    frozen: false,
    capture: keep && tab.capture !== null ? { ...tab.capture, afterNavigation: true } : null
  }
}

function reduce(tab: BrowserPickTab, event: PickEvent, now: number): BrowserPickTab {
  switch (event.kind) {
    case 'mode':
      return event.on ? { ...tab, on: true } : { ...tab, on: false, label: null, capturing: false }
    case 'highlight':
      return { ...tab, label: event.label }
    case 'note':
      return { ...tab, note: event.note, noteSeq: tab.noteSeq + 1 }
    case 'capturing':
      return { ...tab, capturing: true }
    case 'captured':
      return {
        ...tab,
        capturing: false,
        frozen: false,
        capture: { captureId: event.captureId, summary: event.summary, changedAt: null, afterNavigation: false }
      }
    case 'captureFailed':
      return { ...tab, capturing: false }
    case 'refined':
      if (tab.capture?.captureId !== event.captureId) return tab
      return { ...tab, capture: { ...tab.capture, summary: event.summary, changedAt: now } }
    case 'frozen':
      return tab.capture?.captureId === event.captureId ? { ...tab, frozen: true } : tab
    case 'ended':
      return ended(tab, event.reason)
  }
}

export const useBrowserPickStore = create<BrowserPickStoreState>(set => ({
  byTab: new Map(),

  apply: (event, now = performance.now()) =>
    set(state => ({ byTab: update(state.byTab, event.tabId, tab => reduce(tab, event, now)) })),

  showNote: (tabId, note) =>
    set(state => ({ byTab: update(state.byTab, tabId, tab => ({ ...tab, note, noteSeq: tab.noteSeq + 1 })) })),

  clearNote: (tabId, seq) =>
    set(state => {
      const tab = state.byTab.get(tabId)
      if (tab === undefined || tab.noteSeq !== seq || tab.note === null) return state
      return { byTab: update(state.byTab, tabId, current => ({ ...current, note: null })) }
    }),

  dropCapture: (tabId, captureId) =>
    set(state => {
      const tab = state.byTab.get(tabId)
      if (tab?.capture?.captureId !== captureId) return state
      return { byTab: update(state.byTab, tabId, current => ({ ...current, capture: null, frozen: false })) }
    }),

  forget: tabId =>
    set(state => {
      if (!state.byTab.has(tabId)) return state
      const byTab = new Map(state.byTab)
      byTab.delete(tabId)
      return { byTab }
    })
}))
