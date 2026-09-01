// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Overlay guard service (Issue #74, work item 69; design §1.8, §5(d)).
 *
 * The SINGLE owner of preview show/hide. It watches two renderer signals — the
 * occluder store (any dialog/settings/toast/menu/full-screen overlay on screen)
 * and the preview store (which panel holds the one live `WebContentsView`) —
 * and the active dockview tab (fed in via {@link IOverlayGuard.sync}). It sends
 * `preview:setVisibility` for the live preview panel whenever the computed
 * visibility changes:
 *
 * ```
 * visible = (live preview is the active tab) && !isOccluded()
 * ```
 *
 * **This is the ONLY file in `src/renderer/**` allowed to call
 * `api.preview.setVisibility`.** An ESLint `no-restricted-syntax` rule (item 84,
 * a separate batch) enforces that every other renderer module goes through this
 * guard rather than poking main-side visibility directly, so hide/show ordering
 * (capture-before-hide, single application site) has exactly one owner.
 *
 * Why this must be the sole owner (design §5(d)): main captures a still frame
 * *before* hiding, and re-adds the child view topmost on show. A second caller
 * racing `setVisibility` would flap the view, waste a `capturePage`, and flash.
 *
 * Dependency-injected so it is unit-testable with no real `window.api` or
 * zustand store: {@link createOverlayGuard} takes an {@link OverlayGuardDeps};
 * {@link getOverlayGuard} wires the real stores + bridge for production.
 */

import { useOverlayOccluderStore } from '../../stores/useOverlayOccluderStore'
import { usePreviewStore } from '../../stores/usePreviewStore'
import {
  usePreviewChromeGateStore,
  type PreviewChromeGateReason
} from '../../stores/usePreviewChromeGateStore'
import { logger } from '../../utils/logger'

/**
 * Reason strings sent alongside `preview:setVisibility` (design §5(d)).
 *
 * The IPC `reason` is a bounded free string for main-side logging, NOT a closed
 * enum (see `OccluderKind`'s doc comment) — so a coarse cause here is fine. The
 * occluder store only exposes a boolean, so the guard cannot name the exact
 * overlay kind; it distinguishes the three cases it can tell apart.
 */
const VISIBILITY_REASON = {
  /** Live preview is the active tab and nothing occludes it. */
  activeTab: 'active-tab',
  /** Hidden because an overlay (dialog/toast/menu/…) is on screen. */
  occluded: 'occluded',
  /** Hidden because another tab is active. */
  inactiveTab: 'inactive-tab',
  /** Hidden because the page did not prove it moved out of Erfana's chrome. */
  chromeUnconfirmed: 'chrome-unconfirmed',
  /** Hidden because the panel is too short to share with an open host list. */
  chromeTooShort: 'chrome-too-short'
} as const

/**
 * Everything the guard needs from the outside world.
 *
 * Injected rather than imported so the guard is testable with plain fakes and
 * so the "only `setVisibility` caller" invariant is a single, movable seam. The
 * production wiring in {@link getOverlayGuard} passes the real stores + bridge.
 */
export interface OverlayGuardDeps {
  /**
   * @returns `true` while any overlay currently occludes the preview.
   * Reads the *live* occluder counts (synchronous), matching the store getter.
   */
  isOccluded: () => boolean
  /**
   * Why one panel's page must stay hidden, or null.
   *
   * REQUIRED, not optional. An optional dep defaulting to "never gated" fails
   * OPEN — the page stays visible over a permission prompt — and this is the one
   * input where the safe default is the restrictive one.
   */
  getPanelGate: (panelId: string) => PreviewChromeGateReason | null
  /** Notify on gate changes, so the guard recomputes. Returns an unsubscribe. */
  subscribeGate: (listener: () => void) => () => void
  /**
   * Subscribe to occluder-count changes.
   * @param listener - Called (no args) after any occluder count changes.
   * @returns An unsubscribe function.
   */
  subscribeOccluded: (listener: () => void) => () => void
  /**
   * @returns The panel ids of every live preview (each owning its own
   * `WebContentsView`). Derived from the preview store's per-panel load state —
   * a panel is live once it has left `'idle'` and until it is removed or
   * suspended.
   */
  getLivePreviewPanelIds: () => readonly string[]
  /**
   * Subscribe to preview-store changes (load state, panel add/remove).
   * @param listener - Called (no args) after any preview-store change.
   * @returns An unsubscribe function.
   */
  subscribePreview: (listener: () => void) => () => void
  /**
   * Fire-and-forget visibility send to main. In production this is
   * `window.api.preview.setVisibility` — the ONE permitted call site.
   * @param panelId - The live preview panel.
   * @param visible - Whether the view should be shown.
   * @param reason - Advisory cause, for main-side logging.
   */
  setVisibility: (panelId: string, visible: boolean, reason: string) => void
}

