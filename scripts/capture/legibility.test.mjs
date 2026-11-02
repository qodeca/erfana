// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { darkSpan, firstLetterHeight } from './legibility.mjs'

describe('darkSpan (the caption box)', () => {
  it('spans the first to the last dark pixel in range, and is null without one', () => {
    const row = Uint8Array.from([20, 230, 40, 230, 45, 40, 230, 230, 20])
    expect(darkSpan(row, 1, 8)).toEqual({ x: 2, width: 4 })
    expect(darkSpan(Uint8Array.from([230, 230, 230]))).toBeNull()
  })
})

describe('firstLetterHeight (the capital of a label, from its pixels)', () => {
  it('measures only the first lit column run (break: a later p or g counted)', () => {
    // 6 × 5: a 3-px letter in columns 1–2, then a gap, then a taller letter in column 4.
    const g = [
      0, 0, 0, 0, 255, 0,
      0, 255, 255, 0, 255, 0,
      0, 255, 0, 0, 255, 0,
      0, 255, 255, 0, 255, 0,
      0, 0, 0, 0, 255, 0
    ]
    expect(firstLetterHeight({ data: Uint8Array.from(g), width: 6, height: 5 })).toBe(3)
    expect(firstLetterHeight({ data: new Uint8Array(30), width: 6, height: 5 })).toBeNull()
    // A fully lit edge column in front of the letter is skipped.
    const edged = g.map((v, i) => (i % 6 === 0 ? 255 : v))
    expect(firstLetterHeight({ data: Uint8Array.from(edged), width: 6, height: 5 })).toBe(3)
  })
})
