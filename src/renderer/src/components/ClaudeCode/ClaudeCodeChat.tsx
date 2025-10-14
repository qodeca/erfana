/**
 * ClaudeCodeChat Component
 *
 * Main chat interface for Claude Code integration.
 * Handles message display, input, streaming, and session management.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Square, ChevronLeft, ChevronDown, ListChecks } from 'lucide-react'
import { TerminalMessage } from './TerminalMessage'
import { ToolApprovalDialog, ToolApprovalRequest } from '../Dialogs/ToolApprovalDialog'
import { useAiAssistantStore } from '../../stores/useAiAssistantStore'
import './ClaudeCodeChat.css'

interface ClaudeMessage {
  id: string
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system' | 'error'
  content: string
  metadata?: any
  timestamp: Date
}

interface SessionMetrics {
  toolExecutions: number
  messagesCount: number
  sessionStartTime: Date | null
}

// All available Claude Code tools (from official documentation)
const ALL_TOOLS = [
  'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'Bash', 'LS',
  'WebSearch', 'WebFetch', 'SlashCommand',
  'TodoRead', 'TodoWrite', 'Task',
  'NotebookRead', 'NotebookEdit',
  'ExitPlanMode'
]

export function ClaudeCodeChat() {
  const [messages, setMessages] = useState<ClaudeMessage[]>([])
  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [_currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [pendingApproval, setPendingApproval] = useState<ToolApprovalRequest | null>(null)
  const [lastUserPrompt, setLastUserPrompt] = useState('')
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false)
  const [metrics, setMetrics] = useState<SessionMetrics>({
    toolExecutions: 0,
    messagesCount: 0,
    sessionStartTime: null
  })
  const [showControlPanel, setShowControlPanel] = useState(false)
  const [isPlanningMode, setIsPlanningMode] = useState(false)
  const [approvedTools, setApprovedTools] = useState<string[]>([])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastMessageTimeRef = useRef<number>(Date.now())
  const activityCheckIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Watch for pending messages from AI Assistant store
  const pendingMessage = useAiAssistantStore((state) => state.pendingMessage)
  const shouldSendImmediately = useAiAssistantStore((state) => state.shouldSendImmediately)
  const clearPendingMessage = useAiAssistantStore((state) => state.clearPendingMessage)

  // Helper: Update last message timestamp (called whenever any message arrives)
  const updateLastMessageTime = useCallback(() => {
    lastMessageTimeRef.current = Date.now()
  }, [])

  // Helper: Start activity monitoring interval
  const startActivityMonitoring = useCallback(() => {
    // Clear any existing interval
    if (activityCheckIntervalRef.current) {
      clearInterval(activityCheckIntervalRef.current)
    }

    // Update timestamp when starting
    lastMessageTimeRef.current = Date.now()

    // Check every 500ms if we should show the indicator
    activityCheckIntervalRef.current = setInterval(() => {
      const timeSinceLastMessage = Date.now() - lastMessageTimeRef.current

      // Show indicator if more than 1 second has passed since last message
      if (timeSinceLastMessage > 1000) {
        setIsWaitingForResponse(true)
      } else {
        setIsWaitingForResponse(false)
      }
    }, 500)
  }, [])

  // Helper: Stop activity monitoring and hide indicator
  const stopActivityMonitoring = useCallback(() => {
    if (activityCheckIntervalRef.current) {
      clearInterval(activityCheckIntervalRef.current)
      activityCheckIntervalRef.current = null
    }
    setIsWaitingForResponse(false)
  }, [])

  // Helper: Update metrics based on message
  const updateMetrics = useCallback((message: ClaudeMessage) => {
    setMetrics((prev) => {
      const updated = { ...prev }

      // Track session start time
      if (!prev.sessionStartTime && message.type === 'system' && message.content.includes('Session started')) {
        updated.sessionStartTime = message.timestamp
      }

      // Count messages
      if (message.type === 'user' || message.type === 'assistant') {
        updated.messagesCount += 1
      }

      // Count tool executions
      if (message.type === 'tool_use') {
        updated.toolExecutions += 1
      }

      return updated
    })
  }, [])

  // Fetch approved tools on mount
  useEffect(() => {
    const fetchApprovedTools = async () => {
      try {
        const result = await window.api.settings.getApprovedTools()
        if (result.success && result.tools) {
          // Merge default tools with user-approved tools
          const defaultTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'LS', 'WebSearch', 'TodoWrite', 'Task']
          const allApproved = Array.from(new Set([...defaultTools, ...result.tools]))
          setApprovedTools(allApproved)
        }
      } catch (error) {
        console.error('Failed to fetch approved tools:', error)
      }
    }

    fetchApprovedTools()
  }, [])

  // Auto-scroll to bottom when new messages arrive or typing indicator changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isWaitingForResponse])

  // Cleanup activity monitoring on unmount
  useEffect(() => {
    return () => {
      if (activityCheckIntervalRef.current) {
        clearInterval(activityCheckIntervalRef.current)
      }
    }
  }, [])

  // Listen for incoming messages (persistent session)
  useEffect(() => {
    const unsubscribe = window.api.claudeCode.onMessage((data) => {
      // In persistent session mode, accept all messages
      console.log('📨 Received message:', data.message.type, data.message.content.substring(0, 50))

      // Update last message time for any message (keeps indicator responsive)
      updateLastMessageTime()

      // Update metrics for all messages
      updateMetrics(data.message)

      // Filter out completion messages (they have their own handler)
      if (data.message.type === 'system' && data.message.content === '✓ Complete') {
        console.log('✅ Message stream completed')
        setIsRunning(false)
        setCurrentSessionId(null)
        stopActivityMonitoring()
        textareaRef.current?.focus()
        return
      }

      // Add all messages including session lifecycle events (now displayed with enhanced styling)
      setMessages((prev) => [...prev, data.message])
    })

    return unsubscribe
  }, [stopActivityMonitoring, updateLastMessageTime, updateMetrics])

  // Listen for streaming message updates (--include-partial-messages)
  useEffect(() => {
    const unsubscribe = window.api.claudeCode.onMessageUpdate((data) => {
      // Update last message time to keep "thinking" indicator hidden
      updateLastMessageTime()

      // Find and update existing message by ID
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === data.message.id
            ? {
                ...msg,
                content: data.message.content,
                metadata: data.message.metadata,
                timestamp: data.message.timestamp
              }
            : msg
        )
      )
    })

    return unsubscribe
  }, [updateLastMessageTime])

  // Listen for streaming message completion
  useEffect(() => {
    const unsubscribe = window.api.claudeCode.onMessageComplete((data) => {
      // Update last message time
      updateLastMessageTime()

      // Find and finalize existing message by ID
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === data.message.id
            ? {
                ...msg,
                content: data.message.content,
                metadata: { ...data.message.metadata, isStreaming: false },
                timestamp: data.message.timestamp
              }
            : msg
        )
      )

      console.log('✅ Streaming message completed:', data.message.id)
    })

    return unsubscribe
  }, [updateLastMessageTime])

  // Listen for completion (legacy - kept for compatibility)
  useEffect(() => {
    const unsubscribe = window.api.claudeCode.onComplete((data) => {
      console.log('✅ Session completed:', data.sessionId)
      setIsRunning(false)
      setCurrentSessionId(null)
      stopActivityMonitoring()

      // Focus input after completion
      textareaRef.current?.focus()
    })

    return unsubscribe
  }, [stopActivityMonitoring])

  // Listen for errors
  useEffect(() => {
    const unsubscribe = window.api.claudeCode.onError((data) => {
      console.error('❌ Session error:', data.error)

      // Add error message
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          type: 'error',
          content: data.error,
          timestamp: new Date()
        }
      ])

      setIsRunning(false)
      setCurrentSessionId(null)
      stopActivityMonitoring()

      // Focus input after error
      textareaRef.current?.focus()
    })

    return unsubscribe
  }, [stopActivityMonitoring])

  // Listen for tool approval requests
  useEffect(() => {
    const unsubscribe = window.api.claudeCode.onToolApprovalNeeded((request) => {
      console.log('⚠️ Tool approval needed:', request.toolName)
      setPendingApproval(request)
    })

    return unsubscribe
  }, [])

  // Listen for session resumed (after approval)
  useEffect(() => {
    const unsubscribe = window.api.claudeCode.onSessionResumed((data) => {
      console.log('✅ Session resumed with tools:', data.approvedTools)

      // Auto-retry last user prompt after approval
      if (lastUserPrompt) {
        console.log('🔄 Auto-retrying last prompt after approval:', lastUserPrompt)

        // Add system message to show we're retrying
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            type: 'system',
            content: `Retrying with approved tools: ${data.approvedTools.join(', ')}`,
            timestamp: new Date()
          }
        ])

        // Send the last prompt again
        const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        setCurrentSessionId(sessionId)
        setIsRunning(true)
        startActivityMonitoring()

        window.api.claudeCode.sendMessage(lastUserPrompt, {}, sessionId)
      }
    })

    return unsubscribe
  }, [lastUserPrompt, startActivityMonitoring])

  // Listen for pending messages from context menu (or other sources)
  useEffect(() => {
    if (pendingMessage) {
      console.log('📥 Received pending message from store:', pendingMessage.substring(0, 50))

      if (shouldSendImmediately && !isRunning) {
        // Send directly without populating input field
        console.log('🚀 Sending message immediately')

        // Store last prompt for auto-retry after tool approval
        setLastUserPrompt(pendingMessage)

        const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        setCurrentSessionId(sessionId)
        setIsRunning(true)
        startActivityMonitoring()

        // Clear pending message from store
        clearPendingMessage()

        // Send to Claude Code via IPC
        window.api.claudeCode.sendMessage(pendingMessage, {}, sessionId)
      } else {
        // Populate input field with pending message for review
        setInput(pendingMessage)

        // Clear pending message from store
        clearPendingMessage()

        // Auto-resize textarea
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            textareaRef.current.style.height =
              Math.min(textareaRef.current.scrollHeight, 200) + 'px'
          }
          // Focus textarea so user can review and send
          textareaRef.current?.focus()
        }, 100)
      }
    }
  }, [pendingMessage, shouldSendImmediately, isRunning, clearPendingMessage, startActivityMonitoring])

  /**
   * Send message to Claude Code
   */
  const handleSend = () => {
    const trimmedInput = input.trim()

    if (!trimmedInput || isRunning) {
      return
    }

    // Store last prompt for auto-retry after tool approval
    setLastUserPrompt(trimmedInput)

    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    setCurrentSessionId(sessionId)

    // Don't add user message manually - let Claude CLI replay it via --replay-user-messages
    // This prevents duplicate user messages in the UI

    setInput('')
    setIsRunning(true)
    startActivityMonitoring()

    // Send to Claude Code via IPC
    console.log('🚀 Sending message to Claude Code:', sessionId, isPlanningMode ? '(planning mode)' : '')
    window.api.claudeCode.sendMessage(trimmedInput, {}, sessionId)
  }

  /**
   * Stop generation
   */
  const handleStop = () => {
    console.log('🛑 Stopping generation')
    window.api.claudeCode.stop()
    setIsRunning(false)
    setCurrentSessionId(null)
    stopActivityMonitoring()

    // Focus input
    textareaRef.current?.focus()
  }

  /**
   * Clear conversation
   */
  const handleClear = () => {
    if (isRunning) {
      return
    }

    if (window.confirm('Clear all messages?')) {
      setMessages([])
      textareaRef.current?.focus()
    }
  }

  /**
   * Toggle planning mode and restart session
   */
  const handlePlanningModeToggle = async () => {
    if (isRunning) {
      return // Don't toggle during active session
    }

    const newPlanningMode = !isPlanningMode
    setIsPlanningMode(newPlanningMode)

    // Get project path
    const projectPath = await window.api.file.getProjectPath()
    if (!projectPath) {
      console.error('No project path available')
      return
    }

    // Add system message about mode change
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        type: 'system',
        content: newPlanningMode
          ? '📋 Planning mode enabled: Claude will use read-only tools (Read, LS, Grep, Task, WebSearch, TodoWrite)'
          : '🔧 Planning mode disabled: Claude has full access to approved tools',
        timestamp: new Date()
      }
    ])

    console.log(`🔄 Restarting session with planning mode: ${newPlanningMode}`)

    try {
      // Stop current session
      await window.api.claudeCode.stopSession()

      // Start new session with planning mode
      await window.api.claudeCode.startSession(projectPath, newPlanningMode)
    } catch (error) {
      console.error('Failed to restart session:', error)
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          type: 'error',
          content: `Failed to restart session: ${error}`,
          timestamp: new Date()
        }
      ])
    }
  }

  /**
   * Handle keyboard shortcuts
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl + Enter to send
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }

    // Escape to stop
    if (e.key === 'Escape' && isRunning) {
      e.preventDefault()
      handleStop()
    }
  }

  /**
   * Auto-resize textarea based on content
   */
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)

    // Auto-resize
    const textarea = e.target
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px'
  }

  /**
   * Handle tool approval
   */
  const handleToolApprove = async (remember: boolean) => {
    if (!pendingApproval) return

    console.log(`✅ Approving tool: ${pendingApproval.toolName} (remember: ${remember})`)

    try {
      await window.api.claudeCode.approveTool(pendingApproval.toolName, remember)
      setPendingApproval(null) // Close dialog
    } catch (error) {
      console.error('Failed to approve tool:', error)
    }
  }

  /**
   * Handle tool denial
   */
  const handleToolDeny = async () => {
    if (!pendingApproval) return

    console.log(`❌ Denying tool: ${pendingApproval.toolName}`)

    try {
      await window.api.claudeCode.denyTool(pendingApproval.toolName)
      setPendingApproval(null) // Close dialog
    } catch (error) {
      console.error('Failed to deny tool:', error)
    }
  }

  return (
    <div className="claude-code-chat">
      {/* Control Panel */}
      <div className="metrics-dashboard">
        <div className="metrics-header" onClick={() => setShowControlPanel(!showControlPanel)}>
          <span className="metrics-title">Control Panel</span>
          <span className="metrics-toggle">
            {showControlPanel ? (
              <ChevronDown size={16} strokeWidth={2} />
            ) : (
              <ChevronLeft size={16} strokeWidth={2} />
            )}
          </span>
        </div>
        {showControlPanel && (
          <div className="metrics-content">
            {/* Session Stats - always show Messages and Tools Used */}
            <div className="metrics-grid">
              <div className="metric-item">
                <span className="metric-label">Messages</span>
                <span className="metric-value">{metrics.messagesCount}</span>
              </div>
              <div className="metric-item">
                <span className="metric-label">Tools Used</span>
                <span className="metric-value">{metrics.toolExecutions}</span>
              </div>
              {metrics.sessionStartTime && (
                <div className="metric-item">
                  <span className="metric-label">Duration</span>
                  <span className="metric-value">
                    {Math.floor((Date.now() - metrics.sessionStartTime.getTime()) / 1000 / 60)}m
                  </span>
                </div>
              )}
            </div>

            {/* Tools Section */}
            <div className="tools-section">
              <div className="tools-section-header">Available Tools ({ALL_TOOLS.length})</div>
              <div className="tools-list">
                {ALL_TOOLS.map((tool) => (
                  <span
                    key={tool}
                    className={`tool-chip ${approvedTools.includes(tool) ? 'tool-approved' : 'tool-not-approved'}`}
                    title={approvedTools.includes(tool) ? 'Approved - no confirmation needed' : 'Requires approval'}
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Messages area */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty-state">
            <div className="empty-state-content">
              <div className="empty-state-icon">⚡</div>
              <h3>Claude Code</h3>
              <p>Ask Claude Code anything about your project.</p>
              <div className="empty-state-tips">
                <div className="tip">💡 Press <kbd>⌘</kbd>+<kbd>↵</kbd> to send</div>
                <div className="tip">💡 Press <kbd>Esc</kbd> to stop</div>
              </div>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <TerminalMessage key={message.id} message={message} />
        ))}

        {/* Typing indicator */}
        {isWaitingForResponse && (
          <div className="typing-indicator">
            <div className="typing-indicator-content">
              <div className="typing-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <span className="typing-text">Claude is thinking...</span>
            </div>
          </div>
        )}

        {/* Auto-scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="chat-input-container">
        {/* Textarea first - full width */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={
            isRunning ? 'Claude Code is thinking...' : 'Message Claude Code... (⌘↵ to send)'
          }
          disabled={isRunning}
          rows={3}
          className="chat-input-textarea"
        />

        {/* Toolbar below with buttons */}
        <div className="chat-toolbar">
          {messages.length > 0 && (
            <button
              className="toolbar-button clear-button"
              onClick={handleClear}
              disabled={isRunning}
              title="Clear conversation"
              aria-label="Clear conversation"
            >
              Clear
            </button>
          )}
          <button
            className={`toolbar-button planning-button ${isPlanningMode ? 'active' : ''}`}
            onClick={handlePlanningModeToggle}
            disabled={isRunning}
            title={isPlanningMode ? 'Planning mode enabled (read-only tools)' : 'Planning mode disabled (full access)'}
            aria-label="Toggle planning mode"
          >
            <ListChecks size={14} />
          </button>
          <div className="toolbar-spacer" />
          <button
            onClick={isRunning ? handleStop : handleSend}
            disabled={!input.trim() && !isRunning}
            className={`toolbar-button send-button ${isRunning ? 'stop-button' : ''}`}
            title={isRunning ? 'Stop generation (Esc)' : 'Send message (⌘↵)'}
            aria-label={isRunning ? 'Stop generation' : 'Send message'}
          >
            {isRunning ? <Square size={16} /> : <Send size={16} />}
          </button>
        </div>
      </div>

      {/* Tool Approval Dialog */}
      {pendingApproval && (
        <ToolApprovalDialog
          request={pendingApproval}
          onApprove={handleToolApprove}
          onDeny={handleToolDeny}
        />
      )}
    </div>
  )
}
