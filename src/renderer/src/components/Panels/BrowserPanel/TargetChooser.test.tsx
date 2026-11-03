// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { act, createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TargetChooser, targetMenuItems, type TargetChooserHandle } from './TargetChooser'
import { targetView, type TargetStatus } from './pickRow.logic'
import type { BrowserTarget } from './useBrowserTarget'

function target(terminalName: string | null, status: TargetStatus = null): BrowserTarget {
  return {
    terminalId: terminalName === null ? null : 'terminal-1',
    terminalName,
    status,
    view: targetView(terminalName, status),
    refresh: vi.fn()
  }
}

const actions = { onChosen: vi.fn(), onShowTerminal: vi.fn(), onOpenCapture: vi.fn() }

describe('targetMenuItems', () => {
  it('disables the terminal, Show terminal and Open last capture with reasons when nothing is there', () => {
    const items = targetMenuItems({ target: target(null), lastCapture: null, ...actions })
    expect(items.map(item => [item.label, item.disabled ?? false, item.reason])).toEqual([
      ['No terminal open', true, 'Open a terminal and start your agent there'],
      ['', false, undefined],
      ['Show terminal', true, 'No terminal open'],
      ['Open last capture', true, 'Nothing sent from this browser tab yet']
    ])
  })

  it('names a shell as no agent, and opens the last capture', () => {
    const onOpenCapture = vi.fn()
    const items = targetMenuItems({
      target: target('Terminal', { kind: 'shell', process: 'zsh' }),
      lastCapture: '.erfana/browser/captures/c.md',
      ...actions,
      onOpenCapture
    })
    expect(items[0]).toMatchObject({ label: 'Terminal · zsh', reason: 'No agent running' })
    expect(items[2].disabled).toBeUndefined()
    items[3].action()
    expect(onOpenCapture).toHaveBeenCalledWith('.erfana/browser/captures/c.md')
  })
})

describe('TargetChooser', () => {
  beforeEach(() => {
    const root = document.createElement('div')
    root.id = 'portal-root'
    document.body.appendChild(root)
  })
  afterEach(() => {
    document.getElementById('portal-root')?.remove()
  })

  it('shows the terminal and its process, opens the menu, and chooses the terminal', () => {
    const onChosen = vi.fn()
    const t = target('Terminal', { kind: 'agent', process: 'claude' })
    render(<TargetChooser target={t} lastCapture={null} {...actions} onChosen={onChosen} />)
    const button = screen.getByRole('button', { name: 'Terminal · claude, target terminal' })
    expect(button).toHaveTextContent('→Terminal· claude')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(t.refresh).toHaveBeenCalledOnce()
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu', { name: 'Target terminal' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Terminal · claude' }))
    expect(onChosen).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens its menu from the handle, as Choose terminal does, and a choice there is the terminal chosen', () => {
    const onChosen = vi.fn()
    const handle = createRef<TargetChooserHandle>()
    const t = target('Terminal', { kind: 'shell', process: 'zsh' })
    render(<TargetChooser target={t} lastCapture={null} {...actions} onChosen={onChosen} variant="panel" handleRef={handle} />)
    expect(screen.queryByRole('menu')).toBeNull()
    act(() => handle.current?.openMenu())
    expect(t.refresh).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: /target terminal/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu', { name: 'Target terminal' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /Terminal · zsh/ }))
    expect(onChosen).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens over the still image when the row passes one, and lets it go on close', () => {
    const still = { open: vi.fn((show: () => void) => show()), close: vi.fn() }
    render(<TargetChooser target={target(null)} lastCapture={null} {...actions} still={still} variant="panel" />)
    const button = screen.getByRole('button', { name: 'No terminal open, target terminal' })
    fireEvent.click(button)
    expect(still.open).toHaveBeenCalledOnce()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.click(button)
    expect(still.close).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
