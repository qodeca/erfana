// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
import { describe, it, expect, vi } from 'vitest'
import { fitTerminalIfUsable, isUsableFit, MIN_FIT_COLS, MIN_FIT_ROWS } from './terminalFit'

function makeAddon(proposed: { cols: number; rows: number } | undefined, xterm: { cols: number; rows: number }) {
  return {
    proposeDimensions: vi.fn(() => proposed),
    fit: vi.fn(() => {
      if (proposed) {
        xterm.cols = proposed.cols
        xterm.rows = proposed.rows
      }
    })
  }
}

describe('isUsableFit', () => {
  it('accepts a normal terminal size and the exact floor', () => {
    expect(isUsableFit({ cols: 120, rows: 30 })).toBe(true)
    expect(isUsableFit({ cols: MIN_FIT_COLS, rows: MIN_FIT_ROWS })).toBe(true)
  })

  it('rejects the 2-column size FitAddon proposes for a collapsed (0 px) panel (#465)', () => {
    expect(isUsableFit({ cols: 2, rows: 1 })).toBe(false)
    expect(isUsableFit({ cols: 2, rows: 30 })).toBe(false)
  })

  it('rejects sizes just under the floor, no measurement, and non-numbers', () => {
    expect(isUsableFit({ cols: MIN_FIT_COLS - 1, rows: 30 })).toBe(false)
    expect(isUsableFit({ cols: 120, rows: MIN_FIT_ROWS - 1 })).toBe(false)
    expect(isUsableFit(undefined)).toBe(false)
    expect(isUsableFit({ cols: Number.NaN, rows: 30 })).toBe(false)
    expect(isUsableFit({ cols: Infinity, rows: 30 })).toBe(false)
  })
})

describe('fitTerminalIfUsable', () => {
  it('fits and answers the new whole-number size for a usable container', () => {
    const xterm = { cols: 80, rows: 24 }
    const addon = makeAddon({ cols: 132, rows: 40 }, xterm)
    expect(fitTerminalIfUsable(addon, xterm)).toEqual({ cols: 132, rows: 40 })
    expect(addon.fit).toHaveBeenCalledTimes(1)
  })

  it('floors a fractional size', () => {
    const xterm = { cols: 80.6, rows: 24.4 }
    const addon = { proposeDimensions: () => ({ cols: 80, rows: 24 }), fit: vi.fn() }
    expect(fitTerminalIfUsable(addon, xterm)).toEqual({ cols: 80, rows: 24 })
  })

  it('keeps the last good size for a collapsed panel: no fit, no size for the PTY', () => {
    const xterm = { cols: 120, rows: 30 }
    const addon = makeAddon({ cols: 2, rows: 1 }, xterm)
    expect(fitTerminalIfUsable(addon, xterm)).toBeNull()
    expect(addon.fit).not.toHaveBeenCalled()
    expect(xterm).toEqual({ cols: 120, rows: 30 })
  })

  it('does nothing before the terminal or its addon exist, or when nothing can be measured', () => {
    const xterm = { cols: 80, rows: 24 }
    expect(fitTerminalIfUsable(null, xterm)).toBeNull()
    expect(fitTerminalIfUsable(makeAddon({ cols: 80, rows: 24 }, xterm), null)).toBeNull()
    const blind = makeAddon(undefined, xterm)
    expect(fitTerminalIfUsable(blind, xterm)).toBeNull()
    expect(blind.fit).not.toHaveBeenCalled()
  })
})
