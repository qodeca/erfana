/**
 * ClaudeCliService - Persistent Session Architecture
 *
 * Spawns and manages a PERSISTENT Claude Code CLI process for MAX subscription usage.
 * Process runs for the entire project lifetime, maintaining conversation context.
 * Uses --input-format stream-json and --output-format stream-json for bidirectional JSONL communication.
 */

import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { homedir } from 'os'
import { settingsService } from './SettingsService'

/**
 * All available Claude Code tools (17 total)
 * Shared with renderer constants - must be kept in sync
 */
const ALL_CLAUDE_TOOLS = [
  // File Operations (7)
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Glob',
  'Grep',
  'LS',

  // System Operations (1)
  'Bash',

  // AI & Web (3)
  'WebSearch',
  'WebFetch',
  'Task',

  // Workflow & Tasks (4)
  'TodoRead',
  'TodoWrite',
  'SlashCommand',
  'ExitPlanMode',

  // Jupyter Notebooks (2)
  'NotebookRead',
  'NotebookEdit'
] as const

/**
 * Planning mode safe tools (9 total)
 * Read-only and safe tools allowed in planning mode.
 */
const PLANNING_MODE_TOOLS = [
  'Read',
  'LS',
  'Glob',
  'Grep',
  'Task',
  'WebSearch',
  'TodoRead',
  'TodoWrite',
  'NotebookRead'
] as const

/**
 * Message context for Claude queries
 */
export interface ClaudeMessageContext {
  workingDirectory?: string
  currentFile?: string
  selectedText?: string
  projectPath?: string
}

/**
 * Unified message format for renderer
 */
export interface ClaudeMessage {
  id: string
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system' | 'error'
  content: string
  metadata?: any
  timestamp: Date
}

/**
 * Token usage statistics
 */
interface TokenUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: {
    ephemeral_5m_input_tokens?: number
    ephemeral_1h_input_tokens?: number
  }
  service_tier?: string
  server_tool_use?: {
    web_search_requests?: number
  }
}

/**
 * Model-specific usage breakdown
 */
interface ModelUsage {
  [modelName: string]: {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
    webSearchRequests: number
    costUSD: number
    contextWindow: number
  }
}

/**
 * JSONL Event types from Claude CLI (output format)
 * Includes streaming event types from --include-partial-messages
 */
interface ClaudeCliEvent {
  type: 'system' | 'user' | 'assistant' | 'result' | 'message_start' | 'message_stop' | 'message_delta' | 'content_block_start' | 'content_block_delta' | 'content_block_stop'
  subtype?: string
  message?: {
    role?: string
    model?: string
    id?: string
    stop_reason?: string | null
    stop_sequence?: string | null
    usage?: TokenUsage
    content?: Array<{
      type: string
      text?: string
      id?: string
      name?: string
      input?: any
      tool_use_id?: string
      content?: string // For tool_result
      is_error?: boolean
    }>
  }
  session_id?: string
  tools?: string[]
  mcp_servers?: Array<{ name: string; status: string }>
  model?: string
  permissionMode?: string
  cwd?: string
  // Result event fields
  is_error?: boolean
  duration_ms?: number
  duration_api_ms?: number
  num_turns?: number
  result?: string
  total_cost_usd?: number
  usage?: TokenUsage
  modelUsage?: ModelUsage
  permission_denials?: any[]
  uuid?: string
  stats?: any
  // Streaming event fields (--include-partial-messages)
  index?: number // Content block index
  content_block?: {
    type: string
    text?: string
    id?: string
    name?: string
    input?: any
  }
  delta?: {
    type: string
    text?: string // Token delta for streaming
    stop_reason?: string
    usage?: TokenUsage
  }
}

/**
 * JSONL Input format (for sending messages to Claude CLI via stdin)
 */
interface ClaudeInputMessage {
  type: 'user'
  message: {
    role: 'user'
    content: Array<{
      type: 'text'
      text: string
    }>
  }
}

/**
 * Session state
 */
type SessionState = 'stopped' | 'starting' | 'ready' | 'error'

/**
 * Streaming message state for accumulating deltas
 */
interface StreamingMessage {
  id: string
  type: 'assistant'
  content: string // Accumulated text
  metadata: any
  timestamp: Date
  contentBlocks: Map<number, string> // Block index -> accumulated content
  isStreaming: boolean
}

