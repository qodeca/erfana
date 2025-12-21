/**
 * TerminalService - PTY Management
 *
 * Manages pseudo-terminals using node-pty for terminal emulation.
 * Follows the OOP service pattern established by ClaudeCliService.
 */

import { EventEmitter } from 'events'
import { homedir, platform as osPlatform } from 'os'
import type { IPty } from 'node-pty'
import { logger } from './LoggingService'

// Dynamic import for node-pty (optional dependency)
type NodePtyModule = typeof import('node-pty')
let pty: NodePtyModule | null = null
// Test override: allow injecting a mock pty module for unit tests
try {
  const injected = (globalThis as unknown as { __ERFANA_TEST_PTY__?: NodePtyModule }).__ERFANA_TEST_PTY__
  if (injected) {
    pty = injected as NodePtyModule
  }
} catch {
  // No test override available
}
// Kick off loading in background
void import('node-pty')
  .then((mod) => {
    pty = mod
  })
  .catch((error) => {
    logger.error('⚠️ node-pty not available', error instanceof Error ? error : undefined)
  })

/**
 * Terminal instance data
 */
interface TerminalInstance {
  id: string
  ptyProcess: IPty
  cwd: string
  title: string
  initializationComplete: boolean // Track whether terminal has finished init
  isClearing: boolean // Track clearing phase to prevent forwarding clear sequence
  clearFallbackTimeout?: NodeJS.Timeout // Safety timeout for clear confirmation
  hasReceivedMarker: boolean // Track if marker was detected (prevents late data forwarding)
  webContentsId: number // Track owning webContents for cleanup on window close
}

/**
 * Terminal configuration
 */
interface TerminalConfig {
  shell?: string
  cwd?: string
  env?: Record<string, string>
  cols?: number
  rows?: number
}

export class TerminalService extends EventEmitter {
  private terminals: Map<string, TerminalInstance> = new Map()
  private terminalCounter = 0

  /**
   * Check if node-pty is available and optionally check terminal initialization state
   */
  isAvailable(terminalId?: string): { available: boolean; initialized?: boolean } {
    const available = pty !== null

    // If terminalId is provided, also check initialization state
    if (terminalId) {
      const terminal = this.terminals.get(terminalId)
      return {
        available,
        initialized: terminal ? terminal.initializationComplete : false
      }
    }

    return { available }
  }

  /**
   * Clean environment variables before passing to PTY
   * Removes development/build-specific variables that leak into terminal
   */
  private cleanEnvironment(
    baseEnv: NodeJS.ProcessEnv
  ): Record<string, string | undefined> {
    const filtered: Record<string, string | undefined> = {}

    // Development/build variables to exclude
    const excludePatterns = [
      /^NODE_ENV$/,
      /^ELECTRON_/,
      /^npm_/,
      /^INIT_CWD$/,
      /^VITE_/,
      /^FORCE_COLOR$/,
      /^COLORTERM$/ // Will be set explicitly in spawn options
    ]

    for (const [key, value] of Object.entries(baseEnv)) {
      if (!excludePatterns.some((pattern) => pattern.test(key))) {
        filtered[key] = value
      }
    }

    return filtered
  }

