import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageCircle, X, Send, Info } from 'lucide-react'
import { executePromptTemplate } from '../../../utils/panelUtils'
import {
  validateMessage,
  formatCharCount,
  shouldSubmit,
  shouldClose,
  getValidationClass,
  buildFileRef,
  formatLineRange,
  CHAT_LIMITS
} from './chatBubble.logic'
import './ChatBubble.css'

interface ChatBubbleProps {
  mermaidCode: string
  filePath?: string
  startLine?: number
  endLine?: number
}

/**
 * ChatBubble - Floating chat input for AI diagram modifications
 *
 * Features:
 * - FAB button in bottom-right corner of DiagramViewer
 * - Click expands to slide-up panel with textarea
 * - Cmd/Ctrl+Enter to submit (matches PromptDialog pattern)
 * - Click outside or Escape to collapse (preserves draft)
 * - Auto-includes diagram context in prompt
 * - Character limit with warning at 1000, max at 2000
 */
export function ChatBubble({ mermaidCode, filePath, startLine, endLine }: ChatBubbleProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [message, setMessage] = useState('')
  const [showTooltip, setShowTooltip] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const validation = validateMessage(message)

  // Auto-focus textarea when expanded
  useEffect(() => {
    if (!isExpanded || !textareaRef.current) return

    // Small delay to ensure panel animation has started
    const timer = setTimeout(() => {
      textareaRef.current?.focus()
    }, 50)
    return () => clearTimeout(timer)
  }, [isExpanded])

  // Handle click outside to collapse
  useEffect(() => {
    if (!isExpanded) return

    const handleClickOutside = (e: MouseEvent) => {
      // Don't collapse if clicking inside the panel
      if (panelRef.current?.contains(e.target as Node)) return
      // Don't collapse if clicking the bubble button itself
      if ((e.target as HTMLElement).closest('.chat-bubble-btn')) return

      setIsExpanded(false)
    }

    // Add listener with delay to avoid immediate close from the expand click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 100)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isExpanded])

  const handleSubmit = useCallback(async () => {
    if (!validation.canSubmit || !filePath) return

    const trimmedMessage = message.trim()
    const fileRef = buildFileRef(filePath, startLine, endLine)
    const lineRange = formatLineRange(startLine, endLine)

    try {
      const success = await executePromptTemplate('diagram-chat', {
        selectedText: '',
        filePath,
        fullDocument: '',
        startLine,
        endLine,
        lineRange,
        fileRef,
        mermaidCode,
        userInstruction: trimmedMessage
      })

      // Only clear message on successful submit
      if (success) {
        setMessage('')
      }
    } catch (err) {
      console.error('Failed to send chat message:', err)
    }
  }, [message, validation.canSubmit, filePath, startLine, endLine, mermaidCode])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (shouldSubmit(e.key, e.ctrlKey, e.metaKey, e.shiftKey)) {
        e.preventDefault()
        handleSubmit()
      } else if (shouldClose(e.key)) {
        e.preventDefault()
        setIsExpanded(false)
      }
    },
    [handleSubmit]
  )

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    // Enforce max length at input level
    if (value.length <= CHAT_LIMITS.MAX_LENGTH) {
      setMessage(value)
    }
  }

  const handleBubbleClick = () => {
    setIsExpanded(true)
  }

  const handleCloseClick = () => {
    setIsExpanded(false)
  }

  // Don't render if no file context
  if (!filePath) return null

  return (
    <div className="chat-bubble-container">
      {/* Collapsed state: FAB button */}
      {!isExpanded && (
        <button
          className="chat-bubble-btn"
          onClick={handleBubbleClick}
          title="Chat about this diagram"
          aria-label="Open chat to modify diagram"
          aria-expanded={false}
        >
          <MessageCircle size={20} />
        </button>
      )}

      {/* Expanded state: Slide-up panel */}
      {isExpanded && (
        <div
          ref={panelRef}
          className="chat-panel"
          role="dialog"
          aria-modal="false"
          aria-label="Chat about diagram"
        >
          <div className="chat-panel-header">
            <span className="chat-panel-title">Modify Diagram</span>
            <button
              className="chat-panel-close"
              onClick={handleCloseClick}
              title="Close (Escape)"
              aria-label="Close chat panel"
            >
              <X size={16} />
            </button>
          </div>

          <div className="chat-panel-body">
            <textarea
              ref={textareaRef}
              className="chat-textarea"
              value={message}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="Describe changes to this diagram..."
              rows={3}
              maxLength={CHAT_LIMITS.MAX_LENGTH}
              aria-label="Your instruction for modifying the diagram"
            />

            <div className="chat-panel-footer">
              <div className="chat-footer-left">
                <span
                  className={`chat-char-count ${getValidationClass(validation.state)}`}
                >
                  {formatCharCount(validation.charCount)}
                </span>
                {validation.message && validation.state !== 'too-short' && (
                  <span className={`chat-validation-message ${getValidationClass(validation.state)}`}>
                    {validation.message}
                  </span>
                )}
              </div>

              <div className="chat-footer-right">
                {/* Info icon with tooltip */}
                <div className="chat-info-wrapper">
                  <button
                    type="button"
                    className="chat-info-icon"
                    aria-label="View keyboard shortcuts"
                    onFocus={() => setShowTooltip(true)}
                    onBlur={() => setShowTooltip(false)}
                    onMouseEnter={() => setShowTooltip(true)}
                    onMouseLeave={() => setShowTooltip(false)}
                  >
                    <Info size={14} />
                  </button>
                  <div
                    className={`chat-tooltip ${showTooltip ? 'visible' : ''}`}
                    role="tooltip"
                    aria-hidden={!showTooltip}
                  >
                    <div className="chat-tooltip-content">
                      <kbd>Cmd/Ctrl+Enter</kbd> to send
                      <br />
                      <kbd>Esc</kbd> to close
                    </div>
                  </div>
                </div>

                <button
                  className="chat-send-btn"
                  onClick={handleSubmit}
                  disabled={!validation.canSubmit}
                  title="Send (Cmd/Ctrl+Enter)"
                  aria-label="Send message"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
