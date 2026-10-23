// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { TEST_IDS } from '../../constants/testids'
import { useOccluder } from '../../hooks/useOccluder'
import { useOverlayStackEntry } from '../../hooks/useOverlayStackEntry'
import './ContextMenu.css'

/**
 * One entry in a {@link ContextMenu}.
 *
 * A separator is an entry with `separator: true`; its other fields are ignored
 * and the keyboard skips it.
 */
export interface ContextMenuItem {
  /** Visible label; also what typeahead matches against */
  label: string
  /** Decorative icon; hidden from assistive tech */
  icon?: ReactNode
  /** Runs when the item is activated (click, Enter or Space) */
  action: () => void
  /** Destructive styling; a disabled item never shows it (disabled wins) */
  danger?: boolean
  /** Renders a separator instead of an item */
  separator?: boolean
  /** Greyed out and inert, but still reachable by the arrow keys */
  disabled?: boolean
  /** Shortcut hint, e.g. `⌘C`; exposed as `aria-keyshortcuts` */
  shortcut?: string
  /** Optional test ID for automated UI testing */
  testId?: string
}

interface ContextMenuProps {
  /** Anchor x in viewport pixels (the menu opens 8 px right of it) */
  x: number
  /** Anchor y in viewport pixels (the menu opens 8 px below it) */
  y: number
  /** Entries in display order */
  items: ContextMenuItem[]
  /** Called to close the menu; the parent unmounts it */
  onClose: () => void
  /** Optional test ID for the container element (overrides default) */
  containerTestId?: string
}

/** Typed characters within this many ms extend one typeahead search. */
export const TYPEAHEAD_RESET_MS = 800

/**
 * The next non-separator item after `from`, stepping by `by` with wrap-around.
 *
 * @returns Its index, or -1 when the menu has no items at all
 */
function stepFrom(items: ContextMenuItem[], from: number, by: 1 | -1): number {
  const count = items.length
  for (let i = 1; i <= count; i += 1) {
    const at = (((from + by * i) % count) + count) % count
    if (!items[at].separator) return at
  }
  return -1
}

/** The first non-separator item, or -1 for an empty menu. */
function firstItem(items: ContextMenuItem[]): number {
  return items.findIndex((item) => !item.separator)
}

/** The last non-separator item, or -1 for an empty menu. */
function lastItem(items: ContextMenuItem[]): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (!items[i].separator) return i
  }
  return -1
}

/**
 * The shared right-click menu, with the keyboard contract `role="menu"`
 * promises (issue #90, design/system/components/menu – decided).
 *
 * - Focus moves to the first item when the menu opens.
 * - Roving `tabindex`: the active item is `0`, every other item `-1`, so the
 *   menu is one Tab stop and real DOM focus drives `:focus-visible`.
 * - ↑ ↓ move with wrap-around and Home / End jump. Separators are skipped;
 *   disabled items are NOT, so they stay discoverable (`aria-disabled` only).
 * - Enter / Space activate; a disabled item does nothing.
 * - A printable key jumps to the next item starting with it (typeahead).
 * - Escape and Tab close and return focus to whatever had it at open.
 * - The pointer and the keyboard share one active item: hovering an item
 *   moves the roving stop to it.
 *
 * Opening it from the keyboard (Shift+F10, the Menu key) is the trigger's job;
 * see `contextMenuKey.ts`.
 *
 * @param props - Anchor, items and close callback
 * @returns The menu, portalled into `#portal-root`, or null when that is absent
 *
 * @example
 * ```tsx
 * {menu && (
 *   <ContextMenu
 *     x={menu.x}
 *     y={menu.y}
 *     items={[
 *       { label: 'Rename', action: rename },
 *       { label: 'Delete', action: remove, danger: true }
 *     ]}
 *     onClose={() => setMenu(null)}
 *   />
 * )}
 * ```
 */
