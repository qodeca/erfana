// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The hung-page notice (025-FR-056): one strip row with Wait and Reload, the
 * 500 ms input guard on main's clock, and answers to other rows left alone.
 */
import { describe, expect, it, vi } from 'vitest'
import { createManualClock } from '../../../../shared/clock'
import type { StripEvent } from '../../../../shared/ipc/browser-tab-schema'
import { StripEventSchema } from '../../../../shared/ipc/browser-tab-schema'
import { HUNG_NOTICE_TEXT, HungNotice } from './hungNotice'

function setup() {
  const clock = createManualClock(1000)
  const events: StripEvent[] = []
  const onWait = vi.fn()
  const onReload = vi.fn()
  let n = 0
  const notice = new HungNotice({
    tabId: 'browser-tab-1',
    clock,
    emit: (e) => events.push(e),
    onWait,
    onReload,
    newId: () => `row${++n}`
  })
  return { clock, events, onWait, onReload, notice }
}

describe('HungNotice', () => {
  it('025-AC-072 shows "This page is not responding" with Wait and Reload, once', () => {
    const { events, notice } = setup()
    notice.show()
    notice.show()
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      tabId: 'browser-tab-1',
      op: 'add',
      row: { requestId: 'row1', kind: 'hung', text: HUNG_NOTICE_TEXT, answers: ['wait', 'reload'], takesFocus: false, shownAt: 1000 }
    })
    expect(HUNG_NOTICE_TEXT.replace(/\.$/, '')).toBe('This page is not responding')
    expect(StripEventSchema.safeParse(events[0]).success).toBe(true)
    expect(notice.isShown).toBe(true)
  })

  it('ignores an answer within 500 ms of the row appearing, and keeps the row', () => {
    const { clock, notice, onWait } = setup()
    notice.show()
    clock.advance(499)
    expect(notice.answer('row1', 'wait')).toBe('guarded')
    expect(onWait).not.toHaveBeenCalled()
    expect(notice.isShown).toBe(true)
  })

  it('025-AC-072 Wait closes the row; Reload closes it and reloads', () => {
    const { clock, events, notice, onWait, onReload } = setup()
    notice.show()
    clock.advance(500)
    expect(notice.answer('row1', 'wait')).toBe('accepted')
    expect(onWait).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toEqual({ tabId: 'browser-tab-1', op: 'withdraw', requestId: 'row1' })
    notice.show()
    clock.advance(500)
    expect(notice.answer('row2', 'reload')).toBe('accepted')
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('is not the owner of another row, refuses an answer it does not offer, and hides only what shows', () => {
    const { clock, events, notice } = setup()
    expect(notice.answer('row1', 'wait')).toBeNull()
    notice.hide()
    expect(events).toHaveLength(0)
    notice.show()
    clock.advance(600)
    expect(notice.answer('other', 'wait')).toBeNull()
    expect(notice.answer('row1', 'allow')).toBe('invalid')
  })
})
