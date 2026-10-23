// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The keyboard contract `role="menu"` promises (issue #90, part of #87),
 * as decided by design/system/components/menu: focus on open, roving
 * tabindex, arrows with wrap, Home / End, Enter / Space, typeahead, Escape and
 * Tab close and return focus to the opener.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useState } from 'react'
import { ContextMenu, TYPEAHEAD_RESET_MS, type ContextMenuItem } from './ContextMenu'

const ITEMS: ContextMenuItem[] = [
  { label: 'Open', action: vi.fn() },
  { label: 'Open to the side', action: vi.fn() },
  { label: '', action: () => {}, separator: true },
  { label: 'Copy', action: vi.fn(), shortcut: '⌘C' },
  { label: 'Paste', action: vi.fn(), disabled: true },
  { label: 'Delete', action: vi.fn(), danger: true }
]

function items(): HTMLElement[] {
  return screen.getAllByRole('menuitem')
}

function focusedLabel(): string | null | undefined {
  return document.activeElement?.querySelector('.context-menu-label')?.textContent
}

function press(key: string, init: Partial<KeyboardEventInit> = {}): boolean {
  return fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init })
}

/** A trigger that opens the menu and closes it the way a real parent does. */
function Harness({ list = ITEMS, onAction }: { list?: ContextMenuItem[]; onAction?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button data-testid="opener" onClick={() => setOpen(true)}>
        opener
      </button>
      {open && (
        <ContextMenu
          x={10}
          y={10}
          items={list.map((item) => ({
            ...item,
            action: () => {
              item.action()
              onAction?.()
            }
          }))}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function openFromButton(list?: ContextMenuItem[], onAction?: () => void): HTMLElement {
  render(<Harness list={list} onAction={onAction} />)
  const opener = screen.getByTestId('opener')
  opener.focus()
  fireEvent.click(opener)
  return opener
}

describe('ContextMenu keyboard contract (#90)', () => {
  beforeEach(() => {
    const portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
    for (const item of ITEMS) vi.mocked(item.action).mockClear?.()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('moves focus to the first item when it opens', () => {
    openFromButton()
    expect(focusedLabel()).toBe('Open')
  })

  it('keeps exactly one item in the Tab order (roving tabindex)', () => {
    openFromButton()
    const stops = items().map((item) => item.tabIndex)
    expect(stops.filter((value) => value === 0)).toHaveLength(1)
    expect(stops.filter((value) => value === -1)).toHaveLength(items().length - 1)

    press('ArrowDown')
    expect(items()[1]).toHaveAttribute('tabindex', '0')
    expect(items()[0]).toHaveAttribute('tabindex', '-1')
  })

  it('moves with the arrow keys, skips separators and wraps at both ends', () => {
    openFromButton()
    press('ArrowDown')
    expect(focusedLabel()).toBe('Open to the side')
    press('ArrowDown')
    // The separator between them is skipped.
    expect(focusedLabel()).toBe('Copy')
    press('ArrowUp')
    press('ArrowUp')
    expect(focusedLabel()).toBe('Open')
    press('ArrowUp')
    expect(focusedLabel()).toBe('Delete')
    press('ArrowDown')
    expect(focusedLabel()).toBe('Open')
  })

  it('keeps a disabled item reachable by the arrow keys', () => {
    openFromButton()
    press('End')
    press('ArrowUp')
    expect(focusedLabel()).toBe('Paste')
    expect(document.activeElement).toHaveAttribute('aria-disabled', 'true')
  })

  it('jumps to the first and last item with Home and End', () => {
    openFromButton()
    press('End')
    expect(focusedLabel()).toBe('Delete')
    press('Home')
    expect(focusedLabel()).toBe('Open')
  })

  it.each(['Enter', ' '])('activates the focused item with %j and returns focus first', (key) => {
    let focusedDuringAction: Element | null = null
    const copy = vi.fn(() => {
      focusedDuringAction = document.activeElement
    })
    const list = ITEMS.map((item) => (item.label === 'Copy' ? { ...item, action: copy } : item))
    const opener = openFromButton(list)
    press('ArrowDown')
    press('ArrowDown')

    press(key)

    expect(copy).toHaveBeenCalledOnce()
    expect(focusedDuringAction).toBe(opener)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(opener)
  })

  it('does nothing when Enter is pressed on a disabled item', () => {
    const paste = vi.fn()
    const list = ITEMS.map((item) => (item.label === 'Paste' ? { ...item, action: paste } : item))
    openFromButton(list)
    press('End')
    press('ArrowUp')

    press('Enter')

    expect(paste).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(focusedLabel()).toBe('Paste')
  })

  it('closes on Escape and returns focus to the opener', () => {
    const opener = openFromButton()
    press('ArrowDown')

    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(opener)
  })

  it('closes on Tab instead of walking out of the menu, and returns focus', () => {
    const opener = openFromButton()

    const notPrevented = press('Tab')

    expect(notPrevented).toBe(false)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(opener)
  })

  it('returns focus to the opener whatever closes it while focus is inside', () => {
    function Parent() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button data-testid="close-from-outside" onClick={() => setOpen(false)} />
          {open && <ContextMenu x={0} y={0} items={ITEMS} onClose={() => setOpen(false)} />}
        </>
      )
    }
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    render(<Parent />)
    expect(focusedLabel()).toBe('Open')

    // The parent unmounts the menu without going through any menu handler.
    act(() => {
      screen.getByTestId('close-from-outside').click()
    })

    expect(document.activeElement).toBe(opener)
  })

  it('jumps by typeahead, cycles on a repeated letter and resets after a pause', () => {
    vi.useFakeTimers()
    openFromButton()

    press('d')
    expect(focusedLabel()).toBe('Delete')

    vi.advanceTimersByTime(TYPEAHEAD_RESET_MS + 1)
    press('o')
    // Searching starts after the current item and wraps.
    expect(focusedLabel()).toBe('Open')
    press('o')
    // A repeated single letter moves on to the next match...
    expect(focusedLabel()).toBe('Open to the side')
    press('o')
    // ...and wraps back round.
    expect(focusedLabel()).toBe('Open')

    vi.advanceTimersByTime(TYPEAHEAD_RESET_MS + 1)
    press('c')
    press('o')
    // "co" within the window is one search: Copy stays, not an "o" jump.
    expect(focusedLabel()).toBe('Copy')

    press('x')
    // No match for "cox": focus stays where it is.
    expect(focusedLabel()).toBe('Copy')
  })

  it('moves the roving stop to the item under the pointer', () => {
    openFromButton()
    fireEvent.mouseMove(screen.getByText('Copy'))
    expect(focusedLabel()).toBe('Copy')
    expect(screen.getByText('Copy').closest('[role="menuitem"]')).toHaveAttribute('tabindex', '0')
  })

  it('keeps handled keys from reaching a React ancestor through the portal', () => {
    const ancestorKeyDown = vi.fn()
    render(
      <div onKeyDown={ancestorKeyDown}>
        <ContextMenu x={0} y={0} items={ITEMS} onClose={vi.fn()} />
      </div>
    )
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'o', 'Tab']) {
      if (screen.queryByRole('menu')) press(key)
    }
    expect(ancestorKeyDown).not.toHaveBeenCalled()
  })

  it('lets a modified shortcut through to the app', () => {
    const ancestorKeyDown = vi.fn()
    render(
      <div onKeyDown={ancestorKeyDown}>
        <ContextMenu x={0} y={0} items={ITEMS} onClose={vi.fn()} />
      </div>
    )
    press('s', { metaKey: true })
    expect(ancestorKeyDown).toHaveBeenCalledOnce()
    expect(focusedLabel()).toBe('Open')
  })

  it('hides the decorative icon and shortcut and exposes the shortcut as a property', () => {
    render(
      <ContextMenu
        x={0}
        y={0}
        items={[{ label: 'Copy', action: vi.fn(), shortcut: '⌘C', icon: <svg data-testid="icon" /> }]}
        onClose={vi.fn()}
      />
    )
    const item = screen.getByRole('menuitem', { name: 'Copy' })
    // ARIA key names, not the display glyphs.
    expect(item).toHaveAttribute('aria-keyshortcuts', 'Meta+C')
    expect(screen.getByTestId('icon').parentElement).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('⌘C')).toHaveAttribute('aria-hidden', 'true')
  })

  it('still takes focus when it has no items to focus', () => {
    render(
      <ContextMenu x={0} y={0} items={[{ label: '', action: () => {}, separator: true }]} onClose={vi.fn()} />
    )
    expect(document.activeElement).toBe(screen.getByRole('menu'))
    // And the keys do not throw on an empty menu.
    press('ArrowDown')
    press('End')
    press('Enter')
  })
})
