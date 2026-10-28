// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useEffect, type RefObject } from 'react'
import { getDirname } from '../../utils/fileUtils'

/** The focusable part of a tree row (the roving-tabindex `role="treeitem"`). */
const ROW_SELECTOR = '.project-tree-item[data-path]'

/**
 * Which row should take focus when the focused row has been removed: the row
 * that now has the same path (a re-render), else the nearest ancestor folder
 * (a delete or rename inside it), else the first row.
 *
 * It reads the tree's DATA, not the DOM: the tree is virtualised, so the right
 * row may exist but be scrolled out of range, and a DOM search would land on
 * whatever happened to be mounted.
 *
 * @param lostPath - Path of the row that held focus
 * @param indexByPath - Visible-row index by path (`buildVisibleRows`)
 * @returns Index of the row to focus, or null when the tree has no rows
 */
export function findTreeFocusFallback(lostPath: string, indexByPath: ReadonlyMap<string, number>): number | null {
  let path = lostPath
  while (path !== '') {
    const index = indexByPath.get(path)
    if (index !== undefined) return index
    const parent = getDirname(path)
    if (parent === path) break
    path = parent
  }
  return indexByPath.size > 0 ? 0 : null
}

/**
 * Keeps keyboard focus in the project tree when the row that has it is
 * removed – by a rename (the row is re-keyed under its new path) or a delete.
 *
 * Without it, closing the Rename or Delete dialog correctly returned focus to
 * the row that opened it, and the tree refresh a moment later removed that row
 * and dropped focus on `<body>`, where the next keystroke goes nowhere.
 *
 * Blink fires `focusout` for a removed element BEFORE detaching it, so the
 * check runs one frame later: only when focus really fell to `<body>` and the
 * row is really gone does it call `onFocusLost`, which picks the row from the
 * tree's data (`findTreeFocusFallback`) and moves focus there. A focusout to
 * anywhere else – Tab, a click in the editor, the window losing focus – is
 * left alone.
 *
 * @param containerRef - Ref to the tree container (`role="tree"`)
 * @param onFocusLostRef - Ref to the handler given the lost row's path; a ref,
 *   so the handler can read the latest rows without re-subscribing
 */
export function useTreeFocusRecovery(
  containerRef: RefObject<HTMLElement | null>,
  onFocusLostRef: RefObject<(lostPath: string) => void>
): void {
  useEffect(() => {
    let frame: number | null = null

    // On `document`, not the container: the container mounts only once a
    // project is open, after this effect has run.
    const handleFocusOut = (event: FocusEvent): void => {
      if (event.relatedTarget !== null) return
      const container = containerRef.current
      const lost = event.target
      if (!container || !(lost instanceof HTMLElement) || !lost.matches(ROW_SELECTOR)) return
      if (!container.contains(lost)) return
      const lostPath = lost.dataset.path ?? ''

      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        if (lost.isConnected || !container.isConnected) return
        if (document.activeElement !== null && document.activeElement !== document.body) return
        onFocusLostRef.current?.(lostPath)
      })
    }

    document.addEventListener('focusout', handleFocusOut)
    return () => {
      document.removeEventListener('focusout', handleFocusOut)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [containerRef, onFocusLostRef])
}
