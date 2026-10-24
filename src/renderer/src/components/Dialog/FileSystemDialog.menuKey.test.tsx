// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A text field's Cut / Copy / Paste menu, end to end by keyboard (#90):
 * Shift+F10 opens it with focus on the first item, the arrows move, Escape
 * closes it and puts focus back in the field – inside a trapping dialog.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { File } from 'lucide-react'
import { FileSystemDialog } from './FileSystemDialog'
import { resetKeyboardMenuEcho } from '../ContextMenu/contextMenuKey'

const props = {
  id: 'menu-key-dialog',
  title: 'New file',
  icon: <File size={20} strokeWidth={2} />,
  itemType: 'file' as const,
  operation: 'create' as const,
  parentPath: '/project/docs',
  zIndex: 10001,
  onSubmit: vi.fn(),
  onCancel: vi.fn()
}

/**
 * Renders the dialog and waits until BaseDialog's own initial-focus pass has
 * run, not just until the field has focus.
 *
 * FileSystemDialog focuses its field synchronously on mount, so "the field is
 * focused" is already true before BaseDialog's delayed pass (FOCUS_DELAY_MS,
 * 10 ms) fires. Under CI load that pass could then land after Shift+F10 had
 * opened the menu and pull focus back out of it to the field. A person cannot
 * press a key inside those 10 ms, so the test waits for the second `focus()`
 * call on the field – BaseDialog's – before pressing anything.
 *
 * @returns The dialog's text field, focused and settled
 */
async function renderSettled(): Promise<HTMLElement> {
  render(<FileSystemDialog {...props} />)
  const input = screen.getByRole('textbox')
  // Installed after render: the mount-time focus has already happened, and the
  // 10 ms timer cannot fire in between, so the next call is BaseDialog's.
  const focusSpy = vi.spyOn(input, 'focus')
  await waitFor(() => expect(focusSpy).toHaveBeenCalled())
  focusSpy.mockRestore()
  expect(document.activeElement).toBe(input)
  return input
}

describe('FileSystemDialog field menu by keyboard (#90)', () => {
  beforeEach(() => {
    const portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
    // jsdom loads no stylesheet; give the menu's layering token a value so
    // it ranks above the dialog on the overlay stack, as in the app.
    document.documentElement.style.setProperty('--z-context-menu', '100000')
    resetKeyboardMenuEcho()
  })

  afterEach(() => {
    document.documentElement.style.removeProperty('--z-context-menu')
    document.body.innerHTML = ''
  })

  it('opens with Shift+F10, takes the arrows, and Escape returns focus to the field', async () => {
    // Let BaseDialog's initial-focus pass (~10 ms after open) land first, as
    // it always has by the time a person can press a key.
    const input = await renderSettled()
    expect(input).toHaveAttribute('aria-haspopup', 'menu')

    fireEvent.keyDown(input, { key: 'F10', shiftKey: true })

    const menu = await screen.findByRole('menu')
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true))
    const first = document.activeElement
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
    expect(document.activeElement).not.toBe(first)
    expect(menu.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(document.activeElement).toBe(input)
    // Escape closed only the menu, not the dialog under it.
    expect(props.onCancel).not.toHaveBeenCalled()
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it('does not reopen the menu for the native contextmenu Windows sends after the Menu key', async () => {
    const input = await renderSettled()

    fireEvent.keyDown(input, { key: 'ContextMenu' })
    const menu = await screen.findByRole('menu')
    const before = { left: menu.style.left, top: menu.style.top }
    fireEvent.contextMenu(input, { clientX: 900, clientY: 700 })

    expect(screen.getAllByRole('menu')).toHaveLength(1)
    expect({ left: menu.style.left, top: menu.style.top }).toEqual(before)
  })
})
