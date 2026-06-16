// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Text Input Validation Utilities
 *
 * Tests character limit validation for AI prompt inputs
 * including edge cases for trimmed/raw length semantics.
 */

import { describe, it, expect } from 'vitest'
import {
  validateTextInput,
  formatCharCount,
  getValidationStateClass,
  type TextInputValidationState
} from './textInputValidation'
import { TEXT_INPUT_LIMITS } from '../../../shared/constants'

describe('textInputValidation', () => {
  describe('validateTextInput', () => {
    describe('too-short state (minimum length)', () => {
      it('should return too-short for empty string', () => {
        const result = validateTextInput('')
        expect(result.state).toBe('too-short')
        expect(result.isValid).toBe(false)
        expect(result.canSubmit).toBe(false)
        expect(result.message).toBe('Minimum 3 characters required')
        expect(result.charCount).toBe(0)
        expect(result.trimmedLength).toBe(0)
      })

      it('should return too-short for whitespace-only input', () => {
        const result = validateTextInput('   ')
        expect(result.state).toBe('too-short')
        expect(result.isValid).toBe(false)
        expect(result.trimmedLength).toBe(0)
        expect(result.charCount).toBe(3) // Raw length includes spaces
      })

      it('should return too-short for only newlines', () => {
        const result = validateTextInput('\n\n\n')
        expect(result.state).toBe('too-short')
        expect(result.trimmedLength).toBe(0)
      })

      it('should return too-short for input below minLength', () => {
        const result = validateTextInput('ab')
        expect(result.state).toBe('too-short')
        expect(result.isValid).toBe(false)
        expect(result.message).toBe('Minimum 3 characters required')
      })

      it('should use custom minLength', () => {
        const result = validateTextInput('ab', { minLength: 5 })
        expect(result.state).toBe('too-short')
        expect(result.message).toBe('Minimum 5 characters required')
      })

      it('should return valid for exactly minLength chars', () => {
        const result = validateTextInput('abc')
        expect(result.state).toBe('valid')
        expect(result.isValid).toBe(true)
        expect(result.canSubmit).toBe(true)
      })

      it('should use trimmed length for min check (spaces around valid text)', () => {
        const result = validateTextInput('  ab  ') // trimmed = 'ab' (2 chars)
        expect(result.state).toBe('too-short')
        expect(result.trimmedLength).toBe(2)
        expect(result.charCount).toBe(6) // Raw includes spaces
      })
    })

    describe('error state (maximum length)', () => {
      it('should return warning at exactly max length (above threshold)', () => {
        const result = validateTextInput('a'.repeat(2000))
        expect(result.state).toBe('warning') // Above warning threshold, at max
        expect(result.isValid).toBe(true)
        expect(result.canSubmit).toBe(true)
        expect(result.charCount).toBe(2000)
        expect(result.message).toBe('0 characters remaining')
      })

      it('should return error one over max length', () => {
        const result = validateTextInput('a'.repeat(2001))
        expect(result.state).toBe('error')
        expect(result.isValid).toBe(false)
        expect(result.canSubmit).toBe(false)
        expect(result.message).toBe('Maximum 2000 characters exceeded')
      })

      it('should use custom maxLength', () => {
        const result = validateTextInput('a'.repeat(101), { maxLength: 100 })
        expect(result.state).toBe('error')
        expect(result.message).toBe('Maximum 100 characters exceeded')
      })

      it('should use raw length for max check (not trimmed)', () => {
        // 1998 chars + 2 trailing spaces = 2000 raw, but trimmed = 1998
        const result = validateTextInput('a'.repeat(1998) + '  ')
        expect(result.state).toBe('warning') // Raw = 2000, above warning threshold
        expect(result.canSubmit).toBe(true) // But still submittable
        expect(result.charCount).toBe(2000)
        expect(result.trimmedLength).toBe(1998)
      })

      it('should error when raw exceeds max even if trimmed is under', () => {
        // 1999 chars + 3 trailing spaces = 2002 raw
        const result = validateTextInput('a'.repeat(1999) + '   ')
        expect(result.state).toBe('error')
        expect(result.charCount).toBe(2002)
        expect(result.trimmedLength).toBe(1999)
      })
    })

    describe('warning state (approaching limit)', () => {
      it('should return warning just over threshold', () => {
        const result = validateTextInput('a'.repeat(1001))
        expect(result.state).toBe('warning')
        expect(result.isValid).toBe(true)
        expect(result.canSubmit).toBe(true)
        expect(result.message).toBe('999 characters remaining')
      })

      it('should return valid at exactly threshold', () => {
        const result = validateTextInput('a'.repeat(1000))
        expect(result.state).toBe('valid')
        expect(result.message).toBe(null)
      })

      it('should show correct remaining count at 1500 chars', () => {
        const result = validateTextInput('a'.repeat(1500))
        expect(result.state).toBe('warning')
        expect(result.message).toBe('500 characters remaining')
      })

      it('should show correct remaining count at 1999 chars', () => {
        const result = validateTextInput('a'.repeat(1999))
        expect(result.state).toBe('warning')
        expect(result.message).toBe('1 characters remaining')
      })

      it('should use custom warningThreshold', () => {
        const result = validateTextInput('a'.repeat(51), {
          warningThreshold: 50,
          maxLength: 100
        })
        expect(result.state).toBe('warning')
        expect(result.message).toBe('49 characters remaining')
      })
    })

    describe('custom validation', () => {
      it('should pass when custom validation returns true', () => {
        const result = validateTextInput('test', {
          customValidation: () => true
        })
        expect(result.state).toBe('valid')
        expect(result.isValid).toBe(true)
      })

      it('should fail when custom validation returns false', () => {
        const result = validateTextInput('test', {
          customValidation: () => false
        })
        expect(result.state).toBe('error')
        expect(result.isValid).toBe(false)
        expect(result.message).toBe('Invalid input')
      })

      it('should use custom error message from validation', () => {
        const result = validateTextInput('test', {
          customValidation: () => 'Must contain a number'
        })
        expect(result.state).toBe('error')
        expect(result.message).toBe('Must contain a number')
      })

      it('should receive trimmed value in custom validation', () => {
        let receivedValue: string | undefined
        validateTextInput('  test  ', {
          customValidation: (value) => {
            receivedValue = value
            return true
          }
        })
        expect(receivedValue).toBe('test')
      })

      it('should run custom validation after min/max checks pass', () => {
        let validationRan = false
        const result = validateTextInput('ab', {
          customValidation: () => {
            validationRan = true
            return true
          }
        })
        // Should fail min check before running custom validation
        expect(result.state).toBe('too-short')
        expect(validationRan).toBe(false)
      })
    })

    describe('edge cases', () => {
      it('should handle unicode characters (emoji)', () => {
        // 😀 is 2 UTF-16 code units
        const result = validateTextInput('😀😀')
        expect(result.charCount).toBe(4) // 2 emoji × 2 code units
        expect(result.trimmedLength).toBe(4)
      })

      it('should handle mixed content with unicode', () => {
        const result = validateTextInput('Hi 😀')
        expect(result.charCount).toBe(5) // 'Hi ' (3) + emoji (2)
        expect(result.state).toBe('valid')
      })

      it('should return all properties consistently', () => {
        const result = validateTextInput('test')
        expect(result).toHaveProperty('state')
        expect(result).toHaveProperty('isValid')
        expect(result).toHaveProperty('canSubmit')
        expect(result).toHaveProperty('message')
        expect(result).toHaveProperty('charCount')
        expect(result).toHaveProperty('trimmedLength')
      })
    })
  })

  describe('formatCharCount', () => {
    it('should format zero chars', () => {
      expect(formatCharCount(0)).toBe('0/2000')
    })

    it('should format mid-range chars', () => {
      expect(formatCharCount(100)).toBe('100/2000')
    })

    it('should format at max', () => {
      expect(formatCharCount(2000)).toBe('2000/2000')
    })

    it('should format over max', () => {
      expect(formatCharCount(2500)).toBe('2500/2000')
    })

    it('should use custom maxLength', () => {
      expect(formatCharCount(50, 100)).toBe('50/100')
    })

    it('should use default maxLength from TEXT_INPUT_LIMITS', () => {
      expect(formatCharCount(500)).toBe(`500/${TEXT_INPUT_LIMITS.MAX_LENGTH}`)
    })
  })

  describe('getValidationStateClass', () => {
    it('should return empty string for valid', () => {
      expect(getValidationStateClass('valid')).toBe('')
    })

    it('should return hint for too-short', () => {
      expect(getValidationStateClass('too-short')).toBe('hint')
    })

    it('should return warning for warning', () => {
      expect(getValidationStateClass('warning')).toBe('warning')
    })

    it('should return error for error', () => {
      expect(getValidationStateClass('error')).toBe('error')
    })

    it('should handle all states', () => {
      const states: TextInputValidationState[] = ['valid', 'too-short', 'warning', 'error']
      states.forEach(state => {
        expect(() => getValidationStateClass(state)).not.toThrow()
      })
    })
  })

  describe('constants integration', () => {
    it('should use TEXT_INPUT_LIMITS.MIN_LENGTH by default', () => {
      const result = validateTextInput('ab')
      expect(result.state).toBe('too-short')
      expect(result.message).toContain(String(TEXT_INPUT_LIMITS.MIN_LENGTH))
    })

    it('should use TEXT_INPUT_LIMITS.MAX_LENGTH by default', () => {
      const result = validateTextInput('a'.repeat(TEXT_INPUT_LIMITS.MAX_LENGTH + 1))
      expect(result.state).toBe('error')
      expect(result.message).toContain(String(TEXT_INPUT_LIMITS.MAX_LENGTH))
    })

    it('should use TEXT_INPUT_LIMITS.WARNING_THRESHOLD by default', () => {
      const result = validateTextInput('a'.repeat(TEXT_INPUT_LIMITS.WARNING_THRESHOLD + 1))
      expect(result.state).toBe('warning')
    })
  })
})
