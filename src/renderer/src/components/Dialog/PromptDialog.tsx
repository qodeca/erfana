import { useState, useRef, useEffect, useCallback } from 'react'
import { Info, MessageSquare } from 'lucide-react'
import { BaseDialog } from './BaseDialog'
import type { PromptDialogConfig } from './types'

interface PromptDialogProps {
  config: PromptDialogConfig
  zIndex: number
  onSubmit: (value: string) => void
  onCancel: () => void
}

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
    maxLength = 2000,
    minLength = 3,
    validation
  } = config

  const [inputValue, setInputValue] = useState(defaultValue)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [showTooltip, setShowTooltip] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Generate unique IDs for ARIA attributes
  const titleId = `dialog-title-${id}`
  const messageId = `dialog-message-${id}`

  // Auto-focus textarea when dialog opens
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [])

  // Validate input - wrapped in useCallback for stable reference
  const validateInput = useCallback((value: string): boolean => {
    const trimmed = value.trim()

    // Check min length
    if (trimmed.length < minLength) {
      setValidationError(`Minimum ${minLength} characters required`)
      return false
    }

    // Check max length
    if (trimmed.length > maxLength) {
      setValidationError(`Maximum ${maxLength} characters allowed`)
      return false
    }

    // Custom validation
    if (validation) {
      const result = validation(trimmed)
      if (result === true) {
        setValidationError(null)
        return true
      } else if (typeof result === 'string') {
        setValidationError(result)
        return false
      } else {
        setValidationError('Invalid input')
        return false
      }
    }

    setValidationError(null)
    return true
  }, [minLength, maxLength, validation])

  // Validate default value on mount if provided
  useEffect(() => {
    if (defaultValue && defaultValue.trim().length > 0) {
      validateInput(defaultValue)
    }
  }, [defaultValue, validateInput])

  const handleSubmit = () => {
    const trimmed = inputValue.trim()
    if (validateInput(trimmed)) {
      onSubmit(trimmed)
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

  const trimmedLength = inputValue.trim().length
  const isValid = trimmedLength >= minLength && trimmedLength <= maxLength

  // Truncate very long selectedText to prevent performance issues
  // Max 10,000 characters for display (still scrollable up to this limit)
  const displayText = selectedText && selectedText.length > 10000
    ? selectedText.substring(0, 10000) + '\n\n... (text truncated for performance)'
    : selectedText

  return (
    <BaseDialog
      isOpen={true}
      onClose={handleCancel}
      zIndex={zIndex}
      closeOnBackdrop={false}
      closeOnEscape={true}
      ariaLabelledBy={titleId}
      ariaDescribedBy={messageId}
    >
      <div>
        <div className="dialog-header-with-icon">
          <div className="dialog-icon">
            <MessageSquare size={20} strokeWidth={2} />
          </div>
          <h3 id={titleId} className="dialog-title">{title}</h3>
        </div>

        <div className="dialog-body">
          {message && <p id={messageId} className="dialog-message">{message}</p>}

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

          <div className="dialog-input-section">
            <label className="dialog-input-label">{inputLabel}</label>
            <textarea
              ref={textareaRef}
              className="dialog-input"
              value={inputValue}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={inputPlaceholder}
              rows={6}
              maxLength={maxLength}
            />

            <div className="dialog-char-count">
              {trimmedLength}/{maxLength} characters
            </div>

            {validationError && (
              <div className="dialog-validation-error">
                {validationError}
              </div>
            )}
          </div>
        </div>

        <div className="dialog-actions">
          {/* Info icon with tooltip - keyboard accessible */}
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
          <button className="dialog-btn dialog-btn-secondary" onClick={handleCancel}>
            Cancel
          </button>
          <button
            className="dialog-btn dialog-btn-primary"
            onClick={handleSubmit}
            disabled={!isValid}
          >
            Submit
          </button>
        </div>
      </div>
    </BaseDialog>
  )
}
