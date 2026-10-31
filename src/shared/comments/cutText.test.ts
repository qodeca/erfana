// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** Cutting display text (spec 024 § 8 C22: `cutText` is part of the shared base). */
import { describe, expect, it } from 'vitest'
import { cutText } from './cutText'

describe('cutText', () => {
  it('keeps text within the length, cuts longer text, and never splits a surrogate pair', () => {
    expect(cutText('', 0)).toBe('')
    expect(cutText('abc', 3)).toBe('abc')
    expect(cutText('abcd', 3)).toBe('abc')
    expect(cutText('ab😀', 3)).toBe('ab')
    expect(cutText('a😀b', 3)).toBe('a😀')
  })
})
