/**
 * Scroll Anomaly Detector Tests
 *
 * Pure logic tests for detecting anomalous scroll-to-top events
 * caused by Claude Code's Ink library buffer redraws.
 */

import { describe, expect, it } from 'vitest'
import {
  isAnomalousScroll,
  wasUserScrollRecent,
  wasDataStreamActive,
  calculateJumpMagnitude,
  isNearTop,
  DEFAULT_SCROLL_ANOMALY_CONFIG,
  type ScrollAnomalyConfig,
  type ScrollState
} from './scrollAnomalyDetector'

describe('scrollAnomalyDetector', () => {
  const defaultConfig: ScrollAnomalyConfig = DEFAULT_SCROLL_ANOMALY_CONFIG

  describe('wasUserScrollRecent', () => {
    it('returns true when scroll happened within window', () => {
      const now = Date.now()
      expect(wasUserScrollRecent(now - 100, now, 300)).toBe(true)
    })

    it('returns true at exact boundary', () => {
      const now = Date.now()
      expect(wasUserScrollRecent(now - 299, now, 300)).toBe(true)
    })

    it('returns false when scroll happened outside window', () => {
      const now = Date.now()
      expect(wasUserScrollRecent(now - 500, now, 300)).toBe(false)
    })

    it('returns false at exact boundary (exclusive)', () => {
      const now = Date.now()
      expect(wasUserScrollRecent(now - 300, now, 300)).toBe(false)
    })

    it('returns false when never scrolled (ts = 0)', () => {
      expect(wasUserScrollRecent(0, Date.now(), 300)).toBe(false)
    })

    it('handles future timestamps gracefully', () => {
      const now = Date.now()
      expect(wasUserScrollRecent(now + 100, now, 300)).toBe(true)
    })
  })

  describe('wasDataStreamActive', () => {
    it('returns true when data arrived within window', () => {
      const now = Date.now()
      expect(wasDataStreamActive(now - 100, now, 500)).toBe(true)
    })

    it('returns false when data arrived outside window', () => {
      const now = Date.now()
      expect(wasDataStreamActive(now - 1000, now, 500)).toBe(false)
    })

    it('returns false when no data received (ts = 0)', () => {
      expect(wasDataStreamActive(0, Date.now(), 500)).toBe(false)
    })

    it('returns true at boundary', () => {
      const now = Date.now()
      expect(wasDataStreamActive(now - 499, now, 500)).toBe(true)
    })
  })

  describe('calculateJumpMagnitude', () => {
    it('calculates positive difference (scroll up)', () => {
      expect(calculateJumpMagnitude(100, 0)).toBe(100)
    })

    it('calculates positive difference (scroll down)', () => {
      expect(calculateJumpMagnitude(0, 100)).toBe(100)
    })

    it('returns 0 for same position', () => {
      expect(calculateJumpMagnitude(50, 50)).toBe(0)
    })

    it('handles small jumps', () => {
      expect(calculateJumpMagnitude(10, 5)).toBe(5)
    })

    it('handles large jumps', () => {
      expect(calculateJumpMagnitude(10000, 0)).toBe(10000)
    })
  })

  describe('isNearTop', () => {
    it('returns true for position 0', () => {
      expect(isNearTop(0, 3)).toBe(true)
    })

    it('returns true for position at threshold', () => {
      expect(isNearTop(3, 3)).toBe(true)
    })

    it('returns false for position above threshold', () => {
      expect(isNearTop(4, 3)).toBe(false)
    })

    it('handles threshold of 0', () => {
      expect(isNearTop(0, 0)).toBe(true)
      expect(isNearTop(1, 0)).toBe(false)
    })
  })

  describe('isAnomalousScroll', () => {
    const now = Date.now()

    describe('positive cases (should detect anomaly)', () => {
      it('detects large jump to top during streaming without user scroll', () => {
        const state: ScrollState = {
          lastUserScrollTs: 0, // No recent user scroll
          lastDataTs: now - 100, // Recent data (within 500ms)
          viewportYBefore: 500, // Was far from top
          viewportYAfter: 0, // Jumped to top
          baseY: 510,
          currentTs: now
        }
        expect(isAnomalousScroll(state, defaultConfig)).toBe(true)
      })

      it('detects jump to near-top (not exactly 0)', () => {
        const state: ScrollState = {
          lastUserScrollTs: 0,
          lastDataTs: now - 100,
          viewportYBefore: 500,
          viewportYAfter: 2, // Near top but not 0
          baseY: 510,
          currentTs: now
        }
        expect(isAnomalousScroll(state, defaultConfig)).toBe(true)
      })

      it('detects anomaly even with old user scroll', () => {
        const state: ScrollState = {
          lastUserScrollTs: now - 1000, // User scrolled 1s ago (outside 300ms window)
          lastDataTs: now - 100,
          viewportYBefore: 500,
          viewportYAfter: 0,
          baseY: 510,
          currentTs: now
        }
        expect(isAnomalousScroll(state, defaultConfig)).toBe(true)
      })
    })

    describe('negative cases (should NOT detect anomaly)', () => {
      it('returns false when user recently scrolled', () => {
        const state: ScrollState = {
          lastUserScrollTs: now - 100, // Recent user scroll (within 300ms)
          lastDataTs: now - 100,
          viewportYBefore: 500,
          viewportYAfter: 0,
          baseY: 510,
          currentTs: now
        }
        expect(isAnomalousScroll(state, defaultConfig)).toBe(false)
      })

      it('returns false when no data was streaming', () => {
        const state: ScrollState = {
          lastUserScrollTs: 0,
          lastDataTs: now - 1000, // Data was 1s ago (outside 500ms window)
          viewportYBefore: 500,
          viewportYAfter: 0,
          baseY: 510,
          currentTs: now
        }
        expect(isAnomalousScroll(state, defaultConfig)).toBe(false)
      })

      it('returns false for small scroll changes (below threshold)', () => {
        const state: ScrollState = {
          lastUserScrollTs: 0,
          lastDataTs: now - 100,
          viewportYBefore: 10, // Small jump (< 10 lines)
          viewportYAfter: 5,
          baseY: 510,
          currentTs: now
        }
        expect(isAnomalousScroll(state, defaultConfig)).toBe(false)
      })

      it('returns false when user was already near top', () => {
        const state: ScrollState = {
          lastUserScrollTs: 0,
          lastDataTs: now - 100,
          viewportYBefore: 2, // Already near top
          viewportYAfter: 0,
          baseY: 510,
          currentTs: now
        }
        expect(isAnomalousScroll(state, defaultConfig)).toBe(false)
      })

      it('returns false when jump does not land near top', () => {
        const state: ScrollState = {
          lastUserScrollTs: 0,
          lastDataTs: now - 100,
          viewportYBefore: 500,
          viewportYAfter: 100, // Jumped but not to top
          baseY: 510,
          currentTs: now
        }
        expect(isAnomalousScroll(state, defaultConfig)).toBe(false)
      })

      it('returns false when no data has ever been received', () => {
        const state: ScrollState = {
          lastUserScrollTs: 0,
          lastDataTs: 0, // Never received data
          viewportYBefore: 500,
          viewportYAfter: 0,
          baseY: 510,
          currentTs: now
        }
        expect(isAnomalousScroll(state, defaultConfig)).toBe(false)
      })
    })

    describe('edge cases', () => {
      it('handles viewportY and baseY both at 0 (empty terminal)', () => {
        const state: ScrollState = {
          lastUserScrollTs: 0,
          lastDataTs: now - 100,
          viewportYBefore: 0,
          viewportYAfter: 0,
          baseY: 0,
          currentTs: now
        }
        expect(isAnomalousScroll(state, defaultConfig)).toBe(false)
      })

      it('handles exact threshold values', () => {
        const state: ScrollState = {
          lastUserScrollTs: 0,
          lastDataTs: now - 100,
          viewportYBefore: 13, // Exactly 10 lines from threshold (3)
          viewportYAfter: 3, // Exactly at threshold
          baseY: 510,
          currentTs: now
        }
        expect(isAnomalousScroll(state, defaultConfig)).toBe(true)
      })

      it('handles jump at exact threshold minus 1 (should be false)', () => {
        const state: ScrollState = {
          lastUserScrollTs: 0,
          lastDataTs: now - 100,
          viewportYBefore: 12, // 9 lines jump (below 10)
          viewportYAfter: 3,
          baseY: 510,
          currentTs: now
        }
        expect(isAnomalousScroll(state, defaultConfig)).toBe(false)
      })
    })

    describe('custom configuration', () => {
      it('respects custom userScrollRecencyMs', () => {
        const customConfig: ScrollAnomalyConfig = {
          ...defaultConfig,
          userScrollRecencyMs: 100 // Shorter window
        }
        const state: ScrollState = {
          lastUserScrollTs: now - 150, // Would be recent with 300ms, not with 100ms
          lastDataTs: now - 50,
          viewportYBefore: 500,
          viewportYAfter: 0,
          baseY: 510,
          currentTs: now
        }
        expect(isAnomalousScroll(state, customConfig)).toBe(true)
      })

      it('respects custom jumpThresholdLines', () => {
        const customConfig: ScrollAnomalyConfig = {
          ...defaultConfig,
          jumpThresholdLines: 5 // Lower threshold
        }
        const state: ScrollState = {
          lastUserScrollTs: 0,
          lastDataTs: now - 100,
          viewportYBefore: 8, // 8 line jump (above 5, below default 10)
          viewportYAfter: 0,
          baseY: 510,
          currentTs: now
        }
        expect(isAnomalousScroll(state, customConfig)).toBe(true)
        expect(isAnomalousScroll(state, defaultConfig)).toBe(false)
      })

      it('respects custom nearTopThreshold', () => {
        const customConfig: ScrollAnomalyConfig = {
          ...defaultConfig,
          nearTopThreshold: 10 // Higher threshold
        }
        const state: ScrollState = {
          lastUserScrollTs: 0,
          lastDataTs: now - 100,
          viewportYBefore: 500,
          viewportYAfter: 8, // Near top with threshold 10, not with default 3
          baseY: 510,
          currentTs: now
        }
        expect(isAnomalousScroll(state, customConfig)).toBe(true)
        expect(isAnomalousScroll(state, defaultConfig)).toBe(false)
      })
    })
  })
})
