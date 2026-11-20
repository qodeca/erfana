// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'

import { FreshnessRegistry } from './freshnessRegistry'

describe('FreshnessRegistry', () => {
  it('asks every registered tracker to check, and stops asking a removed one', () => {
    const registry = new FreshnessRegistry()
    const a = { check: vi.fn() }
    const b = { check: vi.fn() }
    registry.add(a)
    const removeB = registry.add(b)

    registry.checkAll('focus')
    removeB()
    registry.checkAll('resume')

    expect(a.check.mock.calls).toEqual([['focus'], ['resume']])
    expect(b.check.mock.calls).toEqual([['focus']])
    expect(registry.size).toBe(1)
  })

  it('a tracker that throws does not stop the others; the error surfaces after', () => {
    const registry = new FreshnessRegistry()
    const boom = new Error('boom')
    const later = { check: vi.fn() }
    registry.add({
      check: () => {
        throw boom
      },
    })
    registry.add(later)

    expect(() => registry.checkAll('focus')).toThrow(boom)
    expect(later.check).toHaveBeenCalledWith('focus')
  })
})