/**
 * Public surface of the overlay guard.
 *
 * @see {@link createOverlayGuard} to build one, {@link getOverlayGuard} for the
 * production singleton.
 */
export interface IOverlayGuard {
  /**
   * Records the currently active dockview tab and recomputes visibility.
   *
   * Called from `EditorAreaSplitPanel`'s `onDidActivePanelChange` (item 80): a
   * tab switch changes no occluder count, so without this the "hide the preview
   * when you switch away / show it when you switch back" path has no trigger
   * (design §1.8 X18). Also safe to call after any external state change to
   * force a recompute.
   *
   * @param activeTabId - The active tab's panel id, or `null` when none.
   */
  sync: (activeTabId: string | null) => void
  /** Detaches both store subscriptions. Idempotent. */
  dispose: () => void
}

/**
 * Owns preview show/hide. Constructed with injected {@link OverlayGuardDeps}.
 *
 * Holds two pieces of state: the active tab id (from {@link sync}), and the last
 * visibility sent PER live panel — so `setVisibility` fires only when a value
 * changes.
 *
 * Several previews can be live at once (sd-074b D5), but only one editor tab is
 * visible at a time: dockview drag-and-drop is disabled and no call site creates
 * a positioned group, so exactly one live panel computes `true` and the rest
 * compute `false`. That assumption is not enforced by the layout, so it is
 * asserted here in development rather than left implicit.
 */
class OverlayGuardService implements IOverlayGuard {
  /** The active dockview tab id, or `null` before the first {@link sync}. */
  private activeTabId: string | null = null

  /**
   * Last visibility sent per live panel. A panel absent from the map has never
   * been sent one, so its first computed value is always sent; entries are
   * pruned when a panel stops being live, so a re-opened panel is treated as
   * new rather than inheriting a stale value.
   */
  private readonly lastVisible = new Map<string, boolean>()

  private readonly unsubscribers: Array<() => void> = []

  constructor(private readonly deps: OverlayGuardDeps) {
    // Recompute whenever either signal changes. `sync` covers the third trigger
    // (tab activation), which neither store observes.
    this.unsubscribers.push(deps.subscribeOccluded(() => this.recompute()))
    this.unsubscribers.push(deps.subscribePreview(() => this.recompute()))
    this.unsubscribers.push(deps.subscribeGate(() => this.recompute()))
  }

  sync(activeTabId: string | null): void {
    this.activeTabId = activeTabId
    this.recompute()
  }

  dispose(): void {
    while (this.unsubscribers.length > 0) {
      this.unsubscribers.pop()?.()
    }
  }

  /**
   * Computes `visible = isActiveTab && !isOccluded()` for EVERY live preview and
   * sends `setVisibility` only where it differs from the last sent value.
   *
   * Panels that are no longer live are pruned from the cache; main destroyed
   * their views, so there is nothing left to hide.
   */
  private recompute(): void {
    const livePanelIds = this.deps.getLivePreviewPanelIds()

    // Prune panels that stopped being live, so a re-open starts from unknown.
    const live = new Set(livePanelIds)
    for (const panelId of [...this.lastVisible.keys()]) {
      if (!live.has(panelId)) {
        this.lastVisible.delete(panelId)
      }
    }

    if (livePanelIds.length === 0) return

    const occluded = this.deps.isOccluded()
    let visibleCount = 0

    for (const panelId of livePanelIds) {
      // The gate is per PANEL: a band waiting on one preview must not blank a
      // second preview in a split view, which is exactly what routing this
      // through the global occluder store would have done.
      const gate = this.deps.getPanelGate(panelId)
      const visible = this.activeTabId === panelId && !occluded && gate === null
      if (visible) visibleCount += 1

      if (this.lastVisible.get(panelId) === visible) continue

      this.lastVisible.set(panelId, visible)
      // Precedence when several apply: an inactive tab first, because it is the
      // most basic fact; then the gate, because it is the only one with a
      // user-visible explanation attached to it; then occlusion.
      const reason = visible
        ? VISIBILITY_REASON.activeTab
        : this.activeTabId !== panelId
          ? VISIBILITY_REASON.inactiveTab
          : gate === 'unconfirmed'
            ? VISIBILITY_REASON.chromeUnconfirmed
            : gate === 'too-short'
              ? VISIBILITY_REASON.chromeTooShort
              : VISIBILITY_REASON.occluded
      this.deps.setVisibility(panelId, visible, reason)
    }

    // The one-visible-tab assumption is a consequence of `disableDnd`, not
    // something the layout enforces. If it ever breaks, two native views would
    // paint at once and the symptom (a view over the wrong group) is baffling —
    // so say so loudly here instead.
    if (visibleCount > 1 && import.meta.env.DEV) {
      logger.warn('Overlay guard computed more than one visible preview', {
        visibleCount,
        livePanelIds: [...livePanelIds]
      })
    }
  }
}

