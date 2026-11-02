// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – the drawer as a full-width sheet
 * (docs/designs/comments/html-preview-comments.md §10.6).
 *
 * Under a {@link DRAWER_FULL_BELOW_PX} panel the drawer takes the whole width
 * of the page area. The page then has nowhere to show, and a native view paints
 * over every sibling DOM, so this panel's page must be hidden rather than left
 * painting over the list.
 *
 * **The hide is this panel's gate, never the global occluder.** It goes through
 * `usePreviewCoveredStore`, which the overlay guard applies to this panel only.
 * dockview keeps every opened tab mounted, so an occluder left registered by a
 * hidden tab hid the preview on screen too (owner bug, rev 4).
 *
 * @module HtmlPreviewPanel/comments/useDrawerSheet
 */
import { useEffect } from 'react'
import { usePreviewCoveredStore } from '../../../../stores/usePreviewCoveredStore'
import { DRAWER_FULL_BELOW_PX, useNarrowPanel } from '../../../Comments/useNarrowPanel'

export { DRAWER_FULL_BELOW_PX }

/** Options for {@link useDrawerSheet}. */
export interface UseDrawerSheetOptions {
  readonly panelId: string
  /** The panel root: its width decides the full-width mode. */
  readonly panelRootRef: React.RefObject<HTMLElement | null>
  /** The drawer is open (and the feature is on). */
  readonly drawerOpen: boolean
}

/**
 * Follows the panel's width and hides this panel's page while the drawer
 * covers it.
 *
 * @param options - {@link UseDrawerSheetOptions}
 * @returns Whether the panel is narrow: the drawer, when open, is a sheet.
 *
 * @example
 * ```ts
 * const narrow = useDrawerSheet({ panelId, panelRootRef, drawerOpen: enabled && state.drawerOpen })
 * ```
 */
export function useDrawerSheet({ panelId, panelRootRef, drawerOpen }: UseDrawerSheetOptions): boolean {
  const narrow = useNarrowPanel(panelRootRef, drawerOpen)

  const covers = drawerOpen && narrow
  useEffect(() => {
    if (!covers) return undefined
    usePreviewCoveredStore.getState().setCovered(panelId)
    return () => usePreviewCoveredStore.getState().clearCovered(panelId)
  }, [covers, panelId])

  return narrow
}
