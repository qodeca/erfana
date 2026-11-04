// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { TOOLBAR_OVERFLOW_TEST_IDS } from './toolbarOverflowTestids'
import { TEST_IDS } from './testids'

describe('TOOLBAR_OVERFLOW_TEST_IDS', () => {
  it('has 3 unique values that never collide with TEST_IDS', () => {
    const values = Object.values(TOOLBAR_OVERFLOW_TEST_IDS)
    expect(values).toHaveLength(3)
    expect(new Set(values).size).toBe(3)
    const taken = new Set<string>(Object.values(TEST_IDS))
    for (const value of values) expect(taken.has(value)).toBe(false)
  })
})
