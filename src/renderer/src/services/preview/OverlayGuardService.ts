// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Overlay guard service (Issue #74, work item 69; design §1.8, §5(d)) – the
 * native-view guard (spec 025, ADR 0011 decision 2, commit 16).
 *
 * The SINGLE owner of show/hide for every native view: HTML preview views
 * and, through {@link OverlayGuardDeps.otherKinds}, built-in browser tab views
 * (`nativeViewKinds.ts`; one visibility API per kind, one rule for all). For
 * browser views the send is `browserViewBounds.setVisibility`, which owns the
 * `browser-tab:bounds` push. The single-owner rule and the drag freeze below
 * apply to them too; the window-edge resize hold is main's, and main does not
 * hold browser views yet.
 *
 * Preview show/hide in detail. The guard watches the occluder store (any
 * dialog/settings/toast/menu/full-screen overlay on screen), the preview store
 * (which panels are live – several can be at once, each with its own
 * `WebContentsView`), the per-panel gate stores, and the active dockview tab
 * (fed in via {@link IOverlayGuard.sync}). Visibility is decided and sent per
 * panel: `preview:setVisibility` goes out for each live preview whose computed
 * visibility changed:
 *
 * ```
 * visible = (live preview is the active tab) && !isOccluded() && gate === null
 * ```
 *
 * `gate` is per panel ({@link PreviewPanelGate}): the permission band's chrome
 * gate, else `'collapsed'` while the panel's page area is clipped away (issue
 * #124 C2 – the terminal expanded over the editor), else `'covered'` while the
 * panel's comments drawer is a full-width sheet over its page area.
 *
 * **This is the ONLY file in `src/renderer/**` allowed to call
 * `setVisibility` (on `previewGateway`, the preview bridge's gateway).** An
 * ESLint `no-restricted-syntax` rule (item 84, a separate batch) enforces that
 * every other renderer module goes through this guard rather than poking
 * main-side visibility directly, so show/hide has exactly one application site.
 *
 * Why this must be the sole owner (design §5(d)): main applies each call at
 * once – a hide is synchronous and shows the cached still frame, a show re-adds
 * the child view topmost – and this guard sends only on a change, against its
 * own per-panel cache. A second caller racing `setVisibility` would flap the
 * view, flash, and leave that cache disagreeing with what main shows.
 *
 * **The drag freeze (issue #124, part 1 §1.5) goes through this guard, with one
 * stated exception.**
 * - A splitter drag registers the `drag` occluder (`previewDragFreeze.ts`), so
 *   this guard hides and shows the page exactly as for a dialog. Main's report
 *   then agrees with the cache below, and the reconcile never fires.
 * - **The one sanctioned bypass: the window-edge resize hold.** While a window
 *   edge is dragged, main hides that window's shown views itself
 *   (`previewResizeHold.ts` → `visibility.hold()`) WITHOUT a
 *   `visibilityApplied`, so this guard keeps believing "visible" and never
 *   re-syncs against the hold. A `setVisibility` sent meanwhile is recorded by
 *   main, not applied; the hold ends through main's one `release()`, which
 *   applies the LATEST wish and reports it – so a dialog opened mid-hold stays
 *   covered. The renderer mirrors the hold in the preview store's `resizeHeld`,
 *   for the still picture only; nothing here reads it.
 *
 * Dependency-injected so it is unit-testable with no real `window.api` or
 * zustand store: {@link createOverlayGuard} takes an {@link OverlayGuardDeps};
 * {@link getOverlayGuard} wires the real stores + bridge for production.
 */

import { useOverlayOccluderStore } from '../../stores/useOverlayOccluderStore'
import { usePreviewStore } from '../../stores/usePreviewStore'
import { usePreviewChromeGateStore } from '../../stores/usePreviewChromeGateStore'
import { usePreviewCollapsedStore } from '../../stores/usePreviewCollapsedStore'
import { usePreviewCoveredStore } from '../../stores/usePreviewCoveredStore'
import { logger } from '../../utils/logger'
import { browserViewBounds } from '../browser/browserViewBounds'
import { useBrowserTabStore } from '../../stores/useBrowserTabStore'
import { previewGateway } from '../previewGateway'
import {
  createBrowserViewKind,
  visibilityReason,
  type NativeViewGate,
  type NativeViewKind
} from './nativeViewKinds'

/**
 * Why one preview panel's page must stay hidden (see {@link NativeViewGate}).
 *
 * One term, three stores: each has a single writer, so none can overwrite or
 * lift another's hide (see `usePreviewCollapsedStore`).
 */
export type PreviewPanelGate = NativeViewGate

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
   *
   * When both apply, the chrome gate is returned: it is the one with a
   * user-visible explanation in the band.
   */
  getPanelGate: (panelId: string) => PreviewPanelGate | null
  /**
   * Notify on gate changes – either store behind {@link getPanelGate} – so the
   * guard recomputes. Returns an unsubscribe.
   */
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
   * `previewGateway.setVisibility` — the ONE permitted call site.
   * @param panelId - The live preview panel.
   * @param visible - Whether the view should be shown.
   * @param reason - Advisory cause, for main-side logging.
   */
  setVisibility: (panelId: string, visible: boolean, reason: string) => void
  /**
   * Subscribe to main's report of what it ACTUALLY did with a view.
   *
   * The guard writes `lastVisible` optimistically, at send time, and re-sends
   * only on a change — so a send that main drops, or that Chromium does not
   * honour, is permanent. Nothing corrected it until an unrelated transition,
   * and the symptom is a preview panel that is simply black and stays black.
   *
   * This is the reconciliation. Optional, because a caller with no bridge is
   * strictly no worse off than before it existed.
   *
   * @param listener - Called with what main applied, per panel.
   * @returns An unsubscribe function.
   */
  subscribeVisibilityApplied?: (
    listener: (panelId: string, visible: boolean) => void
  ) => () => void
  /**
   * Native views of other kinds – the built-in browser's tab views – each
   * with its own list, gate and visibility send ({@link NativeViewKind}).
   * The occlusion and the active tab above apply to them unchanged.
   *
   * Optional, and still fail-closed: a kind's views are shown only by this
   * guard (`browserViewBounds` starts every view hidden), so a kind left out
   * is never shown, rather than shown over an overlay.
   */
  otherKinds?: readonly NativeViewKind[]
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
  /**
   * The live panel this guard last told main to SHOW, or `null` when it shows
   * none. The splitter drag freeze asks, so it hides only a page that is on
   * screen (issue #124, part 1 §1.5).
   *
   * The guard's belief, not main's: a lost message is corrected by the
   * reconcile against `visibilityApplied`, not here.
   *
   * @returns The shown panel's id, or `null`
   */
  visiblePanelId: () => string | null
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
   * Per kind (the preview first), the last visibility sent per live view, with
   * the view's panel. A view absent from its map has never been sent one, so
   * its first computed value is always sent; entries are pruned when a view
   * stops being live, so a re-opened view is treated as new rather than
   * inheriting a stale value.
   */
  private readonly kinds: ReadonlyArray<{
    readonly kind: NativeViewKind
    readonly lastVisible: Map<string, { visible: boolean; panelId: string }>
  }>

  private readonly unsubscribers: Array<() => void> = []

  constructor(private readonly deps: OverlayGuardDeps) {
    this.kinds = [previewKind(deps), ...(deps.otherKinds ?? [])].map((kind) => ({
      kind,
      lastVisible: new Map()
    }))
    // Recompute whenever a signal changes. `sync` covers the remaining trigger
    // (tab activation), which no store observes.
    this.unsubscribers.push(deps.subscribeOccluded(() => this.recompute()))
    for (const { kind, lastVisible } of this.kinds) {
      this.unsubscribers.push(kind.subscribe(() => this.recompute()))
      this.unsubscribers.push(kind.subscribeGate(() => this.recompute()))

      /*
       * RECONCILE, because "I sent it" is not "it happened".
       *
       * `lastVisible` is written at send time and gates every later send, so one
       * lost message wedges a view for the life of the session. Main reports what
       * it applied; if that disagrees with what this guard believes, the belief is
       * wrong and must be dropped — the next recompute then sends again.
       *
       * Deliberately NOT a retry loop. It corrects the CACHE and asks for a fresh
       * decision; if the world genuinely wants the other state, the recompute says
       * so and one more message goes out. If main keeps disagreeing, that is a
       * main-side fault and hammering it would only hide it.
       */
      const subscribeApplied = kind.subscribeVisibilityApplied
      if (subscribeApplied !== undefined) {
        this.unsubscribers.push(
          subscribeApplied((viewId, applied) => {
            if (lastVisible.get(viewId)?.visible === applied) return
            lastVisible.delete(viewId)
            this.recompute()
          })
        )
      }
    }
  }

  sync(activeTabId: string | null): void {
    this.activeTabId = activeTabId
    this.recompute()
  }

  visiblePanelId(): string | null {
    // At most one entry is `true` (the one-visible-tab assumption below).
    for (const { lastVisible } of this.kinds) {
      for (const { visible, panelId } of lastVisible.values()) {
        if (visible) return panelId
      }
    }
    return null
  }

  dispose(): void {
    while (this.unsubscribers.length > 0) {
      this.unsubscribers.pop()?.()
    }
  }

  /**
   * Computes `visible = isActiveTab && !isOccluded() && gate === null` for EVERY
   * live view of every kind and sends that kind's visibility only where it
   * differs from the last sent value.
   *
   * Views that are no longer live are pruned from the cache; main destroyed
   * them, so there is nothing left to hide.
   */
  private recompute(): void {
    let occluded: boolean | null = null
    let visibleCount = 0
    const visiblePanels: string[] = []

    for (const { kind, lastVisible } of this.kinds) {
      const views = kind.liveViews()

      // Prune views that stopped being live, so a re-open starts from unknown.
      const live = new Set(views.map((view) => view.viewId))
      for (const viewId of [...lastVisible.keys()]) {
        if (!live.has(viewId)) lastVisible.delete(viewId)
      }
      if (views.length === 0) continue

      occluded ??= this.deps.isOccluded()
      for (const { viewId, panelId } of views) {
        // The gate is per PANEL: a band waiting on one preview must not blank a
        // second view in a split, which routing it through the global occluder
        // store would have done.
        const gate = kind.getGate(panelId)
        const active = this.activeTabId === panelId
        const visible = active && !occluded && gate === null
        if (visible) {
          visibleCount += 1
          visiblePanels.push(panelId)
        }

        if (lastVisible.get(viewId)?.visible === visible) continue
        lastVisible.set(viewId, { visible, panelId })
        kind.setVisibility(viewId, visible, visibilityReason(visible, active, gate))
      }
    }

    // The one-visible-tab assumption is a consequence of `disableDnd`, not
    // something the layout enforces. If it ever breaks, two native views would
    // paint at once and the symptom (a view over the wrong group) is baffling —
    // so say so loudly here instead.
    if (visibleCount > 1 && import.meta.env.DEV) {
      logger.warn('Overlay guard computed more than one visible native view', {
        visibleCount,
        visiblePanels
      })
    }
  }
}

/**
 * The preview kind, read from the guard's own preview deps (a preview's view
 * id is its panel id).
 *
 * @param deps - The guard's deps
 * @returns The preview kind
 */
function previewKind(deps: OverlayGuardDeps): NativeViewKind {
  return {
    liveViews: () => deps.getLivePreviewPanelIds().map((panelId) => ({ viewId: panelId, panelId })),
    subscribe: deps.subscribePreview,
    getGate: deps.getPanelGate,
    subscribeGate: deps.subscribeGate,
    setVisibility: deps.setVisibility,
    subscribeVisibilityApplied: deps.subscribeVisibilityApplied
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
 * The production gate read: the permission band's chrome gate first, then the
 * bounds hook's collapsed flag, then the comments drawer's covered flag.
 *
 * @param panelId - The live preview panel to ask about
 * @returns Why the panel's page must stay hidden, or `null`
 */
function readPanelGate(panelId: string): PreviewPanelGate | null {
  const chromeGate = usePreviewChromeGateStore.getState().getGate(panelId)
  if (chromeGate !== null) return chromeGate
  if (usePreviewCollapsedStore.getState().isCollapsed(panelId)) return 'collapsed'
  return usePreviewCoveredStore.getState().isCovered(panelId) ? 'covered' : null
}

/**
 * Subscribes to every store behind {@link readPanelGate}.
 *
 * @param listener - Called (no args) after any of them changes
 * @returns One unsubscribe that detaches them all
 */
function subscribePanelGate(listener: () => void): () => void {
  const unsubscribers = [
    usePreviewChromeGateStore.subscribe(listener),
    usePreviewCollapsedStore.subscribe(listener),
    usePreviewCoveredStore.subscribe(listener)
  ]
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
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
 * stores, the `previewGateway.setVisibility` bridge and the browser view
 * bounds owner.
 *
 * The `setVisibility` closure here is the ONLY `previewGateway.setVisibility`
 * call site in `src/renderer/**` (design §1.8; item 84 ESLint guard).
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
    getPanelGate: readPanelGate,
    subscribeGate: subscribePanelGate,
    setVisibility: (panelId, visible, reason) =>
      previewGateway.setVisibility(panelId, visible, reason),
    subscribeVisibilityApplied: (listener) =>
      previewGateway.onVisibilityApplied((payload) =>
        listener(payload.panelId, payload.visible)
      ),
    otherKinds: [
      // A browser panel's collapsed flag is written by its own bounds hook,
      // keyed by its own panel id, so it never meets a preview's flag; its
      // page is covered while Erfana's DOM fills the page area.
      createBrowserViewKind(browserViewBounds, {
        isCollapsed: (panelId) => usePreviewCollapsedStore.getState().isCollapsed(panelId),
        isCovered: (panelId) => useBrowserTabStore.getState().coversPage(panelId),
        subscribe: (listener) => {
          const off = [usePreviewCollapsedStore.subscribe(listener), useBrowserTabStore.subscribe(listener)]
          return () => off.forEach((unsubscribe) => unsubscribe())
        }
      })
    ]
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