/**
 * Session statistics for tracking conversation metrics
 */
interface SessionStats {
  messageCount: number      // Total user + assistant messages
  toolExecutions: number    // Total tool executions
  createdAt: Date          // Session creation timestamp
}

export class ClaudeCliService extends EventEmitter {
  private claudeProcess: ChildProcess | null = null
  private sessionState: SessionState = 'stopped'
  private buffer = ''
  private projectPath: string | null = null
  private restartAttempts = 0
  private maxRestartAttempts = 3
  private restartTimeout: NodeJS.Timeout | null = null
  private authCheckBypass = false
  // Pre-approved tools: all 17 Claude Code tools by default
  private approvedTools: Set<string> = new Set(ALL_CLAUDE_TOOLS)
  private sessionId: string | null = null
  private isPlanningMode: boolean = false // Planning mode state

  // Streaming state management
  private streamingMessages: Map<string, StreamingMessage> = new Map() // message_id -> streaming message
  private currentMessageId: string | null = null

  // Tool execution timing
  private toolExecutionStart: Map<string, number> = new Map() // tool_use_id -> start timestamp

  // Cumulative token tracking for the session
  private cumulativeTokens = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0
  }

  // Session statistics tracking
  private sessionStats: SessionStats = {
    messageCount: 0,
    toolExecutions: 0,
    createdAt: new Date()
  }

  /**
   * Set OAuth token for Claude CLI
   * This bypasses authentication check and trusts the system auth
   */
  setOAuthToken(_token: string): void {
    this.authCheckBypass = true
  }

  /**
   * Check if Claude CLI is installed
   */
  async isClaudeInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const testProcess = spawn('which', ['claude'])

      testProcess.on('close', (code) => {
        resolve(code === 0)
      })

      testProcess.on('error', () => {
        resolve(false)
      })
    })
  }

  /**
   * Check Claude CLI authentication status
   */
  async checkAuthStatus(): Promise<{
    isAuthenticated: boolean
    username?: string
    error?: string
  }> {
    // If token was manually set via UI, bypass check and trust system auth
    if (this.authCheckBypass) {
      console.log('🔐 Token was set via UI - trusting system authentication')
      return { isAuthenticated: true }
    }

    // SIMPLIFIED: Just trust that claude setup-token was run
    // Authentication check is unreliable in Electron context
    console.log('🔐 Trusting system Claude CLI configuration from ~/.claude/')
    return { isAuthenticated: true }
  }

  /**
   * Start persistent Claude CLI session
   * Uses --continue flag to automatically preserve conversation history per directory
   *
   * @param projectPath - Path to the project directory
   * @param planningMode - If true, restricts tools to read-only (Read, LS, Grep, Task, WebSearch, TodoWrite)
   */
  async startSession(
    projectPath: string,
    planningMode: boolean = false
  ): Promise<void> {
    console.log('🔵 SESSION START: Begin startSession()')
    console.log('🔵 Project path:', projectPath)
    console.log('🔵 Planning mode:', planningMode)

    if (this.claudeProcess) {
      console.log('⚠️ Session already running, stopping first...')
      await this.stopSession()
    }

    this.sessionState = 'starting'
    this.projectPath = projectPath
    this.isPlanningMode = planningMode
    this.buffer = ''
    this.restartAttempts = 0

    // Always generate unique session ID (required by Claude CLI)
    this.sessionId = this.generateSessionId()
    console.log('🔵 Session ID:', this.sessionId)

    // Reset cumulative token tracking for new session
    this.cumulativeTokens = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0
    }

    // Determine tool set based on planning mode
    let toolsToUse: Set<string>

    if (planningMode) {
      // Planning mode: read-only and safe tools (9 tools)
      toolsToUse = new Set(PLANNING_MODE_TOOLS)
      console.log('📋 Planning mode enabled: using 9 safe tools')
    } else {
      // Normal mode: load approved tools from settings (exact user selection)
      console.log('🔵 Loading approved tools from settings...')
      const approvedToolsList = await settingsService.getApprovedTools()
      console.log('🔵 Tools loaded from settings:', approvedToolsList)
      toolsToUse = new Set(approvedToolsList)
    }

    this.approvedTools = toolsToUse

    console.log(`🚀 Starting persistent Claude CLI session for: ${projectPath}`)
    console.log(`🔧 Approved tools (${this.approvedTools.size} total): ${Array.from(this.approvedTools).join(', ')}`)

    try {
      // Build args with --continue flag for automatic conversation preservation
      const args = [
        '-p', // Print mode (non-interactive, but can accept stdin)
        '--continue', // Automatically continue latest conversation in this directory
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose', // Required for stream-json output format
        '--replay-user-messages', // Echo user messages back for acknowledgment
        '--include-partial-messages', // Enable real-time token streaming
        '--session-id',
        this.sessionId! // Unique ID for this session instance
      ]

      console.log('✅ Using --continue flag for conversation preservation')
      console.log('📝 Will automatically continue latest conversation in directory')

      // Add planning mode flag if enabled
      if (planningMode) {
        args.push('--permission-mode', 'plan')
        console.log('🔵 Added planning mode flag')
      }

      // Add --allowedTools with approved tools
      // This is required for Claude CLI to actually execute the tools
      if (this.approvedTools.size > 0) {
        const toolsArray = Array.from(this.approvedTools)
        args.push('--allowedTools', ...toolsArray)
        console.log('🔵 Added --allowedTools flag with:', toolsArray)
      } else {
        console.warn('⚠️ No approved tools to add!')
      }

      console.log('🔵 Final command args:', args.join(' '))

      // Start Claude CLI in persistent mode with stream-json I/O
      this.claudeProcess = spawn('claude', args, {
        cwd: projectPath, // Run in project directory context
        shell: true, // Use shell for proper environment
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          HOME: process.env.HOME || homedir(),
          ANTHROPIC_API_KEY: undefined // Ensure subscription usage
        }
      })

      if (!this.claudeProcess.stdout || !this.claudeProcess.stderr || !this.claudeProcess.stdin) {
        throw new Error('Failed to initialize Claude CLI stdio streams')
      }

      // Setup continuous JSONL parsing from stdout
      this.claudeProcess.stdout.on('data', (data: Buffer) => {
        this.handleStdout(data)
      })

      // Handle stderr
      this.claudeProcess.stderr.on('data', (data: Buffer) => {
        const errorText = data.toString()
        console.error('❌ Claude CLI stderr:', errorText)

        // Check for authentication errors
        if (errorText.includes('not logged in') || errorText.includes('authenticate')) {
          this.sessionState = 'error'
          this.emit('error', {
            message: 'Not authenticated. Please run: claude setup-token',
            recoverable: false
          })
        }
      })

      // Handle process exit
      this.claudeProcess.on('close', (code) => {
        console.log(`🏁 Claude CLI process exited with code: ${code}`)
        this.handleProcessExit(code)
      })

      // Handle process errors
      this.claudeProcess.on('error', (error) => {
        console.error('❌ Claude CLI process error:', error)
        this.sessionState = 'error'
        this.emit('error', {
          message: error.message,
          recoverable: true
        })
      })

      this.sessionState = 'ready'
      console.log('🔵 Emitting session-started event with projectPath:', projectPath)
      this.emit('session-started', { projectPath })
      console.log('✅ Claude CLI session ready')
      console.log('✅ SESSION START: Complete!')
    } catch (error: any) {
      console.error('❌ Failed to start Claude CLI session:', error)
      this.sessionState = 'error'
      this.emit('error', {
        message: error.message,
        recoverable: false
      })
      throw error
    }
  }

  /**
   * Send message to running Claude CLI session
   * Writes JSONL message to stdin
   */
  sendMessage(prompt: string, context?: Partial<ClaudeMessageContext>): void {
    if (this.sessionState !== 'ready') {
      throw new Error(`Cannot send message: session state is ${this.sessionState}`)
    }

    if (!this.claudeProcess || !this.claudeProcess.stdin) {
      throw new Error('No active Claude CLI session')
    }

    // Build full prompt with context
    const fullPrompt = this.buildPrompt(prompt, context)

    // Create JSONL input message
    const inputMessage: ClaudeInputMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: fullPrompt
          }
        ]
      }
    }

    // Send to Claude CLI via stdin
    const jsonLine = JSON.stringify(inputMessage) + '\n'
    console.log(`📤 Sending message to Claude CLI (${fullPrompt.length} chars)`)

    try {
      this.claudeProcess.stdin.write(jsonLine, (error) => {
        if (error) {
          console.error('❌ Failed to write to stdin:', error)
          this.emit('error', {
            message: `Failed to send message: ${error.message}`,
            recoverable: true
          })
        }
      })
    } catch (error: any) {
      console.error('❌ Error writing to stdin:', error)
      this.emit('error', {
        message: `Error sending message: ${error.message}`,
        recoverable: true
      })
    }
  }

  /**
   * Approve tool and restart session with new permissions
   * Always persists to settings for unified state management
   */
  async approveTool(toolName: string): Promise<void> {
    console.log(`✅ Approving tool: ${toolName}`)

    // Add to approved tools runtime Set
    this.approvedTools.add(toolName)

    // Always save to settings for seamless integration
    await settingsService.addApprovedTool(toolName)
    console.log(`💾 Tool ${toolName} saved to settings`)

    // Restart session with new tool permissions
    await this.restartWithNewPermissions()
  }

  /**
   * Deny tool use and restart session
   */
  async denyTool(toolName: string): Promise<void> {
    console.log(`❌ Denying tool: ${toolName}`)

    // Don't add to approved tools
    // Restart session so Claude can try a different approach
    await this.restartWithNewPermissions()
  }

  /**
   * Restart session with updated tool permissions
   * Uses --continue flag to automatically preserve conversation
   */
  private async restartWithNewPermissions(): Promise<void> {
    if (!this.projectPath) {
      console.error('❌ Cannot restart: missing project path')
      return
    }

    console.log('🔄 Restarting session with updated tool permissions...')
    console.log('📝 --continue flag will preserve conversation')

    const projectPath = this.projectPath
    const planningMode = this.isPlanningMode

    // startSession will use --continue to preserve conversation
    await this.startSession(projectPath, planningMode)

    this.emit('session-resumed', { projectPath, approvedTools: Array.from(this.approvedTools) })
    console.log('✅ Session restarted with new permissions and preserved conversation')
  }

  /**
   * Stop current session (async)
   * Called when project closes or app quits
   * Returns promise that resolves when process actually exits
   */
  async stopSession(): Promise<void> {
    console.log('🛑 Stopping Claude CLI session...')

    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout)
      this.restartTimeout = null
    }

    if (!this.claudeProcess) {
      // Already stopped
      this.sessionState = 'stopped'
      this.projectPath = null
      this.buffer = ''
      this.restartAttempts = 0
      return
    }

    return new Promise<void>((resolve) => {
      const process = this.claudeProcess!

      // Remove all existing listeners to prevent interference
      process.removeAllListeners()

      // Set up one-time exit listener
      process.once('exit', (code) => {
        console.log(`✅ Claude CLI process exited with code: ${code}`)
        this.claudeProcess = null
        this.sessionState = 'stopped'
        this.projectPath = null
        this.buffer = ''
        this.restartAttempts = 0
        this.emit('session-stopped')
        console.log('✅ Claude CLI session stopped')
        resolve()
      })

      // Set up timeout for force kill
      const forceKillTimeout = setTimeout(() => {
        if (this.claudeProcess && !this.claudeProcess.killed) {
          console.log('⚠️ Force killing Claude CLI process (2s timeout)')
          this.claudeProcess.kill('SIGKILL')
        }
      }, 2000)

      // Clean up timeout when process exits
      process.once('exit', () => clearTimeout(forceKillTimeout))

      // Send SIGTERM to gracefully shutdown
      console.log('📤 Sending SIGTERM to Claude CLI process')
      process.kill('SIGTERM')
    })
  }

  /**
   * Restart session after crash (for error recovery)
   * Uses --continue flag to attempt conversation preservation
   */
  private async restartSession(): Promise<void> {
    if (!this.projectPath) {
      console.error('❌ Cannot restart session: no project path')
      return
    }

    if (this.restartAttempts >= this.maxRestartAttempts) {
      console.error('❌ Max restart attempts reached')
      this.sessionState = 'error'
      this.emit('error', {
        message: 'Claude CLI session crashed too many times',
        recoverable: false
      })
      return
    }

    this.restartAttempts++
    const delay = Math.pow(2, this.restartAttempts) * 1000 // Exponential backoff

    console.log(`🔄 Crash recovery: Restarting session in ${delay}ms (attempt ${this.restartAttempts}/${this.maxRestartAttempts})`)
    console.log('📝 --continue will attempt conversation preservation')

    this.emit('session-restarting', {
      attempt: this.restartAttempts,
      maxAttempts: this.maxRestartAttempts
    })

    this.restartTimeout = setTimeout(async () => {
      try {
        // --continue will automatically attempt to preserve conversation
        await this.startSession(this.projectPath!, this.isPlanningMode)
        console.log('✅ Session restarted successfully after crash')
        this.restartAttempts = 0 // Reset on success
      } catch (error) {
        console.error('❌ Restart failed:', error)
        this.restartSession() // Try again
      }
    }, delay)
  }

  /**
   * Get current session state
   */
  getSessionState(): SessionState {
    return this.sessionState
  }

  /**
   * Get session statistics
   */
  getSessionStats(): SessionStats {
    return { ...this.sessionStats }
  }

  /**
   * Get message count (convenience method)
   */
  getMessageCount(): number {
    return this.sessionStats.messageCount
  }

  /**
   * Handle stdout data (continuous JSONL parsing)
   */
  private handleStdout(data: Buffer): void {
    this.buffer += data.toString()
    const lines = this.buffer.split('\n')

    // Keep the last incomplete line in buffer
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue

      try {
        const event: ClaudeCliEvent = JSON.parse(line)
        const message = this.convertEvent(event)

        if (message) {
          console.log(`📨 Message:`, message.type, message.content.substring(0, 50))
          this.emit('message', message)
        }
      } catch (error) {
        console.error('❌ Failed to parse JSONL event:', line, error)
      }
    }
  }

  /**
   * Handle process exit
   */
  private handleProcessExit(code: number | null): void {
    this.claudeProcess = null

    if (this.sessionState === 'stopped') {
      // Manual stop, don't restart
      return
    }

    if (code === 0) {
      // Normal exit (shouldn't happen in persistent mode)
      console.log('ℹ️ Claude CLI exited normally (unexpected)')
      this.sessionState = 'stopped'
      this.emit('session-stopped')
    } else {
      // Abnormal exit, attempt restart
      console.error(`❌ Claude CLI crashed with code ${code}`)
      this.sessionState = 'error'
      this.restartSession()
    }
  }

  /**
   * Build prompt with context
   */
  private buildPrompt(prompt: string, context?: Partial<ClaudeMessageContext>): string {
    let fullPrompt = prompt

    if (context?.projectPath) {
      fullPrompt = `Project path: ${context.projectPath}\n\n${fullPrompt}`
    }

    if (context?.currentFile) {
      fullPrompt = `Current file: ${context.currentFile}\n\n${fullPrompt}`
    }

    if (context?.selectedText) {
      fullPrompt = `Selected text:\n${context.selectedText}\n\n${fullPrompt}`
    }

    return fullPrompt
  }

  /**
   * Convert Claude CLI event to our unified format
   * Handles both traditional events and streaming events
   */
  private convertEvent(event: ClaudeCliEvent): ClaudeMessage | null {
    // === STREAMING EVENTS (--include-partial-messages) ===

    // Message start - Initialize streaming message
    if (event.type === 'message_start' && event.message) {
      const messageId = event.message.id || this.generateId()
      this.currentMessageId = messageId

      const streamingMessage: StreamingMessage = {
        id: messageId,
        type: 'assistant',
        content: '',
        metadata: {
          model: event.message.model,
          message_id: messageId,
          usage: event.message.usage,
          isStreaming: true
        },
        timestamp: new Date(),
        contentBlocks: new Map(),
        isStreaming: true
      }

      this.streamingMessages.set(messageId, streamingMessage)

      // Emit create event for new streaming message
      return {
        id: messageId,
        type: 'assistant',
        content: '',
        metadata: {
          ...streamingMessage.metadata,
          isStreaming: true
        },
        timestamp: streamingMessage.timestamp
      }
    }

    // Content block start - Initialize content block in streaming message
    if (event.type === 'content_block_start' && this.currentMessageId) {
      const streamingMessage = this.streamingMessages.get(this.currentMessageId)
      if (streamingMessage && event.index !== undefined) {
        streamingMessage.contentBlocks.set(event.index, '')
      }
      // Don't emit, this is internal state
      return null
    }

    // Content block delta - Accumulate streaming text
    if (event.type === 'content_block_delta' && this.currentMessageId && event.delta?.text) {
      const streamingMessage = this.streamingMessages.get(this.currentMessageId)
      if (streamingMessage && event.index !== undefined) {
        // Append delta to content block
        const blockContent = streamingMessage.contentBlocks.get(event.index) || ''
        streamingMessage.contentBlocks.set(event.index, blockContent + event.delta.text)

        // Rebuild full content from all blocks
        streamingMessage.content = Array.from(streamingMessage.contentBlocks.values()).join('')

        // Emit update event with accumulated content
        this.emit('message-update', {
          id: streamingMessage.id,
          type: 'assistant',
          content: streamingMessage.content,
          metadata: {
            ...streamingMessage.metadata,
            isStreaming: true
          },
          timestamp: streamingMessage.timestamp
        })
      }
      return null // Don't return new message, we emit update event
    }

    // Content block stop - Finalize content block
    if (event.type === 'content_block_stop' && this.currentMessageId) {
      // Just marks block as complete, no action needed
      return null
    }

    // Message delta - Update metadata (usage, stop_reason)
    if (event.type === 'message_delta' && this.currentMessageId && event.delta) {
      const streamingMessage = this.streamingMessages.get(this.currentMessageId)
      if (streamingMessage) {
        // Update usage metadata if present
        if (event.delta.usage) {
          streamingMessage.metadata.usage = event.delta.usage
        }
        if (event.delta.stop_reason) {
          streamingMessage.metadata.stop_reason = event.delta.stop_reason
        }

        // Emit metadata update
        this.emit('message-update', {
          id: streamingMessage.id,
          type: 'assistant',
          content: streamingMessage.content,
          metadata: {
            ...streamingMessage.metadata,
            isStreaming: true
          },
          timestamp: streamingMessage.timestamp
        })
      }
      return null
    }

    // Message stop - Finalize streaming message
    if (event.type === 'message_stop' && this.currentMessageId) {
      const streamingMessage = this.streamingMessages.get(this.currentMessageId)
      if (streamingMessage) {
        // Accumulate tokens from this message
        this.accumulateTokens(streamingMessage.metadata.usage)

        // Track assistant message (streaming mode)
        this.sessionStats.messageCount++
        console.log(`📊 Message count (streaming): ${this.sessionStats.messageCount}`)

        // Mark as complete
        streamingMessage.isStreaming = false
        streamingMessage.metadata.isStreaming = false

        // Emit final update with cumulative tokens
        this.emit('message-complete', {
          id: streamingMessage.id,
          type: 'assistant',
          content: streamingMessage.content,
          metadata: {
            ...streamingMessage.metadata,
            isStreaming: false,
            cumulativeUsage: { ...this.cumulativeTokens } // Include running total
          },
          timestamp: streamingMessage.timestamp
        })

        // Clean up
        this.streamingMessages.delete(this.currentMessageId)
        this.currentMessageId = null
      }
      return null
    }

    // === TRADITIONAL EVENTS (non-streaming) ===

    // System init event - suppress entirely (not needed in UI)
    if (event.type === 'system' && event.subtype === 'init') {
      return null
    }

    // Result event - Include rich metadata (cost, timing, tokens)
    if (event.type === 'result') {
      return {
        id: this.generateId(),
        type: 'system',
        content: '✓ Complete',
        metadata: {
          // Preserve all rich metadata
          duration_ms: event.duration_ms,
          duration_api_ms: event.duration_api_ms,
          num_turns: event.num_turns,
          total_cost_usd: event.total_cost_usd,
          usage: event.usage,
          modelUsage: event.modelUsage,
          is_error: event.is_error,
          permission_denials: event.permission_denials,
          stats: event.stats
        },
        timestamp: new Date()
      }
    }

    // User message (replayed by --replay-user-messages)
    if (event.type === 'user' && event.message?.content) {
      const content = event.message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')

      if (content) {
        // Track message count
        this.sessionStats.messageCount++
        console.log(`📊 Message count: ${this.sessionStats.messageCount}`)

        return {
          id: this.generateId(),
          type: 'user',
          content,
          metadata: event,
          timestamp: new Date()
        }
      }
    }

    // Assistant message
    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        // Text content - Preserve usage metadata
        if (block.type === 'text' && block.text) {
          // Accumulate tokens
          this.accumulateTokens(event.message.usage)

          // Track message count
          this.sessionStats.messageCount++
          console.log(`📊 Message count: ${this.sessionStats.messageCount}`)

          return {
            id: this.generateId(),
            type: 'assistant',
            content: block.text,
            metadata: {
              // Preserve token usage and model info
              model: event.message.model,
              message_id: event.message.id,
              stop_reason: event.message.stop_reason,
              usage: event.message.usage,
              cumulativeUsage: { ...this.cumulativeTokens }, // Include running total
              session_id: event.session_id
            },
            timestamp: new Date()
          }
        }

        // Tool use
        if (block.type === 'tool_use' && block.name) {
          const toolName = block.name

          // Check if tool is approved
          if (!this.approvedTools.has(toolName)) {
            // Tool needs approval
            console.log(`⚠️ Tool ${toolName} requires approval`)

            // Send a system message to UI
            this.emit('message', {
              id: this.generateId(),
              type: 'system',
              content: `⚠️ ${toolName} tool requires approval - please review and approve to use this tool`,
              timestamp: new Date()
            })

            // Emit approval request (shows dialog)
            this.emit('tool-approval-needed', {
              toolName: toolName,
              toolId: block.id,
              input: block.input,
              description: this.getToolDescription(toolName)
            })

            // Suppress the tool_use message - don't show it to user
            return null
          }

          // Tool is approved, show normally
          const startTime = Date.now()
          if (block.id) {
            this.toolExecutionStart.set(block.id, startTime)
          }

          // Track tool execution
          this.sessionStats.toolExecutions++
          console.log(`📊 Tool executions: ${this.sessionStats.toolExecutions}`)

          return {
            id: this.generateId(),
            type: 'tool_use',
            content: `⏺ ${toolName}`,
            metadata: {
              name: toolName,
              input: block.input,
              tool_use_id: block.id,
              startTime: startTime
            },
            timestamp: new Date()
          }
        }

        // Tool result - Capture tool execution output with timing
        if (block.type === 'tool_result') {
          // Calculate execution duration
          const startTime = block.tool_use_id ? this.toolExecutionStart.get(block.tool_use_id) : undefined
          const endTime = Date.now()
          const duration = startTime ? endTime - startTime : undefined

          // Clean up timing map
          if (startTime && block.tool_use_id) {
            this.toolExecutionStart.delete(block.tool_use_id)
          }

          return {
            id: this.generateId(),
            type: 'tool_result',
            content: block.content || '[No output]',
            metadata: {
              tool_use_id: block.tool_use_id,
              is_error: block.is_error,
              duration_ms: duration,
              endTime: endTime
            },
            timestamp: new Date()
          }
        }
      }
    }

    return null
  }

  /**
   * Accumulate token usage for session tracking
   */
  private accumulateTokens(usage: TokenUsage | undefined): void {
    if (!usage) return

    this.cumulativeTokens.input_tokens += usage.input_tokens || 0
    this.cumulativeTokens.output_tokens += usage.output_tokens || 0
    this.cumulativeTokens.cache_read_input_tokens += usage.cache_read_input_tokens || 0
    this.cumulativeTokens.cache_creation_input_tokens += usage.cache_creation_input_tokens || 0
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Generate UUID-compatible session ID for --session-id flag
   */
  private generateSessionId(): string {
    // Generate a simple UUID v4 format
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  /**
   * Get human-readable description for tool
   */
  private getToolDescription(toolName: string): string {
    const descriptions: Record<string, string> = {
      Write: 'Create or overwrite files',
      Edit: 'Modify existing files',
      MultiEdit: 'Make multiple edits to a single file',
      Read: 'Read file contents',
      Bash: 'Execute shell commands',
      LS: 'List directory contents',
      Glob: 'Search for files by pattern',
      Grep: 'Search file contents',
      Task: 'Delegate to specialized agent',
      WebSearch: 'Search the web',
      WebFetch: 'Fetch web content',
      SlashCommand: 'Execute custom slash command',
      TodoRead: 'Read current to-do list',
      TodoWrite: 'Create and manage task list',
      NotebookRead: 'Read Jupyter notebook files',
      NotebookEdit: 'Edit Jupyter notebook cells',
      ExitPlanMode: 'Exit planning phase'
    }
    return descriptions[toolName] || `Use ${toolName} tool`
  }

}

// Export singleton instance
export const claudeCliService = new ClaudeCliService()
