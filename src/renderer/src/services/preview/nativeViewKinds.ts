// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The kinds of native view the overlay guard owns (spec 025, ADR 0011
 * decision 2, commit 16): HTML preview views and built-in browser tab views.
 *
 * Every native view is composited above all of Erfana's DOM, so the same rule
 * decides each one:
 *
 * ```
 * visible = (its panel is the active tab) && !isOccluded() && gate === null
 * ```
 *
 * What differs per kind is only how a view is listed, gated and told – one
 * visibility API per kind, described by {@link NativeViewKind}. The guard
 * (`OverlayGuardService.ts`) applies the rule to every kind it is given.
 */
import type { PreviewChromeGateReason } from '../../stores/usePreviewChromeGateStore'
import type { BrowserViewBounds } from '../browser/browserViewBounds'

/**
 * Why one panel's page must stay hidden: a chrome-gate reason from the
 * preview's permission band, `'collapsed'` while the page area is clipped away
 * by a collapsed ancestor (issue #124 C2), or `'covered'` while the preview's
 * comments drawer is a full-width sheet over it. A browser view uses
 * `'collapsed'` and `'covered'` – the latter while Erfana's own DOM fills its
 * page area (an Erfana page, or the editor tab closing; ADR 0011 decision 5).
 */
export type NativeViewGate = PreviewChromeGateReason | 'collapsed' | 'covered'

/**
 * Reason strings sent with a visibility change (design §5(d)): a bounded free
 * string for main-side logging, not a closed enum.
 */
export const VISIBILITY_REASON = {
  /** The view's panel is the active tab and nothing occludes it. */
  activeTab: 'active-tab',
  /** Hidden because an overlay (dialog/toast/menu/…) is on screen. */
  occluded: 'occluded',
  /** Hidden because another tab is active. */
  inactiveTab: 'inactive-tab',
  /** Hidden because the page did not prove it moved out of Erfana's chrome. */
  chromeUnconfirmed: 'chrome-unconfirmed',
  /** Hidden because the panel is too short to share with an open host list. */
  chromeTooShort: 'chrome-too-short',
  /** Hidden because the panel's page area is clipped away (issue #124 C2). */
  collapsed: 'collapsed',
  /** Hidden because the panel's own comments drawer covers its page area. */
  covered: 'covered'
} as const

const GATE_REASON: Record<NativeViewGate, string> = {
  unconfirmed: VISIBILITY_REASON.chromeUnconfirmed,
  'too-short': VISIBILITY_REASON.chromeTooShort,
  collapsed: VISIBILITY_REASON.collapsed,
  covered: VISIBILITY_REASON.covered
}

/**
 * The reason sent with a computed visibility.
 *
 * Precedence when several apply: an inactive tab first, because it is the most
 * basic fact; then the gate, because it is the only one with a user-visible
 * explanation attached; then occlusion.
 *
 * @param visible - The computed visibility
 * @param active - Whether the view's panel is the active tab
 * @param gate - The panel's gate, or `null`
 * @returns One of {@link VISIBILITY_REASON}
 */
export function visibilityReason(visible: boolean, active: boolean, gate: NativeViewGate | null): string {
  if (visible) return VISIBILITY_REASON.activeTab
  if (!active) return VISIBILITY_REASON.inactiveTab
  return gate === null ? VISIBILITY_REASON.occluded : GATE_REASON[gate]
}

/** One native view: the id its kind's visibility API takes, and the editor panel hosting it. */
export interface NativeView {
  readonly viewId: string
  readonly panelId: string
}

/** How the guard lists, gates and tells the views of one kind. */
export interface NativeViewKind {
  /** Every view of this kind that main holds now (each with its own native view). */
  liveViews: () => readonly NativeView[]
  /** Notified after {@link liveViews} may have changed. */
  subscribe: (listener: () => void) => () => void
  /** Why the panel's page must stay hidden, or `null`. */
  getGate: (panelId: string) => NativeViewGate | null
  /** Notified after {@link getGate} may have changed. */
  subscribeGate: (listener: () => void) => () => void
  /** The kind's one visibility send. Fire-and-forget. */
  setVisibility: (viewId: string, visible: boolean, reason: string) => void
  /** Main's report of what it applied, for the guard's reconcile. Optional: no report means no reconcile. */
  subscribeVisibilityApplied?: (listener: (viewId: string, visible: boolean) => void) => () => void
}

/** The gate reads a browser view takes: its panel's collapsed flag, and whether Erfana's DOM covers its page area. */
export interface BrowserViewGateSource {
  isCollapsed: (panelId: string) => boolean
  /** Erfana's own DOM fills the page area (`useBrowserTabStore.coversPage`); absent means never. */
  isCovered?: (panelId: string) => boolean
  subscribe: (listener: () => void) => () => void
}

/**
 * The browser tab kind, over the browser view bounds owner.
 *
 * The `reason` is dropped: `browser-tab:bounds` has no reason field, and main
 * logs nothing per visibility change for browser views.
 *
 * @param views - The bounds owner (the one `browser-tab:bounds` sender)
 * @param gate - The collapsed-flag and covered reads
 * @returns The kind the guard drives
 */
export function createBrowserViewKind(views: BrowserViewBounds, gate: BrowserViewGateSource): NativeViewKind {
  return {
    liveViews: () => views.views().map((view) => ({ viewId: view.tabId, panelId: view.panelId })),
    subscribe: (listener) => views.subscribe(listener),
    getGate: (panelId) => {
      if (gate.isCollapsed(panelId)) return 'collapsed'
      return gate.isCovered?.(panelId) === true ? 'covered' : null
    },
    subscribeGate: (listener) => gate.subscribe(listener),
    setVisibility: (tabId, visible) => views.setVisibility(tabId, visible),
    subscribeVisibilityApplied: (listener) => views.onVisibilityApplied(listener)
  }
}
