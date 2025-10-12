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
 * JSONL Event types from Claude CLI (output format)
 */
interface ClaudeCliEvent {
  type: 'system' | 'user' | 'assistant' | 'result'
  subtype?: string
  message?: {
    role?: string
    content?: Array<{
      type: string
      text?: string
      id?: string
      name?: string
      input?: any
      tool_use_id?: string
    }>
  }
  session_id?: string
  tools?: any[]
  stats?: any
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

export class ClaudeCliService extends EventEmitter {
  private claudeProcess: ChildProcess | null = null
  private sessionState: SessionState = 'stopped'
  private buffer = ''
  private projectPath: string | null = null
  private restartAttempts = 0
  private maxRestartAttempts = 3
  private restartTimeout: NodeJS.Timeout | null = null
  private authCheckBypass = false
  private approvedTools: Set<string> = new Set(['Read', 'Glob', 'Grep']) // Safe defaults
  private sessionId: string | null = null

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
   * Called when project opens
   */
  async startSession(projectPath: string): Promise<void> {
    if (this.claudeProcess) {
      console.log('⚠️ Session already running, stopping first...')
      this.stopSession()
    }

    this.sessionState = 'starting'
    this.projectPath = projectPath
    this.buffer = ''
    this.restartAttempts = 0

    // Load approved tools from settings
    const approvedToolsList = await settingsService.getApprovedTools()
    this.approvedTools = new Set(approvedToolsList)

    // Generate session ID for resume support
    this.sessionId = this.generateSessionId()

    console.log(`🚀 Starting persistent Claude CLI session for: ${projectPath}`)
    console.log(`🔧 Approved tools: ${Array.from(this.approvedTools).join(', ')}`)

    try {
      // Build args with approved tools
      const args = [
        '-p', // Print mode (non-interactive, but can accept stdin)
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose', // Required for stream-json output format
        '--replay-user-messages', // Echo user messages back for acknowledgment
        '--session-id',
        this.sessionId // Use specific session ID for resume support
      ]

      // Add --allowedTools with approved tools
      // This is required for Claude CLI to actually execute the tools
      if (this.approvedTools.size > 0) {
        args.push('--allowedTools', ...Array.from(this.approvedTools))
      }

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
      this.emit('session-started', { projectPath })
      console.log('✅ Claude CLI session ready')
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
   */
  async approveTool(toolName: string, remember: boolean = false): Promise<void> {
    console.log(`✅ Approving tool: ${toolName} (remember: ${remember})`)

    // Add to approved tools
    this.approvedTools.add(toolName)

    // Save to settings if remember is true
    if (remember) {
      await settingsService.addApprovedTool(toolName)
    }

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
   */
  private async restartWithNewPermissions(): Promise<void> {
    if (!this.projectPath || !this.sessionId) {
      console.error('❌ Cannot restart: missing project path or session ID')
      return
    }

    console.log('🔄 Restarting session with updated permissions...')

    const previousSessionId = this.sessionId
    const projectPath = this.projectPath

    // Kill current process
    if (this.claudeProcess) {
      this.claudeProcess.removeAllListeners()
      this.claudeProcess.kill('SIGTERM')
      this.claudeProcess = null
    }

    this.sessionState = 'starting'
    this.buffer = ''

    try {
      // Restart with --resume and updated --allowedTools
      const args = [
        '-p',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose',
        '--replay-user-messages',
        '--resume',
        previousSessionId
      ]

      // Add updated allowed tools
      if (this.approvedTools.size > 0) {
        args.push('--allowedTools', ...Array.from(this.approvedTools))
      }

      console.log(`🔧 Resuming with tools: ${Array.from(this.approvedTools).join(', ')}`)

      this.claudeProcess = spawn('claude', args, {
        cwd: projectPath,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          HOME: process.env.HOME || homedir(),
          ANTHROPIC_API_KEY: undefined
        }
      })

      if (!this.claudeProcess.stdout || !this.claudeProcess.stderr || !this.claudeProcess.stdin) {
        throw new Error('Failed to initialize stdio')
      }

      // Setup handlers
      this.claudeProcess.stdout.on('data', (data: Buffer) => this.handleStdout(data))
      this.claudeProcess.stderr.on('data', (data: Buffer) => {
        console.error('❌ Claude CLI stderr:', data.toString())
      })
      this.claudeProcess.on('close', (code) => this.handleProcessExit(code))
      this.claudeProcess.on('error', (error) => {
        console.error('❌ Process error:', error)
        this.sessionState = 'error'
      })

      this.sessionState = 'ready'
      this.emit('session-resumed', { projectPath, approvedTools: Array.from(this.approvedTools) })
      console.log('✅ Session resumed with new permissions')
    } catch (error: any) {
      console.error('❌ Failed to restart:', error)
      this.sessionState = 'error'
      throw error
    }
  }

  /**
   * Stop current session
   * Called when project closes or app quits
   */
  stopSession(): void {
    console.log('🛑 Stopping Claude CLI session...')

    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout)
      this.restartTimeout = null
    }

    if (this.claudeProcess) {
      // Remove listeners to prevent restart on manual stop
      this.claudeProcess.removeAllListeners()

      // Kill the process
      this.claudeProcess.kill('SIGTERM')

      // Force kill if not dead after 2s
      setTimeout(() => {
        if (this.claudeProcess && !this.claudeProcess.killed) {
          console.log('⚠️ Force killing Claude CLI process')
          this.claudeProcess.kill('SIGKILL')
        }
      }, 2000)

      this.claudeProcess = null
    }

    this.sessionState = 'stopped'
    this.projectPath = null
    this.buffer = ''
    this.restartAttempts = 0

    this.emit('session-stopped')
    console.log('✅ Claude CLI session stopped')
  }

  /**
   * Restart session (for error recovery)
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

    console.log(`🔄 Restarting session in ${delay}ms (attempt ${this.restartAttempts}/${this.maxRestartAttempts})`)

    this.emit('session-restarting', {
      attempt: this.restartAttempts,
      maxAttempts: this.maxRestartAttempts
    })

    this.restartTimeout = setTimeout(async () => {
      try {
        await this.startSession(this.projectPath!)
        console.log('✅ Session restarted successfully')
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
   */
  private convertEvent(event: ClaudeCliEvent): ClaudeMessage | null {
    // System init event
    if (event.type === 'system' && event.subtype === 'init') {
      return {
        id: this.generateId(),
        type: 'system',
        content: `Session started: ${event.session_id}`,
        metadata: event,
        timestamp: new Date()
      }
    }

    // Result event
    if (event.type === 'result') {
      return {
        id: this.generateId(),
        type: 'system',
        content: '✓ Complete',
        metadata: event.stats,
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
        // Text content
        if (block.type === 'text' && block.text) {
          return {
            id: this.generateId(),
            type: 'assistant',
            content: block.text,
            metadata: event,
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
          return {
            id: this.generateId(),
            type: 'tool_use',
            content: `⏺ ${toolName}`,
            metadata: {
              name: toolName,
              input: block.input,
              tool_use_id: block.id
            },
            timestamp: new Date()
          }
        }
      }
    }

    return null
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
      Read: 'Read file contents',
      Bash: 'Execute shell commands',
      Glob: 'Search for files by pattern',
      Grep: 'Search file contents',
      Task: 'Delegate to specialized agent',
      WebSearch: 'Search the web',
      WebFetch: 'Fetch web content',
      SlashCommand: 'Execute custom slash command'
    }
    return descriptions[toolName] || `Use ${toolName} tool`
  }
}

// Export singleton instance
export const claudeCliService = new ClaudeCliService()
