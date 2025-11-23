import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ThrottledWorker, createThrottledWorker } from './ThrottledWorker'

describe('ThrottledWorker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
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
})
