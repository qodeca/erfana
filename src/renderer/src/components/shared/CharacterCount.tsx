// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * CharacterCount - Shared character count display component
 *
 * Used in PromptDialog and ChatBubble for consistent styling.
 * Shows "X/Y characters" with validation state coloring.
 */

import { formatCharCount, getValidationStateClass, type TextInputValidationState } from '../../utils/textInputValidation'
import { TEXT_INPUT_LIMITS } from '../../../../shared/constants'
import './CharacterCount.css'

interface CharacterCountProps {
  /** Current character count */
  charCount: number
  /** Maximum allowed characters (default: TEXT_INPUT_LIMITS.MAX_LENGTH) */
  maxLength?: number
  /** Validation state for color styling */
  validationState?: TextInputValidationState
  /** Additional CSS class */
  className?: string
  /** Test ID for automated testing */
  'data-testid'?: string
}

/**
 * Displays character count with validation state coloring
 *
 * @example
 * ```tsx
 * <CharacterCount
 *   charCount={42}
 *   validationState="warning"
 * />
 * // Renders: "42/2000 characters" in warning color
 * ```
 */
export function CharacterCount({
  charCount,
  maxLength = TEXT_INPUT_LIMITS.MAX_LENGTH,
  validationState = 'valid',
  className = '',
  'data-testid': testId
}: CharacterCountProps) {
  const stateClass = getValidationStateClass(validationState)

  return (
    <span
      className={`char-count ${stateClass ? `char-count--${stateClass}` : ''} ${className}`.trim()}
      data-testid={testId}
    >
      {formatCharCount(charCount, maxLength)} characters
    </span>
  )
}
