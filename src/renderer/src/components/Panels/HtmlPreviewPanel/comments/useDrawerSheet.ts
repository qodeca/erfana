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
 * Two rules, each of which once froze the OTHER preview tab on its still frame
 * when the reader switched tabs with the drawer open (owner bug, rev 4):
 *
 * - **The hide is this panel's gate, never the global occluder.** It goes
 *   through `usePreviewCoveredStore`, which the overlay guard applies to this
 *   panel only. dockview keeps every opened tab mounted, so an occluder left
 *   registered by a hidden tab hid the preview on screen too.
 * - **A hidden tab is not measured.** dockview hides an inactive tab with
 *   `display: none`, so its root measures 0×0 – which is "not drawn", not
 *   "narrow". The last real answer stands, so the tab comes back as it left.
 *
 * @module HtmlPreviewPanel/comments/useDrawerSheet
 */
import { useEffect, useState } from 'react'
import { usePreviewCoveredStore } from '../../../../stores/usePreviewCoveredStore'

/** Under this panel width the drawer takes the whole width (§10.6). */
export const DRAWER_FULL_BELOW_PX = 640

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
  const [narrow, setNarrow] = useState(false)

  // Re-run on open: the drawer may open in a panel resized while it was shut.
  useEffect(() => {
    const root = panelRootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return undefined
    const measure = (): void => {
      const { width, height } = root.getBoundingClientRect()
      if (width === 0 && height === 0) return
      setNarrow(width < DRAWER_FULL_BELOW_PX)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [panelRootRef, drawerOpen])

  const covers = drawerOpen && narrow
  useEffect(() => {
    if (!covers) return undefined
    usePreviewCoveredStore.getState().setCovered(panelId)
    return () => usePreviewCoveredStore.getState().clearCovered(panelId)
  }, [covers, panelId])

  return narrow
}
