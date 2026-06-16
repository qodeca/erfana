// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Text Input Validation Utilities
 *
 * Provides consistent character limit validation for AI prompt inputs
 * across PromptDialog and ChatBubble components.
 *
 * Key semantics:
 * - Minimum length uses TRIMMED length (whitespace-only doesn't count)
 * - Maximum length uses RAW length (matches HTML maxLength attribute)
 * - Warning threshold uses RAW length (visual feedback before limit)
 */

import { TEXT_INPUT_LIMITS } from '../../../shared/constants'

export type TextInputValidationState = 'valid' | 'too-short' | 'warning' | 'error'

export interface TextInputValidationResult {
  /** Current validation state */
  state: TextInputValidationState
  /** Whether input meets minimum requirements (trimmed length >= minLength) */
  isValid: boolean
  /** Whether form can be submitted (valid or warning state) */
  canSubmit: boolean
  /** User-facing validation message (null if valid with no warning) */
  message: string | null
  /** Raw character count (not trimmed) */
  charCount: number
  /** Trimmed character count */
  trimmedLength: number
}

export interface TextInputValidationOptions {
  /** Minimum characters (trimmed). Default: TEXT_INPUT_LIMITS.MIN_LENGTH */
  minLength?: number
  /** Maximum characters (raw). Default: TEXT_INPUT_LIMITS.MAX_LENGTH */
  maxLength?: number
  /** Character count at which warning appears. Default: TEXT_INPUT_LIMITS.WARNING_THRESHOLD */
  warningThreshold?: number
  /** Custom validation function. Return true or error message string. */
  customValidation?: (value: string) => boolean | string
}

/**
 * Validate text input for AI prompt dialogs
 *
 * @param value - The raw input value
 * @param options - Validation options (defaults to TEXT_INPUT_LIMITS)
 * @returns Structured validation result
 *
 * @example
 * ```typescript
 * const result = validateTextInput('Hello world')
 * if (result.canSubmit) {
 *   // Safe to submit
 * }
 * ```
 */
export function validateTextInput(
  value: string,
  options: TextInputValidationOptions = {}
): TextInputValidationResult {
  const {
    minLength = TEXT_INPUT_LIMITS.MIN_LENGTH,
    maxLength = TEXT_INPUT_LIMITS.MAX_LENGTH,
    warningThreshold = TEXT_INPUT_LIMITS.WARNING_THRESHOLD,
    customValidation
  } = options

  const trimmedLength = value.trim().length
  const charCount = value.length

  // Check minimum (trimmed) - whitespace-only input doesn't count
  if (trimmedLength < minLength) {
    return {
      state: 'too-short',
      isValid: false,
      canSubmit: false,
      message: `Minimum ${minLength} characters required`,
      charCount,
      trimmedLength
    }
  }

  // Check maximum (raw) - matches HTML maxLength behavior
  if (charCount > maxLength) {
    return {
      state: 'error',
      isValid: false,
      canSubmit: false,
      message: `Maximum ${maxLength} characters exceeded`,
      charCount,
      trimmedLength
    }
  }

  // Custom validation (if provided) - receives trimmed value
  if (customValidation) {
    const result = customValidation(value.trim())
    if (result !== true) {
      return {
        state: 'error',
        isValid: false,
        canSubmit: false,
        message: typeof result === 'string' ? result : 'Invalid input',
        charCount,
        trimmedLength
      }
    }
  }

  // Check warning threshold (raw) - user is approaching limit
  if (charCount > warningThreshold) {
    return {
      state: 'warning',
      isValid: true,
      canSubmit: true,
      message: `${maxLength - charCount} characters remaining`,
      charCount,
      trimmedLength
    }
  }

  // Valid - no issues
  return {
    state: 'valid',
    isValid: true,
    canSubmit: true,
    message: null,
    charCount,
    trimmedLength
  }
}

/**
 * Format character count for display
 *
 * @param charCount - Current character count (raw, not trimmed)
 * @param maxLength - Maximum allowed length
 * @returns Formatted string like "42/2000"
 */
export function formatCharCount(
  charCount: number,
  maxLength: number = TEXT_INPUT_LIMITS.MAX_LENGTH
): string {
  return `${charCount}/${maxLength}`
}

/**
 * Get CSS class suffix for validation state
 *
 * @param state - Current validation state
 * @returns CSS class suffix (empty string for 'valid')
 *
 * @example
 * ```typescript
 * const suffix = getValidationStateClass('warning')
 * // Use as: `dialog-char-count--${suffix}` or `chat-validation-${suffix}`
 * ```
 */
export function getValidationStateClass(state: TextInputValidationState): string {
  switch (state) {
    case 'too-short':
      return 'hint'
    case 'warning':
      return 'warning'
    case 'error':
      return 'error'
    default:
      return ''
  }
}
