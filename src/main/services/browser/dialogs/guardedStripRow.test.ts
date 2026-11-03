// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A non-site strip row (025-FR-054): main's 500 ms input guard, its own
 * answers only, one row that a content change restarts.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock } from '../../../../shared/clock'
import type { StripEvent } from '../../../../shared/ipc/browser-tab-schema'
import { StripEventSchema } from '../../../../shared/ipc/browser-tab-schema'
import { GuardedStripRow, type GuardedRowSpec } from './guardedStripRow'

const SPEC: GuardedRowSpec = { kind: 'leavePage', text: 'Leave?', answers: ['leave', 'stay'], takesFocus: true }

function setup() {
  const clock = createManualClock(10_000)
  const events: StripEvent[] = []
  const row = new GuardedStripRow({ tabId: 'browser-tab-1', clock, emit: (e) => events.push(e), newId: () => 'row1' })
  return { clock, events, row }
}

describe('GuardedStripRow', () => {
  it('shows one row with an id and the time; the same content again changes nothing', () => {
    const { events, row } = setup()
    row.show(SPEC)
    row.show({ ...SPEC })
    expect(events).toEqual([
      { tabId: 'browser-tab-1', op: 'add', row: { ...SPEC, requestId: 'row1', shownAt: 10_000 } }
    ])
    expect(StripEventSchema.safeParse(events[0]).success).toBe(true)
    expect(row.isShown).toBe(true)
  })

  it('a content change is a change event and restarts the guard', () => {
    const { clock, events, row } = setup()
    row.show(SPEC)
    clock.advance(400)
    row.show({ ...SPEC, text: 'Other' })
    expect(events[1]).toMatchObject({ op: 'change', row: { requestId: 'row1', text: 'Other', shownAt: 10_400 } })
    clock.advance(400)
    expect(row.answer('row1', 'stay', vi.fn())).toBe('guarded')
  })

  it('ignores an answer inside the 500 ms guard, refuses one it does not offer, and is not another row', () => {
    const { clock, row } = setup()
    const act = vi.fn()
    expect(row.answer('row1', 'stay', act)).toBeNull()
    row.show(SPEC)
    expect(row.answer('other', 'stay', act)).toBeNull()
    expect(row.answer('row1', 'allowOnce', act)).toBe('invalid')
    clock.advance(499)
    expect(row.answer('row1', 'stay', act)).toBe('guarded')
    expect(act).not.toHaveBeenCalled()
  })

  it('an accepted answer takes the row away and runs the action once', () => {
    const { clock, events, row } = setup()
    const act = vi.fn()
    row.show(SPEC)
    clock.advance(500)
    expect(row.answer('row1', 'leave', act)).toBe('accepted')
    expect(act).toHaveBeenCalledWith('leave')
    expect(events.at(-1)).toEqual({ tabId: 'browser-tab-1', op: 'withdraw', requestId: 'row1' })
    expect(row.answer('row1', 'leave', act)).toBeNull()
  })

  it('hide withdraws a shown row only; a failing emit is logged, not thrown', () => {
    const clock = createManualClock(0)
    const row = new GuardedStripRow({ tabId: 'browser-tab-1', clock, emit: () => { throw new Error('gone') } })
    row.hide()
    expect(() => row.show({ ...SPEC, requester: undefined })).not.toThrow()
    expect(() => row.hide()).not.toThrow()
    expect(row.isShown).toBe(false)
  })

  it('keeps a requester line and mints a random 32-hex id by default', () => {
    const events: StripEvent[] = []
    const row = new GuardedStripRow({ tabId: 'browser-tab-1', clock: createManualClock(0), emit: (e) => events.push(e) })
    const requester = { origin: { kind: 'file' as const }, inside: null }
    row.show({ ...SPEC, requester })
    const added = events[0] as Extract<StripEvent, { op: 'add' }>
    expect(added.row.requester).toEqual(requester)
    expect(added.row.requestId).toMatch(/^[0-9a-f]{32}$/)
  })
})
