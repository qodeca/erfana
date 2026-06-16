// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure Logic Tests for Prompt Scroll Scheduler
 *
 * Tests for pure functions in promptScrollScheduler.logic.ts:
 * - didUserScrollRecently(): User scroll detection within time window
 * - scheduleScrollIfNeeded(): Scroll scheduling with cancellation
 *
 * Coverage:
 * - Happy path (successful scroll execution)
 * - User scroll prevention (skip when user scrolled recently)
 * - Terminal readiness checks (skip when not ready)
 * - Timing accuracy (delays, custom delays)
 * - Cancellation (cleanup, multiple calls, no-op after completion)
 * - Edge cases (undefined refs, negative timestamps, boundary conditions)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  didUserScrollRecently,
  scheduleScrollIfNeeded,
  SkipReason,
  type ScheduleScrollOptions
} from './promptScrollScheduler.logic'

describe('promptScrollScheduler.logic', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('didUserScrollRecently', () => {
    it('returns false when user never scrolled (lastScrollTs = 0)', () => {
      const completionTs = Date.now()
      const result = didUserScrollRecently(0, completionTs, 1000)
      expect(result).toBe(false)
    })

    it('returns false when user scrolled BEFORE completion', () => {
      vi.setSystemTime(2000)
      const lastScrollTs = 500 // User scrolled at 500ms
      const completionTs = 1000 // Prompt completed at 1000ms
      const result = didUserScrollRecently(lastScrollTs, completionTs, 1000)
      expect(result).toBe(false)
    })

    it('returns true when user scrolled AFTER completion within window', () => {
      vi.setSystemTime(1600) // Current time: 1600ms
      const completionTs = 1000 // Prompt completed at 1000ms
      const lastScrollTs = 1200 // User scrolled at 1200ms (200ms ago)
      const result = didUserScrollRecently(lastScrollTs, completionTs, 1000)
      expect(result).toBe(true)
    })

    it('returns false when user scrolled AFTER completion but outside window', () => {
      vi.setSystemTime(2500) // Current time: 2500ms
      const completionTs = 1000 // Prompt completed at 1000ms
      const lastScrollTs = 1200 // User scrolled at 1200ms (1300ms ago)
      const result = didUserScrollRecently(lastScrollTs, completionTs, 1000)
      expect(result).toBe(false)
    })

    it('handles edge case: user scrolled exactly at completion time', () => {
      vi.setSystemTime(1500)
      const completionTs = 1000
      const lastScrollTs = 1000 // Exactly at completion
      // lastScrollTs is NOT > completionTs, so should return false
      const result = didUserScrollRecently(lastScrollTs, completionTs, 1000)
      expect(result).toBe(false)
    })

    it('handles edge case: user scrolled exactly at window boundary', () => {
      vi.setSystemTime(2000) // Current time: 2000ms
      const completionTs = 1000 // Prompt completed at 1000ms
      const lastScrollTs = 1000 // User scrolled at 1000ms (exactly 1000ms ago)
      const windowMs = 1000
      // Elapsed = 2000 - 1000 = 1000ms, which is NOT < windowMs (1000)
      const result = didUserScrollRecently(lastScrollTs, completionTs, windowMs)
      expect(result).toBe(false)
    })

    it('returns true when user scrolled 1ms before window boundary', () => {
      vi.setSystemTime(1999) // Current time: 1999ms
      const completionTs = 500 // Prompt completed at 500ms (doesn't matter for this check)
      const lastScrollTs = 1000 // User scrolled at 1000ms (999ms ago)
      const windowMs = 1000
      // Check: lastScrollTs (1000) > completionTs (500) ✓
      // Elapsed = 1999 - 1000 = 999ms, which is < windowMs (1000) ✓
      const result = didUserScrollRecently(lastScrollTs, completionTs, windowMs)
      expect(result).toBe(true)
    })

    it('handles negative timestamps gracefully', () => {
      vi.setSystemTime(1000)
      const completionTs = -500 // Negative completion time
      const lastScrollTs = 0 // User scrolled at 0
      // lastScrollTs > completionTs (0 > -500), so check elapsed
      // elapsed = 1000 - 0 = 1000ms, NOT < 1000
      const result = didUserScrollRecently(lastScrollTs, completionTs, 1000)
      expect(result).toBe(false)
    })

    it('handles very large timestamps (year 2050+)', () => {
      const year2050 = new Date('2050-01-01').getTime()
      vi.setSystemTime(year2050 + 500) // 500ms after year 2050
      const completionTs = year2050
      const lastScrollTs = year2050 + 100 // User scrolled 100ms after completion
      // Elapsed = (year2050 + 500) - (year2050 + 100) = 400ms
      const result = didUserScrollRecently(lastScrollTs, completionTs, 1000)
      expect(result).toBe(true)
    })

    it('handles custom window size', () => {
      vi.setSystemTime(3000)
      const completionTs = 1000
      const lastScrollTs = 1500 // 1500ms ago from current time
      const windowMs = 2000 // 2 second window
      // lastScrollTs (1500) > completionTs (1000), elapsed = 3000 - 1500 = 1500ms < 2000ms
      const result = didUserScrollRecently(lastScrollTs, completionTs, windowMs)
      expect(result).toBe(true)
    })
  })

  describe('scheduleScrollIfNeeded', () => {
    describe('Happy Path', () => {
      it('schedules scroll when terminal ready and user did not scroll', () => {
        const scrollToBottom = vi.fn()
        const onScroll = vi.fn()
        const onSkip = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: 0 },
          delayMs: 1000,
          onScroll,
          onSkip
        }

        scheduleScrollIfNeeded(options)

        // Before timeout
        expect(scrollToBottom).not.toHaveBeenCalled()
        expect(onScroll).not.toHaveBeenCalled()

        // Fast-forward time
        vi.advanceTimersByTime(1000)

        expect(scrollToBottom).toHaveBeenCalledTimes(1)
        expect(onScroll).toHaveBeenCalledTimes(1)
        expect(onSkip).not.toHaveBeenCalled()
      })

      it('calls scrollToBottom() after correct delay', () => {
        const scrollToBottom = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: 0 },
          delayMs: 1500 // Custom delay
        }

        scheduleScrollIfNeeded(options)

        // 1000ms - not yet
        vi.advanceTimersByTime(1000)
        expect(scrollToBottom).not.toHaveBeenCalled()

        // 500ms more (total 1500ms)
        vi.advanceTimersByTime(500)
        expect(scrollToBottom).toHaveBeenCalledTimes(1)
      })

      it('works without optional callbacks', () => {
        const scrollToBottom = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: 0 }
          // No onScroll or onSkip
        }

        scheduleScrollIfNeeded(options)
        vi.advanceTimersByTime(1000)

        expect(scrollToBottom).toHaveBeenCalledTimes(1)
      })
    })

    describe('User Scroll Prevention', () => {
      it('skips scroll when user scrolled 100ms after completion', () => {
        vi.setSystemTime(1000) // Current time: 1000ms (when scheduleScrollIfNeeded is called)
        const completionTs = 1000 // Prompt completed at 1000ms
        const lastScrollTs = 1100 // User scrolled at 1100ms (100ms after completion)

        const scrollToBottom = vi.fn()
        const onScroll = vi.fn()
        const onSkip = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs,
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: lastScrollTs },
          delayMs: 1000,
          onScroll,
          onSkip
        }

        scheduleScrollIfNeeded(options)

        // Advance time by 1000ms (timeout fires, now Date.now() = 2000ms)
        // At timeout check: lastScrollTs (1100) > completionTs (1000) ✓
        // Elapsed = Date.now() (2000) - lastScrollTs (1100) = 900ms
        // 900ms < 1000ms window ✓ → Should skip
        vi.advanceTimersByTime(1000)

        expect(scrollToBottom).not.toHaveBeenCalled()
        expect(onScroll).not.toHaveBeenCalled()
        expect(onSkip).toHaveBeenCalledWith(SkipReason.USER_SCROLLED)
        expect(onSkip).toHaveBeenCalledTimes(1)
      })

      it('skips scroll when user scrolled 500ms after completion', () => {
        vi.setSystemTime(1000) // Current time: 1000ms
        const completionTs = 1000 // Prompt completed at 1000ms
        const lastScrollTs = 1500 // User scrolled at 1500ms (500ms after completion)

        const scrollToBottom = vi.fn()
        const onSkip = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs,
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: lastScrollTs },
          onSkip
        }

        scheduleScrollIfNeeded(options)

        // Advance time by 1000ms (timeout fires, now Date.now() = 2000ms)
        // At timeout check: lastScrollTs (1500) > completionTs (1000) ✓
        // Elapsed = Date.now() (2000) - lastScrollTs (1500) = 500ms
        // 500ms < 1000ms window ✓ → Should skip
        vi.advanceTimersByTime(1000)

        expect(scrollToBottom).not.toHaveBeenCalled()
        expect(onSkip).toHaveBeenCalledWith(SkipReason.USER_SCROLLED)
      })

      it('skips scroll when user scrolled 999ms after completion (edge case)', () => {
        vi.setSystemTime(1000) // Current time: 1000ms
        const completionTs = 1000 // Prompt completed at 1000ms
        const lastScrollTs = 1999 // User scrolled at 1999ms (999ms after completion)

        const scrollToBottom = vi.fn()
        const onSkip = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs,
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: lastScrollTs },
          delayMs: 1000,
          onSkip
        }

        scheduleScrollIfNeeded(options)

        // Advance time by 1000ms (timeout fires, now Date.now() = 2000ms)
        // At timeout check: lastScrollTs (1999) > completionTs (1000) ✓
        // Elapsed = Date.now() (2000) - lastScrollTs (1999) = 1ms
        // 1ms < 1000ms window ✓ → Should skip
        vi.advanceTimersByTime(1000)

        expect(scrollToBottom).not.toHaveBeenCalled()
        expect(onSkip).toHaveBeenCalledWith(SkipReason.USER_SCROLLED)
      })

      it('executes scroll when user scrolled 1001ms after completion', () => {
        vi.setSystemTime(3001) // Current time: 3001ms
        const completionTs = 1000 // Prompt completed at 1000ms
        const lastScrollTs = 2000 // User scrolled at 2000ms (1001ms ago)

        const scrollToBottom = vi.fn()
        const onScroll = vi.fn()
        const onSkip = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs,
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: lastScrollTs },
          delayMs: 1000,
          onScroll,
          onSkip
        }

        scheduleScrollIfNeeded(options)
        vi.advanceTimersByTime(1000)

        expect(scrollToBottom).toHaveBeenCalledTimes(1)
        expect(onScroll).toHaveBeenCalledTimes(1)
        expect(onSkip).not.toHaveBeenCalled()
      })

      it('executes scroll when user scrolled BEFORE completion', () => {
        vi.setSystemTime(2000)
        const completionTs = 1500 // Prompt completed at 1500ms
        const lastScrollTs = 1000 // User scrolled at 1000ms (BEFORE completion)

        const scrollToBottom = vi.fn()
        const onScroll = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs,
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: lastScrollTs },
          onScroll
        }

        scheduleScrollIfNeeded(options)
        vi.advanceTimersByTime(1000)

        expect(scrollToBottom).toHaveBeenCalledTimes(1)
        expect(onScroll).toHaveBeenCalledTimes(1)
      })
    })

    describe('Terminal Readiness', () => {
      it('skips scroll when terminalControls is null', () => {
        const onSkip = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: null, // No controls
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: 0 },
          onSkip
        }

        scheduleScrollIfNeeded(options)
        vi.advanceTimersByTime(1000)

        expect(onSkip).toHaveBeenCalledWith(SkipReason.CONTROLS_NOT_AVAILABLE)
        expect(onSkip).toHaveBeenCalledTimes(1)
      })

      it('skips scroll when isTerminalReady is false', () => {
        const scrollToBottom = vi.fn()
        const onSkip = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: false // Not ready
          },
          lastUserScrollTsRef: { current: 0 },
          onSkip
        }

        scheduleScrollIfNeeded(options)
        vi.advanceTimersByTime(1000)

        expect(scrollToBottom).not.toHaveBeenCalled()
        expect(onSkip).toHaveBeenCalledWith(SkipReason.TERMINAL_NOT_READY)
        expect(onSkip).toHaveBeenCalledTimes(1)
      })

      it('checks controls availability before terminal readiness', () => {
        const onSkip = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: null,
            isTerminalReady: false // Both conditions fail
          },
          lastUserScrollTsRef: { current: 0 },
          onSkip
        }

        scheduleScrollIfNeeded(options)
        vi.advanceTimersByTime(1000)

        // Should skip with CONTROLS_NOT_AVAILABLE (checked first)
        expect(onSkip).toHaveBeenCalledWith(SkipReason.CONTROLS_NOT_AVAILABLE)
        expect(onSkip).toHaveBeenCalledTimes(1)
      })
    })

    describe('Timing', () => {
      it('waits full delayMs (1000ms default) before executing scroll', () => {
        const scrollToBottom = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: 0 }
          // Default delayMs = 1000
        }

        scheduleScrollIfNeeded(options)

        // 999ms - not yet
        vi.advanceTimersByTime(999)
        expect(scrollToBottom).not.toHaveBeenCalled()

        // 1ms more (total 1000ms)
        vi.advanceTimersByTime(1)
        expect(scrollToBottom).toHaveBeenCalledTimes(1)
      })

      it('uses custom delayMs when provided (500ms)', () => {
        const scrollToBottom = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: 0 },
          delayMs: 500
        }

        scheduleScrollIfNeeded(options)

        vi.advanceTimersByTime(499)
        expect(scrollToBottom).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1)
        expect(scrollToBottom).toHaveBeenCalledTimes(1)
      })

      it('uses custom delayMs when provided (2000ms)', () => {
        const scrollToBottom = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: 0 },
          delayMs: 2000
        }

        scheduleScrollIfNeeded(options)

        vi.advanceTimersByTime(1999)
        expect(scrollToBottom).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1)
        expect(scrollToBottom).toHaveBeenCalledTimes(1)
      })

      it('executes at exact timeout boundary', () => {
        const scrollToBottom = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: 0 },
          delayMs: 750
        }

        scheduleScrollIfNeeded(options)

        // Exactly 750ms
        vi.advanceTimersByTime(750)
        expect(scrollToBottom).toHaveBeenCalledTimes(1)
      })
    })

    describe('Cancellation', () => {
      it('prevents scroll from executing when called before timeout', () => {
        const scrollToBottom = vi.fn()
        const onScroll = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: 0 },
          delayMs: 1000,
          onScroll
        }

        const { cancel } = scheduleScrollIfNeeded(options)

        // Cancel after 500ms
        vi.advanceTimersByTime(500)
        cancel()

        // Advance remaining time
        vi.advanceTimersByTime(500)

        expect(scrollToBottom).not.toHaveBeenCalled()
        expect(onScroll).not.toHaveBeenCalled()
      })

      it('is safe to call multiple times', () => {
        const scrollToBottom = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: 0 }
        }

        const { cancel } = scheduleScrollIfNeeded(options)

        vi.advanceTimersByTime(500)
        cancel()
        cancel() // Second call
        cancel() // Third call

        vi.advanceTimersByTime(500)

        expect(scrollToBottom).not.toHaveBeenCalled()
      })

      it('is a no-op when called after timeout completes', () => {
        const scrollToBottom = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: 0 }
        }

        const { cancel } = scheduleScrollIfNeeded(options)

        // Let timeout complete
        vi.advanceTimersByTime(1000)
        expect(scrollToBottom).toHaveBeenCalledTimes(1)

        // Cancel after completion
        cancel()

        // Should not affect anything
        expect(scrollToBottom).toHaveBeenCalledTimes(1)
      })

      it('clears the timeout properly (no memory leaks)', () => {
        const scrollToBottom = vi.fn()
        const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: 0 }
        }

        const { cancel } = scheduleScrollIfNeeded(options)

        vi.advanceTimersByTime(500)
        cancel()

        expect(clearTimeoutSpy).toHaveBeenCalled()
        clearTimeoutSpy.mockRestore()
      })

      it('can cancel immediately after creation', () => {
        const scrollToBottom = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: 0 }
        }

        const { cancel } = scheduleScrollIfNeeded(options)
        cancel() // Immediate cancel

        vi.advanceTimersByTime(1000)

        expect(scrollToBottom).not.toHaveBeenCalled()
      })
    })

    describe('Edge Cases', () => {
      it('handles undefined lastUserScrollTsRef.current (treats as 0)', () => {
        const scrollToBottom = vi.fn()
        const onScroll = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: undefined as any }, // Simulate undefined
          onScroll
        }

        scheduleScrollIfNeeded(options)
        vi.advanceTimersByTime(1000)

        // Should execute scroll (undefined treated as 0)
        expect(scrollToBottom).toHaveBeenCalledTimes(1)
        expect(onScroll).toHaveBeenCalledTimes(1)
      })

      it('handles null lastUserScrollTsRef.current (treats as 0)', () => {
        const scrollToBottom = vi.fn()
        const onScroll = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: null as any }, // Simulate null
          onScroll
        }

        scheduleScrollIfNeeded(options)
        vi.advanceTimersByTime(1000)

        // Should execute scroll (null treated as 0)
        expect(scrollToBottom).toHaveBeenCalledTimes(1)
        expect(onScroll).toHaveBeenCalledTimes(1)
      })

      it('handles very small delayMs (1ms)', () => {
        const scrollToBottom = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: 0 },
          delayMs: 1
        }

        scheduleScrollIfNeeded(options)
        vi.advanceTimersByTime(1)

        expect(scrollToBottom).toHaveBeenCalledTimes(1)
      })

      it('handles zero delayMs (immediate execution)', () => {
        const scrollToBottom = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: 0 },
          delayMs: 0
        }

        scheduleScrollIfNeeded(options)
        vi.advanceTimersByTime(0)

        expect(scrollToBottom).toHaveBeenCalledTimes(1)
      })

      it('handles MutableRefObject pattern (useRef)', () => {
        const scrollToBottom = vi.fn()
        const onScroll = vi.fn()

        // MutableRefObject has non-nullable current
        const mutableRef = { current: 0 }

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: mutableRef,
          onScroll
        }

        scheduleScrollIfNeeded(options)
        vi.advanceTimersByTime(1000)

        expect(scrollToBottom).toHaveBeenCalledTimes(1)
        expect(onScroll).toHaveBeenCalledTimes(1)
      })

      it('handles RefObject pattern (createRef)', () => {
        const scrollToBottom = vi.fn()
        const onScroll = vi.fn()

        // RefObject has nullable current
        const refObject: { current: number | null } = { current: 0 }

        const options: ScheduleScrollOptions = {
          completionTs: Date.now(),
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: refObject,
          onScroll
        }

        scheduleScrollIfNeeded(options)
        vi.advanceTimersByTime(1000)

        expect(scrollToBottom).toHaveBeenCalledTimes(1)
        expect(onScroll).toHaveBeenCalledTimes(1)
      })

      it('handles negative completionTs gracefully', () => {
        vi.setSystemTime(1000)
        const scrollToBottom = vi.fn()

        const options: ScheduleScrollOptions = {
          completionTs: -1000, // Negative timestamp
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: 0 }
        }

        scheduleScrollIfNeeded(options)
        vi.advanceTimersByTime(1000)

        // Should still execute (logic doesn't break)
        expect(scrollToBottom).toHaveBeenCalledTimes(1)
      })

      it('executes all checks in correct order (controls -> ready -> user scroll)', () => {
        vi.setSystemTime(1000) // Initial time
        const completionTs = 1000
        const lastScrollTs = 1500 // User scrolled at 1500ms (will be recent when timeout fires)

        const onSkip = vi.fn()

        // Test 1: Controls checked first
        const options1: ScheduleScrollOptions = {
          completionTs,
          terminalPortal: {
            terminalControls: null, // Fails first check
            isTerminalReady: false
          },
          lastUserScrollTsRef: { current: lastScrollTs },
          onSkip
        }

        scheduleScrollIfNeeded(options1)
        vi.advanceTimersByTime(1000) // Now at 2000ms
        expect(onSkip).toHaveBeenCalledWith(SkipReason.CONTROLS_NOT_AVAILABLE)

        onSkip.mockClear()
        vi.setSystemTime(1000) // Reset time

        // Test 2: Ready checked second
        const scrollToBottom = vi.fn()
        const options2: ScheduleScrollOptions = {
          completionTs,
          terminalPortal: {
            terminalControls: { scrollToBottom }, // Pass first check
            isTerminalReady: false // Fails second check
          },
          lastUserScrollTsRef: { current: lastScrollTs },
          onSkip
        }

        scheduleScrollIfNeeded(options2)
        vi.advanceTimersByTime(1000) // Now at 2000ms
        expect(onSkip).toHaveBeenCalledWith(SkipReason.TERMINAL_NOT_READY)

        onSkip.mockClear()
        vi.setSystemTime(1000) // Reset time

        // Test 3: User scroll checked third
        const options3: ScheduleScrollOptions = {
          completionTs,
          terminalPortal: {
            terminalControls: { scrollToBottom }, // Pass first check
            isTerminalReady: true // Pass second check
          },
          lastUserScrollTsRef: { current: lastScrollTs }, // Fails third check
          onSkip
        }

        scheduleScrollIfNeeded(options3)
        vi.advanceTimersByTime(1000) // Now at 2000ms
        // At check time: lastScrollTs (1500) > completionTs (1000) ✓
        // Elapsed = 2000 - 1500 = 500ms < 1000ms ✓
        expect(onSkip).toHaveBeenCalledWith(SkipReason.USER_SCROLLED)
      })

      it('does not mutate input options', () => {
        const scrollToBottom = vi.fn()
        const originalOptions: ScheduleScrollOptions = {
          completionTs: 1000,
          terminalPortal: {
            terminalControls: { scrollToBottom },
            isTerminalReady: true
          },
          lastUserScrollTsRef: { current: 0 },
          delayMs: 500
        }

        const optionsCopy = JSON.parse(JSON.stringify({
          completionTs: originalOptions.completionTs,
          delayMs: originalOptions.delayMs
        }))

        scheduleScrollIfNeeded(originalOptions)
        vi.advanceTimersByTime(500)

        // Verify options unchanged
        expect(originalOptions.completionTs).toBe(optionsCopy.completionTs)
        expect(originalOptions.delayMs).toBe(optionsCopy.delayMs)
      })
    })
  })
})
