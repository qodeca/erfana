// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useSplitterDragFreeze – the app's one splitter drag freeze (issue #124, part 1
 * §1.5; user answers 4 and 6).
 *
 * Mounted once, in `AppDockLayout`, because a sash anywhere in the window – the
 * project tree's, the terminal's, a split inside the editor area – can move a
 * live preview. The logic is the pure controller in
 * `services/preview/previewDragFreeze.ts`; this module only wires it to the real
 * document, window, stores, bridge and logger, and is the ONE place its
 * `window` listeners are attached.
 *
 * The hide goes THROUGH the overlay guard, the single show/hide owner: the
 * freeze registers the `drag` occluder and the guard hides the page; releasing
 * it lets the guard show the page again. Nothing here calls `setVisibility`.
 *
 * @module hooks/useSplitterDragFreeze
 * @see docs/design/design-issue-124-part1.md §1.5
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

/**
 * Each mounted preview panel's forced bounds push, by panel id. The release
 * pushes the frozen panel's settled rect before the page returns, and only the
 * panel's bounds hook can measure it.
 */
const boundsPushers = new Map<string, () => void>()

/**
 * Lets the splitter freeze push this panel's bounds when a drag ends.
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
 * @param panelId - The preview panel
 * @returns `false` for `failed` (a crashed page), `suspended`, `idle` and an
 *   unknown panel – each leaves nothing on screen to cover
 */
function hasLiveView(panelId: string): boolean {
  const loadState = usePreviewStore.getState().getLoadState(panelId)
  return loadState === 'loading' || loadState === 'ready'
}

/**
 * The panel whose live page is on screen, or `null`.
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
    subscribeLive: (listener) => usePreviewStore.subscribe(listener),
    subscribeVisibilityApplied: (listener) =>
      window.api.preview.onVisibilityApplied((payload) => listener(payload.panelId, payload.visible)),
    beginHide: (panelId) => {
      // The latch first, so the render the occluder causes already carries it.
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
