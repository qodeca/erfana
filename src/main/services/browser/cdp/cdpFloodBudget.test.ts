// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { createManualClock } from '../../../../shared/clock'
import { CdpFloodBudget, eventPayloadSize, FLOOD_MAX_BYTES, FLOOD_MAX_EVENTS, FLOOD_WINDOW_MS } from './cdpFloodBudget'

describe('CdpFloodBudget (S6, ADR 0007 decision 3)', () => {
  it('allows 200 events in one window and trips on the 201st', () => {
    const budget = new CdpFloodBudget(createManualClock(1000))
    for (let i = 0; i < FLOOD_MAX_EVENTS; i++) expect(budget.count(10)).toBe(false)
    expect(budget.isTripped).toBe(false)
    expect(budget.count(10)).toBe(true)
    expect(budget.isTripped).toBe(true)
  })

  it('reports a trip once and stays tripped until reset', () => {
    const clock = createManualClock(0)
    const budget = new CdpFloodBudget(clock)
    for (let i = 0; i <= FLOOD_MAX_EVENTS; i++) budget.count(1)
    expect(budget.count(1)).toBe(false)
    clock.advance(10 * FLOOD_WINDOW_MS)
    expect(budget.count(1)).toBe(false)
    expect(budget.isTripped).toBe(true)
    budget.reset()
    expect(budget.isTripped).toBe(false)
    expect(budget.count(1)).toBe(false)
  })

  it('allows exactly 1 MB in one window and trips one byte past it', () => {
    const budget = new CdpFloodBudget(createManualClock(0))
    expect(budget.count(FLOOD_MAX_BYTES - 1)).toBe(false)
    expect(budget.count(1)).toBe(false)
    expect(budget.count(1)).toBe(true)
  })

  it('starts a new window 1000 ms after the last one began, not 999 ms', () => {
    const clock = createManualClock(0)
    const budget = new CdpFloodBudget(clock)
    for (let i = 0; i < FLOOD_MAX_EVENTS; i++) budget.count(1)
    clock.advance(FLOOD_WINDOW_MS - 1)
    expect(budget.count(1)).toBe(true)

    const fresh = new CdpFloodBudget(clock)
    for (let i = 0; i < FLOOD_MAX_EVENTS; i++) fresh.count(1)
    clock.advance(FLOOD_WINDOW_MS)
    for (let i = 0; i < FLOOD_MAX_EVENTS; i++) expect(fresh.count(1)).toBe(false)
  })

  it('measures payloads as JSON and counts an unserialisable one as over any budget', () => {
    expect(eventPayloadSize({ a: 1 })).toBe(7)
    expect(eventPayloadSize(undefined)).toBe(0)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(eventPayloadSize(cyclic)).toBe(Number.POSITIVE_INFINITY)
  })
})
