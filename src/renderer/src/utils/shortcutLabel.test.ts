// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the platform-aware shortcut label (utils/shortcutLabel.ts, #143).
 *
 * macOS keeps the modifier glyphs in Apple's order (⌃⌥⇧⌘); Windows and Linux
 * spell the modifiers out and join them with "+".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatShortcut } from './shortcutLabel'
import { isMacOS } from './platform'

vi.mock('./platform', () => ({
  isMacOS: vi.fn()
}))

const mockIsMacOS = vi.mocked(isMacOS)

describe('formatShortcut', () => {
  beforeEach(() => {
    mockIsMacOS.mockReset()
  })

  describe('on macOS', () => {
    beforeEach(() => {
      mockIsMacOS.mockReturnValue(true)
    })

    it('uses the ⌘ glyph for the primary modifier', () => {
      expect(formatShortcut('B', { mod: true })).toBe('⌘B')
    })

    it('orders glyphs the Apple way (⌥ before ⇧ before ⌘)', () => {
      expect(formatShortcut('C', { mod: true, alt: true })).toBe('⌥⌘C')
      expect(formatShortcut('F', { mod: true, shift: true })).toBe('⇧⌘F')
      expect(formatShortcut('R', { mod: true, alt: true, shift: true })).toBe('⌥⇧⌘R')
    })

    it('keeps a named key as a word', () => {
      expect(formatShortcut('Enter', { mod: true })).toBe('⌘Enter')
    })
  })

  describe('on Windows and Linux', () => {
    beforeEach(() => {
      mockIsMacOS.mockReturnValue(false)
    })

    it('spells the primary modifier as Ctrl', () => {
      expect(formatShortcut('B', { mod: true })).toBe('Ctrl+B')
    })

    it('orders modifiers Ctrl, Alt, Shift and joins them with +', () => {
      expect(formatShortcut('C', { mod: true, alt: true })).toBe('Ctrl+Alt+C')
      expect(formatShortcut('F', { mod: true, shift: true })).toBe('Ctrl+Shift+F')
      expect(formatShortcut('R', { mod: true, alt: true, shift: true })).toBe('Ctrl+Alt+Shift+R')
    })

    it('shows a lone Alt chord without Ctrl', () => {
      expect(formatShortcut('W', { alt: true })).toBe('Alt+W')
    })

    it('never shows a macOS glyph or "Cmd"', () => {
      const label = formatShortcut('M', { mod: true, alt: true, shift: true })
      expect(label).not.toMatch(/[⌘⌥⇧⌃]|Cmd/)
    })
  })

  it('returns the bare key when no modifier is set', () => {
    mockIsMacOS.mockReturnValue(false)
    expect(formatShortcut('Esc')).toBe('Esc')
    mockIsMacOS.mockReturnValue(true)
    expect(formatShortcut('Esc')).toBe('Esc')
  })
})
