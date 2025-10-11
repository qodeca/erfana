import { useEffect, useRef } from 'react'
import './ContextMenu.css'

export interface ContextMenuItem {
  label: string
  icon?: string
  action: () => void
  danger?: boolean
  separator?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  elementRect: DOMRect
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, elementRect, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    // Add listeners after a small delay to avoid closing immediately
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }, 10)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  // Calculate optimal position with viewport boundary checks
  useEffect(() => {
    if (menuRef.current) {
      const menu = menuRef.current
      const menuRect = menu.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      // Position menu like VS Code: overlay the element
      // Menu top aligns with element top, left edge at element left
      // Offset by 34px right and 24px up for better visual alignment
      let finalX = elementRect.left + 34
      let finalY = elementRect.top - 24

      // Check right edge - if menu would overflow, align to right edge of viewport
      if (finalX + menuRect.width > viewportWidth) {
        finalX = viewportWidth - menuRect.width - 2
      }

      // Check bottom edge - if menu would overflow, position at bottom of viewport
      if (finalY + menuRect.height > viewportHeight) {
        finalY = viewportHeight - menuRect.height - 2
      }

      // Ensure menu stays within left edge
      if (finalX < 2) {
        finalX = 2
      }

      // Ensure menu stays within top edge
      if (finalY < 2) {
        finalY = 2
      }

      // Apply calculated position and make visible
      menu.style.left = `${finalX}px`
      menu.style.top = `${finalY}px`
      menu.style.opacity = '1'
    }
  }, [x, y, elementRect])

  const handleItemClick = (item: ContextMenuItem) => {
    if (!item.separator) {
      item.action()
      onClose()
    }
  }

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        opacity: 0
      }}
    >
      {items.map((item, index) =>
        item.separator ? (
          <div key={index} className="context-menu-separator" />
        ) : (
          <div
            key={index}
            className={`context-menu-item ${item.danger ? 'danger' : ''}`}
            onClick={() => handleItemClick(item)}
          >
            {item.icon && <span className="context-menu-icon">{item.icon}</span>}
            <span className="context-menu-label">{item.label}</span>
          </div>
        )
      )}
    </div>
  )
}
