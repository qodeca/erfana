// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The terminal's keyboard route into its context menu (#90).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { routeTerminalMenuKey } from './terminalMenuKey'
import { isKeyboardMenuEcho, resetKeyboardMenuEcho } from '../../ContextMenu/contextMenuKey'

function caretAt(left: number, bottom: number): HTMLElement {
  const el = document.createElement('textarea')
  el.getBoundingClientRect = () =>
    ({ left, bottom, top: bottom - 16, right: left + 1, width: 1, height: 16, x: left, y: bottom - 16, toJSON: () => ({}) }) as DOMRect
  return el
}

describe('routeTerminalMenuKey', () => {
  beforeEach(() => resetKeyboardMenuEcho())

  it.each([
    ['Shift+F10', { key: 'F10', shiftKey: true }],
    ['the Menu key', { key: 'ContextMenu' }]
  ])('%s opens the menu at the cursor and is kept from the shell', (_name, init) => {
    const open = vi.fn()
    const event = new KeyboardEvent('keydown', { ...init, cancelable: true })

    expect(routeTerminalMenuKey(event, caretAt(120, 340), open)).toBe(true)
    expect(open).toHaveBeenCalledWith(120, 340)
    expect(event.defaultPrevented).toBe(true)
    // The Windows Menu-key echo that may follow is recognised.
    expect(isKeyboardMenuEcho()).toBe(true)
  })

  it('swallows the keyup of the chord without opening a second menu', () => {
    const open = vi.fn()
    expect(routeTerminalMenuKey(new KeyboardEvent('keyup', { key: 'ContextMenu' }), null, open)).toBe(true)
    expect(open).not.toHaveBeenCalled()
  })

  it.each([
    ['plain F10', { key: 'F10' }],
    ['Ctrl+Shift+F10', { key: 'F10', shiftKey: true, ctrlKey: true }],
    ['a letter', { key: 'a' }]
  ])('passes %s through to the shell', (_name, init) => {
    const open = vi.fn()
    expect(routeTerminalMenuKey(new KeyboardEvent('keydown', init), caretAt(0, 0), open)).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})
