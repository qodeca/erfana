import { useState, useRef, useEffect } from 'react'
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
 * - Text input with validation
 * - Character count
 * - Min/max length enforcement
 * - Custom validation function
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
    inputLabel = 'Your input:',
    inputPlaceholder = '',
    defaultValue = '',
    maxLength = 2000,
    minLength = 3,
    validation
  } = config

  const [inputValue, setInputValue] = useState(defaultValue)
  const [validationError, setValidationError] = useState<string | null>(null)
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

  // Validate default value on mount if provided
  useEffect(() => {
    if (defaultValue && defaultValue.trim().length > 0) {
      validateInput(defaultValue)
    }
  }, []) // Only run on mount

  // Validate input
  const validateInput = (value: string): boolean => {
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
  }

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

  return (
    <BaseDialog
      isOpen={true}
      onClose={handleCancel}
      zIndex={zIndex}
      closeOnBackdrop={true}
      closeOnEscape={true}
      ariaLabelledBy={titleId}
      ariaDescribedBy={messageId}
    >
      <div>
        <div className="dialog-header">
          <h3 id={titleId} className="dialog-title">{title}</h3>
        </div>

        <div className="dialog-body">
          <p id={messageId} className="dialog-message">{message}</p>

          <div style={{ marginTop: '20px' }}>
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

        {/* Keyboard hint */}
        <div className="dialog-keyboard-hint">
          <kbd>Cmd/Ctrl+Enter</kbd> to submit, <kbd>Esc</kbd> to cancel
        </div>
      </div>
    </BaseDialog>
  )
}
