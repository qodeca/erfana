/**
 * TerminalService - PTY Management
 *
 * Manages pseudo-terminals using node-pty for terminal emulation.
 * Follows the OOP service pattern established by ClaudeCliService.
 */

import { EventEmitter } from 'events'
import { homedir, platform as osPlatform } from 'os'
import type { IPty } from 'node-pty'

// Dynamic import for node-pty (optional dependency)
type NodePtyModule = typeof import('node-pty')
let pty: NodePtyModule | null = null
// Test override: allow injecting a mock pty module for unit tests
try {
  const injected = (globalThis as any).__ERFANA_TEST_PTY__
  if (injected) {
    pty = injected as NodePtyModule
  }
} catch {}
// Kick off loading in background
void import('node-pty')
  .then((mod) => {
    pty = mod
  })
  .catch((error) => {
    console.error('⚠️ node-pty not available:', error)
  })

/**
 * Terminal instance data
 */
interface TerminalInstance {
  id: string
  ptyProcess: IPty
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
  async createTerminal(config: TerminalConfig = {}): Promise<string | null> {
    if (!pty) {
      try {
        pty = await import('node-pty')
      } catch (e) {
        console.error('❌ Cannot create terminal: node-pty not available', e)
        return null
      }
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
      // Determine shell arguments based on platform
      // Windows shells (PowerShell, cmd) don't support -l flag
      // Unix shells (zsh, bash) use -l to source RC files and load full environment
      const shellArgs: string[] = []

      if (osPlatform() === 'win32') {
        // Windows: PowerShell uses -NoProfile to load full environment
        // cmd.exe has no equivalent, so no arguments needed
        if (shell.includes('powershell')) {
          shellArgs.push('-NoProfile')
        }
      } else {
        // macOS/Linux: Use login shell (-l) to source RC files
        // This ensures Homebrew paths and other shell configurations are available
        shellArgs.push('-l')
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
      // Ensure shell actually starts in requested cwd; then confirm with marker
      try {
        await this.verifyAndSetCwd(terminal, shell)
      } catch (e) {
        console.warn('Failed to verify working directory:', e)
      }
      return terminalId
    } catch (error) {
      console.error(`❌ Failed to create terminal:`, error)
      const message = error instanceof Error ? error.message : String(error)
      this.emit('error', { terminalId, error: message })
      return null
    }
  }

  /**
   * Ensure the PTY process is in the expected cwd by issuing a cd and
   * then printing the directory with a unique marker. Updates the
   * terminal instance cwd when detected.
   */
  private async verifyAndSetCwd(terminal: { id: string; ptyProcess: IPty; cwd: string }, shell: string) {
    const marker = `__ERFANA_PWD_MARKER_${Date.now()}__`
    const platform = osPlatform()
    const target = terminal.cwd

    // Compose platform-specific commands
    let cmd = ''
    if (platform === 'win32') {
      const isPwsh = shell.toLowerCase().includes('powershell')
      if (isPwsh) {
        // PowerShell
        cmd = `Set-Location -Path \"${target.replace(/`/g, '``').replace(/"/g, '\"')}\"\r\nWrite-Output (Get-Location).Path\r\nWrite-Output ${marker}\r\n`
      } else {
        // cmd.exe
        cmd = `cd /d \"${target.replace(/"/g, '"')}\"\r\ncd\r\necho ${marker}\r\n`
      }
    } else {
      // POSIX shells
      const escaped = target.replace(/"/g, '\\"')
      cmd = `cd \"${escaped}\"\nprintf \"%s\\n\" \"$(pwd)\"\necho ${marker}\n`
    }

    let buffer = ''
    const onData = (data: string) => {
      buffer += data
      if (buffer.includes(marker)) {
        // try to parse last path before marker
        const lines = buffer.split(/\r?\n/).filter(Boolean)
        const idx = lines.findIndex((l) => l.includes(marker))
        if (idx > 0) {
          const detected = lines[idx - 1].trim()
          if (detected) {
            // Update cached cwd
            const t = this.terminals.get(terminal.id)
            if (t) t.cwd = detected
          }
        }
        // Remove listener once done
        terminal.ptyProcess.off?.('data', onData as any)
      }
    }

    // Add temporary listener in addition to the public forwarder
    terminal.ptyProcess.on('data', onData as any)
    // Issue commands
    try {
      terminal.ptyProcess.write(cmd)
    } catch (e) {
      // Ignore if write fails; verification is best-effort
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
    } catch (error) {
      // Suppress EPIPE errors - terminal may have closed
      const code = (error as { code?: unknown }).code
      if (code === 'EPIPE') {
        console.log(`ℹ️ Terminal ${terminalId} PTY closed (terminal likely exited)`)
        // Clean up the closed terminal
        this.terminals.delete(terminalId)
        this.emit('exit', { terminalId, exitCode: 0 })
        return false
      }

      console.error(`❌ Failed to write to terminal ${terminalId}:`, error)
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
      console.error(`❌ Terminal ${terminalId} not found`)
      return false
    }

    try {
      terminal.ptyProcess.resize(cols, rows)
      console.log(`📏 Terminal ${terminalId} resized to ${cols}x${rows}`)
      return true
    } catch (error) {
      console.error(`❌ Failed to resize terminal ${terminalId}:`, error)
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
      console.error(`❌ Terminal ${terminalId} not found`)
      return false
    }

    try {
      terminal.ptyProcess.kill()
      this.terminals.delete(terminalId)
      console.log(`🛑 Terminal ${terminalId} killed`)
      return true
    } catch (error) {
      // Suppress EPIPE and ESRCH errors - process may already be dead
      const code = (error as { code?: unknown }).code
      if (code === 'EPIPE' || code === 'ESRCH') {
        console.log(`ℹ️ Terminal ${terminalId} process already terminated`)
        this.terminals.delete(terminalId)
        return true
      }

      console.error(`❌ Failed to kill terminal ${terminalId}:`, error)
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
    console.log('🛑 Disposing TerminalService...')

    for (const [terminalId, terminal] of this.terminals.entries()) {
      try {
        terminal.ptyProcess.kill()
        console.log(`✅ Terminal ${terminalId} cleaned up`)
      } catch (error) {
        // Suppress EPIPE and ESRCH errors during cleanup
        const code = (error as { code?: unknown }).code
        if (code === 'EPIPE' || code === 'ESRCH') {
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
