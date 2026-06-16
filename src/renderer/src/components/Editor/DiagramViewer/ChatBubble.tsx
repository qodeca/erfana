// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
  RotateCw,
  LockKeyhole,
  LockKeyholeOpen
} from 'lucide-react'
import { executePromptTemplate } from '../../../utils/panelUtils'
import { useTerminalPortalOptional } from '../../../context/TerminalPortalContext'
import { useDiagramViewerStore } from '../../../stores/useDiagramViewerStore'
import { useTerminalStore } from '../../../stores/useTerminalStore'
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
  shouldSubmit,
  shouldClose,
  buildFileRef,
  formatLineRange as formatLineRangeChat,
  calculateResizedHeight,
  CHAT_LIMITS
} from './chatBubble.logic'
import { formatZoomLevel } from './diagramViewer.logic'
import { TextareaContextMenu } from '../../ContextMenu/TextareaContextMenu'
import { useTextareaClipboard } from '../../../hooks/useTextareaClipboard'
import { CharacterCount } from '../../shared'
import { scheduleScrollIfNeeded } from '../../../utils/promptScrollScheduler.logic'
import { logger } from '../../../utils/logger'
import { TEST_IDS } from '../../../constants/testids'
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

  // Subscribe to scroll lock state for UI updates (issue #60)
  // Using Zustand directly for both state and action consolidates access (SOLID: no Inappropriate Intimacy)
  // - State subscription for reactivity (needed because terminalControls is a ref, not state)
  // - Action via setScrollLocked for consistency (avoids dual path through context)
  //
  // NOTE: This differs from TerminalPanel which uses useScrollLock hook with a state accessor.
  // TerminalPanel needs the hook's blocking mechanisms (wheel, keyboard, polling).
  // ChatBubble only needs toggle UI - no scroll enforcement, so direct store access is simpler.
  const scrollLocked = useTerminalStore((state) => state.scrollLocked)
  const setScrollLocked = useTerminalStore((state) => state.setScrollLocked)

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
      const result = await executePromptTemplate('diagram-chat', {
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

      // Schedule scroll-to-bottom after prompt execution (issue #52)
      if (result.success && result.completionTs && portalContext?.lastUserScrollTsRef) {
        scheduleScrollIfNeeded({
          completionTs: result.completionTs,
          terminalPortal: {
            terminalControls: portalContext.terminalControls,
            isTerminalReady: portalContext.isTerminalReady
          },
          lastUserScrollTsRef: portalContext.lastUserScrollTsRef,
          delayMs: 1000
        })
      }

      // Only clear message on successful submit
      if (result.success) {
        setMessage('')
      }
    } catch (err) {
      logger.error('Failed to send chat message', err instanceof Error ? err : undefined)
    }
  }, [message, validation.canSubmit, filePath, startLine, endLine, mermaidCode, portalContext])

  // Direction button click handler (issue #37 - moved from MermaidToolbar)
  const handleDirectionClick = useCallback(
    async (direction: string) => {
      if (!filePath) return

      try {
        const fileRef =
          startLine && endLine ? `@${filePath}:${startLine}-${endLine}` : `@${filePath}`
        const lineRange = formatLineRange(startLine, endLine) || undefined

        const result = await executePromptTemplate('change-mermaid-direction', {
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

        // Schedule scroll-to-bottom after prompt execution (issue #52)
        if (result.success && result.completionTs && portalContext?.lastUserScrollTsRef) {
          scheduleScrollIfNeeded({
            completionTs: result.completionTs,
            terminalPortal: {
              terminalControls: portalContext.terminalControls,
              isTerminalReady: portalContext.isTerminalReady
            },
            lastUserScrollTsRef: portalContext.lastUserScrollTsRef,
            delayMs: 1000
          })
        }
      } catch (err) {
        logger.error('Failed to execute direction change prompt', err instanceof Error ? err : undefined)
      }
    },
    [filePath, startLine, endLine, mermaidCode, portalContext]
  )

  // Terminal control handlers (issue #37)
  const handleScrollToBottom = useCallback(() => {
    portalContext?.terminalControls?.scrollToBottom()
  }, [portalContext])

  const handleRestartTerminal = useCallback(async () => {
    await portalContext?.terminalControls?.restart()
  }, [portalContext])

  const handleToggleScrollLock = useCallback(() => {
    // Consolidated access: use Zustand directly instead of going through portalContext
    // This fixes Inappropriate Intimacy code smell (accessing same concept via two paths)
    setScrollLocked(!scrollLocked)
  }, [scrollLocked, setScrollLocked])

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

  // Note: Terminal context menu is handled globally by TerminalPanel via xterm.element listener

  // Clipboard operations via the central textClipboard service (issue #203).
  // CHAT_LIMITS.MAX_LENGTH stays a silent paste-reject rule (no toast);
  // transport errors are handled centrally by the service.
  const {
    handleCut: handleCutText,
    handleCopy: handleCopyText,
    handlePaste: handlePasteText
  } = useTextareaClipboard({
    textareaRef,
    value: message,
    setValue: setMessage,
    maxLength: CHAT_LIMITS.MAX_LENGTH
  })

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Note: Native clipboard shortcuts (Cmd/Ctrl+C/X/V) work automatically.
      // Context menu provides cut/copy/paste for right-click operations.

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

  const hasTextSelection = useCallback(() => {
    if (!textareaRef.current) return false
    const textarea = textareaRef.current
    return textarea.selectionStart !== textarea.selectionEnd
  }, [])

  // Note: Panel closes via click-outside or Escape key (no header close button - issue #37)

  // Don't render if no file context
  if (!filePath) return null

  return (
    <div className="chat-bubble-container" data-testid={TEST_IDS.CHAT_BUBBLE}>
      {/* Collapsed state: FAB button */}
      {!isExpanded && (
        <button
          className="chat-bubble-btn"
          onClick={handleBubbleClick}
          title="Edit diagram"
          aria-label="Open panel to modify diagram"
          aria-expanded={false}
          data-testid={TEST_IDS.CHAT_BUBBLE_BTN_OPEN}
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
          data-testid={TEST_IDS.CHAT_PANEL}
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
                data-testid={TEST_IDS.CHAT_BTN_ZOOM_OUT}
              >
                <ZoomOut size={14} />
              </button>
              <span className="chat-zoom-indicator" aria-live="polite" data-testid={TEST_IDS.CHAT_ZOOM_INDICATOR}>
                {formatZoomLevel(transform.scale)}
              </span>
              <button
                className="chat-header-btn"
                onClick={onZoomIn}
                disabled={zoomInDisabled}
                title="Zoom in (+)"
                aria-label="Zoom in"
                data-testid={TEST_IDS.CHAT_BTN_ZOOM_IN}
              >
                <ZoomIn size={14} />
              </button>
              <button
                className="chat-header-btn"
                onClick={onFitToView}
                title="Fit to screen (F)"
                aria-label="Fit to screen"
                data-testid={TEST_IDS.CHAT_BTN_FIT}
              >
                <Maximize size={14} />
              </button>
              <button
                className="chat-header-btn"
                onClick={onReset}
                title="Reset view (0)"
                aria-label="Reset view"
                data-testid={TEST_IDS.CHAT_BTN_RESET}
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
                      data-testid={`${TEST_IDS.CHAT_DIRECTION_BTN}-${direction}`}
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
                data-testid={TEST_IDS.CHAT_BTN_SCROLL_BOTTOM}
              >
                <ArrowDownToLine size={14} />
              </button>
              <button
                className="chat-header-btn"
                onClick={handleRestartTerminal}
                disabled={!portalContext?.isTerminalReady}
                title="Restart Terminal"
                aria-label="Restart terminal"
                data-testid={TEST_IDS.CHAT_BTN_RESTART}
              >
                <RotateCw size={14} />
              </button>
              <button
                className={`chat-header-btn${scrollLocked ? ' chat-header-btn--active' : ''}`}
                onClick={handleToggleScrollLock}
                disabled={!portalContext?.isTerminalReady}
                title={scrollLocked ? 'Disable scroll lock' : 'Lock scroll to bottom'}
                aria-label={scrollLocked ? 'Disable scroll lock' : 'Lock scroll to bottom'}
                aria-pressed={scrollLocked}
                data-testid={TEST_IDS.CHAT_BTN_SCROLL_LOCK}
              >
                {scrollLocked ? (
                  <LockKeyhole size={14} />
                ) : (
                  <LockKeyholeOpen size={14} />
                )}
              </button>
            </div>
          </div>

          <div className="chat-panel-body">
            {/* Terminal container - portal target (context menu handled by TerminalPanel) */}
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
                onContextMenu={handleTextareaContextMenu}
                placeholder="Describe changes to this diagram..."
                rows={3}
                maxLength={CHAT_LIMITS.MAX_LENGTH}
                aria-label="Your instruction for modifying the diagram"
                data-testid={TEST_IDS.CHAT_TEXTAREA}
              />

              <div className="chat-panel-footer">
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

                <div className="chat-footer-left">
                  <CharacterCount
                    charCount={validation.charCount}
                    validationState={validation.state}
                    data-testid={TEST_IDS.CHAT_CHARACTER_COUNT}
                  />
                  {validation.message && validation.state !== 'too-short' && (
                    <span className={`chat-validation-message chat-validation-${validation.state}`}>
                      {validation.message}
                    </span>
                  )}
                </div>

                <div className="chat-footer-right">
                  <button
                    className="chat-send-btn"
                    onClick={handleSubmit}
                    disabled={!validation.canSubmit}
                    title="Send (Cmd/Ctrl+Enter)"
                    aria-label="Send message"
                    data-testid={TEST_IDS.CHAT_BTN_SEND}
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
    </div>
  )
}
