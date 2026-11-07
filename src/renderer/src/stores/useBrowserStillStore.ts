// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The still image each built-in browser tab shows in its page area while an
 * Erfana surface draws over it (spec 025, 025-FR-054; ADR 0011 decisions 1
 * and 3; commit 19): the pick's capture under the prompt-actions panel and
 * the instruction dialog, or a fresh picture under a menu or the address
 * suggestions. Written only by `services/browser/browserStill.ts`, which
 * also decides when the page goes off screen; the page area draws it.
 *
 * The bitmap is main's raw BGRA, as it arrived; the page area converts it
 * once when it draws.
 */
import { create } from 'zustand'

/** A raw BGRA bitmap. */
export interface StillBitmap {
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
}

/** What a tab's page area shows over the page. */
export interface TabStill {
  readonly image: StillBitmap
  /** `pick` – the capture of a confirmed pick; `page` – a picture taken for a menu or suggestions. */
  readonly source: 'pick' | 'page'
}

/** Store contract. */
export interface BrowserStillStoreState {
  readonly byTab: ReadonlyMap<string, TabStill>
  set: (tabId: string, still: TabStill) => void
  clear: (tabId: string) => void
}

export const useBrowserStillStore = create<BrowserStillStoreState>(set => ({
  byTab: new Map(),
  set: (tabId, still) =>
    set(state => {
      const byTab = new Map(state.byTab)
      byTab.set(tabId, still)
      return { byTab }
    }),
  clear: tabId =>
    set(state => {
      if (!state.byTab.has(tabId)) return state
      const byTab = new Map(state.byTab)
      byTab.delete(tabId)
      return { byTab }
    })
}))
