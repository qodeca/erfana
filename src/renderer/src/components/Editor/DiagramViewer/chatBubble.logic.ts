/**
 * Pure logic functions for ChatBubble component
 * Handles validation, character counting, and message state
 */

import { formatLineRange as formatLineRangeHelper } from '../../../prompts/helpers'

export const CHAT_LIMITS = {
  MIN_LENGTH: 3,
  WARNING_THRESHOLD: 1000,
  MAX_LENGTH: 2000
} as const

export type ValidationState = 'valid' | 'too-short' | 'warning' | 'error'

export interface ValidationResult {
  state: ValidationState
  isValid: boolean
  canSubmit: boolean
  message: string | null
  charCount: number
  trimmedLength: number
}

/**
 * Validate chat message input
 * @param value - The input value to validate
 * @returns Validation result with state and messages
 */
export function validateMessage(value: string): ValidationResult {
  const trimmedLength = value.trim().length
  const charCount = value.length

  if (trimmedLength < CHAT_LIMITS.MIN_LENGTH) {
    return {
      state: 'too-short',
      isValid: false,
      canSubmit: false,
      message: `Minimum ${CHAT_LIMITS.MIN_LENGTH} characters required`,
      charCount,
      trimmedLength
    }
  }

  if (charCount > CHAT_LIMITS.MAX_LENGTH) {
    return {
      state: 'error',
      isValid: false,
      canSubmit: false,
      message: `Maximum ${CHAT_LIMITS.MAX_LENGTH} characters exceeded`,
      charCount,
      trimmedLength
    }
  }

  if (charCount > CHAT_LIMITS.WARNING_THRESHOLD) {
    return {
      state: 'warning',
      isValid: true,
      canSubmit: true,
      message: `${CHAT_LIMITS.MAX_LENGTH - charCount} characters remaining`,
      charCount,
      trimmedLength
    }
  }

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
 * Format character count display
 * @param charCount - Current character count
 * @param maxLength - Maximum allowed length
 * @returns Formatted string like "42/2000"
 */
export function formatCharCount(charCount: number, maxLength: number = CHAT_LIMITS.MAX_LENGTH): string {
  return `${charCount}/${maxLength}`
}

/**
 * Determine if keyboard event should trigger submit
 * @param key - The key pressed
 * @param ctrlKey - Whether Ctrl is pressed
 * @param metaKey - Whether Meta (Cmd) is pressed
 * @param shiftKey - Whether Shift is pressed
 * @returns true if submit should be triggered
 */
export function shouldSubmit(
  key: string,
  ctrlKey: boolean,
  metaKey: boolean,
  shiftKey: boolean
): boolean {
  // Cmd/Ctrl+Enter to submit (matches PromptDialog)
  return key === 'Enter' && (ctrlKey || metaKey) && !shiftKey
}

/**
 * Determine if keyboard event should close/collapse the panel
 * @param key - The key pressed
 * @returns true if panel should close
 */
export function shouldClose(key: string): boolean {
  return key === 'Escape'
}

/**
 * Get CSS class for validation state
 * @param state - Current validation state
 * @returns CSS class name
 */
export function getValidationClass(state: ValidationState): string {
  switch (state) {
    case 'too-short':
      return 'chat-validation-hint'
    case 'warning':
      return 'chat-validation-warning'
    case 'error':
      return 'chat-validation-error'
    default:
      return ''
  }
}

/**
 * Construct file reference for Claude
 * @param filePath - File path
 * @param startLine - Start line number
 * @param endLine - End line number
 * @returns File reference string like "@file:10-15"
 */
export function buildFileRef(
  filePath: string,
  startLine?: number,
  endLine?: number
): string {
  if (startLine && endLine) {
    return `@${filePath}:${startLine}-${endLine}`
  }
  return `@${filePath}`
}

/**
 * Format line range for display
 * Wrapper around prompts/helpers.formatLineRange that returns undefined for invalid input
 * @param startLine - Start line number
 * @param endLine - End line number
 * @returns Formatted string like "lines 10-15" or "line 10", or undefined if invalid
 */
export function formatLineRange(startLine?: number, endLine?: number): string | undefined {
  const result = formatLineRangeHelper(startLine, endLine)
  return result || undefined
}
