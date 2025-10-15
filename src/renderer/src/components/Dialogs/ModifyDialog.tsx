import { useState, useEffect, useRef } from 'react'
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
  console.log('🎨 ModifyDialog render, isOpen:', isOpen, 'selectedText length:', selectedText?.length)

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

  if (!isOpen) {
    console.log('⚠️ ModifyDialog returning null because isOpen is false')
    return null
  }

  console.log('✅ ModifyDialog rendering dialog UI')

  // Truncate selected text for preview
  const truncatedText = selectedText.length > 100
    ? `${selectedText.substring(0, 100)}...`
    : selectedText

  const isValid = userInput.trim().length >= 3 && userInput.trim().length <= 300

  return (
    <div className="modify-dialog-overlay" onClick={handleBackdropClick}>
      <div className="modify-dialog">
        <div className="modify-dialog-header">
          <h3>{inputLabel}</h3>
        </div>

        <div className="modify-dialog-selected">
          <div className="modify-dialog-selected-label">Selected text:</div>
          <div className="modify-dialog-selected-content">"{truncatedText}"</div>
        </div>

        <textarea
          ref={textareaRef}
          className="modify-dialog-input"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={inputPlaceholder}
          rows={4}
          maxLength={300}
        />

        <div className="modify-dialog-char-count">
          {userInput.length}/300 characters
        </div>

        <div className="modify-dialog-actions">
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
            Modify
          </button>
        </div>

        <div className="modify-dialog-hint">
          Press <kbd>Cmd/Ctrl+Enter</kbd> to submit • <kbd>Esc</kbd> to cancel
        </div>
      </div>
    </div>
  )
}
