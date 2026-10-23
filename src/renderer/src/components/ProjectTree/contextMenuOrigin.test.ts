// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import {
  isKeyboardContextMenu,
  rowMenuAnchor,
  POINTER_MENU_WINDOW_MS,
  POINTER_MENU_SLOP_PX
} from './contextMenuOrigin'

describe('isKeyboardContextMenu', () => {
  const press = { x: 100, y: 40, at: 1000 }

  it('treats a menu right where a recent press was as a pointer menu', () => {
    expect(isKeyboardContextMenu({ clientX: 100, clientY: 40 }, press, 1100)).toBe(false)
    expect(isKeyboardContextMenu({ clientX: 100 + POINTER_MENU_SLOP_PX, clientY: 40 }, press, 1100)).toBe(false)
    expect(isKeyboardContextMenu({ clientX: 100, clientY: 40, pointerType: 'mouse' }, press, 1100)).toBe(false)
  })

  it('treats a menu with no press before it as keyboard-made', () => {
    expect(isKeyboardContextMenu({ clientX: 100, clientY: 40 }, null, 1100)).toBe(true)
  })

  it('treats a press that is too old as not belonging to the menu', () => {
    expect(isKeyboardContextMenu({ clientX: 100, clientY: 40 }, press, 1000 + POINTER_MENU_WINDOW_MS + 1)).toBe(true)
  })

  it('treats a menu away from the last press (the row centre after a click elsewhere) as keyboard-made', () => {
    expect(isKeyboardContextMenu({ clientX: 212, clientY: 40 }, press, 1100)).toBe(true)
    expect(isKeyboardContextMenu({ clientX: 100, clientY: 40 + POINTER_MENU_SLOP_PX + 1 }, press, 1100)).toBe(true)
  })

  it('trusts an empty pointerType (how Chromium may mark a key-made menu)', () => {
    expect(isKeyboardContextMenu({ clientX: 100, clientY: 40, pointerType: '' }, press, 1100)).toBe(true)
  })
})

describe('rowMenuAnchor', () => {
  it('anchors under the row, at its left edge', () => {
    const row = { getBoundingClientRect: () => ({ left: 16, bottom: 92, top: 64, right: 300 }) } as unknown as Element
    expect(rowMenuAnchor(row)).toEqual({ x: 16, y: 92 })
  })
})
