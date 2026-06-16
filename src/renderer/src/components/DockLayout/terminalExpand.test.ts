// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import {
  shouldExpandTerminal,
  shouldPersistTerminalWidth,
  resolvePreExpandWidth
} from './terminalExpand'

describe('shouldExpandTerminal', () => {
  it('true only when expanded AND terminal is the active right panel', () => {
    expect(shouldExpandTerminal(true, 'terminal')).toBe(true)
    expect(shouldExpandTerminal(true, null)).toBe(false)
    expect(shouldExpandTerminal(true, 'git')).toBe(false)
    expect(shouldExpandTerminal(false, 'terminal')).toBe(false)
  })
})

describe('shouldPersistTerminalWidth', () => {
  it('suppresses persistence while applying or expanded', () => {
    expect(shouldPersistTerminalWidth(false, false)).toBe(true)
    expect(shouldPersistTerminalWidth(true, false)).toBe(false)
    expect(shouldPersistTerminalWidth(false, true)).toBe(false)
    expect(shouldPersistTerminalWidth(true, true)).toBe(false)
  })
})

describe('resolvePreExpandWidth', () => {
  it('uses current width when at/above the min', () => {
    expect(resolvePreExpandWidth(420, 170, 300)).toBe(420)
    expect(resolvePreExpandWidth(170, 170, 300)).toBe(170)
  })
  it('falls back to stored width when the terminal was hidden (below min)', () => {
    expect(resolvePreExpandWidth(0, 170, 300)).toBe(300)
    expect(resolvePreExpandWidth(120, 170, 300)).toBe(300)
  })
})
