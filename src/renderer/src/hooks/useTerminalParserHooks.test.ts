// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useTerminalParserHooks pure logic functions
 *
 * Tests the parser hook utility functions that detect scroll-affecting
 * ED sequences and calculate restoration positions.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  isScrollAffectingED,
  calculateRestoredPosition,
  shouldSkipRestoration,
  useTerminalParserHooks
} from './useTerminalParserHooks'
import type { Terminal, IDisposable } from '@xterm/xterm'

describe('useTerminalParserHooks pure functions', () => {
  describe('isScrollAffectingED', () => {
    it('returns true for ED 2 (clear entire screen)', () => {
      expect(isScrollAffectingED(2)).toBe(true)
    })

    it('returns true for ED 3 (clear scrollback)', () => {
      expect(isScrollAffectingED(3)).toBe(true)
    })

    it('returns false for ED 0 (clear from cursor to end)', () => {
      expect(isScrollAffectingED(0)).toBe(false)
    })

    it('returns false for ED 1 (clear from cursor to beginning)', () => {
      expect(isScrollAffectingED(1)).toBe(false)
    })

    it('returns false for other values', () => {
      expect(isScrollAffectingED(4)).toBe(false)
      expect(isScrollAffectingED(-1)).toBe(false)
      expect(isScrollAffectingED(10)).toBe(false)
    })
  })

  describe('calculateRestoredPosition', () => {
    describe('when user was at bottom', () => {
      it('scrolls to bottom when viewport was at baseY', () => {
        const result = calculateRestoredPosition(100, 100, 50)
        expect(result.scrollToBottom).toBe(true)
        expect(result.targetY).toBe(50)
      })

      it('scrolls to bottom when viewport was near bottom (within 3 lines)', () => {
        const result = calculateRestoredPosition(97, 100, 50)
        expect(result.scrollToBottom).toBe(true)
        expect(result.targetY).toBe(50)
      })

      it('scrolls to bottom when newBaseY is 0', () => {
        const result = calculateRestoredPosition(50, 100, 0)
        expect(result.scrollToBottom).toBe(true)
        expect(result.targetY).toBe(0)
      })
    })

    describe('when user was scrolled up', () => {
      it('preserves distance from bottom', () => {
        // User was 20 lines from bottom (baseY 100, viewportY 80)
        const result = calculateRestoredPosition(80, 100, 150)
        expect(result.scrollToBottom).toBe(false)
        expect(result.targetY).toBe(130) // 150 - 20 = 130
      })

      it('preserves distance when scrolled to middle', () => {
        // User was 50 lines from bottom
        const result = calculateRestoredPosition(50, 100, 200)
        expect(result.scrollToBottom).toBe(false)
        expect(result.targetY).toBe(150) // 200 - 50 = 150
      })

      it('ensures targetY never goes negative', () => {
        // User was 80 lines from bottom, but new buffer only has 50 lines
        const result = calculateRestoredPosition(20, 100, 50)
        expect(result.scrollToBottom).toBe(false)
        expect(result.targetY).toBe(0) // max(0, 50 - 80) = 0
      })
    })

    describe('edge cases', () => {
      it('handles zero saved position (terminal just opened)', () => {
        const result = calculateRestoredPosition(0, 0, 100)
        expect(result.scrollToBottom).toBe(true)
        expect(result.targetY).toBe(100)
      })

      it('handles buffer growing (baseY increases)', () => {
        const result = calculateRestoredPosition(50, 80, 120)
        expect(result.scrollToBottom).toBe(false)
        expect(result.targetY).toBe(90) // 120 - (80 - 50) = 90
      })

      it('handles buffer shrinking significantly', () => {
        const result = calculateRestoredPosition(200, 250, 100)
        expect(result.scrollToBottom).toBe(false)
        expect(result.targetY).toBe(50) // 100 - (250 - 200) = 50
      })
    })
  })

  describe('shouldSkipRestoration', () => {
    it('skips when user scrolled within cooldown window', () => {
      const lastScrollTs = 1000
      const currentTs = 1200 // 200ms later
      const cooldown = 300
      expect(shouldSkipRestoration(lastScrollTs, currentTs, cooldown)).toBe(true)
    })

    it('allows restoration after cooldown expires', () => {
      const lastScrollTs = 1000
      const currentTs = 1400 // 400ms later
      const cooldown = 300
      expect(shouldSkipRestoration(lastScrollTs, currentTs, cooldown)).toBe(false)
    })

    it('allows restoration when cooldown exactly expires', () => {
      const lastScrollTs = 1000
      const currentTs = 1300 // exactly 300ms later
      const cooldown = 300
      expect(shouldSkipRestoration(lastScrollTs, currentTs, cooldown)).toBe(false)
    })

    it('uses default 300ms cooldown when not specified', () => {
      const lastScrollTs = 1000
      const currentTs = 1299
      expect(shouldSkipRestoration(lastScrollTs, currentTs)).toBe(true)

      const currentTs2 = 1300
      expect(shouldSkipRestoration(lastScrollTs, currentTs2)).toBe(false)
    })

    it('skips restoration when both timestamps are zero (edge case)', () => {
      // When both are 0, difference is 0 which is < cooldown, so it skips
      expect(shouldSkipRestoration(0, 0, 300)).toBe(true)
    })

    it('allows restoration when lastUserScrollTs is zero and currentTs > cooldown', () => {
      expect(shouldSkipRestoration(0, 5000, 300)).toBe(false)
    })

    it('skips when lastUserScrollTs is zero but currentTs within cooldown', () => {
      // When lastUserScrollTs is 0, currentTs < cooldown means skip
      expect(shouldSkipRestoration(0, 200, 300)).toBe(true)
    })
  })

  describe('integration scenarios', () => {
    it('handles Claude Code Ink ED 2 + ED 3 sequence', () => {
      // Claude Code sends both ED 2 and ED 3 when output exceeds terminal height
      const ed2Detected = isScrollAffectingED(2)
      const ed3Detected = isScrollAffectingED(3)

      expect(ed2Detected).toBe(true)
      expect(ed3Detected).toBe(true)

      // User was reading output 30 lines from bottom before clear
      const savedViewportY = 170
      const savedBaseY = 200
      const newBaseY = 250 // Buffer grew after clear

      const position = calculateRestoredPosition(savedViewportY, savedBaseY, newBaseY)

      // Should restore to proportional position (30 lines from bottom)
      expect(position.scrollToBottom).toBe(false)
      expect(position.targetY).toBe(220) // 250 - 30 = 220
    })

    it('respects user scroll during restoration', () => {
      const lastUserScrollTs = 5000
      const clearSequenceTs = 5100 // 100ms after user scrolled

      // User scrolled recently, should skip restoration
      expect(shouldSkipRestoration(lastUserScrollTs, clearSequenceTs, 300)).toBe(true)

      // After cooldown, allow restoration
      const laterTs = 5400
      expect(shouldSkipRestoration(lastUserScrollTs, laterTs, 300)).toBe(false)
    })

    it('handles rapid ED 2/3 sequence with debouncing', () => {
      // First ED 2
      const ed2 = isScrollAffectingED(2)
      expect(ed2).toBe(true)

      // Followed immediately by ED 3 (coalesced via restorationPendingRef)
      const ed3 = isScrollAffectingED(3)
      expect(ed3).toBe(true)

      // Both should trigger restoration, but coalescing will ensure only one restore
      // (tested in hook-level tests below)
    })
  })
})

