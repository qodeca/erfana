// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Menu shortcut hints become valid `aria-keyshortcuts` values (#350 review).
 */
import { describe, it, expect } from 'vitest'
import { toAriaKeyShortcuts } from './ariaKeyShortcuts'

describe('toAriaKeyShortcuts', () => {
  it.each([
    ['⌘C', 'Meta+C'],
    ['⌥⌘C', 'Alt+Meta+C'],
    ['⇧⌘F', 'Shift+Meta+F'],
    ['⌃⌥⇧⌘K', 'Control+Alt+Shift+Meta+K'],
    ['Ctrl+V', 'Control+V'],
    ['Ctrl+Alt+Shift+C', 'Control+Alt+Shift+C'],
    ['Shift+Ctrl+X', 'Control+Shift+X'],
    ['F2', 'F2'],
    ['Enter', 'Enter'],
    ['↩', 'Enter'],
    ['⌘⌫', 'Meta+Backspace'],
    ['Ctrl++', 'Control++'],
    ['Space', 'Space']
  ])('%s -> %s', (label, expected) => {
    expect(toAriaKeyShortcuts(label)).toBe(expected)
  })

  it.each([undefined, '', '   ', 'right-click', 'Hyper+C', '⌘drag'])('leaves %j off', (label) => {
    expect(toAriaKeyShortcuts(label)).toBeUndefined()
  })
})
