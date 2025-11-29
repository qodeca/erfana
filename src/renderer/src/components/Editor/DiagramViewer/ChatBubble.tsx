import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Pencil,
  Send,
  Info,
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCcw,
  ArrowDownToLine,
  RotateCw
} from 'lucide-react'
import { executePromptTemplate } from '../../../utils/panelUtils'
import { useTerminalPortalOptional } from '../../../context/TerminalPortalContext'
import { useDiagramViewerStore } from '../../../stores/useDiagramViewerStore'
import { formatLineRange } from '../../../prompts/helpers'
import {
  detectChartType,
  supportsDirection,
  getAvailableDirections,
  detectCurrentDirection,
  isDirectionDisabled,
  isDirectionActive,
  getDirectionTooltip,
  DIRECTION_LABELS
} from '../../../utils/mermaidDirections'
import {
  validateMessage,
  formatCharCount,
  shouldSubmit,
  shouldClose,
  getValidationClass,
  buildFileRef,
  formatLineRange as formatLineRangeChat,
  calculateResizedHeight,
  CHAT_LIMITS
} from './chatBubble.logic'
import { formatZoomLevel } from './diagramViewer.logic'
import { TextareaContextMenu } from '../../ContextMenu/TextareaContextMenu'
import { TerminalContextMenu } from '../../ContextMenu/TerminalContextMenu'
import './ChatBubble.css'

interface Transform {
  scale: number
  translateX: number
  translateY: number
}