// === Hook-level tests ===

describe('useTerminalParserHooks hook', () => {
  // Mock terminal with parser hook registration
  const createMockTerminal = (viewportY = 100, baseY = 100) => {
    const handlers: { final: string; handler: (params: number[]) => boolean }[] = []
    const mockDisposable: IDisposable = { dispose: vi.fn() }

    return {
      terminal: {
        buffer: { active: { viewportY, baseY } },
        scrollToBottom: vi.fn(),
        scrollToLine: vi.fn(),
        parser: {
          registerCsiHandler: vi.fn(
            (id: { final: string }, handler: (params: number[]) => boolean) => {
              handlers.push({ final: id.final, handler })
              return mockDisposable
            }
          )
        }
      } as unknown as Terminal,
      handlers,
      disposable: mockDisposable
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
      cb(0)
      return 0
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('enabled: false returns empty disposables array (A7)', () => {
    const { terminal } = createMockTerminal()
    const { result } = renderHook(() =>
      useTerminalParserHooks({ enabled: false })
    )

    const disposables = result.current.registerHooks(terminal)
    expect(disposables).toEqual([])
    expect(terminal.parser.registerCsiHandler).not.toHaveBeenCalled()
  })

  it('microtask fires without setTimeout delay (A1)', async () => {
    const { terminal, handlers } = createMockTerminal(50, 100)
    const onIntercept = vi.fn()

    const { result } = renderHook(() =>
      useTerminalParserHooks({ enabled: true, onIntercept })
    )

    result.current.registerHooks(terminal)

    // Trigger ED2 handler
    const jHandler = handlers.find(h => h.final === 'J')
    expect(jHandler).toBeDefined()
    jHandler!.handler([2])

    // Microtask should fire without needing setTimeout – just flush microtasks
    await Promise.resolve()

    // onIntercept should have been called (restoration ran in microtask)
    expect(onIntercept).toHaveBeenCalledWith('ED2')
  })

  it('restorationPendingRef coalesces rapid ED2+ED3 – only one restoration (A2)', async () => {
    const { terminal, handlers } = createMockTerminal(50, 100)
    const onIntercept = vi.fn()

    const { result } = renderHook(() =>
      useTerminalParserHooks({ enabled: true, onIntercept })
    )

    result.current.registerHooks(terminal)

    const jHandler = handlers.find(h => h.final === 'J')!

    // Fire ED2 then ED3 in same synchronous block (before microtask runs)
    jHandler.handler([2])
    jHandler.handler([3])

    // Flush microtasks
    await Promise.resolve()

    // Only one restoration should have fired (ED2 – the first one)
    expect(onIntercept).toHaveBeenCalledTimes(1)
    expect(onIntercept).toHaveBeenCalledWith('ED2')
  })

  it('pending ref resets after microtask – second sequence triggers new restoration (A3)', async () => {
    const { terminal, handlers } = createMockTerminal(50, 100)
    const onIntercept = vi.fn()

    const { result } = renderHook(() =>
      useTerminalParserHooks({ enabled: true, onIntercept })
    )

    result.current.registerHooks(terminal)

    const jHandler = handlers.find(h => h.final === 'J')!

    // First sequence
    jHandler.handler([2])
    await Promise.resolve()
    expect(onIntercept).toHaveBeenCalledTimes(1)

    // Second sequence – should trigger new restoration since pending ref was reset
    jHandler.handler([3])
    await Promise.resolve()
    expect(onIntercept).toHaveBeenCalledTimes(2)
    expect(onIntercept).toHaveBeenLastCalledWith('ED3')
  })

  it('user-scroll cooldown skips restoration when lastUserScrollTsRef is recent (A4)', async () => {
    const { terminal, handlers } = createMockTerminal(50, 100)
    const onIntercept = vi.fn()
    const lastUserScrollTsRef = { current: Date.now() } // scrolled "just now"

    const { result } = renderHook(() =>
      useTerminalParserHooks({
        enabled: true,
        onIntercept,
        lastUserScrollTsRef
      })
    )

    result.current.registerHooks(terminal)

    const jHandler = handlers.find(h => h.final === 'J')!
    jHandler.handler([2])

    await Promise.resolve()

    // Should skip restoration because user scrolled recently
    expect(onIntercept).not.toHaveBeenCalled()
    expect(terminal.scrollToBottom).not.toHaveBeenCalled()
  })
})
