// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The one sender of `browser-tab:bounds` (spec 025, solution design § 9,
 * commit 16; ADR 0011 decision 2).
 *
 * A browser tab's page is shown or hidden only through its bounds push: main
 * attaches the view on a `visible` push and detaches it on a hidden one
 * (`BrowserTab.applyBounds`). Two writers feed that one message, and this
 * module merges them so neither can undo the other:
 *
 * - **Where** – the panel's bounds hook calls {@link BrowserViewBounds.place}
 *   with the measured page area and clip.
 * - **Whether** – the native-view guard calls
 *   {@link BrowserViewBounds.setVisibility}, and nothing else does (the same
 *   single-owner rule as the preview's `setVisibility`).
 *
 * FAILS CLOSED. A view starts not wanted, so a placement alone never shows a
 * page: only the guard's `true` does. A guard that does not know the view (not
 * registered, kind not wired) therefore leaves it hidden.
 *
 * ONE SEQUENCE. Every push takes the next number of one counter, so the newest
 * push wins in main whichever writer sent it (main drops `seq` ≤ the last
 * applied). Guard pushes ask for an `ack`, so main's confirmation can end the
 * splitter hold. The production instance hears main's answers
 * (`browser-tab:boundsApplied`) while a tab is registered and someone listens.
 *
 * Pure: the sender is injected. {@link browserViewBounds} is the production
 * instance, wired to `browserTabGateway.setBounds`.
 */
import type { BoundsRequest, BrowserRect } from '../../../../shared/ipc/browser-tab-schema'
import { browserTabGateway } from '../browserTabGateway'

/** Where a tab's page sits: the page area, and the clipping panel (ADR 0011 decision 6). */
export interface BrowserViewPlacement {
  readonly bounds: BrowserRect
  readonly clip: BrowserRect
}

/** A registered browser view: main's tab id and the editor panel that hosts it. */
export interface BrowserView {
  readonly tabId: string
  readonly panelId: string
}

/** The bounds owner of every browser view in this window. */
export interface BrowserViewBounds {
  /** A tab's view now exists for `panelId`; the guard starts deciding its visibility. */
  register: (tabId: string, panelId: string) => void
  /** The tab closed or its panel unmounted; nothing more is sent for it. */
  unregister: (tabId: string) => void
  /**
   * Record where the page goes. Sent at once while the guard wants the page
   * shown (even when unchanged – a forced push); otherwise kept for the show.
   * Ignored for a tab that is not registered.
   */
  place: (tabId: string, placement: BrowserViewPlacement, ack?: boolean) => void
  /**
   * Show or hide the page. **The native-view guard is the only caller.** Sent
   * on every call once a placement is known – the guard sends only on a change
   * or to correct a report from main, so a dedupe here would swallow that
   * correction. An unplaced view has never been attached, so there is nothing
   * to hide, and the first {@link place} carries the show.
   */
  setVisibility: (tabId: string, visible: boolean) => void
  /** Every registered view, in registration order. */
  views: () => readonly BrowserView[]
  /** The tab hosted by `panelId`, or `null`. */
  tabOf: (panelId: string) => string | null
  /** Notified after a view is registered or unregistered. */
  subscribe: (listener: () => void) => () => void
  /** Main confirmed what it did with a tab's view (its answer to an `ack`). */
  reportApplied: (tabId: string, visible: boolean) => void
  /** Hears {@link reportApplied}, for registered tabs only. */
  onVisibilityApplied: (listener: (tabId: string, visible: boolean) => void) => () => void
}

interface ViewEntry {
  panelId: string
  placement: BrowserViewPlacement | null
  wanted: boolean
}

/**
 * Builds a bounds owner around a sender.
 *
 * @param send - Delivers one `browser-tab:bounds` push to main
 * @param subscribeApplied - Hears main's `ack` answers; subscribed while
 *   {@link BrowserViewBounds.onVisibilityApplied} has a listener
 * @returns The bounds owner
 *
 * @example
 * ```ts
 * const views = createBrowserViewBounds((request) => sent.push(request))
 * views.register('browser-tab-1', 'browser-panel-1')
 * views.place('browser-tab-1', { bounds, clip }) // kept: not wanted yet
 * views.setVisibility('browser-tab-1', true) // → { visible: true, seq: 0, … }
 * ```
 */
export function createBrowserViewBounds(
  send: (request: BoundsRequest) => void,
  subscribeApplied?: (report: (tabId: string, visible: boolean) => void) => () => void
): BrowserViewBounds {
  let upstream: (() => void) | undefined
  const entries = new Map<string, ViewEntry>()
  const listeners = new Set<() => void>()
  const appliedListeners = new Set<(tabId: string, visible: boolean) => void>()
  /** Hear main's answers only while a tab is registered and someone listens. */
  const syncUpstream = (): void => {
    const wanted = subscribeApplied !== undefined && entries.size > 0 && appliedListeners.size > 0
    if (wanted && upstream === undefined) upstream = subscribeApplied(reportApplied)
    if (!wanted && upstream !== undefined) {
      upstream()
      upstream = undefined
    }
  }
  const reportApplied = (tabId: string, visible: boolean): void => {
    if (!entries.has(tabId)) return
    for (const listener of [...appliedListeners]) listener(tabId, visible)
  }
  let nextSeq = 0

  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const push = (tabId: string, entry: ViewEntry, placement: BrowserViewPlacement, ack: boolean): void => {
    send({
      tabId,
      bounds: placement.bounds,
      clip: placement.clip,
      seq: nextSeq++,
      ack,
      visible: entry.wanted
    })
  }

  return {
    register: (tabId, panelId) => {
      const current = entries.get(tabId)
      if (current?.panelId === panelId) return
      // A re-host under a new panel keeps the placement and the guard's wish
      // out: the new panel measures afresh and the guard decides afresh.
      entries.set(tabId, { panelId, placement: null, wanted: false })
      syncUpstream()
      notify()
    },

    unregister: (tabId) => {
      if (!entries.delete(tabId)) return
      syncUpstream()
      notify()
    },

    place: (tabId, placement, ack = false) => {
      const entry = entries.get(tabId)
      if (entry === undefined) return
      entry.placement = placement
      if (entry.wanted) push(tabId, entry, placement, ack)
    },

    setVisibility: (tabId, visible) => {
      const entry = entries.get(tabId)
      if (entry === undefined) return
      entry.wanted = visible
      if (entry.placement !== null) push(tabId, entry, entry.placement, true)
    },

    views: () => [...entries].map(([tabId, entry]) => ({ tabId, panelId: entry.panelId })),

    tabOf: (panelId) => {
      for (const [tabId, entry] of entries) {
        if (entry.panelId === panelId) return tabId
      }
      return null
    },

    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    reportApplied,

    onVisibilityApplied: (listener) => {
      appliedListeners.add(listener)
      syncUpstream()
      return () => {
        appliedListeners.delete(listener)
        syncUpstream()
      }
    }
  }
}

/** The production bounds owner, sending through the browser tab gateway. */
export const browserViewBounds: BrowserViewBounds = createBrowserViewBounds(
  (request) => browserTabGateway.setBounds(request),
  (report) => browserTabGateway.onBoundsApplied((event) => report(event.tabId, event.visible))
)
