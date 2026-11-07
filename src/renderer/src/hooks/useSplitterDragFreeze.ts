// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useSplitterDragFreeze – the app's one splitter drag freeze (issue #124, part 1
 * §1.5; user answers 4 and 6).
 *
 * Mounted once, in `AppDockLayout`, because a sash anywhere in the window – the
 * project tree's, the terminal's, a split inside the editor area – can move a
 * native view: a live preview or a built-in browser tab's page (spec 025, ADR
 * 0011 decision 2). Whichever kind the guard shows is the one a drag hides. The logic is the pure controller in
 * `services/preview/previewDragFreeze.ts`; this module only wires it to the real
 * document, window, stores, bridge and logger, and is the ONE place its
 * `window` listeners are attached.
 *
 * The hide goes THROUGH the overlay guard, the single show/hide owner: the
 * freeze registers the `drag` occluder and the guard hides the page; releasing
 * it lets the guard show the page again. Nothing here calls `setVisibility`.
 *
 * @module hooks/useSplitterDragFreeze
 * @see docs/designs/html-preview/multi-page/design-issue-124-part1.md §1.5
 */

import { useEffect } from 'react'
import {
  browserFrames,
  createDragFreezeController,
  type DragFreezeDeps
} from '../services/preview/previewDragFreeze'
import { getOverlayGuard } from '../services/preview/OverlayGuardService'
import { useOverlayOccluderStore } from '../stores/useOverlayOccluderStore'
import { usePreviewCollapsedStore } from '../stores/usePreviewCollapsedStore'
import { usePreviewStore } from '../stores/usePreviewStore'
import { logger } from '../utils/logger'
import { browserViewBounds } from '../services/browser/browserViewBounds'
import { previewGateway } from '../services/previewGateway'

/**
 * Each mounted native-view panel's forced bounds push, by panel id – preview
 * and browser panels alike. The release
 * pushes the frozen panel's settled rect before the page returns, and only the
 * panel's bounds hook can measure it.
 */
const boundsPushers = new Map<string, () => void>()

/**
 * Lets the splitter freeze push this panel's bounds when a drag ends. A
 * browser panel's bounds hook registers here too, under its own panel id.
 *
 * @param panelId - The preview panel
 * @param pushBounds - Its bounds hook's forced push
 *
 * @example
 * ```tsx
 * const { pushBounds } = usePreviewBounds({ placeholderRef, panelId, ... })
 * usePreviewDragFreezeTarget(panelId, pushBounds)
 * ```
 */
export function usePreviewDragFreezeTarget(panelId: string, pushBounds: () => boolean): void {
  useEffect(() => {
    const push = (): void => {
      pushBounds()
    }
    boundsPushers.set(panelId, push)
    return () => {
      // A remount under the same id may already have put its own in place.
      if (boundsPushers.get(panelId) === push) boundsPushers.delete(panelId)
    }
  }, [panelId, pushBounds])
}

/**
 * Whether main has a view for the panel that a drag could expose.
 *
 * @param panelId - The preview or browser panel
 * @returns For a preview, `false` for `failed` (a crashed page), `suspended`,
 *   `idle` and an unknown panel – each leaves nothing on screen to cover; for
 *   a browser panel, whether its tab's view is registered
 */
function hasLiveView(panelId: string): boolean {
  const loadState = usePreviewStore.getState().getLoadState(panelId)
  if (loadState === 'loading' || loadState === 'ready') return true
  return browserViewBounds.tabOf(panelId) !== null
}

/**
 * Main's reports of what it did with a view, of either kind, by panel id.
 *
 * A browser view's report arrives under its tab id and is mapped to the
 * hosting panel here, so the controller deals in panel ids only.
 *
 * @param listener - Called with the panel and what main applied
 * @returns One unsubscribe for both feeds
 */
function subscribeNativeViewApplied(listener: (panelId: string, visible: boolean) => void): () => void {
  const unsubscribers = [
    previewGateway.onVisibilityApplied((payload) => listener(payload.panelId, payload.visible)),
    browserViewBounds.onVisibilityApplied((tabId, visible) => {
      const view = browserViewBounds.views().find((candidate) => candidate.tabId === tabId)
      if (view !== undefined) listener(view.panelId, visible)
    })
  ]
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
}

/**
 * Notified after anything {@link hasLiveView} reads may have changed.
 *
 * @param listener - Called (no args) on a preview-store or browser-view change
 * @returns One unsubscribe for both
 */
function subscribeNativeViewLive(listener: () => void): () => void {
  const unsubscribers = [usePreviewStore.subscribe(listener), browserViewBounds.subscribe(listener)]
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
}

/**
 * The panel whose live page – preview or browser – is on screen, or `null`.
 *
 * Asked of the overlay guard, which already folds in the active tab, every
 * occluder and each panel's gate – so an inactive tab, an open host list or a
 * dialog counts as "no visible preview" without a second copy of that rule.
 *
 * @returns The panel a drag must hide, or `null` when there is none
 */
function readVisiblePreviewPanel(): string | null {
  const panelId = getOverlayGuard().visiblePanelId()
  if (panelId === null || !hasLiveView(panelId)) return null
  // A collapsed page (C2) is already hidden: waiting for its hide confirmation
  // would hold the sash for an event that never comes. The guard's gate covers
  // it too; read here as well so the rule holds whatever order stores notify in.
  if (usePreviewCollapsedStore.getState().isCollapsed(panelId)) return null
  return panelId
}

/**
 * Production wiring for the controller.
 *
 * @returns Deps bound to the real document, window, stores, bridge and logger
 */
export function createSplitterDragFreezeDeps(): DragFreezeDeps {
  return {
    document,
    window,
    now: () => performance.now(),
    frames: browserFrames,
    visiblePreviewPanel: readVisiblePreviewPanel,
    isPanelLive: hasLiveView,
    subscribeLive: subscribeNativeViewLive,
    subscribeVisibilityApplied: subscribeNativeViewApplied,
    beginHide: (panelId) => {
      // The latch first, so the render the occluder causes already carries it.
      // A browser panel has no preview state, so this is a no-op for it.
      usePreviewStore.getState().latchDragHide(panelId)
      useOverlayOccluderStore.getState().register('drag')
    },
    pushBounds: (panelId) => boundsPushers.get(panelId)?.(),
    endHide: () => useOverlayOccluderStore.getState().unregister('drag'),
    log: (level, message, fields) => logger[level](message, fields)
  }
}

/**
 * Mounts the splitter drag freeze for the lifetime of the calling component.
 *
 * @example
 * ```tsx
 * export function AppDockLayout() {
 *   useSplitterDragFreeze()
 *   // ...
 * }
 * ```
 */
export function useSplitterDragFreeze(): void {
  useEffect(() => {
    const controller = createDragFreezeController(createSplitterDragFreezeDeps())
    return () => controller.dispose()
  }, [])
}
