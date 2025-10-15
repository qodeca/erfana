/**
 * TerminalService - PTY Management
 *
 * Manages pseudo-terminals using node-pty for terminal emulation.
 * Follows the OOP service pattern established by ClaudeCliService.
 */

import { EventEmitter } from 'events'
import { homedir, platform as osPlatform } from 'os'

// Dynamic import for node-pty (optional dependency)
let pty: any = null
try {
  pty = require('node-pty')
} catch (error) {
  console.error('⚠️ node-pty not available:', error)
}

/**
 * Terminal instance data
 */
interface TerminalInstance {
  id: string
  ptyProcess: any // IPty from node-pty
  cwd: string
  title: string
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
   * Check if node-pty is available
   */
  isAvailable(): boolean {
    return pty !== null
  }

  /**
   * Create a new terminal instance
   */
  createTerminal(config: TerminalConfig = {}): string | null {
    if (!this.isAvailable()) {
      console.error('❌ Cannot create terminal: node-pty not available')
      return null
    }

    const terminalId = `terminal-${++this.terminalCounter}`

    // Determine shell based on platform
    const shell = config.shell || this.getDefaultShell()
    const cwd = config.cwd || process.env.HOME || homedir()
    const cols = config.cols || 80
    const rows = config.rows || 24

    console.log(`🔵 Creating terminal: ${terminalId}`)
    console.log(`🔵 Shell: ${shell}`)
    console.log(`🔵 CWD: ${cwd}`)
    console.log(`🔵 Size: ${cols}x${rows}`)

    try {
      // Determine shell arguments
      // For zsh: use --no-rcs to skip all RC files and get clean prompt
      // For bash: use --norc --noprofile to skip configuration
      const shellArgs: string[] = []
      if (shell.includes('zsh')) {
        shellArgs.push('--no-rcs')
      } else if (shell.includes('bash')) {
        shellArgs.push('--norc', '--noprofile')
      }

      // Spawn PTY process
      const ptyProcess = pty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...process.env,
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
        title: `Terminal ${this.terminalCounter}`
      }

      this.terminals.set(terminalId, terminal)

      // Forward PTY output to renderer
      ptyProcess.onData((data: string) => {
        this.emit('data', { terminalId, data })
      })

      // Handle PTY exit
      ptyProcess.onExit((event: { exitCode: number; signal?: number }) => {
        console.log(`🏁 Terminal ${terminalId} exited:`, event)
        this.emit('exit', { terminalId, exitCode: event.exitCode, signal: event.signal })
        this.terminals.delete(terminalId)
      })

      console.log(`✅ Terminal ${terminalId} created`)
      return terminalId
    } catch (error: any) {
      console.error(`❌ Failed to create terminal:`, error)
      this.emit('error', { terminalId, error: error.message })
      return null
    }
  }

  /**
   * Write data to terminal
   */
  write(terminalId: string, data: string): boolean {
    const terminal = this.terminals.get(terminalId)

    if (!terminal) {
      console.error(`❌ Terminal ${terminalId} not found`)
      return false
    }

    try {
      terminal.ptyProcess.write(data)
      return true
    } catch (error: any) {
      // Suppress EPIPE errors - terminal may have closed
      if (error.code === 'EPIPE') {
        console.log(`ℹ️ Terminal ${terminalId} PTY closed (terminal likely exited)`)
        // Clean up the closed terminal
        this.terminals.delete(terminalId)
        this.emit('exit', { terminalId, exitCode: 0 })
        return false
      }

      console.error(`❌ Failed to write to terminal ${terminalId}:`, error)
      this.emit('error', { terminalId, error: error.message })
      return false
    }
  }

  /**
   * Resize terminal
   */
  resize(terminalId: string, cols: number, rows: number): boolean {
    const terminal = this.terminals.get(terminalId)

    if (!terminal) {
      console.error(`❌ Terminal ${terminalId} not found`)
      return false
    }

    try {
      terminal.ptyProcess.resize(cols, rows)
      console.log(`📏 Terminal ${terminalId} resized to ${cols}x${rows}`)
      return true
    } catch (error: any) {
      console.error(`❌ Failed to resize terminal ${terminalId}:`, error)
      this.emit('error', { terminalId, error: error.message })
      return false
    }
  }

  /**
   * Kill terminal
   */
  killTerminal(terminalId: string): boolean {
    const terminal = this.terminals.get(terminalId)

    if (!terminal) {
      console.error(`❌ Terminal ${terminalId} not found`)
      return false
    }

    try {
      terminal.ptyProcess.kill()
      this.terminals.delete(terminalId)
      console.log(`🛑 Terminal ${terminalId} killed`)
      return true
    } catch (error: any) {
      // Suppress EPIPE and ESRCH errors - process may already be dead
      if (error.code === 'EPIPE' || error.code === 'ESRCH') {
        console.log(`ℹ️ Terminal ${terminalId} process already terminated`)
        this.terminals.delete(terminalId)
        return true
      }

      console.error(`❌ Failed to kill terminal ${terminalId}:`, error)
      this.emit('error', { terminalId, error: error.message })
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
    console.log('🛑 Disposing TerminalService...')

    for (const [terminalId, terminal] of this.terminals.entries()) {
      try {
        terminal.ptyProcess.kill()
        console.log(`✅ Terminal ${terminalId} cleaned up`)
      } catch (error: any) {
        // Suppress EPIPE and ESRCH errors during cleanup
        if (error?.code === 'EPIPE' || error?.code === 'ESRCH') {
          console.log(`ℹ️ Terminal ${terminalId} already terminated`)
        } else {
          console.error(`❌ Failed to cleanup terminal ${terminalId}:`, error)
        }
      }
    }

    this.terminals.clear()
    console.log('✅ TerminalService disposed')
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
