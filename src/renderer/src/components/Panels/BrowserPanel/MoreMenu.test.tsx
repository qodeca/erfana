// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'

vi.mock('../../../utils/platform', () => ({ isMacOS: () => true, isWindows: () => false }))

import { MoreMenu, moreMenuItems, type MoreMenuActions, type MoreMenuFacts } from './MoreMenu'

const actions = (): MoreMenuActions => ({
  zoom: vi.fn(),
  widthPreset: vi.fn(),
  find: vi.fn(),
  openInSystemBrowser: vi.fn(),
  devTools: vi.fn(),
  clearData: vi.fn(),
  forget: vi.fn()
})
const facts = (patch: Partial<MoreMenuFacts> = {}): MoreMenuFacts => ({ zoomPercent: 100, widthPreset: 'full', live: true, devToolsOpen: false, ...patch })
const labels = (items: ReturnType<typeof moreMenuItems>): string[] => items.filter(i => i.separator !== true).map(i => i.label)

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

describe('moreMenuItems', () => {
  it('lists the items in deck order', () => {
    expect(labels(moreMenuItems(facts(), actions()))).toEqual([
      'Full width',
      'Phone width (390px)',
      'Tablet width (768px)',
      'Zoom in',
      'Zoom out',
      'Zoom: 100% – reset',
      'Find in page…',
      'Open in system browser',
      'DevTools',
      'Clear browsing data…',
      "Forget this project's browser data…"
    ])
  })

  it('blocks page items without a page, the zoom ends and reset at 100%, each with its reason', () => {
    const none = moreMenuItems(facts({ live: false }), actions())
    const by = (label: string): (typeof none)[number] | undefined => none.find(i => i.label === label)
    expect(by('Zoom in')).toMatchObject({ disabled: true, reason: 'Load a page first' })
    expect(by('Find in page…')).toMatchObject({ disabled: true, reason: 'Load a page first' })
    expect(by('Open in system browser')).toMatchObject({ disabled: true, reason: 'Load a page first' })
    expect(by('Zoom: 100% – reset')).toMatchObject({ disabled: true, reason: 'Already at 100%' })
    const top = moreMenuItems(facts({ zoomPercent: 500 }), actions())
    expect(top.find(i => i.label === 'Zoom in')).toMatchObject({ disabled: true, reason: 'Already at the largest zoom' })
    const bottom = moreMenuItems(facts({ zoomPercent: 25, devToolsOpen: true }), actions())
    expect(bottom.find(i => i.label === 'Zoom out')).toMatchObject({ disabled: true, reason: 'Already at the smallest zoom' })
    expect(bottom.find(i => i.label === 'Zoom: 25% – reset')?.disabled).toBeUndefined()
    expect(labels(bottom)).toContain('Show DevTools')
  })

  it('wires every item to its action', () => {
    const a = actions()
    const items = moreMenuItems(facts({ zoomPercent: 150 }), a)
    for (const item of items) item.action()
    expect(a.widthPreset).toHaveBeenCalledWith('phone')
    expect(a.zoom).toHaveBeenCalledWith('in')
    expect(a.zoom).toHaveBeenCalledWith('out')
    expect(a.zoom).toHaveBeenCalledWith('reset')
    for (const fn of [a.find, a.openInSystemBrowser, a.devTools, a.clearData, a.forget]) expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('MoreMenu', () => {
  it('opens on click and ArrowDown, names the menu, and closes on a second click', () => {
    render(<MoreMenu {...facts()} actions={actions()} buttonRef={createRef<HTMLButtonElement>()} />)
    const button = screen.getByRole('button', { name: 'More' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(screen.getByRole('menu', { name: 'More' })).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(button)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    expect(screen.getByRole('menu', { name: 'More' })).toBeInTheDocument()
  })
})

describe('MoreMenu with folded navigation tools', () => {
  it('lists them first, then a separator, then its own items', () => {
    const back = vi.fn()
    render(
      <MoreMenu
        {...facts()}
        actions={actions()}
        buttonRef={createRef<HTMLButtonElement>()}
        navItems={[{ label: 'Back', action: back }]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    const items = screen.getAllByRole('menuitem')
    expect(items[0]).toHaveTextContent('Back')
    expect(items[1]).toHaveTextContent('Full width')
    expect(screen.getAllByRole('separator').length).toBeGreaterThan(0)
    fireEvent.click(items[0])
    expect(back).toHaveBeenCalledOnce()
  })
})

describe('MoreMenu over the still image (ADR 0011)', () => {
  it('opens once the picture is up and lets it go on close', () => {
    let show: () => void = () => undefined
    const still = { open: vi.fn((fn: () => void) => (show = fn)), close: vi.fn() }
    render(<MoreMenu {...facts()} actions={actions()} buttonRef={createRef()} still={still} />)
    const button = screen.getByRole('button', { name: 'More' })
    fireEvent.click(button)
    expect(still.open).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
    act(() => show())
    expect(screen.getByRole('menu', { name: 'More' })).toBeInTheDocument()
    fireEvent.click(button)
    expect(still.close).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
