/**
 * ClaudeCodeChat Component
 *
 * Main chat interface for Claude Code integration.
 * Handles message display, input, streaming, and session management.
 */

import { useState, useEffect, useRef } from 'react'
import { Send, Square } from 'lucide-react'
import { TerminalMessage } from './TerminalMessage'
import { ToolApprovalDialog, ToolApprovalRequest } from '../Dialogs/ToolApprovalDialog'
import './ClaudeCodeChat.css'

interface ClaudeMessage {
  id: string
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system' | 'error'
  content: string
  metadata?: any
  timestamp: Date
}

export function ClaudeCodeChat() {
  const [messages, setMessages] = useState<ClaudeMessage[]>([])
  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [_currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [pendingApproval, setPendingApproval] = useState<ToolApprovalRequest | null>(null)
  const [lastUserPrompt, setLastUserPrompt] = useState('')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Listen for incoming messages (persistent session)
  useEffect(() => {
    const unsubscribe = window.api.claudeCode.onMessage((data) => {
      // In persistent session mode, accept all messages
      console.log('📨 Received message:', data.message.type, data.message.content.substring(0, 50))

      // Filter out system init messages
      if (data.message.type === 'system' && data.message.content.includes('Session started')) {
        return
      }

      // Filter out completion messages (they have their own handler)
      if (data.message.type === 'system' && data.message.content === '✓ Complete') {
        console.log('✅ Message stream completed')
        setIsRunning(false)
        setCurrentSessionId(null)
        textareaRef.current?.focus()
        return
      }

      setMessages((prev) => [...prev, data.message])
    })

    return unsubscribe
  }, [])

  // Listen for completion (legacy - kept for compatibility)
  useEffect(() => {
    const unsubscribe = window.api.claudeCode.onComplete((data) => {
      console.log('✅ Session completed:', data.sessionId)
      setIsRunning(false)
      setCurrentSessionId(null)

      // Focus input after completion
      textareaRef.current?.focus()
    })

    return unsubscribe
  }, [])

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

      // Focus input after error
      textareaRef.current?.focus()
    })

    return unsubscribe
  }, [])

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
            content: `🔄 Retrying with approved tools: ${data.approvedTools.join(', ')}`,
            timestamp: new Date()
          }
        ])

        // Send the last prompt again
        const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        setCurrentSessionId(sessionId)
        setIsRunning(true)

        window.api.claudeCode.sendMessage(lastUserPrompt, {}, sessionId)
      }
    })

    return unsubscribe
  }, [lastUserPrompt])

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

    // Send to Claude Code via IPC
    console.log('🚀 Sending message to Claude Code:', sessionId)
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

        {/* Auto-scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="chat-input-container">
        {messages.length > 0 && (
          <div className="chat-actions">
            <button
              className="action-button clear-button"
              onClick={handleClear}
              disabled={isRunning}
              title="Clear conversation"
            >
              Clear
            </button>
          </div>
        )}

        <div className="chat-input">
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

          <button
            onClick={isRunning ? handleStop : handleSend}
            disabled={!input.trim() && !isRunning}
            className={`send-button ${isRunning ? 'stop-button' : ''}`}
            title={isRunning ? 'Stop generation (Esc)' : 'Send message (⌘↵)'}
          >
            {isRunning ? (
              <>
                <Square size={16} />
                Stop
              </>
            ) : (
              <>
                <Send size={16} />
                Send
              </>
            )}
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
