// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shift+F10 / Menu key on a dock tab opens that tab's context menu (#90).
 *
 * The element that holds focus is dockview's `.dv-tab` wrapper (dockview gives
 * it `tabIndex = 0`), not the component Erfana renders inside it, so a React
 * `onKeyDown` on our own markup never sees the key. The listener therefore
 * goes on the nearest `.dv-tab` ancestor of the rendered tab.
 */
import { useEffect, useRef, type RefObject } from 'react'
import { isContextMenuKey, markKeyboardMenuOpen, menuAnchorBelow } from '../ContextMenu/contextMenuKey'

/**
 * Open a tab's context menu from the keyboard.
 *
 * @param contentRef - The root element the tab component renders
 * @param open - Opens the menu at a viewport anchor (under the tab's left edge)
 *
 * @example
 * ```tsx
 * const rootRef = useRef<HTMLDivElement>(null)
 * useTabMenuKey(rootRef, (anchor) => setContextMenu(anchor))
 * return <div ref={rootRef} className="editor-tab">…</div>
 * ```
 */
export function useTabMenuKey(
  contentRef: RefObject<HTMLElement | null>,
  open: (anchor: { x: number; y: number }) => void
): void {
  // A new `open` closure every render must not re-bind the listener.
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    const content = contentRef.current
    // Outside dockview (unit tests render the tab bare) the content itself is
    // the closest thing to a focusable tab.
    const tab = content?.closest<HTMLElement>('.dv-tab') ?? content
    if (!tab) return undefined

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!isContextMenuKey(event)) return
      // Keydown, not the native `contextmenu`: macOS sends none for these keys.
      event.preventDefault()
      event.stopPropagation()
      markKeyboardMenuOpen()
      openRef.current(menuAnchorBelow(tab))
    }
    tab.addEventListener('keydown', handleKeyDown)
    return () => tab.removeEventListener('keydown', handleKeyDown)
  }, [contentRef])
}
