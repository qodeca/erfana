// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The popup blocker's counters (025-FR-011 rule 3, ADR 0011 decision 16):
 * a press the page received activates one open within 5 s; at most 5 opens
 * per tab per minute.
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createManualClock } from '../../../../shared/clock'
import { ACTIVATION_WINDOW_MS, ActivationTracker, MAX_OPENS_PER_MINUTE, OpenRateLimit, RATE_WINDOW_MS } from './popupActivation'

class FakeContents extends EventEmitter {
  destroyed = false
  isDestroyed(): boolean {
    return this.destroyed
  }
}

describe('ActivationTracker', () => {
  it('a press the page received activates one open for 5 s', () => {
    const clock = createManualClock(1000)
    const tracker = new ActivationTracker(clock)
    expect(tracker.isActive()).toBe(false)
    tracker.recordPress()
    clock.advance(ACTIVATION_WINDOW_MS)
    expect(tracker.isActive()).toBe(true)
    clock.advance(1)
    expect(tracker.isActive()).toBe(false)
  })

  it('one open per press: consuming the press ends the activation', () => {
    const tracker = new ActivationTracker(createManualClock(0))
    tracker.recordPress()
    tracker.consume()
    expect(tracker.isActive()).toBe(false)
  })

  it('counts mouse presses and key presses the routers let through, never dropped ones', () => {
    const contents = new FakeContents()
    const tracker = new ActivationTracker(createManualClock(0))
    tracker.listen(contents)
    contents.emit('before-mouse-event', { defaultPrevented: true }, { type: 'mouseDown' })
    contents.emit('before-mouse-event', {}, { type: 'mouseMove' })
    contents.emit('before-mouse-event', {}, { type: 'mouseUp' })
    expect(tracker.isActive()).toBe(false)
    contents.emit('before-mouse-event', { defaultPrevented: false }, { type: 'mouseDown' })
    expect(tracker.isActive()).toBe(true)

    tracker.consume()
    contents.emit('before-input-event', { defaultPrevented: true }, { type: 'keyDown', key: 'a' })
    contents.emit('before-input-event', {}, { type: 'keyUp', key: 'a' })
    contents.emit('before-input-event', {}, { type: 'keyDown', key: 'a', isAutoRepeat: true })
    expect(tracker.isActive()).toBe(false)
    contents.emit('before-input-event', {}, { type: 'rawKeyDown', key: 'Enter' })
    expect(tracker.isActive()).toBe(true)
  })

  it('never counts a modifier, a lock key or Esc (Chromium rule)', () => {
    const tracker = new ActivationTracker(createManualClock(0))
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape']) tracker.onKey({}, { type: 'keyDown', key })
    expect(tracker.isActive()).toBe(false)
  })

  it('stops listening on unlisten, and twice is harmless; a destroyed page is left alone', () => {
    const contents = new FakeContents()
    const tracker = new ActivationTracker(createManualClock(0))
    tracker.listen(contents)
    tracker.unlisten()
    tracker.unlisten()
    contents.emit('before-mouse-event', {}, { type: 'mouseDown' })
    expect(tracker.isActive()).toBe(false)
    expect(contents.listenerCount('before-mouse-event')).toBe(0)

    const gone = new FakeContents()
    tracker.listen(gone)
    gone.destroyed = true
    tracker.unlisten()
    expect(gone.listenerCount('before-input-event')).toBe(1)
  })
})

describe('OpenRateLimit', () => {
  it('025-AC-011 lets 5 opens through in a minute and refuses the sixth until the minute passed', () => {
    const clock = createManualClock(0)
    const rate = new OpenRateLimit(clock)
    for (let i = 0; i < MAX_OPENS_PER_MINUTE; i += 1) {
      expect(rate.hasRoom()).toBe(true)
      rate.record()
      clock.advance(1000)
    }
    expect(rate.hasRoom()).toBe(false)
    clock.advance(RATE_WINDOW_MS - 5000)
    expect(rate.hasRoom()).toBe(true)
  })
})
