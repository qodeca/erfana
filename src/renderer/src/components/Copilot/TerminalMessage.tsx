/**
 * TerminalMessage Component
 *
 * Displays messages with Copilot terminal aesthetic.
 * Supports different message types: user, assistant, tool_use, tool_result, system, error.
 */

import React from 'react'
import { Bot, User, Terminal, CheckCircle, AlertCircle, Info, ChevronLeft } from 'lucide-react'
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
 * Format tool usage display with parameters (no icons)
 * Returns JSX element with tool name and inline parameters
 */
const formatToolDisplay = (toolName: string, metadata?: any): JSX.Element => {
  if (!metadata?.input) {
    return <span>{toolName}</span>
  }

  const input = metadata.input

  // Read/Write/Edit tools - show file path
  if ((toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') && input.file_path) {
    const pathParts = input.file_path.split('/')
    const shortPath = pathParts.length > 3
      ? `.../${pathParts.slice(-3).join('/')}`
      : input.file_path
    return <span>{toolName} <span className="tool-path">{shortPath}</span></span>
  }

  // Glob/Grep tools - show pattern
  if ((toolName === 'Glob' || toolName === 'Grep') && input.pattern) {
    return <span>{toolName} <span className="tool-pattern">{input.pattern}</span></span>
  }

  // Bash tool - show command (truncated)
  if (toolName === 'Bash' && input.command) {
    const cmd = input.command.length > 50
      ? input.command.substring(0, 47) + '...'
      : input.command
    return <span>{toolName} <span className="tool-command">{cmd}</span></span>
  }

  // WebSearch tool - show query
  if (toolName === 'WebSearch' && input.query) {
    const query = input.query.length > 50
      ? input.query.substring(0, 47) + '...'
      : input.query
    return <span>{toolName} <span className="tool-pattern">{query}</span></span>
  }

  // Task tool - show prompt/description (truncated)
  if (toolName === 'Task' && (input.prompt || input.description)) {
    const text = input.prompt || input.description
    const description = text.length > 50
      ? text.substring(0, 47) + '...'
      : text
    return <span>{toolName} <span className="tool-pattern">{description}</span></span>
  }

  // WebFetch tool - show URL (shortened)
  if (toolName === 'WebFetch' && input.url) {
    try {
      const urlObj = new URL(input.url)
      const shortUrl = urlObj.hostname + (urlObj.pathname.length > 20
        ? urlObj.pathname.substring(0, 17) + '...'
        : urlObj.pathname)
      return <span>{toolName} <span className="tool-path">{shortUrl}</span></span>
    } catch {
      // If URL parsing fails, show truncated string
      const url = input.url.length > 50
        ? input.url.substring(0, 47) + '...'
        : input.url
      return <span>{toolName} <span className="tool-path">{url}</span></span>
    }
  }

  // SlashCommand tool - show command
  if (toolName === 'SlashCommand' && input.command) {
    return <span>{toolName} <span className="tool-command">{input.command}</span></span>
  }

  // NotebookEdit tool - show notebook path + cell info
  if (toolName === 'NotebookEdit' && input.notebook_path) {
    const pathParts = input.notebook_path.split('/')
    const shortPath = pathParts.length > 3
      ? `.../${pathParts.slice(-3).join('/')}`
      : input.notebook_path
    const cellInfo = input.cell_id ? ` [cell: ${input.cell_id}]` : ''
    return <span>{toolName} <span className="tool-path">{shortPath}{cellInfo}</span></span>
  }

  return <span>{toolName}</span>
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
      const isStreaming = message.metadata?.isStreaming === true
      return (
        <div className={`terminal-message terminal-message-assistant ${isStreaming ? 'streaming' : ''}`}>
          <div className="message-prefix">
            <Bot size={16} />
          </div>
          <div className="message-content">
            {/* Streaming indicator badge */}
            {isStreaming && (
              <div className="streaming-indicator">
                <span className="streaming-badge">✍️ Generating...</span>
              </div>
            )}
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
            {/* Typing cursor for streaming messages */}
            {isStreaming && message.content && (
              <span className="typing-cursor">▋</span>
            )}
          </div>
        </div>
      )

    case 'tool_use':
      const toolName = message.metadata?.name || 'Tool'
      const isSecureTool = ['Task', 'WebFetch', 'SlashCommand'].includes(toolName)

      return (
        <div className={`terminal-message terminal-message-tool ${isSecureTool ? 'tool-secure' : ''}`}>
          <div className="message-prefix">
            <Terminal size={16} />
          </div>
          <div className="message-content tool-indicator">
            {message.metadata?.input ? (
              <details className="tool-details-inline">
                <summary className="tool-summary-inline">
                  <span className="tool-summary-content">{formatToolDisplay(toolName, message.metadata)}</span>
                  <ChevronLeft size={16} strokeWidth={2} className="tool-summary-chevron" />
                </summary>
                <pre className="tool-params">
                  {JSON.stringify(message.metadata.input, null, 2)}
                </pre>
              </details>
            ) : (
              formatToolDisplay(toolName, message.metadata)
            )}
          </div>
        </div>
      )

    case 'tool_result':
      const duration = message.metadata?.duration_ms
      const isError = message.metadata?.is_error
      const outputLength = message.content.length
      const isLongOutput = outputLength > 500 // Make collapsible if > 500 chars

      return (
        <div className="terminal-message terminal-message-tool-result">
          <div className="message-prefix">
            <CheckCircle size={16} />
          </div>
          <div className="message-content">
            {/* Completion indicator with timing */}
            <div className="tool-result-summary">
              {isError ? (
                <span className="tool-result-badge tool-error-badge">✗ Error</span>
              ) : (
                <span className="tool-result-badge tool-success-badge">✓ Complete</span>
              )}
              {duration !== undefined && (
                <span className="tool-duration">{(duration / 1000).toFixed(2)}s</span>
              )}
            </div>

            {/* Tool output - collapsible if long */}
            {isLongOutput ? (
              <details className="tool-output-details">
                <summary className="tool-output-summary">
                  <span>Show output ({(outputLength / 1024).toFixed(1)} KB, {message.content.split('\n').length} lines)</span>
                  <ChevronLeft size={16} strokeWidth={2} className="tool-output-chevron" />
                </summary>
                <pre className="tool-result-output">{message.content}</pre>
              </details>
            ) : (
              <pre className="tool-result-output">{message.content}</pre>
            )}
          </div>
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
      // Check if this is a result event with rich metadata
      if (message.content === '✓ Complete' && message.metadata) {
        const { total_cost_usd, duration_ms, usage, modelUsage } = message.metadata

        return (
          <div className="terminal-message terminal-message-system terminal-message-result">
            <div className="message-prefix">
              <CheckCircle size={16} />
            </div>
            <div className="message-content">
              <div className="result-summary">
                <span className="result-title">✓ Complete</span>
                {duration_ms && (
                  <span className="metadata-badge">
                    ⏱️ {(duration_ms / 1000).toFixed(2)}s
                  </span>
                )}
                {total_cost_usd !== undefined && (
                  <span className="metadata-badge cost-badge">
                    💰 ${total_cost_usd.toFixed(4)}
                  </span>
                )}
              </div>

              {/* Token usage summary */}
              {usage && (
                <div className="result-details">
                  <div className="result-stat">
                    <span className="stat-label">Tokens:</span>
                    <span className="stat-value">
                      {usage.input_tokens || 0} in / {usage.output_tokens || 0} out
                    </span>
                  </div>
                  {usage.cache_read_input_tokens > 0 && (
                    <div className="result-stat cache-stat">
                      <span className="stat-label">Cache:</span>
                      <span className="stat-value">
                        ⚡ {usage.cache_read_input_tokens} tokens ({
                          ((usage.cache_read_input_tokens /
                            ((usage.cache_read_input_tokens || 0) + (usage.input_tokens || 0))) * 100).toFixed(0)
                        }% hit rate)
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Model usage breakdown (expandable) */}
              {modelUsage && Object.keys(modelUsage).length > 0 && (
                <details className="model-usage-details">
                  <summary className="model-breakdown-summary">
                    <span>Model breakdown</span>
                    <ChevronLeft size={16} strokeWidth={2} className="model-breakdown-chevron" />
                  </summary>
                  <div className="model-usage-list">
                    {Object.entries(modelUsage).map(([model, stats]: [string, any]) => (
                      <div key={model} className="model-usage-item">
                        <div className="model-name">{model.split('-').pop()}</div>
                        <div className="model-stats">
                          <span>{stats.inputTokens} in / {stats.outputTokens} out</span>
                          <span className="model-cost">${stats.costUSD.toFixed(4)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        )
      }

      // Session lifecycle events
      if (message.content.includes('Session started')) {
        return (
          <div className="terminal-message terminal-message-system system-event-session">
            <div className="message-prefix">
              <CheckCircle size={16} />
            </div>
            <div className="message-content">
              <span className="system-event-badge session-started-badge">🚀 Session Started</span>
              {message.metadata?.projectPath && (
                <span className="system-event-detail">
                  {message.metadata.projectPath}
                </span>
              )}
            </div>
          </div>
        )
      }

      if (message.content.includes('Session stopped')) {
        return (
          <div className="terminal-message terminal-message-system system-event-session">
            <div className="message-prefix">
              <Info size={16} />
            </div>
            <div className="message-content">
              <span className="system-event-badge session-stopped-badge">⏹️ Session Stopped</span>
            </div>
          </div>
        )
      }

      if (message.content.includes('restarting') || message.content.includes('Retrying')) {
        return (
          <div className="terminal-message terminal-message-system system-event-warning">
            <div className="message-prefix">
              <AlertCircle size={16} />
            </div>
            <div className="message-content">
              <span className="system-event-badge session-restart-badge">{message.content.split(':')[0]}</span>
              {message.metadata?.attempt && message.metadata?.maxAttempts && (
                <span className="system-event-detail">
                  Attempt {message.metadata.attempt}/{message.metadata.maxAttempts}
                </span>
              )}
              {message.content.includes('approved tools') && (
                <span className="system-event-detail">
                  {message.content.split(':')[1]?.trim()}
                </span>
              )}
            </div>
          </div>
        )
      }

      if (message.content.toLowerCase().includes('error') || message.content.includes('❌')) {
        return (
          <div className="terminal-message terminal-message-system system-event-error">
            <div className="message-prefix">
              <AlertCircle size={16} />
            </div>
            <div className="message-content">
              <span className="system-event-badge session-error-badge">❌ Error</span>
              <span className="system-event-detail">{message.content.replace('❌', '').trim()}</span>
            </div>
          </div>
        )
      }

      // Regular system message
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
