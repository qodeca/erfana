// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The still-image path of a built-in browser tab (spec 025, 025-FR-054;
 * ADR 0011 decisions 1 and 3; design § Layout rules "Popups that would cross
 * into the page area"; commit 19).
 *
 * A native page is composited above Erfana's DOM, so a surface that draws over
 * the page area – the page right-click menu, More, the address suggestions,
 * the target chooser, the prompt-actions panel and the instruction dialog –
 * first swaps the page for a picture of it:
 *
 * 1. **Capture** – main's `still` (or the pick's own capture) goes into
 *    `useBrowserStillStore`, which the page area draws.
 * 2. **Paint, then cover** – after two frames the panel is marked covered
 *    (`useBrowserTabStore.setStillCover`); the native-view guard, which already
 *    reads `coversPage`, takes the page off screen. The order means the page
 *    goes only once its picture is on screen, so nothing flashes.
 * 3. **Return** – when the last holder lets go, the cover lifts first; the
 *    picture is dropped once main reports the page shown again, or after
 *    {@link STILL_RETURN_TIMEOUT_MS}, so no frame of Erfana's background shows
 *    between the two (ADR 0011 decision 3, "dropped after two presented frames").
 *
 * Holders are named, so the menu, the suggestions and the pick can overlap;
 * the picture stays while any holds it. A pick's capture replaces a page
 * picture: it is the moment the reviewer picked. A capture still in flight
 * when its holder lets go is thrown away.
 *
 * Only a live page needs this: an Erfana page is DOM already, so
 * {@link BrowserStill.hold} answers `false` and the caller opens its surface
 * at once. A failed capture also answers `false` – the surface still opens,
 * over Erfana's background as before (the native-view guard hides the page
 * for any app overlay).
 */
import type { StillResponse } from '../../../../shared/ipc/browser-tab-pick-schema'
import { useBrowserStillStore, type StillBitmap } from '../../stores/useBrowserStillStore'
import { useBrowserTabStore } from '../../stores/useBrowserTabStore'
import { browserTabGateway } from '../browserTabGateway'
import { browserViewBounds } from './browserViewBounds'
import { logger } from '../../utils/logger'

/** The holder name of the pick's capture (the prompt-actions panel and the instruction dialog). */
export const PICK_STILL_HOLDER = 'pick'
/** The holder name of the page right-click menu. */
export const CONTEXT_MENU_STILL_HOLDER = 'contextMenu'

/** Longest wait for main to report the page back before the picture goes anyway. */
export const STILL_RETURN_TIMEOUT_MS = 300

/** What the still path needs from the window. */
export interface BrowserStillDeps {
  /** Main's picture of the tab's page. */
  readonly capture: (tabId: string) => Promise<StillResponse>
  /** Resolves after the next animation frame. */
  readonly nextFrame: () => Promise<void>
  /** The editor panel hosting `tabId`, and whether its page is live (no Erfana page). */
  readonly panelOf: (tabId: string) => { readonly panelId: string; readonly live: boolean } | null
  /** Show or drop the picture. */
  readonly setImage: (tabId: string, image: StillBitmap | null, source: 'pick' | 'page') => void
  readonly setCover: (panelId: string, covered: boolean) => void
  /** Calls `done` once main reports `tabId`'s page shown again, or after the timeout; returns a cancel. */
  readonly whenShown: (tabId: string, done: () => void) => () => void
}

/** The still path of every browser tab in this window. */
export interface BrowserStill {
  /**
   * Take a picture of the page and cover it, for `holder`.
   *
   * @returns `true` once the picture is on screen and the page is going;
   *   `false` when there is no live page or no picture could be taken
   */
  hold: (tabId: string, holder: string) => Promise<boolean>
  /** Show the pick's capture as the picture, for `holder` (the prompt-actions panel and dialog). */
  showPick: (tabId: string, holder: string, image: StillBitmap) => Promise<boolean>
  /** `holder` is done; the page returns when no one holds the picture. */
  release: (tabId: string, holder: string) => void
  /** Whether `holder` holds `tabId`'s picture. */
  holds: (tabId: string, holder: string) => boolean
}

interface TabHold {
  readonly holders: Set<string>
  /** Bumped by every new picture and every full release; an older capture is dropped. */
  generation: number
  cancelReturn: (() => void) | null
}

