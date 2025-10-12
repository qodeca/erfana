/**
 * TerminalMessage Component
 *
 * Displays messages with Claude Code terminal aesthetic.
 * Supports different message types: user, assistant, tool_use, tool_result, system, error.
 */

import React from 'react'
import { Bot, User, Terminal, CheckCircle, AlertCircle, Info } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import remarkGfm from 'remark-gfm'
import './TerminalMessage.css'

interface ClaudeMessage {
  id: string
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system' | 'error'
  content: string
  metadata?: any
  timestamp: Date
}

interface TerminalMessageProps {
  message: ClaudeMessage
}

/**
 * Format tool usage display with parameters
 * Examples: "Read (.../project/file.md)", "Glob (*.ts)", "Write (.../file.txt)"
 */
const formatToolDisplay = (toolName: string, metadata?: any): string => {
  if (!metadata?.input) {
    return toolName
  }

  const input = metadata.input

  // Read tool - show file path
  if (toolName === 'Read' && input.file_path) {
    const pathParts = input.file_path.split('/')
    const shortPath = pathParts.length > 3
      ? `.../${pathParts.slice(-3).join('/')}`
      : input.file_path
    return `${toolName} (${shortPath})`
  }

  // Write tool - show file path
  if (toolName === 'Write' && input.file_path) {
    const pathParts = input.file_path.split('/')
    const shortPath = pathParts.length > 3
      ? `.../${pathParts.slice(-3).join('/')}`
      : input.file_path
    return `${toolName} (${shortPath})`
  }

  // Edit tool - show file path
  if (toolName === 'Edit' && input.file_path) {
    const pathParts = input.file_path.split('/')
    const shortPath = pathParts.length > 3
      ? `.../${pathParts.slice(-3).join('/')}`
      : input.file_path
    return `${toolName} (${shortPath})`
  }

  // Glob tool - show pattern
  if (toolName === 'Glob' && input.pattern) {
    return `${toolName} (${input.pattern})`
  }

  // Grep tool - show pattern
  if (toolName === 'Grep' && input.pattern) {
    return `${toolName} (${input.pattern})`
  }

  // Bash tool - show command (truncated)
  if (toolName === 'Bash' && input.command) {
    const cmd = input.command.length > 50
      ? input.command.substring(0, 47) + '...'
      : input.command
    return `${toolName} (${cmd})`
  }

  return toolName
}

/**
 * Terminal Message Component
 * Uses React.memo for performance optimization
 */
export const TerminalMessage = React.memo(({ message }: TerminalMessageProps) => {
  switch (message.type) {
    case 'user':
      return (
        <div className="terminal-message terminal-message-user">
          <div className="message-prefix">
            <User size={16} />
          </div>
          <div className="message-content">{message.content}</div>
        </div>
      )

    case 'assistant':
      return (
        <div className="terminal-message terminal-message-assistant">
          <div className="message-prefix">
            <Bot size={16} />
          </div>
          <div className="message-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ node, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '')
                  const inline = !node || node.position?.start.line === node.position?.end.line
                  return !inline && match ? (
                    <SyntaxHighlighter
                      // @ts-ignore - style prop typing issue
                      style={vscDarkPlus}
                      language={match[1]}
                      PreTag="div"
                      customStyle={{
                        margin: '8px 0',
                        borderRadius: '6px',
                        fontSize: '12px'
                      }}
                      {...props}
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                  ) : (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  )
                }
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        </div>
      )

    case 'tool_use':
      return (
        <div className="terminal-message terminal-message-tool">
          <div className="message-prefix">
            <Terminal size={16} />
          </div>
          <div className="message-content tool-indicator">
            {formatToolDisplay(message.content, message.metadata)}
            {message.metadata?.input && (
              <details className="tool-details">
                <summary>View parameters</summary>
                <pre className="tool-params">
                  {JSON.stringify(message.metadata.input, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </div>
      )

    case 'tool_result':
      return (
        <div className="terminal-message terminal-message-tool-result">
          <div className="message-prefix">
            <CheckCircle size={16} />
          </div>
          <div className="message-content">{message.content}</div>
        </div>
      )

    case 'error':
      return (
        <div className="terminal-message terminal-message-error">
          <div className="message-prefix">
            <AlertCircle size={16} />
          </div>
          <div className="message-content">{message.content}</div>
        </div>
      )

    case 'system':
      return (
        <div className="terminal-message terminal-message-system">
          <div className="message-prefix">
            <Info size={16} />
          </div>
          <div className="message-content">{message.content}</div>
        </div>
      )

    default:
      return null
  }
})

TerminalMessage.displayName = 'TerminalMessage'
