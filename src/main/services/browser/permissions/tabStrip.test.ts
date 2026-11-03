// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One tab's strip, main side (spec 025, 025-FR-019, 025-FR-020, 025-FR-054):
 * the queue, the main-clock input guard, the gap and the notices.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock, type TestClock } from '../../../../shared/clock'
import { StripEventSchema, type StripEvent } from '../../../../shared/ipc/browser-tab-schema'
import {
  STRIP_INPUT_GUARD_MS,
  STRIP_NOTICE_MS,
  STRIP_QUEUE_GAP_MS,
  TabStrip,
  type PromptOutcome,
  type PromptSpec
} from './tabStrip'

const TAB = 'browser-tab-1'
const PERMISSION: PromptSpec = { kind: 'permission', text: 'a.test wants to use your camera', answers: ['block', 'allowOnce', 'allow', 'dismiss'] }
const DOWNLOAD: PromptSpec = { kind: 'download', text: 'This site wants to download several files.', answers: ['block', 'allow'] }

let clock: TestClock
let events: StripEvent[]
let strip: TabStrip
let ids: number

beforeEach(() => {
  clock = createManualClock(1000)
  events = []
  ids = 0
  strip = new TabStrip({ tabId: TAB, clock, emit: (e) => events.push(e), newId: () => `row${++ids}` })
})

function ask(spec: PromptSpec = PERMISSION): { id: string; outcomes: PromptOutcome[] } {
  const outcomes: PromptOutcome[] = []
  const id = strip.ask(spec, (o) => outcomes.push(o))
  return { id, outcomes }
}

const ops = (): string[] => events.map((e) => (e.op === 'withdraw' ? `withdraw:${e.requestId}` : `${e.op}:${e.op === 'held' ? '' : e.row.requestId}`))

