// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useEffect, useRef, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { TEST_IDS } from '../../constants/testids'
import './ContextMenu.css'

export interface ContextMenuItem {
  label: string
  icon?: ReactNode
  action: () => void
  danger?: boolean
  separator?: boolean
  disabled?: boolean
  shortcut?: string
  /** Optional test ID for automated UI testing */
  testId?: string
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
  /** Optional test ID for the container element (overrides default) */
  containerTestId?: string
}

export function ContextMenu({ x, y, items, onClose, containerTestId }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const openTimeRef = useRef<number>(Date.now())
  const portalRoot = document.getElementById('portal-root')

  // Store onClose in a ref to avoid re-running effect when it changes
  // This prevents openTimeRef from being reset when context value updates
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

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

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current()
      }
    }

    // Use capture phase to catch events before any stopPropagation in children
    // Add immediately (no delay) - timestamp check handles the opening click
    document.addEventListener('mousedown', handleClickOutside, { capture: true })
    document.addEventListener('keydown', handleEscape, { capture: true })

    return () => {
      // Must match capture option when removing
      document.removeEventListener('mousedown', handleClickOutside, { capture: true })
      document.removeEventListener('keydown', handleEscape, { capture: true })
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

  const handleItemClick = (item: ContextMenuItem) => {
    if (!item.separator && !item.disabled) {
      item.action()
      onClose()
    }
  }

  if (!portalRoot) return null

  const menu = (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
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
            className={`context-menu-item ${item.danger ? 'danger' : ''} ${item.disabled ? 'disabled' : ''}`}
            role="menuitem"
            aria-disabled={item.disabled || undefined}
            onClick={() => handleItemClick(item)}
            data-testid={item.testId}
          >
            {item.icon && <span className="context-menu-icon">{item.icon}</span>}
            <span className="context-menu-label">{item.label}</span>
            {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
          </div>
        )
      )}
    </div>
  )

  return createPortal(menu, portalRoot)
}