interface ChatBubbleProps {
  mermaidCode: string
  filePath?: string
  startLine?: number
  endLine?: number
  // Zoom controls (issue #37)
  transform: Transform
  onZoomIn: () => void
  onZoomOut: () => void
  onFitToView: () => void
  onReset: () => void
  zoomInDisabled: boolean
  zoomOutDisabled: boolean
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
export function ChatBubble({
  mermaidCode,
  filePath,
  startLine,
  endLine,
  transform,
  onZoomIn,
  onZoomOut,
  onFitToView,
  onReset,
  zoomInDisabled,
  zoomOutDisabled
}: ChatBubbleProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [message, setMessage] = useState('')
  const [showTooltip, setShowTooltip] = useState(false)
  const [textareaContextMenu, setTextareaContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [terminalContextMenu, setTerminalContextMenu] = useState<{ x: number; y: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const terminalContainerRef = useRef<HTMLDivElement>(null)

  // Resize state
  const isResizing = useRef(false)
  const resizeStartY = useRef(0)
  const resizeStartHeight = useRef(0)

  // Get panel height from store
  const { chatPanelHeight, setChatPanelHeight } = useDiagramViewerStore()

  // Portal context for terminal integration and controls
  const portalContext = useTerminalPortalOptional()

  // Direction button state for supported diagrams
  const chartType = detectChartType(mermaidCode)
  const showDirectionButtons = supportsDirection(chartType)
  const availableDirections = getAvailableDirections(chartType)
  const currentDirection = detectCurrentDirection(mermaidCode, chartType)

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

  // Handle click outside to collapse panel
  useEffect(() => {
    if (!isExpanded) return

    const handleClickOutside = (e: MouseEvent) => {
      // Don't collapse if clicking inside the panel
      if (panelRef.current?.contains(e.target as Node)) return
      // Don't collapse if clicking the bubble button itself
      if ((e.target as HTMLElement).closest('.chat-bubble-btn')) return
      // Don't collapse if clicking inside the context menu (rendered in portal)
      if ((e.target as HTMLElement).closest('.context-menu')) return

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
    const lineRange = formatLineRangeChat(startLine, endLine)

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

  // Direction button click handler (issue #37 - moved from MermaidToolbar)
  const handleDirectionClick = useCallback(
    async (direction: string) => {
      if (!filePath) return

      try {
        const fileRef =
          startLine && endLine ? `@${filePath}:${startLine}-${endLine}` : `@${filePath}`
        const lineRange = formatLineRange(startLine, endLine) || undefined

        await executePromptTemplate('change-mermaid-direction', {
          selectedText: '',
          filePath,
          fullDocument: '',
          startLine,
          endLine,
          lineRange,
          fileRef,
          mermaidCode,
          targetDirection: direction,
          directionLabel: DIRECTION_LABELS[direction] || direction
        })
      } catch (err) {
        console.error('Failed to execute direction change prompt:', err)
      }
    },
    [filePath, startLine, endLine, mermaidCode]
  )

  // Terminal control handlers (issue #37)
  const handleScrollToBottom = useCallback(() => {
    portalContext?.terminalControls?.scrollToBottom()
  }, [portalContext])

  const handleRestartTerminal = useCallback(async () => {
    await portalContext?.terminalControls?.restart()
  }, [portalContext])

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

  // Context menu handlers for textarea copy/paste (issue #37)
  const handleTextareaContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setTextareaContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const handleCloseTextareaContextMenu = useCallback(() => {
    setTextareaContextMenu(null)
  }, [])

  // Context menu handlers for terminal copy/paste (issue #37)
  const handleTerminalContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setTerminalContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const handleCloseTerminalContextMenu = useCallback(() => {
    setTerminalContextMenu(null)
  }, [])

  const handleCutText = useCallback(async () => {
    if (!textareaRef.current) return
    const textarea = textareaRef.current
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = textarea.value.substring(start, end)

    if (selectedText) {
      // Copy to clipboard
      await navigator.clipboard.writeText(selectedText)
      // Remove selected text
      const newValue = message.substring(0, start) + message.substring(end)
      setMessage(newValue)
      // Set cursor position at cut location
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start
      }, 0)
    }
  }, [message])

  const handleCopyText = useCallback(async () => {
    if (!textareaRef.current) return
    const textarea = textareaRef.current
    const selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd)
    if (selectedText) {
      await navigator.clipboard.writeText(selectedText)
    }
  }, [])

  const handlePasteText = useCallback(async () => {
    if (!textareaRef.current) return
    const textarea = textareaRef.current
    const clipboardText = await navigator.clipboard.readText()
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const newValue = message.substring(0, start) + clipboardText + message.substring(end)
    if (newValue.length <= CHAT_LIMITS.MAX_LENGTH) {
      setMessage(newValue)
      // Set cursor position after paste
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + clipboardText.length
      }, 0)
    }
  }, [message])

  const hasTextSelection = useCallback(() => {
    if (!textareaRef.current) return false
    const textarea = textareaRef.current
    return textarea.selectionStart !== textarea.selectionEnd
  }, [])

  // Note: Panel closes via click-outside or Escape key (no header close button - issue #37)

  // Don't render if no file context
  if (!filePath) return null

  return (
    <div className="chat-bubble-container">
      {/* Collapsed state: FAB button */}
      {!isExpanded && (
        <button
          className="chat-bubble-btn"
          onClick={handleBubbleClick}
          title="Edit diagram"
          aria-label="Open panel to modify diagram"
          aria-expanded={false}
        >
          <Pencil size={20} />
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
          {/* Header - controls + resize handle (issue #37) */}
          <div
            className="chat-panel-header chat-panel-resize-handle"
            onMouseDown={handleResizeStart}
            role="toolbar"
            aria-label="Diagram controls"
          >
            {/* Zoom controls group */}
            <div className="chat-header-group chat-header-zoom" role="group" aria-label="Zoom controls">
              <button
                className="chat-header-btn"
                onClick={onZoomOut}
                disabled={zoomOutDisabled}
                title="Zoom out (-)"
                aria-label="Zoom out"
              >
                <ZoomOut size={14} />
              </button>
              <span className="chat-zoom-indicator" aria-live="polite">
                {formatZoomLevel(transform.scale)}
              </span>
              <button
                className="chat-header-btn"
                onClick={onZoomIn}
                disabled={zoomInDisabled}
                title="Zoom in (+)"
                aria-label="Zoom in"
              >
                <ZoomIn size={14} />
              </button>
              <button
                className="chat-header-btn"
                onClick={onFitToView}
                title="Fit to screen (F)"
                aria-label="Fit to screen"
              >
                <Maximize size={14} />
              </button>
              <button
                className="chat-header-btn"
                onClick={onReset}
                title="Reset view (0)"
                aria-label="Reset view"
              >
                <RotateCcw size={14} />
              </button>
            </div>

            {/* Direction buttons group (only for supported chart types) */}
            {showDirectionButtons && (
              <div className="chat-header-group chat-header-directions" role="group" aria-label="Layout direction">
                {availableDirections.map((direction) => {
                  const disabled = isDirectionDisabled(direction, currentDirection, chartType)
                  const active = isDirectionActive(direction, currentDirection, chartType)
                  return (
                    <button
                      key={direction}
                      className={`chat-direction-btn ${active ? 'chat-direction-btn--active' : ''}`}
                      onClick={() => handleDirectionClick(direction)}
                      disabled={disabled}
                      title={getDirectionTooltip(direction)}
                      aria-label={`Change layout to ${getDirectionTooltip(direction)}`}
                      aria-pressed={active}
                    >
                      {direction}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Terminal controls group */}
            <div className="chat-header-group chat-header-terminal" role="group" aria-label="Terminal controls">
              <button
                className="chat-header-btn"
                onClick={handleScrollToBottom}
                disabled={!portalContext?.isTerminalReady}
                title="Scroll to Bottom"
                aria-label="Scroll terminal to bottom"
              >
                <ArrowDownToLine size={14} />
              </button>
              <button
                className="chat-header-btn"
                onClick={handleRestartTerminal}
                disabled={!portalContext?.isTerminalReady}
                title="Restart Terminal"
                aria-label="Restart terminal"
              >
                <RotateCw size={14} />
              </button>
            </div>
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
              onContextMenu={handleTerminalContextMenu}
            />

            {/* Textarea section */}
            <div className="chat-input-section">
              <textarea
                ref={textareaRef}
                className="chat-textarea"
                value={message}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onContextMenu={handleTextareaContextMenu}
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

      {/* Context menu for textarea copy/paste */}
      {textareaContextMenu && (
        <TextareaContextMenu
          x={textareaContextMenu.x}
          y={textareaContextMenu.y}
          hasSelection={hasTextSelection()}
          onCut={handleCutText}
          onCopy={handleCopyText}
          onPaste={handlePasteText}
          onClose={handleCloseTextareaContextMenu}
        />
      )}

      {/* Context menu for terminal copy/paste */}
      {terminalContextMenu && portalContext?.terminalControls && (
        <TerminalContextMenu
          x={terminalContextMenu.x}
          y={terminalContextMenu.y}
          hasSelection={portalContext.terminalControls.hasSelection()}
          onCopy={async () => {
            await portalContext.terminalControls?.copy()
          }}
          onPaste={async () => {
            await portalContext.terminalControls?.paste()
          }}
          onClose={handleCloseTerminalContextMenu}
        />
      )}
    </div>
  )
}