export function ContextMenu({ x, y, items, onClose, containerTestId }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const openTimeRef = useRef<number>(Date.now())
  // What had focus when the menu opened (the right-clicked tree row, say),
  // captured on the first render – before the menu moves focus into itself –
  // so it is remembered on open, never looked up on close. Focus goes back
  // there on every close, and BEFORE an item's action runs, so a dialog the
  // action opens records the real opener and can return focus there.
  const [opener] = useState<HTMLElement | null>(() => {
    const active = document.activeElement
    return active instanceof HTMLElement && active !== document.body ? active : null
  })
  const portalRoot = document.getElementById('portal-root')
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])
  const [activeIndex, setActiveIndex] = useState(() => firstItem(items))
  // A parent may rebuild `items` while the menu is open (the tab menu
  // recounts its tabs): never let the roving stop sit on a separator or past
  // the end.
  const current =
    activeIndex >= 0 && activeIndex < items.length && !items[activeIndex].separator
      ? activeIndex
      : firstItem(items)
  const typeahead = useRef({ text: '', at: 0 })

  // Occlude the live preview view for this menu's whole lifetime (item 66). The
  // shared ContextMenu is only mounted while open (parents render it behind a
  // guard), so `active` is `true` until it unmounts. Called before the early
  // `portalRoot` return so the hook order is stable.
  useOccluder('menu', true)

  // Store onClose in a ref to avoid re-running effect when it changes
  // This prevents openTimeRef from being reset when context value updates
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const restoreFocus = useCallback(() => {
    if (opener?.isConnected) {
      opener.focus()
      return
    }
    // Nothing to go back to: leave focus nowhere rather than on an item that
    // is about to unmount.
    const active = document.activeElement
    if (active instanceof HTMLElement && menuRef.current?.contains(active)) active.blur()
  }, [opener])

  // Escape goes through the shared overlay stack (#229) rather than a private
  // document listener: a private listener fired alongside every other
  // overlay's on the same keystroke, and – because it never stopped the event
  // – also let Escape through to the focused control underneath (the terminal,
  // where a stray Escape interrupts a running agent).
  useOverlayStackEntry(menuRef, {
    active: true,
    // The token `.context-menu` paints with: a menu paints above dialogs, so
    // it is also the overlay that takes Escape first.
    zIndex: '--z-context-menu',
    onEscape: () => {
      restoreFocus()
      onCloseRef.current()
    },
    // A menu is transient chrome, not a modal: a trapping dialog beneath it
    // (a menu opened inside one) must keep its Tab trap and focus rescue.
    modal: false
  })

  useEffect(() => {
    // Record when menu was opened to ignore the opening click
    // Only set once on mount, not on every effect re-run
    openTimeRef.current = Date.now()

    const handleClickOutside = (e: MouseEvent) => {
      // Ignore events within 50ms of menu opening (prevents closing from opening click)
      if (Date.now() - openTimeRef.current < 50) return

      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onCloseRef.current()
      }
    }

    // Use capture phase to catch events before any stopPropagation in children
    // Add immediately (no delay) - timestamp check handles the opening click
    document.addEventListener('mousedown', handleClickOutside, { capture: true })

    return () => {
      // Must match capture option when removing
      document.removeEventListener('mousedown', handleClickOutside, { capture: true })
    }
  }, []) // Empty deps - only run on mount/unmount

  // Calculate optimal position with viewport boundary checks
  useEffect(() => {
    if (menuRef.current) {
      const menu = menuRef.current
      const menuRect = menu.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      // Position menu near the cursor (use clientX/Y directly)
      // Small offset to avoid cursor covering the menu
      let finalX = x + 8
      let finalY = y + 8

      // Check right edge - if menu would overflow, align to right edge of viewport
      if (finalX + menuRect.width > viewportWidth) {
        finalX = viewportWidth - menuRect.width - 8
      }

      // Check bottom edge - if menu would overflow, position at bottom of viewport
      if (finalY + menuRect.height > viewportHeight) {
        finalY = viewportHeight - menuRect.height - 8
      }

      // Ensure menu stays within left edge
      if (finalX < 8) {
        finalX = 8
      }

      // Ensure menu stays within top edge
      if (finalY < 8) {
        finalY = 8
      }

      // Apply calculated position and make visible
      menu.style.left = `${finalX}px`
      menu.style.top = `${finalY}px`
      menu.style.opacity = '1'
    }
  }, [x, y])

  // Real DOM focus follows the roving stop. Declared after the positioning
  // effect, so the menu is in place (and visible) when it takes focus; the
  // first run is the "focus moves into the menu on open" half of the contract.
  useEffect(() => {
    const target = current >= 0 ? itemRefs.current[current] : menuRef.current
    if (target && document.activeElement !== target) target.focus({ preventScroll: true })
  }, [current])

  // Whatever closes the menu – Escape, Tab, an item, a click elsewhere, the
  // parent – focus must not be left on a node that is about to disappear. A
  // layout-effect cleanup runs while the menu is still in the DOM, so it can
  // still see that focus is inside it. A click on another control has not
  // moved focus yet at this point, and still wins afterwards.
  useLayoutEffect(() => {
    const menu = menuRef.current
    return () => {
      const active = document.activeElement
      if (menu && active instanceof Node && menu.contains(active) && opener?.isConnected) {
        opener.focus()
      }
    }
  }, [opener])

  const handleItemClick = (item: ContextMenuItem) => {
    if (!item.separator && !item.disabled) {
      restoreFocus()
      item.action()
      onClose()
    }
  }

  /**
   * The next item whose label starts with the typed text. The buffer resets
   * after a pause, so "de" finds Delete but a later "d" starts again; one
   * letter pressed repeatedly cycles through the items that start with it.
   */
  const findByTypeahead = (key: string): number => {
    const now = Date.now()
    const buffer = typeahead.current
    buffer.text = now - buffer.at > TYPEAHEAD_RESET_MS ? key : buffer.text + key
    buffer.at = now
    const typed = buffer.text.toLowerCase()
    // "ooo" means "the next item starting with o", not a search for "ooo".
    const repeated = [...typed].every((char) => char === typed[0])
    const wanted = repeated ? typed[0] : typed
    const from = wanted.length === 1 ? current + 1 : current
    for (let i = 0; i < items.length; i += 1) {
      const at = (((from + i) % items.length) + items.length) % items.length
      const item = items[at]
      if (!item.separator && item.label.toLowerCase().startsWith(wanted)) return at
    }
    return current
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Escape belongs to the shared overlay stack (capture phase, above), and
    // shortcuts with a modifier (Cmd+S, Ctrl+W) are not the menu's to take.
    if (event.key === 'Escape' || event.metaKey || event.ctrlKey || event.altKey) return

    let next: number | null = null
    switch (event.key) {
      case 'ArrowDown':
        next = stepFrom(items, current, 1)
        break
      case 'ArrowUp':
        next = stepFrom(items, current < 0 ? 0 : current, -1)
        break
      case 'Home':
        next = firstItem(items)
        break
      case 'End':
        next = lastItem(items)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        event.stopPropagation()
        if (current >= 0) handleItemClick(items[current])
        return
      case 'Tab':
        // A menu is modal to the keyboard while open: Tab closes it rather
        // than walking out into the page behind it.
        event.preventDefault()
        event.stopPropagation()
        restoreFocus()
        onClose()
        return
      default:
        if (event.key.length === 1 && /\S/.test(event.key)) next = findByTypeahead(event.key)
    }
    if (next === null) return
    // Handled: keep it from also reaching a React ancestor through the portal
    // (the tree's own arrow keys and typeahead would move the tree as well).
    event.preventDefault()
    event.stopPropagation()
    if (next >= 0) setActiveIndex(next)
  }

  if (!portalRoot) return null

  const menu = (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      // Focusable only so an EMPTY menu can still hold focus; with items the
      // roving stop is always an item.
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      data-testid={containerTestId ?? TEST_IDS.CONTEXT_MENU}
      style={{
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        opacity: 0
      }}
    >
      {items.map((item, index) =>
        item.separator ? (
          <div
            key={index}
            className="context-menu-separator"
            role="separator"
            data-testid={TEST_IDS.CONTEXT_MENU_SEPARATOR}
          />
        ) : (
          <div
            key={index}
            ref={(node) => {
              itemRefs.current[index] = node
            }}
            className={`context-menu-item ${item.danger ? 'danger' : ''} ${item.disabled ? 'disabled' : ''}`}
            role="menuitem"
            tabIndex={index === current ? 0 : -1}
            aria-disabled={item.disabled || undefined}
            // The hint is hidden below, so the shortcut reaches assistive tech
            // as a property of the item rather than as part of its name.
            aria-keyshortcuts={item.shortcut}
            onClick={() => handleItemClick(item)}
            // One active item whichever device is in use: the pointer moves the
            // roving stop instead of painting a second highlight.
            onMouseMove={() => {
              if (index !== current) setActiveIndex(index)
            }}
            data-testid={item.testId}
          >
            {item.icon && (
              <span className="context-menu-icon" aria-hidden="true">
                {item.icon}
              </span>
            )}
            <span className="context-menu-label">{item.label}</span>
            {item.shortcut && (
              <span className="context-menu-shortcut" aria-hidden="true">
                {item.shortcut}
              </span>
            )}
          </div>
        )
      )}
    </div>
  )

  return createPortal(menu, portalRoot)
}
