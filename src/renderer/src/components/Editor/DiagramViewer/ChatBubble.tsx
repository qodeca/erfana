import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageCircle, X, Send, Info } from 'lucide-react'
import { executePromptTemplate } from '../../../utils/panelUtils'
import { useTerminalPortalOptional } from '../../../context/TerminalPortalContext'
import { useDiagramViewerStore } from '../../../stores/useDiagramViewerStore'
import {
  validateMessage,
  formatCharCount,
  shouldSubmit,
  shouldClose,
  getValidationClass,
  buildFileRef,
  formatLineRange,
  calculateResizedHeight,
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
 * - Click expands to slide-up panel with terminal + textarea
 * - Terminal is always visible when panel is expanded
 * - Panel height resizable by dragging top edge
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
  const terminalContainerRef = useRef<HTMLDivElement>(null)

  // Resize state
  const isResizing = useRef(false)
  const resizeStartY = useRef(0)
  const resizeStartHeight = useRef(0)

  // Get panel height from store
  const { chatPanelHeight, setChatPanelHeight } = useDiagramViewerStore()

  // Portal context for terminal integration
  const portalContext = useTerminalPortalOptional()

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

  // Portal management: move terminal into chat panel when expanded
  useEffect(() => {
    if (!portalContext || !isExpanded || !terminalContainerRef.current) return

    portalContext.setPortalTarget('diagram-viewer')
    portalContext.requestRefit()

    return () => {
      portalContext.returnToMain()
      portalContext.requestRefit()
    }
  }, [isExpanded, portalContext])

  // Request terminal refit when panel height changes
  useEffect(() => {
    if (portalContext && isExpanded) {
      portalContext.requestRefit()
    }
  }, [chatPanelHeight, portalContext, isExpanded])

  // Resize handle mouse down
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    resizeStartY.current = e.clientY
    resizeStartHeight.current = chatPanelHeight
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  }, [chatPanelHeight])

  // Resize mouse move/up handlers
  useEffect(() => {
    if (!isExpanded) return

    const handleResizeMove = (e: MouseEvent) => {
      if (!isResizing.current) return

      const deltaY = e.clientY - resizeStartY.current
      const viewportHeight = window.innerHeight
      const newHeight = calculateResizedHeight(resizeStartHeight.current, deltaY, viewportHeight)
      setChatPanelHeight(newHeight)
    }

    const handleResizeEnd = () => {
      if (isResizing.current) {
        isResizing.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }

    document.addEventListener('mousemove', handleResizeMove)
    document.addEventListener('mouseup', handleResizeEnd)

    return () => {
      document.removeEventListener('mousemove', handleResizeMove)
      document.removeEventListener('mouseup', handleResizeEnd)
    }
  }, [isExpanded, setChatPanelHeight])

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

      {/* Expanded state: Slide-up panel with terminal */}
      {isExpanded && (
        <div
          ref={panelRef}
          className="chat-panel"
          role="dialog"
          aria-modal="false"
          aria-label="Chat about diagram"
          style={{ height: chatPanelHeight }}
        >
          {/* Header - also serves as resize handle */}
          <div
            className="chat-panel-header chat-panel-resize-handle"
            onMouseDown={handleResizeStart}
          >
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
            {/* Terminal container - portal target */}
            <div
              ref={(el) => {
                // Store ref locally
                (terminalContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
                // Also set the portal context ref
                if (portalContext?.diagramViewerContainerRef) {
                  (portalContext.diagramViewerContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
                }
              }}
              className="chat-terminal-container"
            />

            {/* Textarea section */}
            <div className="chat-input-section">
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
        </div>
      )}
    </div>
  )
}
