// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ToolbarOverflow (#451): what moves, the "More actions" menu, its keyboard and
 * where focus goes – the Toolbar overflow card's contract
 * (docs/design-system/system/patterns/toolbar-overflow, decided).
 *
 * jsdom does no layout, so the row's width, each button's width (24) and the
 * icon's width (16) are stubbed; CSS is not loaded, so gaps, padding and the
 * title reserve read as 0. A stubbed ResizeObserver stands in for a splitter drag.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { ToolbarOverflow, MORE_ACTIONS_LABEL, overflowItemTestId, type ToolbarAction } from './ToolbarOverflow'

const BTN = 24
const ICON = 16

let rowWidth = 500
let resizeCallbacks: Array<() => void> = []

function widthOf(element: Element): number {
  if (element.closest('.erf-toolbar-overflow__slot') === element) return BTN
  if (element.classList.contains('erf-toolbar-overflow__more')) return BTN
  if (element.classList.contains('erf-toolbar-overflow__icon')) return element.hasAttribute('hidden') ? 0 : ICON
  return 0
}

function resizeTo(width: number): void {
  rowWidth = width
  act(() => resizeCallbacks.forEach((callback) => callback()))
}

function makeActions(overrides: Partial<Record<string, Partial<ToolbarAction>>> = {}): ToolbarAction[] {
  const base: ToolbarAction[] = [
    { id: 'a', icon: <svg />, label: 'Alpha', title: 'Alpha', onSelect: vi.fn(), testId: 'btn-a' },
    { id: 'b', icon: <svg />, label: 'Bravo', title: 'Bravo', onSelect: vi.fn(), testId: 'btn-b' },
    {
      id: 'c',
      icon: <svg />,
      label: 'Charlie lock',
      title: 'Charlie lock',
      pressed: true,
      onSelect: vi.fn(),
      testId: 'btn-c'
    },
    {
      id: 'd',
      icon: <svg />,
      label: 'Delta import',
      title: 'Delta import',
      busy: true,
      busyLabel: 'Importing file…',
      onSelect: vi.fn(),
      testId: 'btn-d'
    },
    {
      id: 'max',
      icon: <svg />,
      label: 'Maximize',
      title: 'Maximize (Ctrl+Shift+M)',
      shortcut: 'Ctrl+Shift+M',
      pressed: false,
      onSelect: vi.fn(),
      testId: 'btn-max',
      moveLast: true
    }
  ]
  return base.map((action) => ({ ...action, ...overrides[action.id] }))
}

function renderRow(actions: ToolbarAction[] = makeActions()) {
  return render(
    <ToolbarOverflow
      className="row"
      icon={<svg />}
      title="Terminal"
      titleClassName="title"
      buttonClassName="icon-btn"
      menuLabel="Terminal actions"
      actions={actions}
      testId="row"
    />
  )
}

function more(): HTMLElement {
  return screen.getByRole('button', { name: MORE_ACTIONS_LABEL })
}

function menuItems(): HTMLElement[] {
  return [...screen.getByRole('menu').querySelectorAll<HTMLElement>('[role^="menuitem"]')]
}

/** Room for icon + 3 buttons: a, Maximize (raised) and … stay; b, c, d move. */
const NARROW = ICON + 3 * BTN

