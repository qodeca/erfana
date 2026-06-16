// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { isElementVisible } from './domUtils'

describe('domUtils.isElementVisible', () => {
  it('returns false for null or zero-sized elements', () => {
    expect(isElementVisible(null as any)).toBe(false)
    const el = document.createElement('div')
    // jsdom returns 0 rect by default
    expect(isElementVisible(el)).toBe(false)
  })

  it('returns true when element has non-zero rect', () => {
    const el = document.createElement('div')
    // Mock getBoundingClientRect to simulate visibility
    el.getBoundingClientRect = () => ({
      width: 100,
      height: 50,
      top: 0,
      left: 0,
      bottom: 50,
      right: 100,
      x: 0,
      y: 0,
      toJSON() { return {} }
    } as any)
    expect(isElementVisible(el)).toBe(true)
  })
})

