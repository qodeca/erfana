// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ThrottledWorker, createThrottledWorker } from './ThrottledWorker'
import { logger } from '../LoggingService'

vi.mock('../LoggingService', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

describe('ThrottledWorker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(logger.warn).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic functionality', () => {
    it('should process work after collection delay', () => {
      const onWork = vi.fn()
      const worker = createThrottledWorker<string>(onWork)

      worker.work('item1')

      expect(onWork).not.toHaveBeenCalled()

      // Advance past collection delay (75ms default)
      vi.advanceTimersByTime(80)

      expect(onWork).toHaveBeenCalledWith(['item1'])
    })

    it('should batch work items during collection window', () => {
      const onWork = vi.fn()
      const worker = createThrottledWorker<string>(onWork)

      worker.work('item1')
      worker.work('item2')
      worker.work('item3')

      vi.advanceTimersByTime(80)

      expect(onWork).toHaveBeenCalledTimes(1)
      expect(onWork).toHaveBeenCalledWith(['item1', 'item2', 'item3'])
    })

    it('should process workMany correctly', () => {
      const onWork = vi.fn()
      const worker = createThrottledWorker<string>(onWork)

      worker.workMany(['item1', 'item2', 'item3'])

      vi.advanceTimersByTime(80)

      expect(onWork).toHaveBeenCalledWith(['item1', 'item2', 'item3'])
    })
  })

  describe('chunk processing', () => {
    it('should process work in chunks', () => {
      const onWork = vi.fn()
      const worker = new ThrottledWorker<number>(
        { maxWorkChunkSize: 3, collectionDelay: 10, throttleDelay: 50, maxBufferedWork: 100 },
        { onWork }
      )

      // Add 7 items
      for (let i = 0; i < 7; i++) {
        worker.work(i)
      }

      // Process first chunk after collection delay
      vi.advanceTimersByTime(15)
      expect(onWork).toHaveBeenCalledTimes(1)
      expect(onWork).toHaveBeenCalledWith([0, 1, 2])

      // Process second chunk after throttle delay
      vi.advanceTimersByTime(55)
      expect(onWork).toHaveBeenCalledTimes(2)
      expect(onWork).toHaveBeenCalledWith([3, 4, 5])

      // Process third chunk
      vi.advanceTimersByTime(55)
      expect(onWork).toHaveBeenCalledTimes(3)
      expect(onWork).toHaveBeenCalledWith([6])
    })
  })

  describe('buffer limit', () => {
    it('should drop oldest items when buffer exceeds limit', () => {
      const onWork = vi.fn()
      const onOverflow = vi.fn()
      const worker = new ThrottledWorker<number>(
        { maxWorkChunkSize: 100, collectionDelay: 10, throttleDelay: 50, maxBufferedWork: 5 },
        { onWork, onOverflow }
      )

      // Add 8 items (3 over limit)
      for (let i = 0; i < 8; i++) {
        worker.work(i)
      }

      // Each time buffer exceeds 5, oldest item is dropped
      // Items 6, 7, 8 each cause an overflow (dropping 1 item each time)
      expect(onOverflow).toHaveBeenCalledTimes(3)
      expect(worker.getBufferSize()).toBe(5)

      vi.advanceTimersByTime(15)
      // Should have items 3-7 (oldest dropped)
      expect(onWork).toHaveBeenCalledWith([3, 4, 5, 6, 7])
    })
  })

  describe('cancel and flush', () => {
    it('should cancel pending processing', () => {
      const onWork = vi.fn()
      const worker = createThrottledWorker<string>(onWork)

      worker.work('item1')
      worker.cancel()

      vi.advanceTimersByTime(200)

      // Work should not be called since we cancelled
      expect(onWork).not.toHaveBeenCalled()
      // But buffer should still have items
      expect(worker.getBufferSize()).toBe(1)
    })

    it('should flush buffer and cancel', () => {
      const onWork = vi.fn()
      const worker = createThrottledWorker<string>(onWork)

      worker.work('item1')
      worker.work('item2')
      worker.flush()

      expect(worker.getBufferSize()).toBe(0)

      vi.advanceTimersByTime(200)
      expect(onWork).not.toHaveBeenCalled()
    })
  })

  describe('dispose', () => {
    it('should not accept work after dispose', () => {
      const onWork = vi.fn()
      const worker = createThrottledWorker<string>(onWork)

      worker.dispose()
      worker.work('item1')

      vi.advanceTimersByTime(200)

      expect(onWork).not.toHaveBeenCalled()
      expect(worker.getBufferSize()).toBe(0)
    })
  })

  describe('isBusy', () => {
    it('should return true when collecting', () => {
      const onWork = vi.fn()
      const worker = createThrottledWorker<string>(onWork)

      expect(worker.isBusy()).toBe(false)

      worker.work('item1')
      expect(worker.isBusy()).toBe(true)

      vi.advanceTimersByTime(200)
      expect(worker.isBusy()).toBe(false)
    })

    it('should return true during throttle delay', () => {
      const onWork = vi.fn()
      const worker = new ThrottledWorker<number>(
        { maxWorkChunkSize: 2, collectionDelay: 10, throttleDelay: 100, maxBufferedWork: 100 },
        { onWork }
      )

      // Add 4 items (2 chunks)
      for (let i = 0; i < 4; i++) {
        worker.work(i)
      }

      // Process first chunk
      vi.advanceTimersByTime(15)
      expect(onWork).toHaveBeenCalledTimes(1)

      // Should be busy waiting for throttle
      expect(worker.isBusy()).toBe(true)

      // Complete throttle
      vi.advanceTimersByTime(105)
      expect(onWork).toHaveBeenCalledTimes(2)
      expect(worker.isBusy()).toBe(false)
    })
  })

  describe('VS Code default values', () => {
    it('should use VS Code defaults when created with factory', () => {
      const onWork = vi.fn()
      const worker = createThrottledWorker<string>(onWork)

      // Add 600 items (more than 500 chunk size)
      for (let i = 0; i < 600; i++) {
        worker.work(`item${i}`)
      }

      // After collection delay (75ms)
      vi.advanceTimersByTime(80)
      expect(onWork).toHaveBeenCalledTimes(1)
      expect(onWork.mock.calls[0][0]).toHaveLength(500) // First chunk

      // After throttle delay (200ms)
      vi.advanceTimersByTime(205)
      expect(onWork).toHaveBeenCalledTimes(2)
      expect(onWork.mock.calls[1][0]).toHaveLength(100) // Remaining items
    })
  })

  describe('error handling', () => {
    it('should continue processing after onWork throws', () => {
      const onWork = vi.fn().mockImplementationOnce(() => {
        throw new Error('Test error')
      })
      const worker = new ThrottledWorker<number>(
        { maxWorkChunkSize: 2, collectionDelay: 10, throttleDelay: 50, maxBufferedWork: 100 },
        { onWork }
      )

      // Add 4 items
      for (let i = 0; i < 4; i++) {
        worker.work(i)
      }

      // First chunk throws
      vi.advanceTimersByTime(15)
      expect(onWork).toHaveBeenCalledTimes(1)

      // Should continue to second chunk
      vi.advanceTimersByTime(55)
      expect(onWork).toHaveBeenCalledTimes(2)
    })
  })

  describe('event buffer overflow at production scale (016-AC-017)', () => {
    it('should not trigger overflow with exactly 30,000 events', () => {
      const onWork = vi.fn()
      const onOverflow = vi.fn()
      const worker = new ThrottledWorker<string>(
        { maxWorkChunkSize: 500, collectionDelay: 75, throttleDelay: 200, maxBufferedWork: 30000 },
        { onWork, onOverflow }
      )

      // Add exactly 30,000 events
      for (let i = 0; i < 30000; i++) {
        worker.work(`event-${i}`)
      }

      // onOverflow should NOT be called
      expect(onOverflow).not.toHaveBeenCalled()
      // Buffer should retain all 30,000 events
      expect(worker.getBufferSize()).toBe(30000)
    })

    it('should trigger FIFO eviction when 30,001 events are added', () => {
      const onWork = vi.fn()
      const onOverflow = vi.fn()
      const worker = new ThrottledWorker<string>(
        { maxWorkChunkSize: 500, collectionDelay: 75, throttleDelay: 200, maxBufferedWork: 30000 },
        { onWork, onOverflow }
      )

      // Add 30,001 events
      for (let i = 0; i < 30001; i++) {
        worker.work(`event-${i}`)
      }

      // onOverflow should be called with droppedCount=1
      expect(onOverflow).toHaveBeenCalledTimes(1)
      expect(onOverflow).toHaveBeenCalledWith(1)

      // Buffer should contain exactly 30,000 events
      expect(worker.getBufferSize()).toBe(30000)

      // Process and verify oldest event was dropped (event-0 should be gone)
      vi.advanceTimersByTime(80)

      // First chunk should contain events starting from event-1 (event-0 dropped)
      expect(onWork).toHaveBeenCalledTimes(1)
      const firstChunk = onWork.mock.calls[0][0] as string[]
      expect(firstChunk[0]).toBe('event-1') // Oldest event dropped was event-0
      expect(firstChunk.length).toBe(500)
    })

    // Pushes 60,000 events into the buffer. Historically this was O(n^2)
    // because every front-drop re-allocated the array; now runs in <1s on
    // Windows thanks to the offset-based deque (see #173 / ThrottledWorker.ts).
    // The default 5s vitest timeout is sufficient cross-platform.
    it('should drop 30,000 oldest events when 60,000 events are added', () => {
      const onWork = vi.fn()
      const onOverflow = vi.fn()
      const worker = new ThrottledWorker<string>(
        { maxWorkChunkSize: 500, collectionDelay: 75, throttleDelay: 200, maxBufferedWork: 30000 },
        { onWork, onOverflow }
      )

      // Add 60,000 events
      for (let i = 0; i < 60000; i++) {
        worker.work(`event-${i}`)
      }

      // onOverflow should be called 30,000 times (once per dropped event)
      expect(onOverflow).toHaveBeenCalledTimes(30000)

      // Buffer should contain exactly 30,000 events (latest ones)
      expect(worker.getBufferSize()).toBe(30000)

      // Process and verify we have the latest 30,000 events (30000-59999)
      vi.advanceTimersByTime(80)

      expect(onWork).toHaveBeenCalledTimes(1)
      const firstChunk = onWork.mock.calls[0][0] as string[]
      expect(firstChunk[0]).toBe('event-30000') // First event in buffer should be 30000
      expect(firstChunk.length).toBe(500)
    })

    it('should report correct dropped count in each onOverflow call', () => {
      const onWork = vi.fn()
      const onOverflow = vi.fn()
      const worker = new ThrottledWorker<string>(
        { maxWorkChunkSize: 500, collectionDelay: 75, throttleDelay: 200, maxBufferedWork: 30000 },
        { onWork, onOverflow }
      )

      // Add 30,000 events (no overflow)
      for (let i = 0; i < 30000; i++) {
        worker.work(`event-${i}`)
      }
      expect(onOverflow).not.toHaveBeenCalled()

      // Add 5 more events (each triggers overflow with droppedCount=1)
      for (let i = 30000; i < 30005; i++) {
        worker.work(`event-${i}`)
      }

      // Should have 5 overflow calls, each with droppedCount=1
      expect(onOverflow).toHaveBeenCalledTimes(5)
      for (let i = 0; i < 5; i++) {
        expect(onOverflow.mock.calls[i][0]).toBe(1)
      }
    })

    it('should not crash or hang during overflow and processing', () => {
      const onWork = vi.fn()
      const onOverflow = vi.fn()
      const worker = new ThrottledWorker<string>(
        { maxWorkChunkSize: 500, collectionDelay: 75, throttleDelay: 200, maxBufferedWork: 30000 },
        { onWork, onOverflow }
      )

      // Add 35,000 events (5,000 over limit)
      for (let i = 0; i < 35000; i++) {
        worker.work(`event-${i}`)
      }

      expect(onOverflow).toHaveBeenCalledTimes(5000)
      expect(worker.getBufferSize()).toBe(30000)

      // Advance timers to process all events
      // Collection delay: 75ms
      vi.advanceTimersByTime(80)
      expect(onWork).toHaveBeenCalled()

      // Process all chunks (30000 events / 500 per chunk = 60 chunks)
      // Each chunk needs throttle delay (200ms) after the first
      for (let chunk = 0; chunk < 59; chunk++) {
        vi.advanceTimersByTime(205)
      }

      // All events should be processed
      expect(onWork).toHaveBeenCalledTimes(60)

      // Worker should return to idle state
      expect(worker.isBusy()).toBe(false)
      expect(worker.getBufferSize()).toBe(0)
    })

    it('should process post-burst events normally after overflow', () => {
      const onWork = vi.fn()
      const onOverflow = vi.fn()
      const worker = new ThrottledWorker<string>(
        { maxWorkChunkSize: 500, collectionDelay: 75, throttleDelay: 200, maxBufferedWork: 30000 },
        { onWork, onOverflow }
      )

      // Add 35,000 events causing overflow
      for (let i = 0; i < 35000; i++) {
        worker.work(`burst-${i}`)
      }

      expect(onOverflow).toHaveBeenCalledTimes(5000)

      // Process all events
      vi.advanceTimersByTime(80)
      for (let chunk = 0; chunk < 59; chunk++) {
        vi.advanceTimersByTime(205)
      }

      // Worker should be idle
      expect(worker.isBusy()).toBe(false)
      expect(worker.getBufferSize()).toBe(0)

      // Reset mocks
      onWork.mockClear()
      onOverflow.mockClear()

      // Add new events after burst
      worker.work('post-burst-1')
      worker.work('post-burst-2')
      worker.work('post-burst-3')

      // No overflow should occur
      expect(onOverflow).not.toHaveBeenCalled()

      // Events should be processed normally
      vi.advanceTimersByTime(80)
      expect(onWork).toHaveBeenCalledTimes(1)
      expect(onWork).toHaveBeenCalledWith(['post-burst-1', 'post-burst-2', 'post-burst-3'])
    })
  })

  describe('buffer pressure hysteresis', () => {
    it('emits warn when buffer reaches 80% via work()', () => {
      const worker = new ThrottledWorker<number>(
        { maxWorkChunkSize: 100, collectionDelay: 10, throttleDelay: 50, maxBufferedWork: 100 },
        { onWork: vi.fn() }
      )

      for (let i = 0; i < 80; i++) {
        worker.work(i)
      }

      expect(logger.warn).toHaveBeenCalledWith(
        'ThrottledWorker buffer pressure',
        expect.objectContaining({ current: 80, max: 100, pct: 80 })
      )
    })

    it('emits warn when buffer reaches 80% via workMany()', () => {
      const worker = new ThrottledWorker<number>(
        { maxWorkChunkSize: 100, collectionDelay: 10, throttleDelay: 50, maxBufferedWork: 100 },
        { onWork: vi.fn() }
      )

      worker.workMany(Array.from({ length: 80 }, (_, i) => i))

      expect(logger.warn).toHaveBeenCalledWith(
        'ThrottledWorker buffer pressure',
        expect.objectContaining({ current: 80, max: 100, pct: 80 })
      )
    })

    it('does not emit warn at 79% fill', () => {
      const worker = new ThrottledWorker<number>(
        { maxWorkChunkSize: 100, collectionDelay: 10, throttleDelay: 50, maxBufferedWork: 100 },
        { onWork: vi.fn() }
      )

      for (let i = 0; i < 79; i++) {
        worker.work(i)
      }

      const pressureCalls = vi.mocked(logger.warn).mock.calls.filter(
        (args) => args[0] === 'ThrottledWorker buffer pressure'
      )
      expect(pressureCalls).toHaveLength(0)
    })

    it('does not re-emit warn while still above 80%', () => {
      const worker = new ThrottledWorker<number>(
        { maxWorkChunkSize: 100, collectionDelay: 10, throttleDelay: 50, maxBufferedWork: 100 },
        { onWork: vi.fn() }
      )

      // Fill to 80% (warn fires once)
      for (let i = 0; i < 80; i++) {
        worker.work(i)
      }

      // Add 5 more items while still above 80%
      for (let i = 80; i < 85; i++) {
        worker.work(i)
      }

      const pressureCalls = vi.mocked(logger.warn).mock.calls.filter(
        (args) => args[0] === 'ThrottledWorker buffer pressure'
      )
      expect(pressureCalls).toHaveLength(1)
    })

    it('re-enables warning after buffer drains below 50%', () => {
      const onWork = vi.fn()
      const worker = new ThrottledWorker<number>(
        // maxWorkChunkSize: 60 so one chunk leaves 20 items in buffer (below 50%)
        { maxWorkChunkSize: 60, collectionDelay: 10, throttleDelay: 50, maxBufferedWork: 100 },
        { onWork }
      )

      // First wave: fill to 80% – warn fires (call #1)
      for (let i = 0; i < 80; i++) {
        worker.work(i)
      }

      // Advance past collectionDelay only, so the first 60-item chunk is processed.
      // Buffer drops from 80 → 20 items (20% fill). The throttle timer is now pending
      // but the second chunk has not run yet.
      vi.advanceTimersByTime(15)

      // Buffer should have 20 items remaining (80 - 60)
      expect(worker.getBufferSize()).toBe(20)

      // Second wave: adding one item at 20-item buffer (21/100 = 21% fill < 50%).
      // checkBufferPressure sees fillRatio < 0.5 → resets pressureWarningEmitted.
      // Then we keep adding until 80% is reached – warn fires again (call #2).
      for (let i = 100; i < 180; i++) {
        worker.work(i)
      }

      // Buffer is now 20 + 80 = 100 items but enforceBufferLimit caps at 100, so 100.
      // The first work(100) call resets the flag (21/100 < 0.5), subsequent calls
      // reach 80% and emit the second warning.
      const pressureCalls = vi.mocked(logger.warn).mock.calls.filter(
        (args) => args[0] === 'ThrottledWorker buffer pressure'
      )
      expect(pressureCalls).toHaveLength(2)
    })

    it('flush() resets the pressure flag so warn fires again after refill', () => {
      const worker = new ThrottledWorker<number>(
        { maxWorkChunkSize: 100, collectionDelay: 10, throttleDelay: 50, maxBufferedWork: 100 },
        { onWork: vi.fn() }
      )

      // First wave: fill to 80% – warn fires (call #1)
      for (let i = 0; i < 80; i++) {
        worker.work(i)
      }

      // flush() clears buffer and resets pressureWarningEmitted
      worker.flush()
      expect(worker.getBufferSize()).toBe(0)

      // Second wave: fill to 80% again – warn should fire again (call #2)
      for (let i = 0; i < 80; i++) {
        worker.work(i)
      }

      const pressureCalls = vi.mocked(logger.warn).mock.calls.filter(
        (args) => args[0] === 'ThrottledWorker buffer pressure'
      )
      expect(pressureCalls).toHaveLength(2)
    })
  })
})
