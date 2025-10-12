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
 * Terminal Message Component
 * Uses React.memo for performance optimization
 */
export const TerminalMessage = React.memo(({ message }: TerminalMessageProps) => {
  switch (message.type) {
    case 'user':
      return (
        <div className="terminal-message terminal-message-user">
          <div className="message-prefix">
            <User size={14} />
            <span className="prefix-text">You</span>
          </div>
          <div className="message-content">{message.content}</div>
        </div>
      )

    case 'assistant':
      return (
        <div className="terminal-message terminal-message-assistant">
          <div className="message-prefix">
            <Bot size={14} />
            <span className="prefix-text">Claude</span>
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
            <Terminal size={14} />
            <span className="prefix-text">Tool</span>
          </div>
          <div className="message-content tool-indicator">
            <span className="tool-icon">⏺</span>
            {message.content}
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
            <CheckCircle size={14} />
            <span className="prefix-text">Result</span>
          </div>
          <div className="message-content">{message.content}</div>
        </div>
      )

    case 'error':
      return (
        <div className="terminal-message terminal-message-error">
          <div className="message-prefix">
            <AlertCircle size={14} />
            <span className="prefix-text">Error</span>
          </div>
          <div className="message-content">{message.content}</div>
        </div>
      )

    case 'system':
      return (
        <div className="terminal-message terminal-message-system">
          <div className="message-prefix">
            <Info size={14} />
          </div>
          <div className="message-content">{message.content}</div>
        </div>
      )

    default:
      return null
  }
})

TerminalMessage.displayName = 'TerminalMessage'
