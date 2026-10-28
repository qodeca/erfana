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
import { BaseDialog } from '../Dialog/BaseDialog'
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

  it('Escape closes only the menu when it is open over a dialog (#229)', () => {
    const onClose = vi.fn()
    const dialogClose = vi.fn()
    // jsdom loads no stylesheet; give the menu's layering token its value.
    document.documentElement.style.setProperty('--z-context-menu', '100000')
    render(
      <>
        <BaseDialog isOpen onClose={dialogClose} zIndex={10001}>
          <button>Dialog button</button>
        </BaseDialog>
        <ContextMenu x={100} y={200} items={defaultItems} onClose={onClose} />
      </>
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledOnce()
    expect(dialogClose).not.toHaveBeenCalled()
    document.documentElement.style.removeProperty('--z-context-menu')
  })

  it('leaves the Tab trap of a dialog beneath it working', () => {
    // A menu is not modal: opened inside a trapping dialog it must not make
    // that dialog think something modal is stacked above it.
    document.documentElement.style.setProperty('--z-context-menu', '100000')
    render(
      <>
        <BaseDialog isOpen onClose={vi.fn()} zIndex={10001} trapFocus>
          <button data-testid="first">First</button>
          <button data-testid="last">Last</button>
        </BaseDialog>
        <ContextMenu x={100} y={200} items={defaultItems} onClose={vi.fn()} />
      </>
    )

    screen.getByTestId('last').focus()
    const notPrevented = fireEvent.keyDown(document, { key: 'Tab' })

    expect(notPrevented).toBe(false)
    expect(document.activeElement).toBe(screen.getByTestId('first'))
    document.documentElement.style.removeProperty('--z-context-menu')
  })

  it('keeps Escape from reaching the control underneath the menu', () => {
    // A terminal context menu sits over xterm's textarea: an Escape that leaks
    // through would interrupt the agent running in the terminal.
    const underneath = vi.fn()
    const input = document.createElement('textarea')
    document.body.appendChild(input)
    input.addEventListener('keydown', underneath)
    renderMenu()

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(underneath).not.toHaveBeenCalled()
    input.remove()
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
