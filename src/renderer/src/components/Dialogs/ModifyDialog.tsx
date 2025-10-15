import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import './ModifyDialog.css'

interface ModifyDialogProps {
  isOpen: boolean
  selectedText: string
  inputLabel?: string
  inputPlaceholder?: string
  onSubmit: (userInput: string) => void
  onCancel: () => void
}

export function ModifyDialog({
  isOpen,
  selectedText,
  inputLabel = 'How should this be modified?',
  inputPlaceholder = 'e.g., make more concise, add examples, use simpler language...',
  onSubmit,
  onCancel
}: ModifyDialogProps) {
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
    <div className="modify-dialog-overlay" onClick={handleBackdropClick}>
      <div className="modify-dialog">
        <div className="modify-dialog-header">
          <h3>{inputLabel}</h3>
        </div>

        <div className="modify-dialog-selected">
          <div className="modify-dialog-selected-label">Selected text:</div>
          <div className="modify-dialog-selected-content">"{truncatedText}"</div>
        </div>

        <div className="modify-dialog-input-section">
          <label className="modify-dialog-input-label">Your instructions:</label>
          <textarea
            ref={textareaRef}
            className="modify-dialog-input"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={inputPlaceholder}
            rows={6}
            maxLength={2000}
          />
          <div className="modify-dialog-char-count">
            {userInput.length}/2000 characters
          </div>
        </div>

        <div className="modify-dialog-actions">
          <div className="modify-dialog-info-wrapper">
            <div className="modify-dialog-info-icon">
              <Info size={16} strokeWidth={2} />
            </div>
            <div className="modify-dialog-tooltip">
              <div className="modify-dialog-tooltip-content">
                <kbd>Cmd/Ctrl+Enter</kbd> to submit
                <br />
                <kbd>Esc</kbd> to cancel
              </div>
            </div>
          </div>
          <button
            className="modify-dialog-btn modify-dialog-btn-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="modify-dialog-btn modify-dialog-btn-submit"
            onClick={handleSubmit}
            disabled={!isValid}
          >
            Apply Modification
          </button>
        </div>
      </div>
    </div>
  )

  // Render dialog at document root level for proper z-index stacking
  return createPortal(dialogContent, document.body)
}