describe('TabStrip prompts', () => {
  it('shows a prompt at once, with every event valid against the IPC schema', () => {
    ask()
    expect(events).toHaveLength(1)
    expect(StripEventSchema.safeParse(events[0]).success).toBe(true)
    expect(events[0]).toMatchObject({ op: 'add', row: { requestId: 'row1', kind: 'permission', takesFocus: false, waiting: 0, shownAt: 1000 } })
  })

  it('025-AC-019 ignores an answer at 499 ms on the main clock and accepts it at 500 ms', () => {
    const { id, outcomes } = ask()
    clock.advance(STRIP_INPUT_GUARD_MS - 1)
    expect(strip.answer(id, 'allow')).toBe('guarded')
    expect(outcomes).toEqual([])
    clock.advance(1)
    expect(strip.answer(id, 'allow')).toBe('accepted')
    expect(outcomes).toEqual([{ answer: 'allow' }])
    expect(ops()).toEqual(['add:row1', 'withdraw:row1'])
  })

  it('refuses an answer the row does not offer, an unknown id, and a second answer', () => {
    const { id } = ask(DOWNLOAD)
    clock.advance(STRIP_INPUT_GUARD_MS)
    expect(strip.answer(id, 'allowOnce')).toBe('invalid')
    expect(strip.answer('nope', 'allow')).toBe('unknown')
    expect(strip.answer(id, 'block')).toBe('accepted')
    expect(strip.answer(id, 'block')).toBe('unknown')
  })

  it('025-AC-019 queues two requests: "+1 waiting", no prompt at 299 ms, the next at 300 ms, guarded again', () => {
    const first = ask()
    const second = ask()
    expect(events[1]).toMatchObject({ op: 'change', row: { requestId: 'row1', waiting: 1, shownAt: 1000 } })
    expect(strip.answer(second.id, 'allow')).toBe('unknown')
    clock.advance(STRIP_INPUT_GUARD_MS)
    expect(strip.answer(first.id, 'allow')).toBe('accepted')
    clock.advance(STRIP_QUEUE_GAP_MS - 1)
    expect(ops()).toEqual(['add:row1', 'change:row1', 'withdraw:row1'])
    clock.advance(1)
    expect(events.at(-1)).toMatchObject({ op: 'add', row: { requestId: 'row2', waiting: 0, shownAt: 1000 + 500 + 300 } })
    clock.advance(STRIP_INPUT_GUARD_MS - 1)
    expect(strip.answer(second.id, 'allow')).toBe('guarded')
    clock.advance(1)
    expect(strip.answer(second.id, 'allow')).toBe('accepted')
    expect(second.outcomes).toEqual([{ answer: 'allow' }])
  })

  it('waits out the gap even for a request that arrives after the queue emptied', () => {
    const first = ask()
    clock.advance(STRIP_INPUT_GUARD_MS)
    strip.answer(first.id, 'block')
    ask()
    expect(ops()).toEqual(['add:row1', 'withdraw:row1'])
    clock.advance(STRIP_QUEUE_GAP_MS)
    expect(ops().at(-1)).toBe('add:row2')
  })

  it('keeps one row per kind: a download prompt shows beside a permission prompt', () => {
    ask()
    ask(DOWNLOAD)
    expect(ops()).toEqual(['add:row1', 'add:row2'])
    expect(strip.pendingCount('permission')).toBe(1)
    expect(strip.pendingCount('download')).toBe(1)
  })

  it('removes a queued or shown request without settling it', () => {
    const first = ask()
    const second = ask()
    const third = ask()
    strip.remove(second.id)
    expect(events.at(-1)).toMatchObject({ op: 'change', row: { requestId: 'row1', waiting: 1 } })
    strip.remove(first.id)
    expect(events.at(-1)).toEqual({ tabId: TAB, op: 'withdraw', requestId: 'row1' })
    clock.advance(STRIP_QUEUE_GAP_MS)
    expect(events.at(-1)).toMatchObject({ op: 'add', row: { requestId: 'row3' } })
    strip.remove('unknown')
    expect(first.outcomes).toEqual([])
    expect(second.outcomes).toEqual([])
    expect(third.outcomes).toEqual([])
    expect(strip.pendingCount('permission')).toBe(1)
    expect(strip.pendingCount('download')).toBe(0)
  })

  it('025-AC-019 withdraws every row on navigation and settles each request withdrawn', () => {
    const first = ask()
    const second = ask()
    const download = ask(DOWNLOAD)
    strip.notice('fullscreen', 'a.test is now full screen. Press Esc to exit.', undefined)
    strip.withdrawAll()
    expect(first.outcomes).toEqual([{ withdrawn: true }])
    expect(second.outcomes).toEqual([{ withdrawn: true }])
    expect(download.outcomes).toEqual([{ withdrawn: true }])
    expect(ops().filter((o) => o.startsWith('withdraw')).sort()).toEqual(['withdraw:row1', 'withdraw:row3', 'withdraw:row4'])
    expect(clock.pendingTimers()).toBe(0)
  })

  it('withdraws a pending gap so the next page starts clean', () => {
    const first = ask()
    clock.advance(STRIP_INPUT_GUARD_MS)
    strip.answer(first.id, 'allow')
    strip.withdrawAll()
    ask()
    expect(ops().at(-1)).toBe('add:row2')
  })

  it('after dispose emits nothing and settles new requests withdrawn at once', () => {
    const first = ask()
    strip.dispose()
    const count = events.length
    const late = ask()
    strip.notice('pointerLock', 'x', undefined)
    expect(first.outcomes).toEqual([{ withdrawn: true }])
    expect(late.outcomes).toEqual([{ withdrawn: true }])
    expect(events).toHaveLength(count)
  })

  it('survives an emitter or a settle callback that throws', () => {
    strip = new TabStrip({
      tabId: TAB,
      clock,
      emit: () => {
        throw new Error('window gone')
      }
    })
    const id = strip.ask(PERMISSION, () => {
      throw new Error('owner failed')
    })
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    clock.advance(STRIP_INPUT_GUARD_MS)
    expect(strip.answer(id, 'allow')).toBe('accepted')
  })
})

describe('TabStrip notices', () => {
  it('025-AC-019 shows a fullscreen notice with no answers and takes it away after 4 s', () => {
    strip.notice('fullscreen', 'a.test is now full screen. Press Esc to exit.', undefined)
    expect(events[0]).toMatchObject({ op: 'add', row: { kind: 'fullscreen', answers: [], takesFocus: false } })
    expect(StripEventSchema.safeParse(events[0]).success).toBe(true)
    expect(strip.answer('row1', 'ok')).toBe('invalid')
    clock.advance(STRIP_NOTICE_MS - 1)
    expect(events).toHaveLength(1)
    clock.advance(1)
    expect(events[1]).toEqual({ tabId: TAB, op: 'withdraw', requestId: 'row1' })
  })

  it('restarts the 4 s when the same kind shows again, as a change of the same row', () => {
    const requester = { origin: { kind: 'file' as const }, inside: null }
    strip.notice('pointerLock', 'one', requester)
    clock.advance(3000)
    strip.notice('pointerLock', 'two', requester)
    expect(events[1]).toMatchObject({ op: 'change', row: { requestId: 'row1', text: 'two', requester } })
    clock.advance(3999)
    expect(events).toHaveLength(2)
    clock.advance(1)
    expect(ops()).toEqual(['add:row1', 'change:row1', 'withdraw:row1'])
  })
})