  /**
   * Create a new terminal instance
   * @param config - Terminal configuration
   * @param webContentsId - ID of the webContents that owns this terminal (for cleanup on window close)
   */
  async createTerminal(config: TerminalConfig = {}, webContentsId?: number): Promise<string | null> {
    if (!pty) {
      try {
        pty = await import('node-pty')
      } catch (e) {
        logger.error('❌ Cannot create terminal: node-pty not available', e instanceof Error ? e : undefined)
        return null
      }
    }

    const terminalId = `terminal-${++this.terminalCounter}`

    // Determine shell based on platform
    const shell = config.shell || this.getDefaultShell()
    const cwd = config.cwd || process.env.HOME || homedir()
    const cols = config.cols || 80
    const rows = config.rows || 24

    logger.info(`🔵 Creating terminal: ${terminalId}`)
    logger.info(`🔵 Shell: ${shell}`)
    logger.info(`🔵 CWD: ${cwd}`)
    logger.info(`🔵 Size: ${cols}x${rows}`)

    try {
      // Generate unique marker for CWD verification
      const marker = `__ERFANA_PWD_MARKER_${Date.now()}__`

      // Build bootstrap script that verifies CWD non-interactively, then execs into interactive shell
      // This prevents TTY echo of verification commands (no interactive input = no echo)
      const shellArgs: string[] = []

      if (osPlatform() === 'win32') {
        // Windows: PowerShell bootstrap then start interactive session
        if (shell.includes('powershell')) {
          const pwshPath = cwd.replace(/`/g, '``').replace(/"/g, '`"')
          const bootstrapScript = [
            `Set-Location -Path "${pwshPath}"`,
            'Write-Output (Get-Location).Path',
            `Write-Output ${marker}`,
            // Start interactive PowerShell session (Windows doesn't have exec)
            `& "${shell}" -NoLogo`
          ].join('; ')
          shellArgs.push('-NoProfile', '-Command', bootstrapScript)
        } else {
          // cmd.exe - no verification, just use cwd
          // cmd.exe has no equivalent to exec
        }
      } else {
        // POSIX: Run non-interactive bootstrap, then exec into login interactive shell
        // The exec replaces the process, so PTY continues but now running interactive shell
        const bootstrapScript = [
          `cd "${cwd}"`,           // Change to target directory
          'pwd',                    // Print working directory (for verification)
          `echo ${marker}`,         // Print marker (triggers clear handshake)
          `exec -l "$SHELL" -i`     // Exec into login interactive shell (replaces process)
        ].join('; ')
        shellArgs.push('-c', bootstrapScript)
      }

      // Spawn PTY process with bootstrap script
      const ptyProcess = pty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...this.cleanEnvironment(process.env),
          ...config.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          // Set traditional prompt: username directory $
          // %n = username, %~ = current directory (~ for home)
          PROMPT: '%n %~ $ ',
          PS1: '%n %~ $ ',
          // Disable macOS session restoration (prevents "Restored session" message)
          SHELL_SESSIONS_DISABLE: '1'
        }
      })

      // Store terminal instance
      const terminal: TerminalInstance = {
        id: terminalId,
        ptyProcess,
        cwd,
        title: `Terminal ${this.terminalCounter}`,
        initializationComplete: false, // Will be set to true after cwd verification
        isClearing: false, // Will be set to true during terminal clear phase
        hasReceivedMarker: false, // Will be set to true when marker is detected
        // Track owning webContents for cleanup on window close (issue #59)
        // Sentinel value -1 means "no owner" - terminals with -1 won't be cleaned up
        // during window destruction (used in tests and manual terminal creation)
        webContentsId: webContentsId ?? -1
      }

      this.terminals.set(terminalId, terminal)

      // Marker detection: buffer data until we see the marker from bootstrap script
      let markerBuffer = ''
      let markerDetected = false
      const markerDetector = (data: string) => {
        if (markerDetected) return
        markerBuffer += data
        if (markerBuffer.includes(marker)) {
          markerDetected = true

          // Parse PWD from output (line before marker)
          const lines = markerBuffer.split(/\r?\n/).filter(Boolean)
          const markerIdx = lines.findIndex((l) => l.includes(marker))
          if (markerIdx > 0) {
            const detectedCwd = lines[markerIdx - 1].trim()
            if (detectedCwd) {
              const term = this.terminals.get(terminalId)
              if (term) term.cwd = detectedCwd
            }
          }

          // Trigger clear handshake
          logger.info(`[MARKER DETECTED] Terminal ${terminalId} - emitting clearTerminal event`)
          const term = this.terminals.get(terminalId)
          if (term) {
            logger.info(`[MARKER DETECTED] Setting hasReceivedMarker=true, isClearing=true`)
            term.hasReceivedMarker = true
            term.isClearing = true

            this.emit('clearTerminal', { terminalId })

            // Safety fallback: if renderer doesn't respond in 3 seconds, enable anyway
            term.clearFallbackTimeout = setTimeout(() => {
              const t = this.terminals.get(terminalId)
              if (t && t.isClearing) {
                logger.warn(`⚠️ Terminal ${terminalId} clear confirmation timeout, forcing enable`)
                t.isClearing = false
                t.initializationComplete = true
                t.clearFallbackTimeout = undefined
              }
            }, 3000)
          }
        }
      }
      ptyProcess.onData(markerDetector)

