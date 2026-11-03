// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WidthPresetMenu, widthMenuItems } from './WidthPresetMenu'

let portalRoot: HTMLDivElement
beforeEach(() => {
  portalRoot = document.createElement('div')
  portalRoot.id = 'portal-root'
  document.body.appendChild(portalRoot)
})
afterEach(() => {
  cleanup()
  portalRoot.remove()
})

describe('widthMenuItems (025-FR-012)', () => {
  it('lists Full, Phone and Tablet with the DevTools reason on the two narrow ones, and chooses on action', () => {
    const choose = vi.fn()
    const items = widthMenuItems('phone', choose)
    expect(items.map(i => i.label)).toEqual(['Full width', 'Phone width (390px)', 'Tablet width (768px)'])
    expect(items.map(i => i.reason)).toEqual([undefined, 'Width only – touch and mobile mode are in DevTools', 'Width only – touch and mobile mode are in DevTools'])
    items[2].action()
    expect(choose).toHaveBeenCalledWith('tablet')
  })
})

describe('WidthPresetMenu', () => {
  it('names the button after the preset and opens the menu, which closes after a choice', () => {
    const choose = vi.fn()
    render(<WidthPresetMenu preset="tablet" onChoose={choose} />)
    const button = screen.getByRole('button', { name: 'Page width: Tablet width (768px)' })
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveTextContent('Tablet width (768px)')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Full width' }))
    expect(choose).toHaveBeenCalledWith('full')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('survives a still image that shows the menu after the button went away', () => {
    let show: () => void = () => undefined
    const still = { open: vi.fn((s: () => void) => (show = s)), close: vi.fn(), active: false }
    const { unmount } = render(<WidthPresetMenu preset="full" onChoose={vi.fn()} still={still as never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Page width: Full width' }))
    unmount()
    expect(() => show()).not.toThrow()
  })

  it('opens with ArrowDown and over the still image when one is given, releasing it on close', () => {
    const still = { open: vi.fn((show: () => void) => show()), close: vi.fn(), active: false }
    render(<WidthPresetMenu preset="full" onChoose={vi.fn()} still={still as never} />)
    const button = screen.getByRole('button', { name: 'Page width: Full width' })
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    expect(still.open).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('menu', { name: 'Page width' })).toBeInTheDocument()
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(still.open).toHaveBeenCalledTimes(1)
    fireEvent.click(button)
    expect(still.close).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
