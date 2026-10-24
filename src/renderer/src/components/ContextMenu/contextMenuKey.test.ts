// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The keyboard route into a context menu (#90): which keys open one, where,
 * and how the Windows Menu-key echo is told apart from a real right-click.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isContextMenuKey,
  isKeyboardMenuEcho,
  markKeyboardMenuOpen,
  menuAnchorBelow,
  openMenuFromKey,
  resetKeyboardMenuEcho
} from './contextMenuKey'
import { KEYBOARD_MENU_ECHO_MS } from '../ProjectTree/contextMenuOrigin'

function boxed(left: number, bottom: number): HTMLElement {
  const el = document.createElement('input')
  el.getBoundingClientRect = () =>
    ({ left, bottom, top: bottom - 20, right: left + 80, width: 80, height: 20, x: left, y: bottom - 20, toJSON: () => ({}) }) as DOMRect
  return el
}

describe('isContextMenuKey', () => {
  it.each([
    [{ key: 'ContextMenu', shiftKey: false }, true],
    [{ key: 'F10', shiftKey: true }, true],
    [{ key: 'F10', shiftKey: false }, false],
    [{ key: 'F10', shiftKey: true, ctrlKey: true }, false],
    [{ key: 'F10', shiftKey: true, metaKey: true }, false],
    [{ key: 'F10', shiftKey: true, altKey: true }, false],
    [{ key: 'Enter', shiftKey: true }, false]
  ])('%j -> %s', (event, expected) => {
    expect(isContextMenuKey(event)).toBe(expected)
  })
})

describe('menuAnchorBelow', () => {
  it('anchors under the left edge', () => {
    expect(menuAnchorBelow(boxed(30, 90))).toEqual({ x: 30, y: 90 })
  })
})

describe('openMenuFromKey', () => {
  beforeEach(() => resetKeyboardMenuEcho())

  it('opens under the field and consumes the key', () => {
    const open = vi.fn()
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    const consumed = openMenuFromKey(
      { key: 'F10', shiftKey: true, currentTarget: boxed(10, 40), preventDefault, stopPropagation },
      open
    )
    expect(consumed).toBe(true)
    expect(open).toHaveBeenCalledWith({ x: 10, y: 40 })
    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
  })

  it('leaves any other key alone', () => {
    const open = vi.fn()
    const preventDefault = vi.fn()
    expect(
      openMenuFromKey(
        { key: 'Enter', shiftKey: false, currentTarget: boxed(0, 0), preventDefault, stopPropagation: vi.fn() },
        open
      )
    ).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })
})

describe('the keyboard-menu echo guard', () => {
  beforeEach(() => resetKeyboardMenuEcho())

  it('is quiet when no menu was opened from the keyboard', () => {
    expect(isKeyboardMenuEcho()).toBe(false)
  })

  it('drops a contextmenu shortly after a keyboard open', () => {
    markKeyboardMenuOpen(1000)
    expect(isKeyboardMenuEcho(1000 + 50)).toBe(true)
  })

  it('stops dropping once the echo window has passed', () => {
    markKeyboardMenuOpen(1000)
    expect(isKeyboardMenuEcho(1000 + KEYBOARD_MENU_ECHO_MS + 1)).toBe(false)
  })

  it('never drops a real right-click: a pointer press after the open', () => {
    markKeyboardMenuOpen(performance.now() - 10)
    document.dispatchEvent(new Event('pointerdown'))
    expect(isKeyboardMenuEcho()).toBe(false)
  })
})
