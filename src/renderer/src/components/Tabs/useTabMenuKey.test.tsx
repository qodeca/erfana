// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shift+F10 / the Menu key on a focused dock tab open its menu (#90). The key
 * arrives on dockview's `.dv-tab` wrapper, which holds focus, not on the
 * markup Erfana renders inside it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import { useTabMenuKey } from './useTabMenuKey'

function Tab({ open }: { open: (anchor: { x: number; y: number }) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useTabMenuKey(ref, open)
  return <div ref={ref} data-testid="content" />
}

/** Mount inside a stand-in for dockview's focusable tab wrapper. */
function mountInDvTab(open: (anchor: { x: number; y: number }) => void): HTMLElement {
  const dvTab = document.createElement('div')
  dvTab.className = 'dv-tab'
  dvTab.tabIndex = 0
  dvTab.getBoundingClientRect = () =>
    ({ left: 200, bottom: 35, top: 0, right: 320, width: 120, height: 35, x: 200, y: 0, toJSON: () => ({}) }) as DOMRect
  document.body.appendChild(dvTab)
  render(<Tab open={open} />, { container: dvTab })
  return dvTab
}

describe('useTabMenuKey', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it.each([
    ['Shift+F10', { key: 'F10', shiftKey: true }],
    ['the Menu key', { key: 'ContextMenu' }]
  ])('%s on the focused dockview tab opens the menu under it', (_name, init) => {
    const open = vi.fn()
    const dvTab = mountInDvTab(open)
    dvTab.focus()

    const notPrevented = fireEvent.keyDown(dvTab, init)

    expect(notPrevented).toBe(false)
    expect(open).toHaveBeenCalledWith({ x: 200, y: 35 })
  })

  it('ignores other keys', () => {
    const open = vi.fn()
    const dvTab = mountInDvTab(open)
    fireEvent.keyDown(dvTab, { key: 'F10' })
    fireEvent.keyDown(dvTab, { key: 'Enter' })
    expect(open).not.toHaveBeenCalled()
  })

  it('stops listening when the tab unmounts', () => {
    const open = vi.fn()
    const dvTab = document.createElement('div')
    dvTab.className = 'dv-tab'
    document.body.appendChild(dvTab)
    const view = render(<Tab open={open} />, { container: dvTab })
    view.unmount()
    fireEvent.keyDown(dvTab, { key: 'ContextMenu' })
    expect(open).not.toHaveBeenCalled()
  })
})
