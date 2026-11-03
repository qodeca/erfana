// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The "Pop-up blocked" row (025-FR-011 rule 3, 025-FR-054): Allow once,
 * Always allow for this site, dismiss, the input guard, the latest open.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock } from '../../../../shared/clock'
import type { StripEvent } from '../../../../shared/ipc/browser-tab-schema'
import { POPUP_BLOCKED_TEXT, PopupBlockedRow, type BlockedOpen } from './popupBlockedRow'

const OPEN_A: BlockedOpen = { url: 'http://app.test/a', siteOrigin: 'http://app.test', requester: undefined }
const OPEN_B: BlockedOpen = { url: 'http://app.test/b', siteOrigin: 'http://app.test', requester: undefined }

function setup() {
  const clock = createManualClock(0)
  const events: StripEvent[] = []
  const openOnce = vi.fn()
  const alwaysAllow = vi.fn()
  const row = new PopupBlockedRow({ tabId: 'browser-tab-1', clock, emit: (e) => events.push(e), openOnce, alwaysAllow, newId: () => 'pb' })
  return { clock, events, openOnce, alwaysAllow, row }
}

describe('PopupBlockedRow', () => {
  it('025-AC-011 shows "Pop-up blocked" with Allow once, Always allow and dismiss, in the strip', () => {
    const { events, row } = setup()
    row.blocked(OPEN_A)
    expect(events).toEqual([
      {
        tabId: 'browser-tab-1',
        op: 'add',
        row: { requestId: 'pb', kind: 'popupBlocked', text: POPUP_BLOCKED_TEXT, answers: ['allowOnce', 'alwaysAllow', 'dismiss'], takesFocus: false, shownAt: 0 }
      }
    ])
    expect(row.isShown).toBe(true)
  })

  it('025-AC-011 Allow once inside the guard does nothing; after it, opens the most recent blocked address', () => {
    const { clock, events, openOnce, alwaysAllow, row } = setup()
    row.blocked(OPEN_A)
    row.blocked(OPEN_B)
    expect(events).toHaveLength(1)
    expect(row.answer('pb', 'allowOnce')).toBe('guarded')
    clock.advance(500)
    expect(row.answer('pb', 'allowOnce')).toBe('accepted')
    expect(openOnce).toHaveBeenCalledExactlyOnceWith(OPEN_B)
    expect(alwaysAllow).not.toHaveBeenCalled()
    expect(row.isShown).toBe(false)
  })

  it('025-AC-011 Always allow saves the site and opens the address', () => {
    const { clock, openOnce, alwaysAllow, row } = setup()
    row.blocked(OPEN_A)
    clock.advance(500)
    expect(row.answer('pb', 'alwaysAllow')).toBe('accepted')
    expect(alwaysAllow).toHaveBeenCalledWith('http://app.test')
    expect(openOnce).toHaveBeenCalledWith(OPEN_A)
  })

  it('dismiss hides the row and opens nothing; hide forgets the open; another row id is not this row', () => {
    const { clock, openOnce, row } = setup()
    row.blocked(OPEN_A)
    expect(row.answer('other', 'dismiss')).toBeNull()
    clock.advance(500)
    expect(row.answer('pb', 'dismiss')).toBe('accepted')
    expect(openOnce).not.toHaveBeenCalled()
    row.blocked(OPEN_A)
    row.hide()
    expect(row.isShown).toBe(false)
    expect(row.answer('pb', 'allowOnce')).toBeNull()
  })

  it('a blocked open from another site changes the row, which restarts the guard', () => {
    const { clock, events, row } = setup()
    const requester = { origin: { kind: 'file' as const }, inside: null }
    row.blocked(OPEN_A)
    clock.advance(400)
    row.blocked({ ...OPEN_B, siteOrigin: 'http://other.test', requester })
    expect(events[1]).toMatchObject({ op: 'change', row: { requester, shownAt: 400 } })
    clock.advance(400)
    expect(row.answer('pb', 'allowOnce')).toBe('guarded')
  })
})
