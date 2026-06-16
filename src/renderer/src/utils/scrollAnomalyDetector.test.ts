// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
  detectClearSequences,
  hasDestructiveClearSequence,
  wasBufferTruncated,
  isRapidRedraw,
  calculateRecoveryTarget,
  DEFAULT_SCROLL_ANOMALY_CONFIG,
  type ScrollAnomalyConfig,
  type ScrollState,
  type EscapeSequenceSignals,
  type ReadingPosition
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

  // Issue #22 Enhanced: Escape sequence detection tests
  describe('detectClearSequences', () => {
    describe('ED 2 - screen clear (\\x1b[2J)', () => {
      it('detects screen clear sequence', () => {
        const result = detectClearSequences('\x1b[2J')
        expect(result.hasScreenClear).toBe(true)
        expect(result.hasScrollbackClear).toBe(false)
        expect(result.hasCursorHome).toBe(false)
      })

      it('detects screen clear embedded in other data', () => {
        const result = detectClearSequences('hello\x1b[2Jworld')
        expect(result.hasScreenClear).toBe(true)
      })

      it('does not false-positive on similar sequences', () => {
        const result = detectClearSequences('\x1b[1J') // ED 1 is different
        expect(result.hasScreenClear).toBe(false)
      })
    })

    describe('ED 3 - scrollback clear (\\x1b[3J)', () => {
      it('detects scrollback clear sequence', () => {
        const result = detectClearSequences('\x1b[3J')
        expect(result.hasScreenClear).toBe(false)
        expect(result.hasScrollbackClear).toBe(true)
        expect(result.hasCursorHome).toBe(false)
      })

      it('detects scrollback clear embedded in other data', () => {
        const result = detectClearSequences('prefix\x1b[3Jsuffix')
        expect(result.hasScrollbackClear).toBe(true)
      })
    })

    describe('cursor home (\\x1b[H and \\x1b[;H)', () => {
      it('detects cursor home sequence (\\x1b[H)', () => {
        const result = detectClearSequences('\x1b[H')
        expect(result.hasScreenClear).toBe(false)
        expect(result.hasScrollbackClear).toBe(false)
        expect(result.hasCursorHome).toBe(true)
      })

      it('detects cursor home with semicolon (\\x1b[;H)', () => {
        const result = detectClearSequences('\x1b[;H')
        expect(result.hasCursorHome).toBe(true)
      })

      it('does not false-positive on cursor position sequences', () => {
        // \x1b[10;20H is cursor position, not home
        const result = detectClearSequences('\x1b[10;20H')
        expect(result.hasCursorHome).toBe(false)
      })
    })

    describe('combined sequences (Ink library pattern)', () => {
      it('detects all three sequences together', () => {
        // Ink typically sends: clear screen + clear scrollback + cursor home
        const result = detectClearSequences('\x1b[2J\x1b[3J\x1b[H')
        expect(result.hasScreenClear).toBe(true)
        expect(result.hasScrollbackClear).toBe(true)
        expect(result.hasCursorHome).toBe(true)
      })

      it('detects sequences in different order', () => {
        const result = detectClearSequences('\x1b[H\x1b[3J\x1b[2J')
        expect(result.hasScreenClear).toBe(true)
        expect(result.hasScrollbackClear).toBe(true)
        expect(result.hasCursorHome).toBe(true)
      })

      it('handles mixed content and sequences', () => {
        const result = detectClearSequences('some text\x1b[2Jmore\x1b[3Jdata\x1b[H')
        expect(result.hasScreenClear).toBe(true)
        expect(result.hasScrollbackClear).toBe(true)
        expect(result.hasCursorHome).toBe(true)
      })
    })

    describe('negative cases', () => {
      it('returns all false for normal text', () => {
        const result = detectClearSequences('Hello, World!')
        expect(result.hasScreenClear).toBe(false)
        expect(result.hasScrollbackClear).toBe(false)
        expect(result.hasCursorHome).toBe(false)
      })

      it('returns all false for empty string', () => {
        const result = detectClearSequences('')
        expect(result.hasScreenClear).toBe(false)
        expect(result.hasScrollbackClear).toBe(false)
        expect(result.hasCursorHome).toBe(false)
      })

      it('does not false-positive on partial sequences', () => {
        const result = detectClearSequences('\x1b[2')
        expect(result.hasScreenClear).toBe(false)
      })

      it('handles other ANSI sequences correctly', () => {
        // Color sequences, cursor movement, etc.
        const result = detectClearSequences('\x1b[31m\x1b[1A\x1b[K')
        expect(result.hasScreenClear).toBe(false)
        expect(result.hasScrollbackClear).toBe(false)
        expect(result.hasCursorHome).toBe(false)
      })
    })
  })

  describe('hasDestructiveClearSequence', () => {
    it('returns true when screen clear is present', () => {
      const signals: EscapeSequenceSignals = {
        hasScreenClear: true,
        hasScrollbackClear: false,
        hasCursorHome: false
      }
      expect(hasDestructiveClearSequence(signals)).toBe(true)
    })

    it('returns true when scrollback clear is present', () => {
      const signals: EscapeSequenceSignals = {
        hasScreenClear: false,
        hasScrollbackClear: true,
        hasCursorHome: false
      }
      expect(hasDestructiveClearSequence(signals)).toBe(true)
    })

    it('returns true when both are present', () => {
      const signals: EscapeSequenceSignals = {
        hasScreenClear: true,
        hasScrollbackClear: true,
        hasCursorHome: true
      }
      expect(hasDestructiveClearSequence(signals)).toBe(true)
    })

    it('returns false when only cursor home is present', () => {
      const signals: EscapeSequenceSignals = {
        hasScreenClear: false,
        hasScrollbackClear: false,
        hasCursorHome: true
      }
      expect(hasDestructiveClearSequence(signals)).toBe(false)
    })

    it('returns false when nothing is present', () => {
      const signals: EscapeSequenceSignals = {
        hasScreenClear: false,
        hasScrollbackClear: false,
        hasCursorHome: false
      }
      expect(hasDestructiveClearSequence(signals)).toBe(false)
    })
  })

  describe('wasBufferTruncated', () => {
    it('returns true when buffer shrinks by threshold or more', () => {
      expect(wasBufferTruncated(100, 80, 10)).toBe(true) // 20 lines shrunk
      expect(wasBufferTruncated(100, 90, 10)).toBe(true) // exactly 10 lines
    })

    it('returns false when buffer shrinks less than threshold', () => {
      expect(wasBufferTruncated(100, 95, 10)).toBe(false) // only 5 lines
      expect(wasBufferTruncated(100, 91, 10)).toBe(false) // only 9 lines
    })

    it('returns false when buffer grows', () => {
      expect(wasBufferTruncated(100, 150, 10)).toBe(false) // grew
    })

    it('returns false when buffer stays same', () => {
      expect(wasBufferTruncated(100, 100, 10)).toBe(false)
    })

    it('uses default threshold of 10', () => {
      expect(wasBufferTruncated(100, 90)).toBe(true)
      expect(wasBufferTruncated(100, 91)).toBe(false)
    })

    it('handles zero values', () => {
      expect(wasBufferTruncated(0, 0, 10)).toBe(false)
      expect(wasBufferTruncated(10, 0, 10)).toBe(true)
    })

    it('handles large buffer sizes', () => {
      expect(wasBufferTruncated(10000, 5000, 10)).toBe(true)
      expect(wasBufferTruncated(10000, 9995, 10)).toBe(false)
    })
  })

  describe('isRapidRedraw', () => {
    const now = Date.now()

    it('returns true when threshold events occur within window', () => {
      const timestamps = [now - 50, now - 100, now - 150] // 3 events in last 200ms
      expect(isRapidRedraw(timestamps, now, 200, 3)).toBe(true)
    })

    it('returns false when fewer than threshold events', () => {
      const timestamps = [now - 50, now - 100] // only 2 events
      expect(isRapidRedraw(timestamps, now, 200, 3)).toBe(false)
    })

    it('returns false when events are outside window', () => {
      const timestamps = [now - 500, now - 600, now - 700] // all outside 200ms
      expect(isRapidRedraw(timestamps, now, 200, 3)).toBe(false)
    })

    it('filters to only recent events', () => {
      const timestamps = [now - 50, now - 100, now - 500, now - 600]
      // Only 2 are within 200ms, threshold is 3
      expect(isRapidRedraw(timestamps, now, 200, 3)).toBe(false)
    })

    it('uses default values', () => {
      const timestamps = [now - 50, now - 100, now - 150]
      expect(isRapidRedraw(timestamps, now)).toBe(true) // defaults: 200ms, 3
    })

    it('handles empty array', () => {
      expect(isRapidRedraw([], now, 200, 3)).toBe(false)
    })

    it('handles exact boundary', () => {
      const timestamps = [now - 199, now - 199, now - 199]
      expect(isRapidRedraw(timestamps, now, 200, 3)).toBe(true)

      const timestampsAtBoundary = [now - 200, now - 200, now - 200]
      expect(isRapidRedraw(timestampsAtBoundary, now, 200, 3)).toBe(false)
    })
  })

  describe('calculateRecoveryTarget', () => {
    it('returns null when no saved position', () => {
      expect(calculateRecoveryTarget(null, 100)).toBe(null)
    })

    it('returns null when user was at bottom', () => {
      const position: ReadingPosition = {
        viewportY: 100,
        baseY: 100,
        timestamp: Date.now()
      }
      expect(calculateRecoveryTarget(position, 150)).toBe(null)
    })

    it('returns null when user was near bottom (within 3 lines)', () => {
      const position: ReadingPosition = {
        viewportY: 97,
        baseY: 100,
        timestamp: Date.now()
      }
      expect(calculateRecoveryTarget(position, 150)).toBe(null)
    })

    it('calculates correct target for user reading back in history', () => {
      const position: ReadingPosition = {
        viewportY: 50,
        baseY: 100, // 50 lines from bottom
        timestamp: Date.now()
      }
      // New buffer has baseY 150
      // User was 50 lines from bottom, so target = 150 - 50 = 100
      expect(calculateRecoveryTarget(position, 150)).toBe(100)
    })

    it('clamps target to 0 when offset exceeds new buffer', () => {
      const position: ReadingPosition = {
        viewportY: 10,
        baseY: 100, // 90 lines from bottom
        timestamp: Date.now()
      }
      // New buffer has baseY 50 (smaller than offset)
      // Target would be 50 - 90 = -40, clamped to 0
      expect(calculateRecoveryTarget(position, 50)).toBe(0)
    })

    it('preserves relative position when buffer grows', () => {
      const position: ReadingPosition = {
        viewportY: 80,
        baseY: 100, // 20 lines from bottom
        timestamp: Date.now()
      }
      // Buffer grew from 100 to 200
      // User was 20 lines from bottom, so target = 200 - 20 = 180
      expect(calculateRecoveryTarget(position, 200)).toBe(180)
    })

    it('handles small buffer', () => {
      const position: ReadingPosition = {
        viewportY: 0,
        baseY: 10, // 10 lines from bottom
        timestamp: Date.now()
      }
      // New buffer has baseY 5
      // Target = 5 - 10 = -5, clamped to 0
      expect(calculateRecoveryTarget(position, 5)).toBe(0)
    })

    it('handles user at line 0 with large buffer', () => {
      const position: ReadingPosition = {
        viewportY: 0,
        baseY: 1000, // 1000 lines from bottom (at very top)
        timestamp: Date.now()
      }
      // New buffer has baseY 500
      // Target = 500 - 1000 = -500, clamped to 0
      expect(calculateRecoveryTarget(position, 500)).toBe(0)
    })
  })
})