describe('ToolbarOverflow', () => {
  beforeEach(() => {
    rowWidth = 500
    resizeCallbacks = []
    const portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('erf-toolbar-overflow') ? rowWidth : 0
    })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const width = widthOf(this)
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: BTN, width, height: BTN, toJSON: () => ({}) } as DOMRect
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resizeCallbacks.push(callback)
        }
        observe(): void {}
        disconnect(): void {}
      }
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  describe('what moves', () => {
    it('keeps every button in the row and shows no … while everything fits', () => {
      renderRow()
      for (const id of ['a', 'b', 'c', 'd', 'max']) expect(screen.getByTestId(`btn-${id}`)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: MORE_ACTIONS_LABEL })).toBeNull()
    })

    it('removes moved buttons from the row (not hidden) and shows … at the end', () => {
      renderRow()
      resizeTo(NARROW)
      expect(screen.getByTestId('btn-a')).toBeInTheDocument()
      expect(screen.getByTestId('btn-max')).toBeInTheDocument()
      for (const id of ['b', 'c', 'd']) expect(screen.queryByTestId(`btn-${id}`)).toBeNull()
      const button = more()
      expect(button).toHaveAttribute('aria-haspopup', 'menu')
      expect(button).toHaveAttribute('aria-expanded', 'false')
      expect(button).toHaveAttribute('title', MORE_ACTIONS_LABEL)
      expect(button).toBeEnabled()
      // … is the last control in the row.
      const buttons = within(screen.getByTestId('row')).getAllByRole('button')
      expect(buttons[buttons.length - 1]).toBe(button)
    })

    it('brings buttons back once they fit whole again', () => {
      renderRow()
      resizeTo(NARROW)
      resizeTo(500)
      expect(screen.getByTestId('btn-b')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: MORE_ACTIONS_LABEL })).toBeNull()
    })

    it('drops the title, then the icon, leaving only … at the floor', () => {
      const { container } = renderRow()
      // The title's reserve comes from CSS, which jsdom does not load.
      ;(container.querySelector('.erf-toolbar-overflow__title') as HTMLElement).style.minWidth = '32px'
      resizeTo(ICON + BTN)
      expect(container.querySelector('.erf-toolbar-overflow__title')).toHaveAttribute('hidden')
      expect(container.querySelector('.erf-toolbar-overflow__icon')).not.toHaveAttribute('hidden')
      resizeTo(BTN)
      expect(container.querySelector('.erf-toolbar-overflow__icon')).toHaveAttribute('hidden')
      expect(within(screen.getByTestId('row')).getAllByRole('button')).toEqual([more()])
    })

    it('never trades a one-button toolbar for …', () => {
      renderRow(makeActions().slice(0, 1))
      resizeTo(1)
      expect(screen.getByTestId('btn-a')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: MORE_ACTIONS_LABEL })).toBeNull()
    })

    it('keeps its layout while a hidden tab measures 0 wide', () => {
      renderRow()
      resizeTo(NARROW)
      resizeTo(0)
      expect(more()).toBeInTheDocument()
      expect(screen.queryByTestId('btn-b')).toBeNull()
    })
  })

  describe('the menu', () => {
    it('lists moved buttons in toolbar order with icon, label and state', () => {
      renderRow()
      resizeTo(NARROW)
      fireEvent.click(more())
      expect(screen.getByRole('menu')).toHaveAccessibleName('Terminal actions')
      expect(more()).toHaveAttribute('aria-expanded', 'true')
      const [bravo, charlie, delta] = menuItems()
      expect(menuItems()).toHaveLength(3)
      expect(bravo).toHaveAttribute('role', 'menuitem')
      expect(bravo).toHaveAccessibleName('Bravo')
      expect(bravo.querySelector('.context-menu-icon svg')).not.toBeNull()
      // A toggle becomes a checked checkbox item with a visible check.
      expect(charlie).toHaveAttribute('role', 'menuitemcheckbox')
      expect(charlie).toHaveAttribute('aria-checked', 'true')
      expect(charlie.querySelector('.context-menu-check svg')).not.toBeNull()
      // A busy button becomes a disabled item carrying its busy label.
      expect(delta).toHaveAccessibleName('Importing file…')
      expect(delta).toHaveAttribute('aria-disabled', 'true')
      expect(delta).toHaveAttribute('data-testid', overflowItemTestId({ testId: 'btn-d' }))
    })

    it('shows a shortcut in the shortcut column and as aria-keyshortcuts', () => {
      renderRow()
      resizeTo(BTN)
      fireEvent.click(more())
      const max = menuItems()[menuItems().length - 1]
      expect(max).toHaveAccessibleName('Maximize')
      expect(max).toHaveAttribute('role', 'menuitemcheckbox')
      expect(max).toHaveAttribute('aria-checked', 'false')
      expect(max.querySelector('.context-menu-check svg')).toBeNull()
      expect(max.querySelector('.context-menu-shortcut')).toHaveTextContent('Ctrl+Shift+M')
      expect(max).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+M')
    })

    it('runs the action on click and closes, focus back on …', () => {
      const actions = makeActions()
      renderRow(actions)
      resizeTo(NARROW)
      fireEvent.click(more())
      fireEvent.click(menuItems()[0])
      expect(actions[1].onSelect).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('menu')).toBeNull()
      expect(more()).toHaveFocus()
    })

    it('toggles closed when … is pressed again', () => {
      renderRow()
      resizeTo(NARROW)
      fireEvent.click(more())
      fireEvent.mouseDown(more())
      fireEvent.click(more())
      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('closes an open menu when the row resizes', () => {
      renderRow()
      resizeTo(NARROW)
      fireEvent.click(more())
      expect(screen.getByRole('menu')).toBeInTheDocument()
      resizeTo(NARROW - 1)
      expect(screen.queryByRole('menu')).toBeNull()
    })
  })

  describe('keyboard', () => {
    function openWith(key: string): void {
      renderRow()
      resizeTo(NARROW)
      more().focus()
      fireEvent.keyDown(more(), { key })
    }

    it('↓ on … opens on the first item', () => {
      openWith('ArrowDown')
      expect(menuItems()[0]).toHaveFocus()
    })

    it('↑ on … opens on the last item', () => {
      openWith('ArrowUp')
      expect(menuItems()[2]).toHaveFocus()
    })

    it('Enter / Space on … (a click) opens on the first item', () => {
      renderRow()
      resizeTo(NARROW)
      more().focus()
      fireEvent.click(more())
      expect(menuItems()[0]).toHaveFocus()
    })

    it('arrows wrap and reach the disabled item; Home and End jump', () => {
      openWith('ArrowDown')
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' })
      expect(menuItems()[2]).toHaveFocus() // wrapped, disabled but reachable
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
      expect(menuItems()[0]).toHaveFocus()
      fireEvent.keyDown(document.activeElement as Element, { key: 'End' })
      expect(menuItems()[2]).toHaveFocus()
      fireEvent.keyDown(document.activeElement as Element, { key: 'Home' })
      expect(menuItems()[0]).toHaveFocus()
    })

    it('typeahead moves to the matching item', () => {
      openWith('ArrowDown')
      fireEvent.keyDown(document.activeElement as Element, { key: 'c' })
      expect(menuItems()[1]).toHaveFocus()
    })

    it('Enter runs the item, closes the menu and returns focus to …', () => {
      const actions = makeActions()
      render(
        <ToolbarOverflow className="row" icon={<svg />} title="T" buttonClassName="b" menuLabel="m" actions={actions} />
      )
      resizeTo(NARROW)
      more().focus()
      fireEvent.keyDown(more(), { key: 'ArrowDown' })
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
      fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' })
      expect(actions[2].onSelect).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('menu')).toBeNull()
      expect(more()).toHaveFocus()
    })

    it('Enter on a disabled item does nothing and keeps the menu open', () => {
      const actions = makeActions()
      render(
        <ToolbarOverflow className="row" icon={<svg />} title="T" buttonClassName="b" menuLabel="m" actions={actions} />
      )
      resizeTo(NARROW)
      more().focus()
      fireEvent.keyDown(more(), { key: 'ArrowUp' })
      fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' })
      expect(actions[3].onSelect).not.toHaveBeenCalled()
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('Esc closes and returns focus to …', () => {
      openWith('ArrowDown')
      fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
      expect(screen.queryByRole('menu')).toBeNull()
      expect(more()).toHaveFocus()
    })

    it('Tab closes and returns focus to …', () => {
      openWith('ArrowDown')
      fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' })
      expect(screen.queryByRole('menu')).toBeNull()
      expect(more()).toHaveFocus()
    })
  })

  describe('focus never falls off the row', () => {
    it('moves focus to … when the focused button moves', () => {
      renderRow()
      screen.getByTestId('btn-c').focus()
      resizeTo(NARROW)
      expect(screen.queryByTestId('btn-c')).toBeNull()
      expect(more()).toHaveFocus()
    })

    it('moves focus to the last button when … goes while focused', () => {
      renderRow()
      resizeTo(NARROW)
      more().focus()
      resizeTo(500)
      expect(screen.getByTestId('btn-max')).toHaveFocus()
    })
  })

  describe('row buttons', () => {
    it('carry their name, tooltip, pressed and busy state', () => {
      renderRow()
      const c = screen.getByTestId('btn-c')
      expect(c).toHaveAccessibleName('Charlie lock')
      expect(c).toHaveAttribute('aria-pressed', 'true')
      const d = screen.getByTestId('btn-d')
      expect(d).toHaveAttribute('aria-busy', 'true')
      // Busy keeps focus (Buttons card): aria-disabled, never the disabled attribute.
      expect(d).toHaveAttribute('aria-disabled', 'true')
      expect(d).not.toBeDisabled()
      const max = screen.getByTestId('btn-max')
      expect(max).toHaveAttribute('title', 'Maximize (Ctrl+Shift+M)')
    })

    it('runs the action on click', () => {
      const actions = makeActions()
      renderRow(actions)
      fireEvent.click(screen.getByTestId('btn-a'))
      expect(actions[0].onSelect).toHaveBeenCalledTimes(1)
    })
  })
})