/**
 * Builds the still path over its deps.
 *
 * @param deps - {@link BrowserStillDeps}
 * @returns The still path
 *
 * @example
 * ```ts
 * if (await browserStill.hold(tabId, 'more')) openMenu()
 * else openMenu() // over Erfana's background
 * browserStill.release(tabId, 'more') // on close
 * ```
 */
export function createBrowserStill(deps: BrowserStillDeps): BrowserStill {
  const tabs = new Map<string, TabHold>()

  const entry = (tabId: string): TabHold => {
    let hold = tabs.get(tabId)
    if (hold === undefined) {
      hold = { holders: new Set(), generation: 0, cancelReturn: null }
      tabs.set(tabId, hold)
    }
    return hold
  }

  /** Put `image` up for `holder`, then cover the page once it has painted. */
  const present = async (tabId: string, holder: string, image: StillBitmap, source: 'pick' | 'page'): Promise<boolean> => {
    const panel = deps.panelOf(tabId)
    const hold = entry(tabId)
    if (panel === null || !panel.live || !hold.holders.has(holder)) return false
    hold.cancelReturn?.()
    hold.cancelReturn = null
    const generation = ++hold.generation
    deps.setImage(tabId, image, source)
    await deps.nextFrame()
    await deps.nextFrame()
    if (hold.generation !== generation || !hold.holders.has(holder)) return false
    deps.setCover(panel.panelId, true)
    return true
  }

  return {
    hold: async (tabId, holder) => {
      const panel = deps.panelOf(tabId)
      if (panel === null || !panel.live) return false
      const hold = entry(tabId)
      hold.holders.add(holder)
      const generation = hold.generation
      let answer: StillResponse
      try {
        answer = await deps.capture(tabId)
      } catch (error) {
        logger.warn('Browser still image failed', { error: error instanceof Error ? error.message : String(error) })
        return false
      }
      if (!hold.holders.has(holder) || hold.generation !== generation) return false
      if ('error' in answer) {
        logger.debug('Browser still image not taken', { reason: answer.error })
        return false
      }
      return present(tabId, holder, { data: answer.still, width: answer.width, height: answer.height }, 'page')
    },

    showPick: async (tabId, holder, image) => {
      entry(tabId).holders.add(holder)
      return present(tabId, holder, image, 'pick')
    },

    release: (tabId, holder) => {
      const hold = tabs.get(tabId)
      if (hold === undefined || !hold.holders.delete(holder) || hold.holders.size > 0) return
      hold.generation++
      const panel = deps.panelOf(tabId)
      if (panel !== null) deps.setCover(panel.panelId, false)
      hold.cancelReturn?.()
      hold.cancelReturn = deps.whenShown(tabId, () => {
        hold.cancelReturn = null
        if (hold.holders.size === 0) deps.setImage(tabId, null, 'page')
      })
    },

    holds: (tabId, holder) => tabs.get(tabId)?.holders.has(holder) ?? false
  }
}

/** Resolves after the next animation frame. */
function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

/** Main reports the page back (its answer to the guard's `ack`), or the timeout passes. */
function whenShown(tabId: string, done: () => void): () => void {
  let settled = false
  const finish = (): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    off()
    done()
  }
  const off = browserViewBounds.onVisibilityApplied((shownTab, visible) => {
    if (shownTab === tabId && visible) finish()
  })
  const timer = setTimeout(finish, STILL_RETURN_TIMEOUT_MS)
  return () => {
    settled = true
    clearTimeout(timer)
    off()
  }
}

/** The production still path. */
export const browserStill: BrowserStill = createBrowserStill({
  capture: tabId => browserTabGateway.still(tabId),
  nextFrame,
  panelOf: tabId => {
    const entry = useBrowserTabStore.getState().byTab.get(tabId)
    if (entry === undefined) return null
    return { panelId: entry.panelId, live: entry.state !== null && entry.state.erfanaPage === null }
  },
  setImage: (tabId, image, source) => {
    const store = useBrowserStillStore.getState()
    if (image === null) store.clear(tabId)
    else store.set(tabId, { image, source })
  },
  setCover: (panelId, covered) => useBrowserTabStore.getState().setStillCover(panelId, covered),
  whenShown
})