      // Forward PTY output to renderer (only after initialization)
      ptyProcess.onData((data: string) => {
        const term = this.terminals.get(terminalId)
        logger.info(`[PRIMARY onData] term=${!!term}, init=${term?.initializationComplete}, clearing=${term?.isClearing}, marker=${term?.hasReceivedMarker}, dataPreview=${data.substring(0, 50).replace(/\n/g, '\\n')}`)

        // STRICT BLOCKING: Only forward if:
        // 1. Initialization complete (clear confirmed by renderer)
        // 2. NOT currently clearing
        // 3. Marker has been received (ensures no pre-marker data leaks through)
        if (term && term.initializationComplete && !term.isClearing && term.hasReceivedMarker) {
          logger.info(`[PRIMARY onData] FORWARDING data`)
          this.emit('data', { terminalId, data })
        } else {
          logger.info(`[PRIMARY onData] BLOCKING data`)
        }
      })

      // Handle PTY exit
      ptyProcess.onExit((event: { exitCode: number; signal?: number }) => {
        logger.info(`🏁 Terminal ${terminalId} exited`, event)
        this.emit('exit', { terminalId, exitCode: event.exitCode, signal: event.signal })
        this.terminals.delete(terminalId)
      })

      logger.info(`✅ Terminal ${terminalId} created (bootstrap pattern - no interactive echo)`)
      return terminalId
    } catch (error) {
      logger.error(`❌ Failed to create terminal`, error instanceof Error ? error : undefined)
      const message = error instanceof Error ? error.message : String(error)
      this.emit('error', { terminalId, error: message })
      return null
    }
  }


  /**
   * Called by renderer after clear sequence is processed
   * Enables normal terminal output
   */
  markInitializationComplete(terminalId: string): void {
    const terminal = this.terminals.get(terminalId)
    if (terminal) {
      logger.info(`✅ Terminal ${terminalId} initialization complete (clear confirmed)`)

      // Clear safety fallback timeout
      if (terminal.clearFallbackTimeout) {
        clearTimeout(terminal.clearFallbackTimeout)
        terminal.clearFallbackTimeout = undefined
      }

      terminal.isClearing = false
      terminal.initializationComplete = true

      // Note: We intentionally do NOT send a newline here
      // Sending '\r' would cause the shell to flush its output buffer,
      // which may still contain echoes from initialization commands
      // The terminal will remain clean until the user first interacts with it
    }
  }

  /**
   * Write data to terminal (synchronous, fire-and-forget)
   * Returns true if write was initiated successfully, false otherwise
   */
  write(terminalId: string, data: string): boolean {
    const terminal = this.terminals.get(terminalId)

    if (!terminal) {
      logger.error(`❌ Terminal ${terminalId} not found`)
      return false
    }

    try {
      // Simple synchronous write - no callback needed
      // The PTY will buffer and handle the write internally
      terminal.ptyProcess.write(data)
      return true
    } catch (error) {
      // Suppress EPIPE errors - terminal may have closed
      const code = (error as { code?: unknown }).code
      if (code === 'EPIPE') {
        logger.info(`ℹ️ Terminal ${terminalId} PTY closed (terminal likely exited)`)
        // Clean up the closed terminal
        this.terminals.delete(terminalId)
        this.emit('exit', { terminalId, exitCode: 0 })
        return false
      }

      logger.error(`❌ Failed to write to terminal ${terminalId}`, error instanceof Error ? error : undefined)
      const message = error instanceof Error ? error.message : String(error)
      this.emit('error', { terminalId, error: message })
      return false
    }
  }

  /**
   * Resize terminal
   */
  resize(terminalId: string, cols: number, rows: number): boolean {
    const terminal = this.terminals.get(terminalId)

    if (!terminal) {
      logger.error(`❌ Terminal ${terminalId} not found`)
      return false
    }

    try {
      terminal.ptyProcess.resize(cols, rows)
      logger.info(`📏 Terminal ${terminalId} resized to ${cols}x${rows}`)
      return true
    } catch (error) {
      logger.error(`❌ Failed to resize terminal ${terminalId}`, error instanceof Error ? error : undefined)
      const message = error instanceof Error ? error.message : String(error)
      this.emit('error', { terminalId, error: message })
      return false
    }
  }

  /**
   * Kill terminal
   */
  killTerminal(terminalId: string): boolean {
    const terminal = this.terminals.get(terminalId)

    if (!terminal) {
      logger.error(`❌ Terminal ${terminalId} not found`)
      return false
    }

    // Clear fallback timeout to prevent timer leak (issue #59)
    try {
      if (terminal.clearFallbackTimeout) {
        clearTimeout(terminal.clearFallbackTimeout)
        terminal.clearFallbackTimeout = undefined
      }
    } catch (error) {
      logger.warn(`⚠️  Failed to clear fallback timeout for terminal ${terminalId}`, error instanceof Error ? { error: error.message } : undefined)
      // Continue with kill anyway - don't let timeout error prevent cleanup
    }

    try {
      terminal.ptyProcess.kill()
      this.terminals.delete(terminalId)
      logger.info(`🛑 Terminal ${terminalId} killed`)
      return true
    } catch (error) {
      // Suppress EPIPE and ESRCH errors - process may already be dead
      const code = (error as { code?: unknown }).code
      if (code === 'EPIPE' || code === 'ESRCH') {
        logger.info(`ℹ️ Terminal ${terminalId} process already terminated`)
        this.terminals.delete(terminalId)
        return true
      }

      logger.error(`❌ Failed to kill terminal ${terminalId}`, error instanceof Error ? error : undefined)
      const message = error instanceof Error ? error.message : String(error)
      this.emit('error', { terminalId, error: message })
      return false
    }
  }

  /**
   * Get terminal info
   */
  getTerminalInfo(terminalId: string): { id: string; cwd: string; title: string } | null {
    const terminal = this.terminals.get(terminalId)

    if (!terminal) {
      return null
    }

    return {
      id: terminal.id,
      cwd: terminal.cwd,
      title: terminal.title
    }
  }

  /**
   * List all terminals
   */
  listTerminals(): Array<{ id: string; title: string }> {
    return Array.from(this.terminals.values()).map((t) => ({
      id: t.id,
      title: t.title
    }))
  }

  /**
   * Cleanup all terminals
   */
  async dispose(): Promise<void> {
    logger.info('🛑 Disposing TerminalService...')

    for (const [terminalId, terminal] of this.terminals.entries()) {
      try {
        terminal.ptyProcess.kill()
        logger.info(`✅ Terminal ${terminalId} cleaned up`)
      } catch (error) {
        // Suppress EPIPE and ESRCH errors during cleanup
        const code = (error as { code?: unknown }).code
        if (code === 'EPIPE' || code === 'ESRCH') {
          logger.info(`ℹ️ Terminal ${terminalId} already terminated`)
        } else {
          logger.error(`❌ Failed to cleanup terminal ${terminalId}`, error instanceof Error ? error : undefined)
        }
      }
    }

    this.terminals.clear()
    logger.info('✅ TerminalService disposed')
  }

  /**
   * Cleanup all terminals owned by a specific webContents.
   * Called when webContents is destroyed (window close or dev refresh).
   *
   * @param webContentsId - The ID of the destroyed webContents
   * @remarks
   * - Terminals with webContentsId=-1 (no owner) are not affected
   * - Synchronous operation - safe to call from event handlers
   * @see Issue #59 - App enters broken state after window close
   */
  cleanupForWebContentsId(webContentsId: number): void {
    logger.info(`🧹 Cleaning up terminals for webContents ${webContentsId}`)
    const terminalsToKill: string[] = []

    for (const [terminalId, terminal] of this.terminals.entries()) {
      if (terminal.webContentsId === webContentsId) {
        terminalsToKill.push(terminalId)
      }
    }

    for (const terminalId of terminalsToKill) {
      // Check if terminal still exists - it may have exited naturally between collection and kill
      if (!this.terminals.has(terminalId)) {
        continue
      }
      this.killTerminal(terminalId)
    }

    logger.info(`✅ Cleaned up ${terminalsToKill.length} terminals for webContents ${webContentsId}`)
  }

  /**
   * Get default shell based on platform
   */
  private getDefaultShell(): string {
    const platform = osPlatform()

    if (platform === 'win32') {
      // Windows: prefer PowerShell, fallback to cmd
      return process.env.SHELL || process.env.COMSPEC || 'powershell.exe'
    } else if (platform === 'darwin') {
      // macOS: prefer zsh (default since Catalina), fallback to bash
      return process.env.SHELL || '/bin/zsh'
    } else {
      // Linux/Unix: use $SHELL, fallback to bash
      return process.env.SHELL || '/bin/bash'
    }
  }
}

// Export singleton instance
export const terminalService = new TerminalService()
