// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ContextMenu opened from a menu button (#451, the toolbar's "More actions"):
 * placed under the anchor with its inline-end edge on the anchor's, flipped
 * toward the window's interior near an edge; opens on the last item for ↑; a
 * press on the anchor is not an outside click; focus returns to the anchor;
 * a checked item is a `menuitemcheckbox`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'

const MENU_W = 200
const MENU_H = 100

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

function domRect({ left, top, width, height }: Rect): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({})
  } as DOMRect
}

let anchorRect: Rect

function makeAnchor(): HTMLButtonElement {
  const anchor = document.createElement('button')
  anchor.textContent = 'More actions'
  document.body.appendChild(anchor)
  return anchor
}

const ITEMS: ContextMenuItem[] = [
  { label: 'First', action: vi.fn() },
  { label: 'Lock', action: vi.fn(), checked: true },
  { label: 'Last', action: vi.fn(), checked: false }
]

describe('ContextMenu under an anchor', () => {
  beforeEach(() => {
    const portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.getAttribute('role') === 'menu') return domRect({ left: 0, top: 0, width: MENU_W, height: MENU_H })
      if (this.tagName === 'BUTTON') return domRect(anchorRect)
      return domRect({ left: 0, top: 0, width: 0, height: 0 })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('opens under the anchor, its inline-end edge on the anchor’s', () => {
    anchorRect = { left: 900, top: 10, width: 24, height: 24 }
    const anchor = makeAnchor()
    render(<ContextMenu anchorElement={anchor} items={ITEMS} onClose={() => {}} />)
    const menu = screen.getByRole('menu')
    expect(menu.style.left).toBe(`${924 - MENU_W}px`)
    expect(menu.style.top).toBe(`${34 + 2}px`)
    expect(menu.style.opacity).toBe('1')
  })

  it('flips to open toward the interior when the anchor is at the left edge', () => {
    anchorRect = { left: 20, top: 10, width: 24, height: 24 }
    const anchor = makeAnchor()
    render(<ContextMenu anchorElement={anchor} items={ITEMS} onClose={() => {}} />)
    expect(screen.getByRole('menu').style.left).toBe('20px')
  })

  it('opens above the anchor when there is no room below', () => {
    anchorRect = { left: 900, top: 760, width: 24, height: 24 }
    const anchor = makeAnchor()
    render(<ContextMenu anchorElement={anchor} items={ITEMS} onClose={() => {}} />)
    expect(screen.getByRole('menu').style.top).toBe(`${760 - 2 - MENU_H}px`)
  })

  it('opens on the last item when asked (↑ on a menu button)', () => {
    anchorRect = { left: 900, top: 10, width: 24, height: 24 }
    const anchor = makeAnchor()
    render(<ContextMenu anchorElement={anchor} items={ITEMS} onClose={() => {}} initialFocus="last" />)
    expect(document.activeElement).toHaveAccessibleName('Last')
  })

  it('does not treat a press on the anchor as an outside click', () => {
    anchorRect = { left: 900, top: 10, width: 24, height: 24 }
    const anchor = makeAnchor()
    const onClose = vi.fn()
    render(<ContextMenu anchorElement={anchor} items={ITEMS} onClose={onClose} />)
    fireEvent.mouseDown(anchor)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('returns focus to the anchor before an item runs', () => {
    anchorRect = { left: 900, top: 10, width: 24, height: 24 }
    const anchor = makeAnchor()
    let focusedWhenRun: Element | null = null
    const items: ContextMenuItem[] = [{ label: 'Run', action: () => (focusedWhenRun = document.activeElement) }]
    render(<ContextMenu anchorElement={anchor} items={items} onClose={() => {}} />)
    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' })
    expect(focusedWhenRun).toBe(anchor)
  })

  it('renders a checked item as a menuitemcheckbox with a check, an unchecked one without', () => {
    anchorRect = { left: 900, top: 10, width: 24, height: 24 }
    const anchor = makeAnchor()
    render(<ContextMenu anchorElement={anchor} items={ITEMS} onClose={() => {}} />)
    const [lock, last] = screen.getAllByRole('menuitemcheckbox')
    expect(lock).toHaveAttribute('aria-checked', 'true')
    expect(lock.querySelector('.context-menu-check svg')).not.toBeNull()
    expect(last).toHaveAttribute('aria-checked', 'false')
    expect(last.querySelector('.context-menu-check svg')).toBeNull()
    expect(screen.getByRole('menuitem')).not.toHaveAttribute('aria-checked')
  })
})
