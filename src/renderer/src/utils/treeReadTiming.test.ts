// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach } from 'vitest'
import { getTreeReadMs, recordTreeReadMs, resetTreeReadTiming } from './treeReadTiming'

describe('treeReadTiming', () => {
  beforeEach(() => resetTreeReadTiming())

  it('starts at 0, takes the first sample as is, then smooths', () => {
    expect(getTreeReadMs()).toBe(0)
    recordTreeReadMs(1000)
    expect(getTreeReadMs()).toBe(1000)
    recordTreeReadMs(3000)
    expect(getTreeReadMs()).toBe(2000)
  })

  it('ignores an invalid sample', () => {
    recordTreeReadMs(-5)
    recordTreeReadMs(Number.NaN)
    expect(getTreeReadMs()).toBe(0)
  })
})
