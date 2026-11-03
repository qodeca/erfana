// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'

vi.mock('../../../utils/platform', () => ({ isMacOS: () => true, isWindows: () => false }))
/** The fold steps the row takes; jsdom has no layout, so the measure is stood in for. */
const fold = vi.hoisted(() => ({ count: 0 }))
vi.mock('./useNavFold', () => ({ useNavFold: () => fold.count }))

import { NavigationRow, type NavigationRowProps } from './NavigationRow'
import { browserState } from './__test__/browserState'
import type { BrowserTabState } from '../../../stores/useBrowserTabStore'

function props(
  state: BrowserTabState | null,
  patch: Partial<NavigationRowProps> = {}
): NavigationRowProps {
  return {
    state,
    addressRef: createRef<HTMLInputElement>(),
    lastToolRef: createRef<HTMLButtonElement>(),
    onBack: vi.fn(),
    onForward: vi.fn(),
    onReload: vi.fn(),
    onStop: vi.fn(),
    onDevTools: vi.fn(),
    onSubmitAddress: vi.fn(async () => true),
    onAddressEscape: vi.fn(),
    onAddressEdit: vi.fn(),
    errorId: null,
    onOpenInSystemBrowser: vi.fn(async () => undefined),
    moreActions: {
      zoom: vi.fn(),
      widthPreset: vi.fn(),
      find: vi.fn(),
      openInSystemBrowser: vi.fn(),
      devTools: vi.fn(),
      clearData: vi.fn(),
      forget: vi.fn()
    },
    ...patch
  }
}

afterEach(() => {
  cleanup()
  fold.count = 0
})

