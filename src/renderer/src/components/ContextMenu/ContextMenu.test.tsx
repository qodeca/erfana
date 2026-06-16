// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for ContextMenu component
 *
 * Covers rendering, accessibility roles, keyboard/mouse interactions,
 * positioning, and disabled item behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextMenu, ContextMenuItem } from './ContextMenu'
import { TEST_IDS } from '../../constants/testids'

describe('ContextMenu', () => {
  let portalRoot: HTMLDivElement

  beforeEach(() => {
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    document.body.removeChild(portalRoot)
  })

  const defaultItems: ContextMenuItem[] = [
    { label: 'Copy', action: vi.fn() },
    { label: 'Paste', action: vi.fn() },
    { label: 'Delete', action: vi.fn(), danger: true }
  ]

  const renderMenu = (props: Partial<Parameters<typeof ContextMenu>[0]> = {}) => {
    const defaultProps = {
      x: 100,
      y: 200,
      items: defaultItems,
      onClose: vi.fn()
    }
    return render(<ContextMenu {...defaultProps} {...props} />)
  }

  it('renders with role="menu" on the menu container', () => {
    renderMenu()
    const menu = screen.getByRole('menu')
    expect(menu).toBeInTheDocument()
  })

  it('menu items have role="menuitem"', () => {
    renderMenu()
    const menuItems = screen.getAllByRole('menuitem')
    expect(menuItems).toHaveLength(3)
  })

  it('separators have role="separator"', () => {
    const items: ContextMenuItem[] = [
      { label: 'Copy', action: vi.fn() },
      { label: '', action: () => {}, separator: true },
      { label: 'Paste', action: vi.fn() }
    ]
    renderMenu({ items })
    const separator = screen.getByRole('separator')
    expect(separator).toBeInTheDocument()
  })

  it('disabled items have aria-disabled="true"', () => {
    const items: ContextMenuItem[] = [
      { label: 'Enabled', action: vi.fn() },
      { label: 'Disabled', action: vi.fn(), disabled: true }
    ]
    renderMenu({ items })
    const disabledItem = screen.getByText('Disabled').closest('[role="menuitem"]')
    expect(disabledItem).toHaveAttribute('aria-disabled', 'true')
  })

  it('uses TEST_IDS.CONTEXT_MENU as default data-testid', () => {
    renderMenu()
    const menu = screen.getByTestId(TEST_IDS.CONTEXT_MENU)
    expect(menu).toBeInTheDocument()
  })

  it('custom containerTestId prop overrides the default test ID', () => {
    renderMenu({ containerTestId: 'custom-context-menu' })
    const menu = screen.getByTestId('custom-context-menu')
    expect(menu).toBeInTheDocument()
    expect(screen.queryByTestId(TEST_IDS.CONTEXT_MENU)).not.toBeInTheDocument()
  })

  it('item click callback fires correctly', async () => {
    const action = vi.fn()
    const onClose = vi.fn()
    const items: ContextMenuItem[] = [{ label: 'Click me', action }]
    renderMenu({ items, onClose })

    const item = screen.getByText('Click me')
    await userEvent.click(item)

    expect(action).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape key closes the menu', () => {
    const onClose = vi.fn()
    renderMenu({ onClose })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('clicking outside closes the menu', () => {
    const onClose = vi.fn()
    renderMenu({ onClose })

    // Advance time past the 50ms debounce guard
    vi.useFakeTimers()
    vi.advanceTimersByTime(100)

    fireEvent.mouseDown(document.body)

    expect(onClose).toHaveBeenCalledOnce()

    vi.useRealTimers()
  })

  it('menu renders at specified position (with cursor offset)', () => {
    renderMenu({ x: 150, y: 250 })
    const menu = screen.getByRole('menu')
    // The component applies a +8px offset to avoid the cursor covering the menu
    expect(menu.style.left).toBe('158px')
    expect(menu.style.top).toBe('258px')
  })

  it('items render correct labels', () => {
    const items: ContextMenuItem[] = [
      { label: 'Alpha', action: vi.fn() },
      { label: 'Beta', action: vi.fn() },
      { label: 'Gamma', action: vi.fn() }
    ]
    renderMenu({ items })

    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('Gamma')).toBeInTheDocument()
  })

  it('disabled items do not fire click callback', async () => {
    const action = vi.fn()
    const onClose = vi.fn()
    const items: ContextMenuItem[] = [{ label: 'No click', action, disabled: true }]
    renderMenu({ items, onClose })

    const item = screen.getByText('No click')
    await userEvent.click(item)

    expect(action).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
