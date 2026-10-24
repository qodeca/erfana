// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The terminal's keyboard route into its context menu (#90).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ANCHOR_PADDING_PX, routeTerminalMenuKey, terminalCursorAnchor, type CursorAnchorSource } from './terminalMenuKey'
import { isKeyboardMenuEcho, resetKeyboardMenuEcho } from '../../ContextMenu/contextMenuKey'

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({})
  } as DOMRect
}

/** A terminal element at `panel`, its `.xterm-screen` at `screen` (null: none) */
function terminalAt(panel: DOMRect, screen: DOMRect | null): HTMLElement {
  const element = document.createElement('div')
  element.getBoundingClientRect = () => panel
  if (screen) {
    const screenEl = document.createElement('div')
    screenEl.className = 'xterm-screen'
    screenEl.getBoundingClientRect = () => screen
    element.appendChild(screenEl)
  }
  return element
}

function source(
  element: HTMLElement | undefined,
  cursor: { x: number; y: number },
  scroll: { baseY: number; viewportY: number } = { baseY: 0, viewportY: 0 }
): CursorAnchorSource {
  return {
    cols: 80,
    rows: 24,
    element,
    buffer: { active: { cursorX: cursor.x, cursorY: cursor.y, ...scroll } }
  }
}

const at = (x: number, y: number) => () => ({ x, y })

describe('terminalCursorAnchor', () => {
  // 80 x 24 cells of 8 x 16 px, the screen inset 4 px in a panel at (100, 200)
  const panel = rect(100, 200, 700, 400)
  const screen = rect(104, 204, 640, 384)

  it('anchors just below the cursor cell', () => {
    const anchor = terminalCursorAnchor(source(terminalAt(panel, screen), { x: 10, y: 5 }))
    // x: 104 + 10 * 8, y: 204 + (5 + 1) * 16
    expect(anchor).toEqual({ x: 184, y: 300 })
  })

  it('follows the cursor row on screen when the viewport is scrolled back', () => {
    // Cursor at buffer row 100 + 3; the viewport shows rows from 90, so it sits on screen row 13
    const anchor = terminalCursorAnchor(source(terminalAt(panel, screen), { x: 0, y: 3 }, { baseY: 100, viewportY: 90 }))
    // Column 0 stays on the screen's left edge, inside the panel: not pushed right
    expect(anchor).toEqual({ x: 104, y: 204 + 14 * 16 })
  })

  it('keeps a cursor scrolled out of view inside the panel', () => {
    const anchor = terminalCursorAnchor(source(terminalAt(panel, screen), { x: 5, y: 3 }, { baseY: 500, viewportY: 0 }))
    // Clamped to the last row, and the y to the panel's padded bottom edge at most
    expect(anchor.y).toBeLessThanOrEqual(panel.bottom - ANCHOR_PADDING_PX)
    expect(anchor.y).toBe(204 + 24 * 16)
  })

  it('clamps into the panel when the screen is wider than the panel shows', () => {
    const narrow = rect(100, 200, 300, 400)
    const anchor = terminalCursorAnchor(source(terminalAt(narrow, screen), { x: 79, y: 23 }))
    // x past the panel's right edge is pulled in; y (the last row) already fits
    expect(anchor).toEqual({ x: narrow.right - ANCHOR_PADDING_PX, y: 204 + 24 * 16 })
  })

  it('is never the off-screen helper textarea position', () => {
    const anchor = terminalCursorAnchor(source(terminalAt(panel, screen), { x: 0, y: 0 }))
    expect(anchor.x).toBeGreaterThanOrEqual(panel.left)
    expect(anchor.y).toBeGreaterThanOrEqual(panel.top)
  })

  it.each([
    ['no screen element', null],
    ['a screen with no size (hidden)', rect(0, 0, 0, 0)]
  ])('falls back to the panel top-left plus padding with %s', (_name, screenRect) => {
    const anchor = terminalCursorAnchor(source(terminalAt(panel, screenRect), { x: 10, y: 5 }))
    expect(anchor).toEqual({ x: 100 + ANCHOR_PADDING_PX, y: 200 + ANCHOR_PADDING_PX })
  })

  it('falls back to the viewport corner plus padding with no element at all', () => {
    expect(terminalCursorAnchor(source(undefined, { x: 1, y: 1 }))).toEqual({ x: ANCHOR_PADDING_PX, y: ANCHOR_PADDING_PX })
  })
})

describe('routeTerminalMenuKey', () => {
  beforeEach(() => resetKeyboardMenuEcho())

  it.each([
    ['Shift+F10', { key: 'F10', shiftKey: true }],
    ['the Menu key', { key: 'ContextMenu' }]
  ])('%s opens the menu at the cursor and is kept from the shell', (_name, init) => {
    const open = vi.fn()
    const event = new KeyboardEvent('keydown', { ...init, cancelable: true })

    expect(routeTerminalMenuKey(event, at(120, 340), open)).toBe(true)
    expect(open).toHaveBeenCalledWith(120, 340)
    expect(event.defaultPrevented).toBe(true)
    // The Windows Menu-key echo that may follow is recognised.
    expect(isKeyboardMenuEcho()).toBe(true)
  })

  it('swallows the keyup of the chord without opening a second menu', () => {
    const open = vi.fn()
    expect(routeTerminalMenuKey(new KeyboardEvent('keyup', { key: 'ContextMenu' }), at(0, 0), open)).toBe(true)
    expect(open).not.toHaveBeenCalled()
  })

  it.each([
    ['plain F10', { key: 'F10' }],
    ['Ctrl+Shift+F10', { key: 'F10', shiftKey: true, ctrlKey: true }],
    ['a letter', { key: 'a' }]
  ])('passes %s through to the shell', (_name, init) => {
    const open = vi.fn()
    expect(routeTerminalMenuKey(new KeyboardEvent('keydown', init), at(0, 0), open)).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})
