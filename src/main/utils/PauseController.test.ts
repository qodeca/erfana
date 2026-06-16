// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PauseController } from './PauseController'

describe('PauseController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic ref counting (backward compatibility)', () => {
    it('pause() increments count', () => {
      const controller = new PauseController()

      expect(controller.getCount()).toBe(0)
      expect(controller.isPaused()).toBe(false)

      controller.pause()

      expect(controller.getCount()).toBe(1)
      expect(controller.isPaused()).toBe(true)
    })

    it('resume() decrements count', () => {
      const controller = new PauseController()

      controller.pause()
      expect(controller.getCount()).toBe(1)

      const fullyResumed = controller.resume()

      expect(controller.getCount()).toBe(0)
      expect(controller.isPaused()).toBe(false)
      expect(fullyResumed).toBe(true)
    })

    it('resume() does not go below 0', () => {
      const controller = new PauseController()

      expect(controller.getCount()).toBe(0)

      // Resume without any pause calls
      const fullyResumed = controller.resume()

      expect(controller.getCount()).toBe(0)
      expect(controller.isPaused()).toBe(false)
      expect(fullyResumed).toBe(true)

      // Multiple resumes
      controller.resume()
      controller.resume()

      expect(controller.getCount()).toBe(0)
    })

    it('isPaused() reflects state', () => {
      const controller = new PauseController()

      // Initially not paused
      expect(controller.isPaused()).toBe(false)

      // After pause
      controller.pause()
      expect(controller.isPaused()).toBe(true)

      // After resume
      controller.resume()
      expect(controller.isPaused()).toBe(false)
    })

    it('nested pause/resume', () => {
      const controller = new PauseController()

      // Pause 3 times
      controller.pause()
      expect(controller.getCount()).toBe(1)
      expect(controller.isPaused()).toBe(true)

      controller.pause()
      expect(controller.getCount()).toBe(2)
      expect(controller.isPaused()).toBe(true)

      controller.pause()
      expect(controller.getCount()).toBe(3)
      expect(controller.isPaused()).toBe(true)

      // Resume 3 times
      let fullyResumed = controller.resume()
      expect(controller.getCount()).toBe(2)
      expect(controller.isPaused()).toBe(true)
      expect(fullyResumed).toBe(false)

      fullyResumed = controller.resume()
      expect(controller.getCount()).toBe(1)
      expect(controller.isPaused()).toBe(true)
      expect(fullyResumed).toBe(false)

      fullyResumed = controller.resume()
      expect(controller.getCount()).toBe(0)
      expect(controller.isPaused()).toBe(false)
      expect(fullyResumed).toBe(true)
    })

    it('reset() clears count', () => {
      const controller = new PauseController()

      // Pause 3 times
      controller.pause()
      controller.pause()
      controller.pause()

      expect(controller.getCount()).toBe(3)
      expect(controller.isPaused()).toBe(true)

      // Reset
      controller.reset()

      expect(controller.getCount()).toBe(0)
      expect(controller.isPaused()).toBe(false)
    })
  })

  describe('safety timeout', () => {
    it('fires after configured timeout', () => {
      const onTimeout = vi.fn()
      const controller = new PauseController({ timeoutMs: 5000, onTimeout })

      controller.pause()
      expect(controller.getCount()).toBe(1)
      expect(controller.isPaused()).toBe(true)

      // Advance just before timeout
      vi.advanceTimersByTime(4999)
      expect(controller.isPaused()).toBe(true)
      expect(controller.getCount()).toBe(1)
      expect(onTimeout).not.toHaveBeenCalled()

      // Advance to timeout
      vi.advanceTimersByTime(1)
      expect(controller.isPaused()).toBe(false)
      expect(controller.getCount()).toBe(0)
      expect(onTimeout).toHaveBeenCalledTimes(1)
    })

    it('calls onTimeout callback when timeout fires', () => {
      const onTimeout = vi.fn()
      const controller = new PauseController({ timeoutMs: 5000, onTimeout })

      controller.pause()

      // Advance to timeout
      vi.advanceTimersByTime(5000)

      expect(onTimeout).toHaveBeenCalledTimes(1)
      expect(controller.isPaused()).toBe(false)
      expect(controller.getCount()).toBe(0)
    })

    it('does not fire before timeout', () => {
      const onTimeout = vi.fn()
      const controller = new PauseController({ timeoutMs: 5000, onTimeout })

      controller.pause()

      // Advance to just before timeout
      vi.advanceTimersByTime(4999)

      expect(onTimeout).not.toHaveBeenCalled()
      expect(controller.isPaused()).toBe(true)
      expect(controller.getCount()).toBe(1)
    })

    it('clears timer when resume() brings count to 0', () => {
      const onTimeout = vi.fn()
      const controller = new PauseController({ timeoutMs: 5000, onTimeout })

      controller.pause()
      expect(controller.isPaused()).toBe(true)

      // Resume before timeout
      controller.resume()
      expect(controller.isPaused()).toBe(false)

      // Advance past timeout
      vi.advanceTimersByTime(5000)

      // Timeout should NOT fire
      expect(onTimeout).not.toHaveBeenCalled()
    })

    it('does not clear timer on partial resume (count > 0)', () => {
      const onTimeout = vi.fn()
      const controller = new PauseController({ timeoutMs: 5000, onTimeout })

      // Pause 3 times
      controller.pause()
      controller.pause()
      controller.pause()
      expect(controller.getCount()).toBe(3)

      // Resume once (count still > 0)
      controller.resume()
      expect(controller.getCount()).toBe(2)
      expect(controller.isPaused()).toBe(true)

      // Advance to timeout
      vi.advanceTimersByTime(5000)

      // Timer should fire and reset full count
      expect(onTimeout).toHaveBeenCalledTimes(1)
      expect(controller.getCount()).toBe(0)
      expect(controller.isPaused()).toBe(false)
    })

    it('restarts timer on subsequent pause()', () => {
      const onTimeout = vi.fn()
      const controller = new PauseController({ timeoutMs: 5000, onTimeout })

      // First pause
      controller.pause()

      // Advance 3 seconds
      vi.advanceTimersByTime(3000)

      // Second pause (timer should restart)
      controller.pause()
      expect(controller.getCount()).toBe(2)

      // Advance 3 more seconds (total 6s from first pause, but only 3s from second)
      vi.advanceTimersByTime(3000)

      // Timer should NOT have fired yet (restarted at 3s mark)
      expect(onTimeout).not.toHaveBeenCalled()
      expect(controller.isPaused()).toBe(true)

      // Advance 2001ms more (5001ms from second pause)
      vi.advanceTimersByTime(2001)

      // Now timer should fire
      expect(onTimeout).toHaveBeenCalledTimes(1)
      expect(controller.getCount()).toBe(0)
      expect(controller.isPaused()).toBe(false)
    })

    it('resets full count on timeout regardless of nesting depth', () => {
      const onTimeout = vi.fn()
      const controller = new PauseController({ timeoutMs: 5000, onTimeout })

      // Pause 5 times
      controller.pause()
      controller.pause()
      controller.pause()
      controller.pause()
      controller.pause()

      expect(controller.getCount()).toBe(5)
      expect(controller.isPaused()).toBe(true)

      // Advance to timeout
      vi.advanceTimersByTime(5000)

      // Should reset to 0, not decrement by 1
      expect(onTimeout).toHaveBeenCalledTimes(1)
      expect(controller.getCount()).toBe(0)
      expect(controller.isPaused()).toBe(false)
    })

    it('does not fire when no timeoutMs configured', () => {
      const onTimeout = vi.fn()
      const controller = new PauseController() // No options

      controller.pause()

      // Advance well past any reasonable timeout
      vi.advanceTimersByTime(100_000)

      // Should still be paused, no timeout fired
      expect(onTimeout).not.toHaveBeenCalled()
      expect(controller.isPaused()).toBe(true)
      expect(controller.getCount()).toBe(1)
    })
  })

  describe('timer cleanup', () => {
    it('dispose() prevents timeout from firing', () => {
      const onTimeout = vi.fn()
      const controller = new PauseController({ timeoutMs: 5000, onTimeout })

      controller.pause()
      expect(controller.isPaused()).toBe(true)
      expect(controller.getCount()).toBe(1)

      // Dispose the controller
      controller.dispose()

      // Advance past timeout
      vi.advanceTimersByTime(5000)

      // Timeout should NOT fire (timer was cleared)
      expect(onTimeout).not.toHaveBeenCalled()

      // State should still be paused (dispose only clears timer, doesn't reset count)
      expect(controller.isPaused()).toBe(true)
      expect(controller.getCount()).toBe(1)
    })

    it('reset() clears the timer', () => {
      const onTimeout = vi.fn()
      const controller = new PauseController({ timeoutMs: 5000, onTimeout })

      controller.pause()
      expect(controller.isPaused()).toBe(true)

      // Reset the controller
      controller.reset()
      expect(controller.isPaused()).toBe(false)
      expect(controller.getCount()).toBe(0)

      // Advance past timeout
      vi.advanceTimersByTime(5000)

      // Timeout should NOT fire (timer was cleared by reset)
      expect(onTimeout).not.toHaveBeenCalled()
    })

    it('multiple pause/resume cycles do not leak timers', () => {
      const onTimeout = vi.fn()
      const controller = new PauseController({ timeoutMs: 5000, onTimeout })

      // Perform 10 rapid pause/resume cycles
      for (let i = 0; i < 10; i++) {
        controller.pause()
        controller.resume()
      }

      // One final pause
      controller.pause()

      // Advance to timeout
      vi.advanceTimersByTime(5000)

      // Should fire exactly once (only the final pause has an active timer)
      expect(onTimeout).toHaveBeenCalledTimes(1)
      expect(controller.getCount()).toBe(0)
      expect(controller.isPaused()).toBe(false)
    })
  })
})
