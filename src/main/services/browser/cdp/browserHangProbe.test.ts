// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { createManualClock, type TestClock } from '../../../../shared/clock'
import {
  BrowserHangProbe,
  HANG_PROBE_INTERVAL_HIDDEN_MS,
  HANG_PROBE_INTERVAL_VISIBLE_MS,
  HANG_THRESHOLD_MS,
  type HangProbeEvent
} from './browserHangProbe'
import { flush } from './__test-helpers__/fakeCdp'

interface Harness {
  probe: BrowserHangProbe
  clock: TestClock
  events: HangProbeEvent[]
  /** Probes sent so far; resolve or reject one to answer it. */
  pending: Array<{ resolve: () => void; reject: () => void }>
}

function harness(options: { visible?: boolean; answer?: 'never' | 'at-once' } = {}): Harness {
  const clock = createManualClock(0)
  const events: HangProbeEvent[] = []
  const pending: Harness['pending'] = []
  const probe = new BrowserHangProbe({
    clock,
    evaluate: () =>
      options.answer === 'at-once'
        ? Promise.resolve({})
        : new Promise<unknown>((resolve, reject) => pending.push({ resolve: () => resolve({}), reject: () => reject(new Error('x')) })),
    onEvent: e => events.push(e)
  })
  probe.setVisible(options.visible ?? true)
  probe.start()
  return { probe, clock, events, pending }
}

