// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useEffect, type RefObject } from 'react'
import { getDirname } from '../../utils/fileUtils'

/** The focusable part of a tree row (dnd-kit gives it `tabIndex: 0`). */
const ROW_SELECTOR = '.project-tree-item[data-path]'

/**
 * Where focus should go when the focused tree row has been removed: the row
 * that now shows the same path (a re-render), else the nearest ancestor
 * folder's row (a delete or rename inside it), else the first row.
 *
 * @param container - The tree container
 * @param lostPath - `data-path` of the row that held focus
 * @returns The row to focus, or null when the tree has no rows
 */
export function findTreeFocusFallback(container: HTMLElement, lostPath: string): HTMLElement | null {
  const rows = Array.from(container.querySelectorAll<HTMLElement>(ROW_SELECTOR))
  const byPath = (path: string): HTMLElement | undefined => rows.find((row) => row.dataset.path === path)

  let path = lostPath
  while (path !== '') {
    const row = byPath(path)
    if (row) return row
    path = getDirname(path)
  }
  return rows[0] ?? null
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
 * row is really gone does it move focus. A focusout to anywhere else – Tab, a
 * click in the editor, the window losing focus – is left alone.
 *
 * @param containerRef - Ref to the tree container (`role="tree"`)
 *
 * @example
 * ```tsx
 * const treeRef = useRef<HTMLDivElement>(null)
 * useTreeFocusRecovery(treeRef)
 * return <div role="tree" ref={treeRef}>…</div>
 * ```
 */
export function useTreeFocusRecovery(containerRef: RefObject<HTMLElement | null>): void {
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
        findTreeFocusFallback(container, lostPath)?.focus()
      })
    }

    document.addEventListener('focusout', handleFocusOut)
    return () => {
      document.removeEventListener('focusout', handleFocusOut)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [containerRef])
}
