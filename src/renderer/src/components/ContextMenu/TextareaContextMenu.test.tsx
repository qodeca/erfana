// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TextareaContextMenu } from './TextareaContextMenu'
import { isMacOS } from '../../utils/platform'

vi.mock('../../utils/platform', () => ({ isMacOS: vi.fn(), isWindows: vi.fn() }))

describe('TextareaContextMenu (#463)', () => {
  const props = () => ({
    x: 10,
    y: 20,
    hasSelection: true,
    onCut: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn()
  })
  let portalRoot: HTMLElement

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isMacOS).mockReturnValue(false)
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })

  afterEach(() => portalRoot.remove())

  const menuItem = (name: string) => screen.getByRole('menuitem', { name })

  it('offers Cut, Copy, Paste and Delete with their shortcut hints', () => {
    render(<TextareaContextMenu {...props()} />)

    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'CutCtrl+X',
      'CopyCtrl+C',
      'PasteCtrl+V',
      'DeleteDelete'
    ])
    expect(menuItem('Delete')).toHaveAttribute('aria-keyshortcuts', 'Delete')
  })

  it('shows the macOS glyphs on macOS', () => {
    vi.mocked(isMacOS).mockReturnValue(true)
    render(<TextareaContextMenu {...props()} />)

    expect(menuItem('Cut')).toHaveAttribute('aria-keyshortcuts', 'Meta+X')
    expect(menuItem('Delete')).toHaveTextContent('⌫')
    expect(menuItem('Delete')).toHaveAttribute('aria-keyshortcuts', 'Backspace')
  })

  it('Delete deletes the selection and closes the menu', async () => {
    const p = props()
    render(<TextareaContextMenu {...p} />)

    await userEvent.click(menuItem('Delete'))

    expect(p.onDelete).toHaveBeenCalledTimes(1)
    expect(p.onCut).not.toHaveBeenCalled()
    expect(p.onClose).toHaveBeenCalled()
  })

  it('disables Cut, Copy and Delete without a selection; Paste stays enabled', async () => {
    const p = { ...props(), hasSelection: false }
    render(<TextareaContextMenu {...p} />)

    for (const name of ['Cut', 'Copy', 'Delete']) expect(menuItem(name)).toHaveAttribute('aria-disabled', 'true')
    expect(menuItem('Paste')).not.toHaveAttribute('aria-disabled')
    await userEvent.click(menuItem('Delete'))
    expect(p.onDelete).not.toHaveBeenCalled()
  })

  it('a read-only field offers Copy only', () => {
    render(<TextareaContextMenu {...props()} readOnly />)

    for (const name of ['Cut', 'Paste', 'Delete']) expect(menuItem(name)).toHaveAttribute('aria-disabled', 'true')
    expect(menuItem('Copy')).not.toHaveAttribute('aria-disabled')
  })

  it('a password field never lets its text out', () => {
    render(<TextareaContextMenu {...props()} concealed />)

    expect(menuItem('Cut')).toHaveAttribute('aria-disabled', 'true')
    expect(menuItem('Copy')).toHaveAttribute('aria-disabled', 'true')
    expect(menuItem('Delete')).not.toHaveAttribute('aria-disabled')
  })
})
