// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Info, MessageSquare } from 'lucide-react'
import { BaseDialog } from './BaseDialog'
import { TextareaContextMenu } from '../ContextMenu/TextareaContextMenu'
import { CharacterCount } from '../shared'
import { validateTextInput } from '../../utils/textInputValidation'
import { useTextareaClipboard } from '../../hooks/useTextareaClipboard'
import { TEXT_INPUT_LIMITS } from '../../../../shared/constants'
import { TEST_IDS } from '../../constants/testids'
import type { PromptDialogConfig } from './types'

/**
 * Composite result returned when dropdown is present
 * Allows PreviewContextMenu to extract both values
 */
export interface PromptDialogResult {
  /** User's text input (may be empty if textareaOptional) */
  text: string
  /** Selected dropdown value (only present when dropdown is configured) */
  dropdown?: string
}

interface PromptDialogProps {
  config: PromptDialogConfig
  zIndex: number
  onSubmit: (value: string) => void
  onCancel: () => void
}

/**
 * Max characters of selected text rendered in the preview. Longer selections are
 * truncated (still scrollable up to this limit) to avoid layout/perf issues.
 */
const SELECTED_TEXT_DISPLAY_MAX = 10000

/**
 * PromptDialog - Input dialog with validation
 *
 * Features:
 * - MessageSquare icon for all text input prompts
 * - Text input with validation
 * - Character count
 * - Min/max length enforcement
 * - Custom validation function
 * - Selected text preview (for AI prompts)
 * - Keyboard shortcuts (Cmd/Ctrl+Enter to submit, Esc to cancel)
 * - Auto-focus input
 * - Promise-based API via useDialog()
 *
 * @example
 * ```typescript
 * const { showPrompt } = useDialog()
 * const value = await showPrompt({
 *   title: 'Enter Name',
 *   message: 'Please enter your name',
 *   inputPlaceholder: 'John Doe',
 *   validation: (v) => v.length >= 3 || 'Minimum 3 characters'
 * })
 * if (value) console.log(value)
 * ```
 */