/**
 * Builds an overlay guard from injected dependencies.
 *
 * @param deps - The store readers/subscribers and the `setVisibility` sink.
 * @returns A guard; call {@link IOverlayGuard.sync} on active-tab change and
 * {@link IOverlayGuard.dispose} on teardown.
 *
 * @example Unit test with fakes (no real window.api)
 * ```ts
 * const sent: Array<[string, boolean]> = []
 * const guard = createOverlayGuard({
 *   isOccluded: () => occluded,
 *   subscribeOccluded: () => () => {},
 *   getLivePreviewPanelIds: () => ['preview-1'],
 *   subscribePreview: () => () => {},
 *   setVisibility: (id, v) => sent.push([id, v])
 * })
 * guard.sync('preview-1') // → setVisibility('preview-1', true, 'active-tab')
 * ```
 */
export function createOverlayGuard(deps: OverlayGuardDeps): IOverlayGuard {
  return new OverlayGuardService(deps)
}

/**
 * Reads every live preview panel id from the preview store.
 *
 * A panel is "live" once it has left the initial `'idle'` load state (main emits
 * `loadStateChanged` on open) and until it is removed or `suspended`. A
 * suspended panel has no `WebContentsView` — main tore it down to a still frame
 * — so it must NOT receive visibility messages.
 *
 * Map iteration order is irrelevant here now that every live panel is returned,
 * which retires the ordering caveat the single-view version carried.
 *
 * @returns The live preview panel ids; empty when no preview is live.
 */
function readLivePreviewPanelIds(): readonly string[] {
  const { panels } = usePreviewStore.getState()
  const livePanelIds: string[] = []
  for (const [panelId, state] of panels) {
    if (state.loadState !== 'idle' && state.loadState !== 'suspended') {
      livePanelIds.push(panelId)
    }
  }
  return livePanelIds
}

let singleton: IOverlayGuard | null = null

/**
 * The production overlay-guard singleton, wired to the real occluder + preview
 * stores and the `window.api.preview.setVisibility` bridge.
 *
 * The `setVisibility` closure here is the ONLY `api.preview.setVisibility` call
 * site in `src/renderer/**` (design §1.8; item 84 ESLint guard).
 *
 * @returns The lazily-created singleton guard.
 */
export function getOverlayGuard(): IOverlayGuard {
  if (singleton) return singleton
  singleton = createOverlayGuard({
    isOccluded: () => useOverlayOccluderStore.getState().isOccluded(),
    subscribeOccluded: (listener) => useOverlayOccluderStore.subscribe(listener),
    getLivePreviewPanelIds: readLivePreviewPanelIds,
    subscribePreview: (listener) => usePreviewStore.subscribe(listener),
    getPanelGate: (panelId) => usePreviewChromeGateStore.getState().getGate(panelId),
    subscribeGate: (listener) => usePreviewChromeGateStore.subscribe(listener),
    setVisibility: (panelId, visible, reason) =>
      window.api.preview.setVisibility(panelId, visible, reason)
  })
  return singleton
}

/**
 * Disposes and clears the production singleton. Intended for tests and hard
 * teardown; production code holds the guard for the app's lifetime.
 */
export function resetOverlayGuard(): void {
  singleton?.dispose()
  singleton = null
}
