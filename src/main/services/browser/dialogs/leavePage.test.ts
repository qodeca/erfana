// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The leave-page prompt (025-FR-058, ADR 0011 decisions 7 and 10, S-31):
 * asked for the user's close, reload and navigation; Leave repeats the
 * action with a one-shot pass; page-started unloads go ahead.
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock } from '../../../../shared/clock'
import type { StripEvent } from '../../../../shared/ipc/browser-tab-schema'
import { LEAVE_CLOSE_TIMEOUT_MS, LEAVE_PAGE_TEXT, LeavePageGuard } from './leavePage'

class FakeContents extends EventEmitter {
  destroyed = false
  close = vi.fn()
  isDestroyed(): boolean {
    return this.destroyed
  }
  /** Fire `will-prevent-unload`; returns whether main let the unload go ahead. */
  unload(): boolean {
    let allowed = false
    this.emit('will-prevent-unload', { preventDefault: () => (allowed = true) })
    return allowed
  }
}

function setup() {
  const clock = createManualClock(0)
  const contents = new FakeContents()
  const events: StripEvent[] = []
  const forceClose = vi.fn()
  const guard = new LeavePageGuard({
    tabId: 'browser-tab-1',
    contents,
    clock,
    emit: (e) => events.push(e),
    requester: () => undefined,
    forceClose,
    newId: () => 'lp'
  })
  return { clock, contents, events, forceClose, guard }
}

const shownRows = (events: StripEvent[]) => events.filter((e) => e.op === 'add')

describe('LeavePageGuard', () => {
  it('025-AC-075 a close by the user runs beforeunload and, when the page asks, shows "Leave this page?" focused on Stay', () => {
    const { contents, events, guard } = setup()
    guard.closeByUser()
    expect(contents.close).toHaveBeenCalledWith({ waitForBeforeUnload: true })
    expect(contents.unload()).toBe(false)
    expect(shownRows(events)).toEqual([
      {
        tabId: 'browser-tab-1',
        op: 'add',
        row: { requestId: 'lp', kind: 'leavePage', text: LEAVE_PAGE_TEXT, answers: ['leave', 'stay'], takesFocus: true, shownAt: 0 }
      }
    ])
  })

  it('025-AC-075 Stay keeps the tab; Leave after the guard closes it without asking again', () => {
    const { clock, contents, forceClose, guard } = setup()
    guard.closeByUser()
    contents.unload()
    expect(guard.answer('lp', 'stay')).toBe('guarded')
    clock.advance(500)
    expect(guard.answer('lp', 'stay')).toBe('accepted')
    expect(forceClose).not.toHaveBeenCalled()
    clock.advance(LEAVE_CLOSE_TIMEOUT_MS)
    expect(forceClose).not.toHaveBeenCalled()

    guard.closeByUser()
    contents.unload()
    clock.advance(500)
    expect(guard.answer('lp', 'leave')).toBe('accepted')
    expect(forceClose).toHaveBeenCalledTimes(1)
  })

  it('Leave on a reload or navigation repeats it, and lets exactly that unload go ahead', () => {
    const { clock, contents, guard } = setup()
    const repeat = vi.fn(() => guard.arm(repeat))
    guard.arm(repeat)
    expect(contents.unload()).toBe(false)
    clock.advance(500)
    expect(guard.answer('lp', 'leave')).toBe('accepted')
    expect(repeat).toHaveBeenCalledTimes(1)
    expect(contents.unload()).toBe(true)
    // The pass was one-shot: the next armed action asks again.
    guard.arm(repeat)
    expect(contents.unload()).toBe(false)
  })

  it('an unload the page started itself goes ahead without a prompt', () => {
    const { contents, events } = setup()
    expect(contents.unload()).toBe(true)
    expect(events).toEqual([])
  })

  it('the armed action lapses when the load commits or ends; a commit also takes the row away', () => {
    const { contents, events, guard } = setup()
    guard.arm(vi.fn())
    contents.emit('did-stop-loading')
    expect(contents.unload()).toBe(true)
    guard.arm(vi.fn())
    contents.unload()
    contents.emit('did-navigate')
    expect(events.at(-1)).toEqual({ tabId: 'browser-tab-1', op: 'withdraw', requestId: 'lp' })
  })

  it('a close the page never answers (hung) closes after the timeout; a closed page is not asked', () => {
    const { clock, contents, forceClose, guard } = setup()
    guard.closeByUser()
    clock.advance(LEAVE_CLOSE_TIMEOUT_MS)
    expect(forceClose).toHaveBeenCalledTimes(1)
    contents.destroyed = true
    contents.close.mockClear()
    guard.closeByUser()
    expect(contents.close).not.toHaveBeenCalled()
  })

  it('detach removes the row, the timer and the listeners; a destroyed page is left alone', () => {
    const { clock, contents, forceClose, guard } = setup()
    guard.closeByUser()
    contents.unload()
    guard.detach()
    expect(contents.listenerCount('will-prevent-unload')).toBe(0)
    clock.advance(LEAVE_CLOSE_TIMEOUT_MS)
    expect(forceClose).not.toHaveBeenCalled()
    expect(guard.answer('lp', 'leave')).toBeNull()

    const other = setup()
    other.contents.destroyed = true
    other.guard.detach()
    expect(other.contents.listenerCount('will-prevent-unload')).toBe(1)
  })
})