export function PromptDialog({ config, zIndex, onSubmit, onCancel }: PromptDialogProps) {
  const {
    id,
    title,
    message,
    selectedText,
    inputLabel = 'Your input:',
    inputPlaceholder = '',
    defaultValue = '',
    maxLength = TEXT_INPUT_LIMITS.MAX_LENGTH,
    minLength = TEXT_INPUT_LIMITS.MIN_LENGTH,
    validation,
    dropdownOptions,
    dropdownLabel,
    defaultDropdownValue,
    textareaOptional = false
  } = config

  // Determine initial dropdown value: use provided default, or first option if available
  const initialDropdownValue = defaultDropdownValue
    || (dropdownOptions && dropdownOptions.length > 0 ? dropdownOptions[0].value : '')

  const [inputValue, setInputValue] = useState(defaultValue)
  const [dropdownValue, setDropdownValue] = useState(initialDropdownValue)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [showTooltip, setShowTooltip] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [hasSelection, setHasSelection] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Whether this dialog has a dropdown configured
  const hasDropdown = dropdownOptions && dropdownOptions.length > 0

  // Generate unique IDs for ARIA attributes
  const titleId = `dialog-title-${id}`
  const messageId = `dialog-message-${id}`

  // Auto-focus textarea when dialog opens
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [])

  // Effective minimum length: 0 when textarea is optional, otherwise use configured minLength
  const effectiveMinLength = textareaOptional ? 0 : minLength

  // Memoized validation result using shared validation utility
  const validationResult = useMemo(() => {
    return validateTextInput(inputValue, {
      minLength: effectiveMinLength,
      maxLength,
      warningThreshold: TEXT_INPUT_LIMITS.WARNING_THRESHOLD,
      customValidation: validation
    })
  }, [inputValue, effectiveMinLength, maxLength, validation])

  // Validate input for submit - updates validation error state
  const validateInput = useCallback((value: string): boolean => {
    const result = validateTextInput(value, {
      minLength: effectiveMinLength,
      maxLength,
      warningThreshold: TEXT_INPUT_LIMITS.WARNING_THRESHOLD,
      customValidation: validation
    })

    if (!result.canSubmit) {
      setValidationError(result.message)
      return false
    }

    setValidationError(null)
    return true
  }, [effectiveMinLength, maxLength, validation])

  // Validate default value on mount if provided
  useEffect(() => {
    if (defaultValue && defaultValue.trim().length > 0) {
      validateInput(defaultValue)
    }
  }, [defaultValue, validateInput])

  const handleSubmit = () => {
    const trimmed = inputValue.trim()
    if (validateInput(trimmed)) {
      // When dropdown is present, return JSON with both values
      // This allows PreviewContextMenu to extract dropdown and text separately
      if (hasDropdown) {
        const result: PromptDialogResult = {
          text: trimmed,
          dropdown: dropdownValue
        }
        onSubmit(JSON.stringify(result))
      } else {
        // Backward compatibility: return plain text for non-dropdown prompts
        onSubmit(trimmed)
      }
    }
  }

  const handleCancel = () => {
    onCancel()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancel()
    }
  }

  // Validate on input change
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInputValue(value)

    // Clear validation error when user types
    if (validationError) {
      setValidationError(null)
    }
  }

  // Track selection changes for context menu state
  const handleSelect = useCallback(() => {
    if (textareaRef.current) {
      const { selectionStart, selectionEnd } = textareaRef.current
      setHasSelection(selectionStart !== selectionEnd)
    }
  }, [])

  // Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
    handleSelect()
  }, [handleSelect])

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  // Clipboard operations via the central textClipboard service (issue #203).
  // maxLength reject stays a silent product rule (no toast); transport errors
  // are handled centrally by the service.
  const { handleCut, handleCopy, handlePaste } = useTextareaClipboard({
    textareaRef,
    value: inputValue,
    setValue: setInputValue,
    maxLength
  })

  // Use validation result for UI state
  const { charCount, canSubmit, state: validationState } = validationResult

  // Truncate very long selectedText to prevent performance issues.
  const displayText = selectedText && selectedText.length > SELECTED_TEXT_DISPLAY_MAX
    ? selectedText.substring(0, SELECTED_TEXT_DISPLAY_MAX) + '\n\n... (text truncated for performance)'
    : selectedText

  return (
    <BaseDialog
      isOpen={true}
      onClose={handleCancel}
      zIndex={zIndex}
      closeOnBackdrop={false}
      closeOnEscape={true}
      className="dialog-prompt"
      ariaLabelledBy={titleId}
      ariaDescribedBy={messageId}
    >
      <div data-testid={TEST_IDS.DIALOG_PROMPT}>
        <div className="dialog-header-with-icon">
          <div className="dialog-icon">
            <MessageSquare size={20} strokeWidth={2} />
          </div>
          <h3 id={titleId} className="dialog-title" data-testid={TEST_IDS.DIALOG_TITLE}>{title}</h3>
        </div>

        <div className="dialog-body">
          {message && <p id={messageId} className="dialog-message" data-testid={TEST_IDS.DIALOG_PROMPT_MESSAGE}>{message}</p>}

          {/* Selected text preview section */}
          {displayText && (
            <div
              className="dialog-selected-text"
              role="region"
              aria-label="Selected text preview"
            >
              <div className="dialog-selected-text-label" aria-hidden="true">
                Selected text:
              </div>
              {/* React automatically escapes displayText to prevent XSS */}
              <div className="dialog-selected-text-content">
                &quot;{displayText}&quot;
              </div>
            </div>
          )}

          {/* Dropdown section (when configured) */}
          {hasDropdown && (
            <div className="dialog-dropdown-section">
              <label
                htmlFor={`dialog-dropdown-${id}`}
                className="dialog-dropdown-label"
              >
                {dropdownLabel || 'Select an option:'}
              </label>
              <select
                id={`dialog-dropdown-${id}`}
                className="dialog-select"
                value={dropdownValue}
                onChange={(e) => setDropdownValue(e.target.value)}
                aria-label={dropdownLabel || 'Select an option'}
                data-testid={TEST_IDS.DIALOG_PROMPT_DROPDOWN}
              >
                {dropdownOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="dialog-input-section">
            <label className="dialog-input-label">
              {inputLabel}
              {textareaOptional && (
                <span style={{ fontWeight: 'normal', color: 'var(--color-text-muted)' }}>
                  {' '}(optional)
                </span>
              )}
            </label>
            <textarea
              ref={textareaRef}
              className="dialog-input"
              value={inputValue}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onContextMenu={handleContextMenu}
              onSelect={handleSelect}
              placeholder={inputPlaceholder}
              rows={6}
              maxLength={maxLength}
              data-testid={TEST_IDS.DIALOG_PROMPT_INPUT}
            />

            {/* Error message (exceeds limit or custom validation) */}
            {validationError && (
              <div className="dialog-validation-error">
                {validationError}
              </div>
            )}
          </div>
        </div>

        <div className="dialog-actions">
          {/* Info icon with tooltip - keyboard accessible */}
          <div className="dialog-actions-left">
            <div className="dialog-info-wrapper">
              <button
                type="button"
                className="dialog-info-icon"
                aria-label="View keyboard shortcuts"
                onFocus={() => setShowTooltip(true)}
                onBlur={() => setShowTooltip(false)}
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
              >
                <Info size={16} strokeWidth={2} />
              </button>
              <div
                className={`dialog-tooltip ${showTooltip ? 'visible' : ''}`}
                role="tooltip"
                aria-hidden={!showTooltip}
              >
                <div className="dialog-tooltip-content">
                  <kbd>Cmd/Ctrl+Enter</kbd> to submit
                  <br />
                  <kbd>Esc</kbd> to cancel
                </div>
              </div>
            </div>
            <CharacterCount
              charCount={charCount}
              maxLength={maxLength}
              validationState={validationState}
            />
          </div>
          <button className="dialog-btn dialog-btn-secondary" onClick={handleCancel} data-testid={TEST_IDS.DIALOG_BTN_CANCEL}>
            Cancel
          </button>
          <button
            className="dialog-btn dialog-btn-primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid={TEST_IDS.DIALOG_BTN_CONFIRM}
          >
            Submit
          </button>
        </div>
      </div>

      {/* Context menu for textarea clipboard operations */}
      {contextMenu && (
        <TextareaContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          hasSelection={hasSelection}
          onCut={handleCut}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onClose={handleCloseContextMenu}
        />
      )}
    </BaseDialog>
  )
}
