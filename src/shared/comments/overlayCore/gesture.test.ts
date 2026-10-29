// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { SELECT_DRAG_MIN_PX, classifyGesture, type GesturePoint } from './gesture'

const ORIGIN = { x: 100, y: 100 }

function released(up: GesturePoint, selectionCollapsed = true): ReturnType<typeof classifyGesture> {
  return classifyGesture({ down: ORIGIN, up, selectionCollapsed })
}

describe('gesture (shared overlay core)', () => {
  it('024-AC-001 gesture: a drag selects from 4 px of travel', () => {
    expect(SELECT_DRAG_MIN_PX).toBe(4)
  })

  it('024-AC-001 gesture: a click in place picks', () => {
    expect(released(ORIGIN)).toBe('pick')
  })

  it('024-AC-001 gesture: under 4 px of travel picks, 4 px or more selects', () => {
    expect(released({ x: 103.99, y: 100 })).toBe('pick')
    expect(released({ x: 104, y: 100 })).toBe('select')
    expect(released({ x: 100, y: 96 })).toBe('select')
    expect(released({ x: 70, y: 100 })).toBe('select')
  })

  it('024-AC-001 gesture: travel is the straight-line distance', () => {
    // 2, 3 → 3.61 px; 3, 3 → 4.24 px.
    expect(released({ x: 102, y: 103 })).toBe('pick')
    expect(released({ x: 103, y: 103 })).toBe('select')
    expect(released({ x: 97, y: 97 })).toBe('select')
  })

  it('024-AC-001 gesture: a selection that holds words selects, however short the travel', () => {
    expect(released(ORIGIN, false)).toBe('select')
    expect(released({ x: 101, y: 100 }, false)).toBe('select')
  })

  it('024-AC-001 gesture: a coordinate that is not a number picks', () => {
    expect(released({ x: Number.NaN, y: 100 })).toBe('pick')
  })
})
