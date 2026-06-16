// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for TerminalPanel Pure Logic Functions
 *
 * @module TerminalPanel/logic.test
 */

import { describe, it, expect } from 'vitest'
import {
  computeTerminalState,
  shouldApplyResize,
  RESIZE_COL_THRESHOLD,
  RESIZE_ROW_THRESHOLD,
  NODE_PTY_FIX_COMMAND,
  TERMINAL_THEME,
  TERMINAL_OPTIONS,
  TERMINAL_FONT_FAMILY,
  ensureTerminalFontLoaded
} from './terminalPanel.logic'

describe('computeTerminalState', () => {
  it('returns "checking" when isAvailable is null', () => {
    expect(computeTerminalState(null, null)).toBe('checking')
    expect(computeTerminalState(null, 'some error')).toBe('checking')
  })

  it('returns "unavailable" when isAvailable is false', () => {
    expect(computeTerminalState(false, null)).toBe('unavailable')
    expect(computeTerminalState(false, 'error')).toBe('unavailable')
  })

  it('returns "error" when isAvailable is true but error exists', () => {
    expect(computeTerminalState(true, 'Failed to create terminal')).toBe('error')
    expect(computeTerminalState(true, 'Connection refused')).toBe('error')
  })

  it('returns "ready" when isAvailable is true and no error', () => {
    expect(computeTerminalState(true, null)).toBe('ready')
  })
})

describe('shouldApplyResize', () => {
  it('returns false when column change is below threshold', () => {
    expect(shouldApplyResize(80, 24, 79, 24)).toBe(false)
    expect(shouldApplyResize(80, 24, 81, 24)).toBe(false)
  })

  it('returns true when column change meets threshold', () => {
    expect(shouldApplyResize(80, 24, 78, 24)).toBe(true)
    expect(shouldApplyResize(80, 24, 82, 24)).toBe(true)
  })

  it('returns true when row change meets threshold', () => {
    expect(shouldApplyResize(80, 24, 80, 23)).toBe(true)
    expect(shouldApplyResize(80, 24, 80, 25)).toBe(true)
  })

  it('returns false when dimensions are zero or negative', () => {
    expect(shouldApplyResize(0, 24, 10, 24)).toBe(false)
    expect(shouldApplyResize(80, 0, 80, 10)).toBe(false)
    expect(shouldApplyResize(-1, 24, 10, 24)).toBe(false)
  })

  it('returns true when both thresholds are met', () => {
    expect(shouldApplyResize(80, 24, 70, 20)).toBe(true)
  })
})

describe('constants', () => {
  it('NODE_PTY_FIX_COMMAND contains rebuild command', () => {
    expect(NODE_PTY_FIX_COMMAND).toContain('npm rebuild node-pty')
    expect(NODE_PTY_FIX_COMMAND).toContain('--build-from-source')
  })

  it('RESIZE thresholds are positive', () => {
    expect(RESIZE_COL_THRESHOLD).toBeGreaterThan(0)
    expect(RESIZE_ROW_THRESHOLD).toBeGreaterThan(0)
  })

  it('TERMINAL_THEME has required color properties', () => {
    expect(TERMINAL_THEME.background).toBeDefined()
    expect(TERMINAL_THEME.foreground).toBeDefined()
    expect(TERMINAL_THEME.cursor).toBeDefined()
  })

  it('TERMINAL_OPTIONS has required settings', () => {
    expect(TERMINAL_OPTIONS.fontSize).toBeGreaterThan(0)
    expect(TERMINAL_OPTIONS.scrollback).toBeGreaterThan(0)
    expect(TERMINAL_OPTIONS.cursorBlink).toBe(true)
  })

  it('lists the bundled Cascadia Mono first in the font stack', () => {
    // Cross-platform identical rendering depends on the bundled font winning.
    expect(TERMINAL_OPTIONS.fontFamily.startsWith(`'${TERMINAL_FONT_FAMILY}'`)).toBe(true)
    // Keeps a generic fallback so the terminal never renders an invalid family.
    expect(TERMINAL_OPTIONS.fontFamily).toContain('monospace')
  })
})

describe('ensureTerminalFontLoaded', () => {
  it('resolves and is idempotent even without a Font Loading API', async () => {
    // jsdom has no document.fonts; the helper must degrade gracefully so
    // terminal init never blocks. Same promise instance on repeat calls.
    const first = ensureTerminalFontLoaded()
    const second = ensureTerminalFontLoaded()
    expect(second).toBe(first)
    await expect(first).resolves.toBeUndefined()
  })
})
