// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import {
  validateMessage,
  formatCharCount,
  shouldSubmit,
  shouldClose,
  getValidationClass,
  buildFileRef,
  formatLineRange,
  clamp,
  getMaxPanelHeight,
  calculateResizedHeight,
  isAtMinHeight,
  isAtMaxHeight,
  CHAT_LIMITS,
  CHAT_PANEL_CONFIG
} from './chatBubble.logic'

describe('chatBubble.logic', () => {
  describe('CHAT_LIMITS', () => {
    it('should have correct limit values', () => {
      expect(CHAT_LIMITS.MIN_LENGTH).toBe(3)
      expect(CHAT_LIMITS.WARNING_THRESHOLD).toBe(1000)
      expect(CHAT_LIMITS.MAX_LENGTH).toBe(2000)
    })
  })

  describe('validateMessage', () => {
    describe('too-short state', () => {
      it('should return too-short for empty string', () => {
        const result = validateMessage('')
        expect(result.state).toBe('too-short')
        expect(result.isValid).toBe(false)
        expect(result.canSubmit).toBe(false)
        expect(result.message).toBe('Minimum 3 characters required')
        expect(result.charCount).toBe(0)
        expect(result.trimmedLength).toBe(0)
      })

      it('should return too-short for whitespace only', () => {
        const result = validateMessage('   ')
        expect(result.state).toBe('too-short')
        expect(result.isValid).toBe(false)
        expect(result.canSubmit).toBe(false)
        expect(result.trimmedLength).toBe(0)
      })

      it('should return too-short for 1 character', () => {
        const result = validateMessage('a')
        expect(result.state).toBe('too-short')
        expect(result.canSubmit).toBe(false)
        expect(result.trimmedLength).toBe(1)
      })

      it('should return too-short for 2 characters', () => {
        const result = validateMessage('ab')
        expect(result.state).toBe('too-short')
        expect(result.canSubmit).toBe(false)
        expect(result.trimmedLength).toBe(2)
      })

      it('should count trimmed length correctly', () => {
        const result = validateMessage('  a  ')
        expect(result.state).toBe('too-short')
        expect(result.charCount).toBe(5)
        expect(result.trimmedLength).toBe(1)
      })
    })

    describe('valid state', () => {
      it('should return valid for exactly 3 characters', () => {
        const result = validateMessage('abc')
        expect(result.state).toBe('valid')
        expect(result.isValid).toBe(true)
        expect(result.canSubmit).toBe(true)
        expect(result.message).toBe(null)
        expect(result.charCount).toBe(3)
        expect(result.trimmedLength).toBe(3)
      })

      it('should return valid for normal message', () => {
        const result = validateMessage('Add a new node to the diagram')
        expect(result.state).toBe('valid')
        expect(result.isValid).toBe(true)
        expect(result.canSubmit).toBe(true)
        expect(result.message).toBe(null)
      })

      it('should return valid for message at warning threshold', () => {
        const result = validateMessage('a'.repeat(1000))
        expect(result.state).toBe('valid')
        expect(result.isValid).toBe(true)
        expect(result.canSubmit).toBe(true)
      })
    })

    describe('warning state', () => {
      it('should return warning just above threshold', () => {
        const result = validateMessage('a'.repeat(1001))
        expect(result.state).toBe('warning')
        expect(result.isValid).toBe(true)
        expect(result.canSubmit).toBe(true)
        expect(result.message).toBe('999 characters remaining')
      })

      it('should return warning at 1500 chars', () => {
        const result = validateMessage('a'.repeat(1500))
        expect(result.state).toBe('warning')
        expect(result.isValid).toBe(true)
        expect(result.canSubmit).toBe(true)
        expect(result.message).toBe('500 characters remaining')
      })

      it('should return warning at max length', () => {
        const result = validateMessage('a'.repeat(2000))
        expect(result.state).toBe('warning')
        expect(result.isValid).toBe(true)
        expect(result.canSubmit).toBe(true)
        expect(result.message).toBe('0 characters remaining')
      })
    })

    describe('error state', () => {
      it('should return error when exceeding max length', () => {
        const result = validateMessage('a'.repeat(2001))
        expect(result.state).toBe('error')
        expect(result.isValid).toBe(false)
        expect(result.canSubmit).toBe(false)
        expect(result.message).toBe('Maximum 2000 characters exceeded')
      })

      it('should return error for very long message', () => {
        const result = validateMessage('a'.repeat(5000))
        expect(result.state).toBe('error')
        expect(result.isValid).toBe(false)
        expect(result.canSubmit).toBe(false)
      })
    })
  })

  describe('formatCharCount', () => {
    it('should format with default max length', () => {
      expect(formatCharCount(0)).toBe('0/2000')
      expect(formatCharCount(100)).toBe('100/2000')
      expect(formatCharCount(2000)).toBe('2000/2000')
    })

    it('should format with custom max length', () => {
      expect(formatCharCount(50, 100)).toBe('50/100')
      expect(formatCharCount(0, 500)).toBe('0/500')
    })
  })

  describe('shouldSubmit', () => {
    it('should return true for Cmd+Enter (Mac)', () => {
      expect(shouldSubmit('Enter', false, true, false)).toBe(true)
    })

    it('should return true for Ctrl+Enter (Windows/Linux)', () => {
      expect(shouldSubmit('Enter', true, false, false)).toBe(true)
    })

    it('should return false for Enter alone', () => {
      expect(shouldSubmit('Enter', false, false, false)).toBe(false)
    })

    it('should return false for Shift+Enter', () => {
      expect(shouldSubmit('Enter', false, false, true)).toBe(false)
    })

    it('should return false for Cmd+Shift+Enter', () => {
      expect(shouldSubmit('Enter', false, true, true)).toBe(false)
    })

    it('should return false for Ctrl+Shift+Enter', () => {
      expect(shouldSubmit('Enter', true, false, true)).toBe(false)
    })

    it('should return false for other keys with Cmd', () => {
      expect(shouldSubmit('a', false, true, false)).toBe(false)
      expect(shouldSubmit('Space', false, true, false)).toBe(false)
    })
  })

  describe('shouldClose', () => {
    it('should return true for Escape', () => {
      expect(shouldClose('Escape')).toBe(true)
    })

    it('should return false for other keys', () => {
      expect(shouldClose('Enter')).toBe(false)
      expect(shouldClose('Tab')).toBe(false)
      expect(shouldClose('a')).toBe(false)
    })
  })

  describe('getValidationClass', () => {
    it('should return correct class for each state', () => {
      expect(getValidationClass('valid')).toBe('')
      expect(getValidationClass('too-short')).toBe('chat-validation-hint')
      expect(getValidationClass('warning')).toBe('chat-validation-warning')
      expect(getValidationClass('error')).toBe('chat-validation-error')
    })
  })

  describe('buildFileRef', () => {
    it('should build ref with line range', () => {
      expect(buildFileRef('/path/to/file.md', 10, 15)).toBe('@/path/to/file.md:10-15')
    })

    it('should build ref with same start and end line', () => {
      expect(buildFileRef('/path/to/file.md', 10, 10)).toBe('@/path/to/file.md:10-10')
    })

    it('should build ref without line numbers', () => {
      expect(buildFileRef('/path/to/file.md')).toBe('@/path/to/file.md')
    })

    it('should build ref with only start line', () => {
      expect(buildFileRef('/path/to/file.md', 10)).toBe('@/path/to/file.md')
    })

    it('should build ref with only end line', () => {
      expect(buildFileRef('/path/to/file.md', undefined, 15)).toBe('@/path/to/file.md')
    })
  })

  describe('formatLineRange', () => {
    it('should format range for different start and end', () => {
      expect(formatLineRange(10, 15)).toBe('lines 10-15')
    })

    it('should format single line', () => {
      expect(formatLineRange(10, 10)).toBe('line 10')
    })

    it('should return undefined for missing start', () => {
      expect(formatLineRange(undefined, 15)).toBe(undefined)
    })

    it('should format single line when end is missing', () => {
      // When end line is missing, treat as single line (consistent with helpers.ts)
      expect(formatLineRange(10, undefined)).toBe('line 10')
    })

    it('should return undefined for both missing', () => {
      expect(formatLineRange(undefined, undefined)).toBe(undefined)
    })

    it('should format line 1', () => {
      expect(formatLineRange(1, 1)).toBe('line 1')
    })

    it('should format large line numbers', () => {
      expect(formatLineRange(100, 200)).toBe('lines 100-200')
    })
  })

  // ============================================================================
  // Panel resize logic tests (issue #36)
  // ============================================================================

  describe('CHAT_PANEL_CONFIG', () => {
    it('should have correct config values', () => {
      expect(CHAT_PANEL_CONFIG.DEFAULT_HEIGHT).toBe(450)
      expect(CHAT_PANEL_CONFIG.MIN_HEIGHT).toBe(200)
      expect(CHAT_PANEL_CONFIG.MAX_HEIGHT_RATIO).toBe(0.7)
      expect(CHAT_PANEL_CONFIG.MIN_TERMINAL_HEIGHT).toBe(100)
      expect(CHAT_PANEL_CONFIG.PANEL_WIDTH).toBe(640)
    })

    it('should have MIN_HEIGHT less than DEFAULT_HEIGHT', () => {
      expect(CHAT_PANEL_CONFIG.MIN_HEIGHT).toBeLessThan(CHAT_PANEL_CONFIG.DEFAULT_HEIGHT)
    })
  })

  describe('clamp', () => {
    it('should return value when within bounds', () => {
      expect(clamp(250, 200, 500)).toBe(250)
      expect(clamp(350, 200, 500)).toBe(350)
    })

    it('should return min when value is below min', () => {
      expect(clamp(100, 200, 500)).toBe(200)
      expect(clamp(0, 200, 500)).toBe(200)
      expect(clamp(-100, 200, 500)).toBe(200)
    })

    it('should return max when value is above max', () => {
      expect(clamp(600, 200, 500)).toBe(500)
      expect(clamp(1000, 200, 500)).toBe(500)
    })

    it('should return min when value equals min', () => {
      expect(clamp(200, 200, 500)).toBe(200)
    })

    it('should return max when value equals max', () => {
      expect(clamp(500, 200, 500)).toBe(500)
    })

    it('should handle edge case where min equals max', () => {
      expect(clamp(100, 300, 300)).toBe(300)
      expect(clamp(500, 300, 300)).toBe(300)
      expect(clamp(300, 300, 300)).toBe(300)
    })
  })

  describe('getMaxPanelHeight', () => {
    it('should calculate max height as 70% of viewport', () => {
      expect(getMaxPanelHeight(1000)).toBe(700)
      expect(getMaxPanelHeight(800)).toBe(560)
      expect(getMaxPanelHeight(600)).toBe(420)
    })

    it('should floor the result', () => {
      // 1001 * 0.7 = 700.7, should floor to 700
      expect(getMaxPanelHeight(1001)).toBe(700)
      // 999 * 0.7 = 699.3, should floor to 699
      expect(getMaxPanelHeight(999)).toBe(699)
    })

    it('should handle small viewport', () => {
      expect(getMaxPanelHeight(300)).toBe(210)
      expect(getMaxPanelHeight(100)).toBe(70)
    })

    it('should handle zero viewport', () => {
      expect(getMaxPanelHeight(0)).toBe(0)
    })
  })

  describe('calculateResizedHeight', () => {
    const viewportHeight = 1000 // max = 700

    it('should increase height when dragging up (negative deltaY)', () => {
      // Start at 350, drag up by 100 -> new height = 450
      expect(calculateResizedHeight(350, -100, viewportHeight)).toBe(450)
    })

    it('should decrease height when dragging down (positive deltaY)', () => {
      // Start at 350, drag down by 100 -> new height = 250
      expect(calculateResizedHeight(350, 100, viewportHeight)).toBe(250)
    })

    it('should clamp to min height', () => {
      // Start at 350, drag down by 200 -> would be 150, clamp to 200
      expect(calculateResizedHeight(350, 200, viewportHeight)).toBe(200)
      // Start at 250, drag down by 100 -> would be 150, clamp to 200
      expect(calculateResizedHeight(250, 100, viewportHeight)).toBe(200)
    })

    it('should clamp to max height (70% of viewport)', () => {
      // Max is 700 for viewport 1000
      // Start at 350, drag up by 400 -> would be 750, clamp to 700
      expect(calculateResizedHeight(350, -400, viewportHeight)).toBe(700)
      // Start at 600, drag up by 200 -> would be 800, clamp to 700
      expect(calculateResizedHeight(600, -200, viewportHeight)).toBe(700)
    })

    it('should work with small viewport', () => {
      // Viewport 400, max = 280
      // Start at 250, drag up by 50 -> would be 300, clamp to 280
      expect(calculateResizedHeight(250, -50, 400)).toBe(280)
    })

    it('should handle zero drag', () => {
      expect(calculateResizedHeight(350, 0, viewportHeight)).toBe(350)
    })

    it('should return min height when start height is below min', () => {
      // Start at 100 (below min), drag up by 50 -> would be 150, clamp to 200
      expect(calculateResizedHeight(100, -50, viewportHeight)).toBe(200)
    })
  })

  describe('isAtMinHeight', () => {
    it('should return true when height equals min', () => {
      expect(isAtMinHeight(200)).toBe(true)
    })

    it('should return true when height is below min', () => {
      expect(isAtMinHeight(150)).toBe(true)
      expect(isAtMinHeight(0)).toBe(true)
    })

    it('should return false when height is above min', () => {
      expect(isAtMinHeight(201)).toBe(false)
      expect(isAtMinHeight(350)).toBe(false)
      expect(isAtMinHeight(700)).toBe(false)
    })
  })

  describe('isAtMaxHeight', () => {
    it('should return true when height equals max', () => {
      // Viewport 1000, max = 700
      expect(isAtMaxHeight(700, 1000)).toBe(true)
    })

    it('should return true when height is above max', () => {
      expect(isAtMaxHeight(750, 1000)).toBe(true)
      expect(isAtMaxHeight(1000, 1000)).toBe(true)
    })

    it('should return false when height is below max', () => {
      expect(isAtMaxHeight(699, 1000)).toBe(false)
      expect(isAtMaxHeight(350, 1000)).toBe(false)
      expect(isAtMaxHeight(200, 1000)).toBe(false)
    })

    it('should work with different viewport sizes', () => {
      // Viewport 800, max = 560
      expect(isAtMaxHeight(560, 800)).toBe(true)
      expect(isAtMaxHeight(559, 800)).toBe(false)
      // Viewport 600, max = 420
      expect(isAtMaxHeight(420, 600)).toBe(true)
      expect(isAtMaxHeight(419, 600)).toBe(false)
    })
  })
})