describe('NavigationRow', () => {
  it('names the group, disables Back and Forward with no history and describes why', () => {
    render(<NavigationRow {...props(null)} />)
    const group = screen.getByRole('group', { name: 'Navigation' })
    expect(group).toHaveAccessibleDescription('No earlier or later page')
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute(
      'title',
      'Back – no earlier page'
    )
    expect(screen.getByRole('button', { name: 'Reload' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Meta+R'
    )
    expect(screen.getByRole('button', { name: 'DevTools' })).toHaveAttribute(
      'title',
      'DevTools (F12)'
    )
  })

  it('runs Back, Forward, Reload and DevTools, and shows Stop while loading', () => {
    const p = props(browserState({ canGoBack: true, canGoForward: true }))
    const { rerender } = render(<NavigationRow {...p} />)
    expect(screen.getByRole('group', { name: 'Navigation' })).not.toHaveAttribute(
      'aria-describedby'
    )
    expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute('title', 'Back (⌘[)')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    fireEvent.click(screen.getByRole('button', { name: 'DevTools' }))
    expect(
      [p.onBack, p.onForward, p.onReload, p.onDevTools].every(
        fn => vi.mocked(fn).mock.calls.length === 1
      )
    ).toBe(true)

    rerender(<NavigationRow {...p} state={browserState({ loading: true, devToolsOpen: true })} />)
    const stop = screen.getByRole('button', { name: 'Stop loading' })
    expect(stop).not.toHaveAttribute('aria-keyshortcuts')
    fireEvent.click(stop)
    expect(p.onStop).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Show DevTools' })).toHaveAttribute(
      'title',
      'Show DevTools (F12)'
    )
  })

  it('hands focus from Back to Forward when Back disables itself', () => {
    const p = props(browserState({ canGoBack: true, canGoForward: false }))
    const { rerender } = render(<NavigationRow {...p} />)
    act(() => screen.getByRole('button', { name: 'Back' }).focus())
    rerender(
      <NavigationRow {...p} state={browserState({ canGoBack: false, canGoForward: true })} />
    )
    expect(screen.getByRole('button', { name: 'Forward' })).toHaveFocus()
  })

  it('hands focus to the address bar when neither is enabled', () => {
    const p = props(browserState({ canGoBack: false, canGoForward: true }))
    const { rerender } = render(<NavigationRow {...p} />)
    act(() => screen.getByRole('button', { name: 'Forward' }).focus())
    rerender(
      <NavigationRow {...p} state={browserState({ canGoBack: false, canGoForward: false })} />
    )
    expect(screen.getByRole('combobox', { name: 'Address and search' })).toHaveFocus()
  })

  it('keeps Tab order Back, Forward, Reload, address bar, Open in system browser, DevTools, More', () => {
    render(<NavigationRow {...props(browserState({ canGoBack: true, canGoForward: true }))} />)
    const order = Array.from(screen.getByRole('group').querySelectorAll('button, input')).map(el =>
      el.getAttribute('aria-label')
    )
    expect(order).toEqual(['Back', 'Forward', 'Reload', 'Address and search', 'Open in system browser', 'DevTools', 'More'])
  })
})

describe('NavigationRow fold steps 3–7 (design § States › Tiers)', () => {
  let portalRoot: HTMLDivElement
  beforeEach(() => {
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })
  afterEach(() => portalRoot.remove())

  it('marks every foldable tool with its step and takes none by default', () => {
    render(<NavigationRow {...props(browserState({ canGoBack: true }))} />)
    const step = (name: string): string | null => screen.getByRole('button', { name }).getAttribute('data-fold-step')
    expect(step('Back')).toBe('7')
    expect(step('Forward')).toBe('4')
    expect(step('Reload')).toBe('4')
    expect(step('Open in system browser')).toBe('3')
    expect(step('DevTools')).toBe('3')
    expect(step('More')).toBeNull()
    expect(screen.getByRole('group', { name: 'Navigation' })).not.toHaveAttribute('data-fold')
  })

  it('lists the taken steps on the row, and More leads with the navigation tools it took', () => {
    fold.count = 5
    const p = props(browserState({ canGoBack: true, canGoForward: false }))
    render(<NavigationRow {...p} />)
    expect(screen.getByRole('group', { name: 'Navigation' })).toHaveAttribute('data-fold', '3 4 5 6 7')
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    const items = screen.getAllByRole('menuitem')
    expect(items.slice(0, 3).map(item => item.textContent)).toEqual([
      expect.stringContaining('Back'),
      expect.stringContaining('Forward'),
      expect.stringContaining('Reload')
    ])
    expect(items[1]).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(items[0])
    expect(p.onBack).toHaveBeenCalledOnce()
  })

  it('hands focus to More when the focused tool folds', () => {
    const lastToolRef = createRef<HTMLButtonElement>()
    const p = props(browserState(), { lastToolRef })
    const { rerender } = render(<NavigationRow {...p} />)
    const devTools = screen.getByRole('button', { name: 'DevTools' })
    act(() => devTools.focus())
    fold.count = 1
    rerender(<NavigationRow {...p} />)
    expect(screen.getByRole('button', { name: 'More' })).toHaveFocus()
  })

  it('hands focus from a Back that disables itself to the address bar while Forward is folded', () => {
    fold.count = 2
    const addressRef = createRef<HTMLInputElement>()
    const p = props(browserState({ canGoBack: true, canGoForward: true }), { addressRef })
    const { rerender } = render(<NavigationRow {...p} />)
    act(() => screen.getByRole('button', { name: 'Back' }).focus())
    rerender(<NavigationRow {...props(browserState({ canGoBack: false, canGoForward: true }), { addressRef })} />)
    expect(addressRef.current).toHaveFocus()
  })

  it('keeps focus on a tool that stays on the row', () => {
    const p = props(browserState({ canGoBack: true }))
    const { rerender } = render(<NavigationRow {...p} />)
    const back = screen.getByRole('button', { name: 'Back' })
    act(() => back.focus())
    fold.count = 2
    rerender(<NavigationRow {...p} />)
    expect(back).toHaveFocus()
  })
})

