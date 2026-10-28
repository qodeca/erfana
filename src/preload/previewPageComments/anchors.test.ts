// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The visible / hidden pin report (docs/designs/comments/html-preview-comments.md §6
 * status, §8 `commentAnchors`, §9.1 S25).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { AnchorReporter } from './anchors'
import { ANCHOR_CHECK_MIN_MS, ANCHOR_KEYS_MAX, COMMENT_ANCHORS_CHANNEL } from './constants'

let clock: { now: number }
let send: Mock<(channel: string, payload: unknown) => void>
let reporter: AnchorReporter

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  clock = { now: 10_000 }
  send = vi.fn<(channel: string, payload: unknown) => void>()
  reporter = new AnchorReporter({ send, now: () => clock.now })
})

afterEach(() => {
  reporter.dispose()
  vi.useRealTimers()
})

/** Advance the clock and the fake timers together. */
function wait(ms: number): void {
  clock.now += ms
  vi.advanceTimersByTime(ms)
}

const reports = (): unknown[] => send.mock.calls.map(([channel, payload]) => {
  expect(channel).toBe(COMMENT_ANCHORS_CHANNEL)
  return payload
})

describe('AnchorReporter', () => {
  it('sends a change at once, and nothing when the split is the same', () => {
    reporter.update([])
    expect(reports()).toEqual([])
    reporter.update([{ key: 'a', visible: true }, { key: 'b', visible: false }])
    reporter.update([{ key: 'a', visible: true }, { key: 'b', visible: false }])
    expect(reports()).toEqual([{ visible: ['a'], hidden: ['b'] }])
  })

  it(`sends at most one report per ${ANCHOR_CHECK_MIN_MS} ms, the latest split`, () => {
    reporter.update([{ key: 'a', visible: true }])
    wait(10)
    reporter.update([{ key: 'a', visible: false }])
    reporter.update([{ key: 'a', visible: false }, { key: 'b', visible: true }])
    expect(reports()).toHaveLength(1)
    wait(ANCHOR_CHECK_MIN_MS)
    expect(reports()).toEqual([
      { visible: ['a'], hidden: [] },
      { visible: ['b'], hidden: ['a'] }
    ])
  })

  it('drops a queued report when the split goes back to the last one sent', () => {
    reporter.update([{ key: 'a', visible: true }])
    wait(10)
    reporter.update([{ key: 'a', visible: false }])
    reporter.update([{ key: 'a', visible: true }])
    wait(ANCHOR_CHECK_MIN_MS)
    expect(reports()).toHaveLength(1)
  })

  it(`caps each list at ${ANCHOR_KEYS_MAX} keys`, () => {
    const entries = Array.from({ length: ANCHOR_KEYS_MAX + 5 }, (_, i) => ({ key: `k${i}`, visible: i % 2 === 0 }))
    entries.push(...Array.from({ length: ANCHOR_KEYS_MAX }, (_, i) => ({ key: `v${i}`, visible: true })))
    reporter.update(entries)
    const [report] = reports() as Array<{ visible: string[]; hidden: string[] }>
    expect(report.visible).toHaveLength(ANCHOR_KEYS_MAX)
    expect(report.hidden).toHaveLength(Math.floor((ANCHOR_KEYS_MAX + 5) / 2))
  })

  it('says the overlay is unavailable once, at once, with the last split and the first reason', () => {
    reporter.update([{ key: 'a', visible: true }])
    wait(10)
    reporter.markUnavailable('document-replaced')
    reporter.markUnavailable('overlay-removed')
    expect(reports()).toEqual([
      { visible: ['a'], hidden: [] },
      { visible: ['a'], hidden: [], overlay: 'unavailable', reason: 'document-replaced' }
    ])
  })

  it('sends nothing after dispose', () => {
    reporter.update([{ key: 'a', visible: true }])
    wait(10)
    reporter.update([{ key: 'b', visible: true }])
    reporter.dispose()
    wait(ANCHOR_CHECK_MIN_MS)
    expect(reports()).toHaveLength(1)
  })
})