describe('BrowserHangProbe (025-FR-056)', () => {
  it('025-AC-072 probes the visible tab every second and stays quiet while the page answers', async () => {
    const h = harness({ answer: 'at-once' })
    for (let i = 0; i < 20; i++) {
      h.clock.advance(HANG_PROBE_INTERVAL_VISIBLE_MS)
      await flush()
    }
    expect(h.events).toEqual([])
    expect(h.probe.isHung).toBe(false)
  })

  it('025-AC-072 reports "not responding" at exactly 5 s without an answer, not at 4999 ms', () => {
    const h = harness()
    h.clock.advance(HANG_PROBE_INTERVAL_VISIBLE_MS)
    expect(h.pending).toHaveLength(1)
    h.clock.advance(HANG_THRESHOLD_MS - 1)
    expect(h.events).toEqual([])
    h.clock.advance(1)
    expect(h.events).toEqual(['hung'])
    expect(h.probe.isHung).toBe(true)
    // One probe in flight at a time: no pile-up while the page is stuck.
    h.clock.advance(10_000)
    expect(h.pending).toHaveLength(1)
    expect(h.events).toEqual(['hung'])
  })

  it('025-AC-072 Wait closes the notice and it returns after another 5 s if the page still hangs', () => {
    const h = harness()
    h.clock.advance(HANG_PROBE_INTERVAL_VISIBLE_MS + HANG_THRESHOLD_MS)
    expect(h.events).toEqual(['hung'])
    h.probe.wait()
    expect(h.probe.isHung).toBe(false)
    h.clock.advance(HANG_THRESHOLD_MS - 1)
    expect(h.events).toEqual(['hung'])
    h.clock.advance(1)
    expect(h.events).toEqual(['hung', 'hung'])
  })

  it('025-AC-072 reports the page responsive when the late answer arrives, then probes again', async () => {
    const h = harness()
    h.clock.advance(HANG_PROBE_INTERVAL_VISIBLE_MS + HANG_THRESHOLD_MS)
    h.pending[0].resolve()
    await flush()
    expect(h.events).toEqual(['hung', 'responsive'])
    h.clock.advance(HANG_PROBE_INTERVAL_VISIBLE_MS)
    expect(h.pending).toHaveLength(2)
  })

  it('counts a protocol error as an answer', async () => {
    const h = harness()
    h.clock.advance(HANG_PROBE_INTERVAL_VISIBLE_MS)
    h.pending[0].reject()
    await flush()
    h.clock.advance(HANG_THRESHOLD_MS)
    expect(h.events).toEqual([])
  })

  it('counts a synchronous throw from evaluate as an answer', async () => {
    const clock = createManualClock(0)
    const events: HangProbeEvent[] = []
    const probe = new BrowserHangProbe({
      clock,
      evaluate: () => {
        throw new Error('refused')
      },
      onEvent: e => events.push(e)
    })
    probe.setVisible(true)
    probe.start()
    clock.advance(HANG_PROBE_INTERVAL_VISIBLE_MS)
    await flush()
    clock.advance(HANG_THRESHOLD_MS)
    expect(events).toEqual([])
  })

  it('a Wait with no hang does nothing', () => {
    const h = harness()
    h.probe.wait()
    h.clock.advance(HANG_PROBE_INTERVAL_VISIBLE_MS + HANG_THRESHOLD_MS - 1)
    expect(h.events).toEqual([])
  })

  it.each(['frozen', 'dialog', 'beforeunload', 'offScreen', 'detached'] as const)(
    'skips probing while %s and forgets a probe in flight (A8, X16)',
    async reason => {
      const h = harness()
      h.clock.advance(HANG_PROBE_INTERVAL_VISIBLE_MS)
      h.probe.suspend(reason)
      h.probe.suspend(reason)
      h.clock.advance(60_000)
      expect(h.pending).toHaveLength(1)
      expect(h.events).toEqual([])
      // The stale answer of the forgotten probe changes nothing.
      h.pending[0].resolve()
      await flush()
      h.probe.resume(reason)
      h.clock.advance(HANG_PROBE_INTERVAL_VISIBLE_MS - 1)
      expect(h.pending).toHaveLength(1)
      h.clock.advance(1)
      expect(h.pending).toHaveLength(2)
      h.clock.advance(HANG_THRESHOLD_MS)
      expect(h.events).toEqual(['hung'])
    }
  )

  it('needs every suspension lifted before probing again', () => {
    const h = harness()
    h.probe.suspend('frozen')
    h.probe.suspend('dialog')
    h.probe.resume('frozen')
    h.probe.resume('beforeunload')
    h.clock.advance(10_000)
    expect(h.pending).toHaveLength(0)
    expect(h.probe.isRunning).toBe(false)
    h.probe.resume('dialog')
    h.clock.advance(HANG_PROBE_INTERVAL_VISIBLE_MS)
    expect(h.pending).toHaveLength(1)
  })

  it('withdraws a reported hang when suspended, as "cleared"', () => {
    const h = harness()
    h.clock.advance(HANG_PROBE_INTERVAL_VISIBLE_MS + HANG_THRESHOLD_MS)
    h.probe.suspend('frozen')
    expect(h.events).toEqual(['hung', 'cleared'])
    expect(h.probe.isHung).toBe(false)
  })

  it('probes a hidden tab every 5 s and reports its hang only when shown (P10)', () => {
    const h = harness({ visible: false })
    h.clock.advance(HANG_PROBE_INTERVAL_HIDDEN_MS - 1)
    expect(h.pending).toHaveLength(0)
    h.clock.advance(1)
    expect(h.pending).toHaveLength(1)
    h.clock.advance(HANG_THRESHOLD_MS)
    expect(h.probe.isHung).toBe(true)
    expect(h.events).toEqual([])
    h.probe.setVisible(true)
    expect(h.events).toEqual(['hung'])
    h.probe.setVisible(true)
    expect(h.events).toEqual(['hung'])
  })

  it('switches back to the 1 s interval when shown', () => {
    const h = harness({ visible: false })
    h.probe.setVisible(true)
    h.clock.advance(HANG_PROBE_INTERVAL_VISIBLE_MS)
    expect(h.pending).toHaveLength(1)
  })

  it('stops and starts idempotently', () => {
    const h = harness()
    h.probe.start()
    h.probe.stop()
    h.probe.stop()
    h.clock.advance(10_000)
    expect(h.pending).toHaveLength(0)
    h.probe.start()
    h.clock.advance(HANG_PROBE_INTERVAL_VISIBLE_MS)
    expect(h.pending).toHaveLength(1)
  })
})
