import { describe, it, expect } from 'vitest'
import {
  validateMessage,
  formatCharCount,
  shouldSubmit,
  shouldClose,
  getValidationClass,
  buildFileRef,
  formatLineRange,
  CHAT_LIMITS
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

    it('should return undefined for missing end', () => {
      expect(formatLineRange(10, undefined)).toBe(undefined)
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
})
