// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { getLastSeenProjectGeneration, noteProjectGeneration } from './projectGeneration'

describe('projectGeneration', () => {
  it('remembers the latest generation and ignores an event without one', () => {
    noteProjectGeneration(3)
    noteProjectGeneration(undefined)
    expect(getLastSeenProjectGeneration()).toBe(3)

    noteProjectGeneration(4)
    expect(getLastSeenProjectGeneration()).toBe(4)
  })
})
