// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Whether a preview is too narrow to keep the comments drawer beside its page
 * (docs/designs/comments/html-preview-comments.md §10.6). Both previews use it,
 * so the drawer takes the whole width at the same point in each.
 *
 * A hidden tab is not measured: dockview hides an inactive tab with
 * `display: none`, so it measures 0×0, which is "not drawn", not "narrow". The
 * last real answer stands, so the tab comes back as it left.
 *
 * @module components/Comments/useNarrowPanel
 */
import { useEffect, useMemo, useState } from 'react'

/** Under this preview width the drawer takes the whole width (§10.6). */
export const DRAWER_FULL_BELOW_PX = 640

/**
 * Follows an element's width.
 *
 * @param rootRef - The element whose width decides
 * @param drawerOpen - The drawer is open: it may open in a panel resized while it was shut
 * @returns Whether the element is under {@link DRAWER_FULL_BELOW_PX}
 *
 * @example
 * ```ts
 * const narrow = useNarrowPanel(panelRootRef, state.drawerOpen)
 * ```
 */
export function useNarrowPanel(rootRef: React.RefObject<HTMLElement | null>, drawerOpen: boolean): boolean {
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    const root = rootRef.current
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
  }, [rootRef, drawerOpen])

  return narrow
}

/**
 * {@link useNarrowPanel} for an element held in state.
 *
 * @param element - The element whose width decides, or null before it is bound
 * @param drawerOpen - The drawer is open
 * @returns Whether the element is under {@link DRAWER_FULL_BELOW_PX}
 */
export function useNarrowElement(element: HTMLElement | null, drawerOpen: boolean): boolean {
  return useNarrowPanel(useMemo(() => ({ current: element }), [element]), drawerOpen)
}
