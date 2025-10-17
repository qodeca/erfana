import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import './UserInputDialog.css'

interface UserInputDialogProps {
  isOpen: boolean
  selectedText: string
  inputLabel?: string
  inputPlaceholder?: string
  onSubmit: (userInput: string) => void
  onCancel: () => void
}

export function UserInputDialog({
  isOpen,
  selectedText,
  inputLabel = 'What would you like to do?',
  inputPlaceholder = 'Enter your instructions or question here...',
  onSubmit,
  onCancel
}: UserInputDialogProps) {
  const [userInput, setUserInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-focus textarea when dialog opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isOpen])

  // Reset input when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setUserInput('')
    }
  }, [isOpen])

  const handleSubmit = () => {
    const trimmedInput = userInput.trim()
    if (trimmedInput) {
      onSubmit(trimmedInput)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onCancel()
    }
  }

  if (!isOpen) return null

  // Truncate selected text for preview (showing source markdown)
  const truncatedText = selectedText.length > 500
    ? `${selectedText.substring(0, 500)}...`
    : selectedText

  const isValid = userInput.trim().length >= 3 && userInput.trim().length <= 2000

  const dialogContent = (
    <div className="user-input-dialog-overlay" onClick={handleBackdropClick}>
      <div className="user-input-dialog">
        <div className="user-input-dialog-header">
          <h3>{inputLabel}</h3>
        </div>

        <div className="user-input-dialog-selected">
          <div className="user-input-dialog-selected-label">Selected text:</div>
          <div className="user-input-dialog-selected-content">&quot;{truncatedText}&quot;</div>
        </div>

        <div className="user-input-dialog-input-section">
          <label className="user-input-dialog-input-label">Your input:</label>
          <textarea
            ref={textareaRef}
            className="user-input-dialog-input"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={inputPlaceholder}
            rows={6}
            maxLength={2000}
          />
          <div className="user-input-dialog-char-count">
            {userInput.length}/2000 characters
          </div>
        </div>

        <div className="user-input-dialog-actions">
          <div className="user-input-dialog-info-wrapper">
            <div className="user-input-dialog-info-icon">
              <Info size={16} strokeWidth={2} />
            </div>
            <div className="user-input-dialog-tooltip">
              <div className="user-input-dialog-tooltip-content">
                <kbd>Cmd/Ctrl+Enter</kbd> to submit
                <br />
                <kbd>Esc</kbd> to cancel
              </div>
            </div>
          </div>
          <button
            className="user-input-dialog-btn user-input-dialog-btn-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="user-input-dialog-btn user-input-dialog-btn-submit"
            onClick={handleSubmit}
            disabled={!isValid}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  )

  // Render dialog at document root level for proper z-index stacking
  return createPortal(dialogContent, document.body)
}
