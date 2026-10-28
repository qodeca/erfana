// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ContextMenu hands focus back to whatever had it at open before running an
 * item's action (PR #286 review). Focus is inside the menu when an item is
 * picked; without the hand-back a dialog the action opens would record the
 * vanishing item (or <body>) as its opener and return focus nowhere.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContextMenu } from './ContextMenu'

describe('ContextMenu focus hand-back', () => {
  beforeEach(() => {
    const portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('re-focuses what had focus at open before running the action', () => {
    const row = document.createElement('button')
    document.body.appendChild(row)
    row.focus()
    let focusedDuringAction: Element | null = null
    const action = vi.fn(() => {
      focusedDuringAction = document.activeElement
    })

    render(<ContextMenu x={10} y={10} items={[{ label: 'Rename', action }]} onClose={vi.fn()} />)
    // Since #90 the menu takes focus on open, so at click time focus is on the
    // item – not on the row, and not on <body> as it was when items were not
    // focusable. Either way the action must see the row focused.
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename' }))

    fireEvent.click(screen.getByText('Rename'))

    expect(action).toHaveBeenCalledTimes(1)
    expect(focusedDuringAction).toBe(row)
  })

  it('still runs the action when the opener is gone', () => {
    const row = document.createElement('button')
    document.body.appendChild(row)
    row.focus()
    const action = vi.fn()

    render(<ContextMenu x={10} y={10} items={[{ label: 'Delete', action }]} onClose={vi.fn()} />)
    row.remove()
    fireEvent.click(screen.getByText('Delete'))

    expect(action).toHaveBeenCalledTimes(1)
  })

  it('does not focus anything when nothing had focus at open', () => {
    const action = vi.fn()
    render(<ContextMenu x={10} y={10} items={[{ label: 'Copy', action }]} onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('Copy'))

    expect(action).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(document.body)
  })
})
