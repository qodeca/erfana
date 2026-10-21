// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * TerminalService - PTY Management
 *
 * Manages pseudo-terminals using node-pty for terminal emulation.
 * Follows the OOP service pattern established by ClaudeCliService.
 */

import { EventEmitter } from 'events'
import { existsSync } from 'fs'
import { homedir, platform as osPlatform } from 'os'
import type { IPty } from 'node-pty'
import type { ShellKind } from '../../shared/shellKind'
import { logger } from './LoggingService'
import { redactPath } from '../utils/redactUserInput'
import {
  buildWindowsBootstrap,
  normalizeWindowsCwd,
  validateWindowsCwd
} from './WindowsTerminalBootstrap'
import { isWindowsLongPath } from './watcher/PlatformConfig'
import { isForegroundBusy, shellProcessNames } from './terminalForeground'

/**
 * Outcome of {@link TerminalService.createTerminal}. A failure carries its
 * reason as plain text for the renderer. It used to be `null` for every
 * failure, and the IPC handler — which cannot see the `'error'` event for a
 * terminal whose id it never learned — could only say "Failed to create
 * terminal".
 */
export type TerminalCreateResult =
  | { terminalId: string; shellKind: ShellKind }
  | { error: string }

/**
 * Win32 `CreateProcess` refuses a working directory over MAX_PATH whatever
 * the long-paths policy says; node-pty surfaces it as ENOENT. Only a shorter
 * path fixes it, so the message says that.
 */
export const TERMINAL_CWD_TOO_LONG_MESSAGE =
  "This folder's path is longer than Windows allows for a terminal (260 characters). Move the project to a shorter path."

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
  /** OS pid of the spawned PTY process; main-only, never sent over IPC (#216 §10). */
  pid?: number
  cwd: string
  title: string
  initializationComplete: boolean // Track whether terminal has finished init
  isClearing: boolean // Track clearing phase to prevent forwarding clear sequence
  clearFallbackTimeout?: NodeJS.Timeout // Safety timeout for clear confirmation
  hasReceivedMarker: boolean // Track if marker was detected (prevents late data forwarding)
  /** Output that arrived after the marker line while the clear handshake was open; flushed in order once it ends. */
  pendingOutput: string
  webContentsId: number // Track owning webContents for cleanup on window close
  shellKind: ShellKind // Quoting flavour resolved at create time (#164)
  shellNames: ReadonlySet<string> // Names the idle shell shows as; see terminalForeground.ts
  exited: Promise<void> // Settles when node-pty reports the shell exit (#214)
}

/**
 * How long `dispose()` waits for killed shells to report their exit (#214).
 *
 * On Windows, node-pty reports a ConPTY shell's exit from a native thread that
 * calls back into JavaScript. If the app exits first, that callback lands while
 * Node is tearing down and V8 aborts the process ("Invoke in
 * DisallowJavascriptExecutionScope"). Waiting for the exit lets the callback run
 * while JavaScript is still allowed. Measured on Windows 11: 115–400 ms after
 * kill. Kept below the 2 s shutdown bound in `src/main/index.ts`.
 */
export const TERMINAL_EXIT_WAIT_MS = 1_500

/** Most output kept while waiting for the bootstrap marker (64 KiB). */
export const MARKER_BUFFER_MAX_CHARS = 64 * 1024

/** Most post-marker output held while the clear handshake is open (64 KiB, newest kept). */
export const PENDING_OUTPUT_MAX_CHARS = 64 * 1024

/**
 * Drops the rest of the marker's own line from output that follows the marker.
 *
 * The shell prints the marker followed by a line break. That break belongs to
 * the hidden handshake, anything after it is real output (a prompt can follow
 * within the same chunk). `pending` is true when the line break has not fully
 * arrived yet (the chunk ended on the marker, or on a lone `\r`), so the next
 * chunk must be given to this function again.
 */
export function stripMarkerLineEnd(text: string): { rest: string; pending: boolean } {
  const eol = /^[ \t]*\r?\n/.exec(text)
  if (eol) return { rest: text.slice(eol[0].length), pending: false }
  if (/^[ \t]*\r?$/.test(text)) return { rest: '', pending: true }
  return { rest: text, pending: false }
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
  /** Exits of killed shells not yet reported by node-pty; `dispose()` waits for them (#214). */
  private pendingExits = new Set<Promise<void>>()

  /**
   * @param fsExists - injected for `resolveWindowsShell()` testability;
   *                   defaults to `fs.existsSync`. The exported singleton at
   *                   the bottom of this file uses the default.
   */
  constructor(
    private readonly fsExists: (p: string) => boolean = existsSync
  ) {
    super()
  }

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
   * Clean environment variables before passing to PTY.
   *
   * Removes development/build-specific variables that leak into the terminal, and
   * the Claude Code nested-session markers. MUST be applied to the FULLY MERGED
   * environment (base + caller-supplied): the caller-supplied half arrives over
   * IPC, so filtering only the base would leave the guarantee bypassable.
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
      /^COLORTERM$/, // Will be set explicitly in spawn options
      // Claude Code session markers. If Erfana itself was launched from inside a
      // Claude Code session (e.g. `npm run dev` started by the agent), these are
      // inherited; passing them into a spawned terminal makes a `claude` launched
      // there believe it is a NESTED/child session, which (per Claude Code
      // v2.1.170) silently suppresses transcript persistence — leaving the Claude
      // status bar with no usage to read. Strip them so an in-terminal `claude`
      // is always a clean top-level session. ANTHROPIC_* (e.g. API keys) are left
      // intact intentionally.
      /^CLAUDECODE$/,
      /^CLAUDE_CODE_/
    ]

    for (const [key, value] of Object.entries(baseEnv)) {
      if (!excludePatterns.some((pattern) => pattern.test(key))) {
        filtered[key] = value
      }
    }

    return filtered
  }

  /**
   * Create a new terminal instance.
   *
   * Returns the new terminal id alongside the resolved {@link ShellKind} so
   * the renderer can quote pasted paths correctly without a follow-up IPC
   * round-trip (#164 round-2 F#1). Returns `{ error }` if node-pty is
   * unavailable, the cwd fails validation, or the spawn throws — see
   * {@link TerminalCreateResult} for why the reason travels in the result.
   *
   * @param config - Terminal configuration
   * @param webContentsId - ID of the webContents that owns this terminal (for cleanup on window close)
   */
  async createTerminal(
    config: TerminalConfig = {},
    webContentsId?: number
  ): Promise<TerminalCreateResult> {
    if (!pty) {
      try {
        pty = await import('node-pty')
      } catch (e) {
        logger.error('❌ Cannot create terminal: node-pty not available', e instanceof Error ? e : undefined)
        return { error: 'Terminal support is not available (node-pty failed to load)' }
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
    logger.info(`🔵 CWD: ${redactPath(cwd)}`)
    logger.info(`🔵 Size: ${cols}x${rows}`)

    try {
      // Generate unique marker for CWD verification
      const marker = `__ERFANA_PWD_MARKER_${Date.now()}__`

      // Build bootstrap script that verifies CWD non-interactively, then execs into interactive shell
      // This prevents TTY echo of verification commands (no interactive input = no echo)
      const shellArgs: string[] = []
      // `shellKind` is recorded on the TerminalInstance AND returned to the
      // renderer via the create response so renderer-side path-quoting can
      // pick the right flavour per terminal (#164 round-2 F#1).
      let shellKind: ShellKind = 'posix'

      if (osPlatform() === 'win32') {
        // Win32 CreateProcess hard-fails on a cwd over MAX_PATH and node-pty
        // reports a bare ENOENT. Found on a 320-char project path during the
        // v0.19.0 Windows verification; the renderer showed only "Failed to
        // create terminal". The length is logged, never the path.
        if (isWindowsLongPath(cwd)) {
          logger.error(`❌ Cannot create terminal ${terminalId}: cwd exceeds MAX_PATH (${cwd.length} chars)`)
          this.emit('error', { terminalId, error: TERMINAL_CWD_TOO_LONG_MESSAGE, webContentsId: webContentsId ?? -1 })
          return { error: TERMINAL_CWD_TOO_LONG_MESSAGE }
        }
        // Validate + normalize the cwd, then dispatch to a registered
        // WindowsBootstrapBuilder. See WindowsTerminalBootstrap.ts for the
        // strategy interface and the dispatch chain.
        const validation = validateWindowsCwd(cwd)
        if (!validation.ok) {
          logger.error(`❌ Cannot create terminal ${terminalId}: ${validation.reason}`)
          this.emit('error', { terminalId, error: validation.reason, webContentsId: webContentsId ?? -1 })
          return { error: validation.reason }
        }
        const winCwd = normalizeWindowsCwd(cwd)
        const { kind, shellKind: winShellKind, shellArgs: winShellArgs } = buildWindowsBootstrap({
          shell,
          cwd: winCwd,
          marker
        })
        logger.info(`🔵 Windows shell kind: ${kind} (quoting=${winShellKind})`)
        shellArgs.push(...winShellArgs)
        shellKind = winShellKind
      } else {
        // POSIX bootstrap. We use a single-quoted argument so `$`, backtick,
        // backslash and other shell metacharacters in the cwd are inert.
        // Inside a single-quoted POSIX string the only escape is the
        // canonical `'\''` form (close, escape, reopen) – portable across
        // sh / bash / zsh / dash. `\r\n` would still break the script, so
        // those are rejected up-front.
        if (/[\r\n]/.test(cwd)) {
          const reason = 'cwd contains unsupported newline character'
          logger.error(`❌ Cannot create terminal ${terminalId}: ${reason}`)
          this.emit('error', { terminalId, error: reason, webContentsId: webContentsId ?? -1 })
          return { error: reason }
        }
        const posixEscapedCwd = cwd.replace(/'/g, "'\\''")
        // E2E fast-shell mode: exec into /bin/sh -i instead of the user's
        // login interactive $SHELL. The user's $SHELL (e.g. zsh) sources
        // .zshenv / .zprofile / .zshrc / .zlogin on a login interactive
        // start, which can take seconds with a heavy framework (oh-my-zsh,
        // async plugins). For deterministic E2E timing we use /bin/sh,
        // which reads no user rc files and starts in well under 50 ms.
        // Production (and any run without the env var) is unchanged.
        // See docs/known-issues.md § "E2E terminal-driven tests sensitive
        // to user's shell init speed".
        const innerShellCmd =
          process.env.ERFANA_E2E_FAST_SHELL === '1'
            ? 'exec /bin/sh -i'
            : `exec -l "$SHELL" -i`
        const bootstrapScript = [
          `cd '${posixEscapedCwd}'`,    // Change to target directory (literal)
          'pwd',                          // Print working directory (for verification)
          `echo ${marker}`,               // Print marker (triggers clear handshake)
          innerShellCmd                   // Exec into interactive shell (replaces process)
        ].join('; ')
        shellArgs.push('-c', bootstrapScript)
      }

      // Clean the MERGED environment, not just `process.env`. `config.env` arrives
      // from the `terminal:create` IPC payload, so cleaning the base first and
      // merging afterwards let a caller re-add the very names the exclusion list
      // exists to remove — defeating the documented guarantee that an in-terminal
      // `claude` runs as a clean top-level session. The explicit keys below are
      // applied after cleaning because `COLORTERM` is itself on the exclusion list.
      const spawnEnv: Record<string, string | undefined> = {
        ...this.cleanEnvironment({ ...process.env, ...config.env }),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        // Set traditional prompt: username directory $
        // %n = username, %~ = current directory (~ for home)
        PROMPT: '%n %~ $ ',
        PS1: '%n %~ $ ',
        // Disable macOS session restoration (prevents "Restored session" message)
        SHELL_SESSIONS_DISABLE: '1'
      }

      // Spawn PTY process with bootstrap script
      const ptyProcess = pty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: spawnEnv
      })

      let markExited: () => void = () => {}
      const exited = new Promise<void>((resolve) => {
        markExited = resolve
      })

      // Store terminal instance
      const terminal: TerminalInstance = {
        id: terminalId,
        ptyProcess,
        // Record the PTY pid for the Claude status detector (#216). Looked up
        // main-side via getPid(); never returned to or supplied by the renderer.
        pid: ptyProcess.pid,
        cwd,
        title: `Terminal ${this.terminalCounter}`,
        initializationComplete: false, // Will be set to true after cwd verification
        isClearing: false, // Will be set to true during terminal clear phase
        hasReceivedMarker: false, // Will be set to true when marker is detected
        pendingOutput: '',
        // Track owning webContents for cleanup on window close (issue #59)
        // Sentinel value -1 means "no owner" - terminals with -1 won't be cleaned up
        // during window destruction (used in tests and manual terminal creation)
        webContentsId: webContentsId ?? -1,
        shellKind,
        shellNames: shellProcessNames(
          shell,
          process.env.SHELL,
          process.env.ERFANA_E2E_FAST_SHELL === '1'
        ),
        exited
      }

      this.terminals.set(terminalId, terminal)

      // Marker detection: buffer data until we see the marker from bootstrap script
      let markerBuffer = ''
      let markerDetected = false
      // True while the line break that ends the marker line has not been seen yet
      let markerLineEndPending = false
      // Set by the detector for the chunk that held the marker, so the forwarder
      // does not process that chunk a second time
      let markerChunkHandled = false
      const markerDetector = (data: string) => {
        if (markerDetected) return
        markerBuffer += data
        // Output before the marker is bounded: keep the tail (the marker and the
        // line before it are at the end)
        if (markerBuffer.length > MARKER_BUFFER_MAX_CHARS) {
          markerBuffer = markerBuffer.slice(-MARKER_BUFFER_MAX_CHARS)
        }
        const markerAt = markerBuffer.indexOf(marker)
        if (markerAt !== -1) {
          markerDetected = true
          markerChunkHandled = true

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

            // Output that followed the marker in the same chunk (a fast shell can
            // draw its prompt right behind it) is real: hold it until the clear
            // has been applied instead of discarding it.
            const afterMarker = stripMarkerLineEnd(markerBuffer.slice(markerAt + marker.length))
            markerLineEndPending = afterMarker.pending
            this.queuePendingOutput(term, afterMarker.rest)

            this.emit('clearTerminal', { terminalId, webContentsId: webContentsId ?? -1 })

            // Safety fallback: if renderer doesn't respond in 3 seconds, enable anyway
            term.clearFallbackTimeout = setTimeout(() => {
              const t = this.terminals.get(terminalId)
              if (t && t.isClearing) {
                logger.warn(`⚠️ Terminal ${terminalId} clear confirmation timeout, forcing enable`)
                t.isClearing = false
                t.initializationComplete = true
                t.clearFallbackTimeout = undefined
                this.flushPendingOutput(t)
              }
            }, 3000)
          }
        }
      }
      ptyProcess.onData(markerDetector)

      // Forward PTY output to renderer (only after initialization).
      // These log lines fire on every PTY data chunk and are pure debug
      // instrumentation – kept at `debug` level so production logs are
      // not flooded but they are still available when chasing handshake
      // regressions.
      ptyProcess.onData((data: string) => {
        const term = this.terminals.get(terminalId)
        // Length only – PTY output is user content and must never reach the log file.
        // `logger.debug` drops the call below the configured level.
        logger.debug(`[PRIMARY onData] term=${!!term}, init=${term?.initializationComplete}, clearing=${term?.isClearing}, marker=${term?.hasReceivedMarker}, length=${data.length}`)

        // Output before the marker is bootstrap noise and is dropped. The chunk
        // that held the marker was already split by the detector.
        if (!term || !term.hasReceivedMarker) {
          logger.debug(`[PRIMARY onData] BLOCKING data`)
          return
        }
        if (markerChunkHandled) {
          markerChunkHandled = false
          return
        }

        let output = data
        if (markerLineEndPending) {
          const stripped = stripMarkerLineEnd(output)
          markerLineEndPending = stripped.pending
          output = stripped.rest
        }
        if (!output) return

        if (term.initializationComplete && !term.isClearing) {
          logger.debug(`[PRIMARY onData] FORWARDING data`)
          this.emit('data', { terminalId, data: output, webContentsId: webContentsId ?? -1 })
        } else {
          // Clear handshake still open: keep it, in order, for the flush.
          logger.debug(`[PRIMARY onData] QUEUEING data`)
          this.queuePendingOutput(term, output)
        }
      })

      // Handle PTY exit
      ptyProcess.onExit((event: { exitCode: number; signal?: number }) => {
        logger.info(`🏁 Terminal ${terminalId} exited`, event)
        markExited()
        this.emit('exit', { terminalId, exitCode: event.exitCode, signal: event.signal, webContentsId: webContentsId ?? -1 })
        this.terminals.delete(terminalId)
      })

      logger.info(`✅ Terminal ${terminalId} created (bootstrap pattern - no interactive echo)`)
      return { terminalId, shellKind }
    } catch (error) {
      logger.error(`❌ Failed to create terminal`, error instanceof Error ? error : undefined)
      const message = error instanceof Error ? error.message : String(error)
      this.emit('error', { terminalId, error: message, webContentsId: webContentsId ?? -1 })
      return { error: message }
    }
  }


  /** Holds post-marker output while the clear handshake is open (bounded, newest kept). */
  private queuePendingOutput(terminal: TerminalInstance, output: string): void {
    if (!output) return
    const merged = terminal.pendingOutput + output
    terminal.pendingOutput =
      merged.length > PENDING_OUTPUT_MAX_CHARS ? merged.slice(-PENDING_OUTPUT_MAX_CHARS) : merged
  }

  /** Forwards held output, in order, once the handshake has ended. */
  private flushPendingOutput(terminal: TerminalInstance): void {
    const data = terminal.pendingOutput
    if (!data) return
    terminal.pendingOutput = ''
    this.emit('data', { terminalId: terminal.id, data, webContentsId: terminal.webContentsId })
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
      this.flushPendingOutput(terminal)

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
        this.emit('exit', { terminalId, exitCode: 0, webContentsId: terminal.webContentsId })
        return false
      }

      logger.error(`❌ Failed to write to terminal ${terminalId}`, error instanceof Error ? error : undefined)
      const message = error instanceof Error ? error.message : String(error)
      this.emit('error', { terminalId, error: message, webContentsId: terminal.webContentsId })
      return false
    }
  }

  /**
   * Resize terminal
   */
  resize(terminalId: string, cols: number, rows: number): boolean {
    const terminal = this.terminals.get(terminalId)

    if (!terminal) {
      // Benign race: renderer's fit addon flushes a resize after the tab closed.
      logger.debug(`Terminal ${terminalId} not found for resize (likely exited)`)
      return false
    }

    try {
      terminal.ptyProcess.resize(cols, rows)
      logger.info(`📏 Terminal ${terminalId} resized to ${cols}x${rows}`)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      // Windows-specific: node-pty's WindowsTerminal.resize() defers via
      // _deferNoArgs, so a resize can fire after the pty has already exited
      // (e.g. user typed `exit`, onExit hasn't propagated yet). Treat as a
      // benign race — drop the dead terminal and return silently instead of
      // emitting an 'error' event the renderer would surface.
      if (message.includes('already exited')) {
        logger.debug(`Terminal ${terminalId} resize ignored (pty already exited)`)
        this.terminals.delete(terminalId)
        return false
      }

      logger.error(`❌ Failed to resize terminal ${terminalId}`, error instanceof Error ? error : undefined)
      this.emit('error', { terminalId, error: message, webContentsId: terminal.webContentsId })
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
      this.trackExit(terminal)
      logger.info(`🛑 Terminal ${terminalId} killed`)
      return true
    } catch (error) {
      // Suppress EPIPE and ESRCH errors - process may already be dead
      const code = (error as { code?: unknown }).code
      if (code === 'EPIPE' || code === 'ESRCH') {
        logger.info(`ℹ️ Terminal ${terminalId} process already terminated`)
        this.terminals.delete(terminalId)
        this.trackExit(terminal)
        return true
      }

      logger.error(`❌ Failed to kill terminal ${terminalId}`, error instanceof Error ? error : undefined)
      const message = error instanceof Error ? error.message : String(error)
      this.emit('error', { terminalId, error: message, webContentsId: terminal.webContentsId })
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
   * The `webContents` that created a terminal, or `undefined` for an unknown
   * id. `-1` means the terminal has no owner (created without a sender).
   */
  getOwner(terminalId: string): number | undefined {
    return this.terminals.get(terminalId)?.webContentsId
  }

  /**
   * Whether a program other than the shell is in the terminal's foreground.
   *
   * node-pty names the foreground process on macOS and Linux. On Windows
   * `IPty.process` is the shell's own name for the life of the terminal, so the
   * answer is not available there (`known: false`).
   *
   * @returns `null` for an unknown id
   */
  getActivity(terminalId: string): { busy: boolean; known: boolean } | null {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) return null
    if (osPlatform() === 'win32') return { busy: false, known: false }
    try {
      const foreground = terminal.ptyProcess.process
      if (typeof foreground !== 'string') return { busy: false, known: false }
      return { busy: isForegroundBusy(foreground, terminal.shellNames), known: true }
    } catch {
      // The process may have exited between the lookup and the read
      return { busy: false, known: false }
    }
  }

  /**
   * Get the OS pid of a terminal's PTY process.
   *
   * Main-only accessor for the Claude Code status detector (#216): the pid keys
   * the per-OS process-tree walk and is NEVER sent to or supplied by the
   * renderer (security remediation §10).
   *
   * @returns the pid, or `undefined` for an unknown terminal id.
   */
  getPid(terminalId: string): number | undefined {
    return this.terminals.get(terminalId)?.pid
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
   * Cleanup all terminals, then wait (bounded by `TERMINAL_EXIT_WAIT_MS`) until
   * node-pty has reported every killed shell's exit – including shells killed
   * earlier by `killTerminal` or a window close – so its native exit callback
   * cannot run after the app starts to exit (#214).
   */
  async dispose(): Promise<void> {
    logger.info('🛑 Disposing TerminalService...')

    for (const [terminalId, terminal] of this.terminals.entries()) {
      this.trackExit(terminal)
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
    await this.waitForPendingExits()
    logger.info('✅ TerminalService disposed')
  }

  /** Remember a killed shell until node-pty reports its exit (#214). */
  private trackExit(terminal: TerminalInstance): void {
    const exited = terminal.exited
    this.pendingExits.add(exited)
    void exited.then(() => this.pendingExits.delete(exited))
  }

  private async waitForPendingExits(): Promise<void> {
    if (this.pendingExits.size === 0) return
    let timer: NodeJS.Timeout | undefined
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), TERMINAL_EXIT_WAIT_MS)
    })
    const allExited = Promise.all(this.pendingExits).then(() => false)
    const didTimeOut = await Promise.race([allExited, timedOut])
    clearTimeout(timer)
    if (didTimeOut) {
      logger.warn(`⚠️ ${this.pendingExits.size} terminal(s) did not report exit within ${TERMINAL_EXIT_WAIT_MS}ms`)
    }
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
   * Get default shell based on platform.
   *
   * Windows resolution order (never returns a bare command name):
   *   1. $SHELL (set by WSL / Git Bash / user override) – if it exists on disk
   *   2. PowerShell 7+ (`pwsh.exe`) under Program Files
   *   3. Windows PowerShell 5.1 absolute path under %SystemRoot%
   *   4. %COMSPEC% / absolute cmd.exe path
   */
  private getDefaultShell(): string {
    const platform = osPlatform()

    if (platform === 'win32') {
      return this.resolveWindowsShell()
    } else if (platform === 'darwin') {
      // macOS: prefer zsh (default since Catalina), fallback to bash
      return process.env.SHELL || '/bin/zsh'
    } else {
      // Linux/Unix: use $SHELL, fallback to bash
      return process.env.SHELL || '/bin/bash'
    }
  }

  /**
   * Resolve a Windows shell to an absolute path. Never returns a bare name.
   * See {@link getDefaultShell} for the resolution order.
   *
   * Uses `this.fsExists` so tests can construct a `TerminalService` with a
   * fake `existsSync` and assert the resolution chain deterministically
   * without `vi.doMock('fs')` gymnastics.
   *
   * @internal exposed for testability
   */
  resolveWindowsShell(): string {
    // 1. Honor explicit $SHELL (WSL, Git Bash, user override) – only if it
    //    actually exists, otherwise fall through.
    const envShell = process.env.SHELL
    if (envShell && this.fsExists(envShell)) {
      return envShell
    }

    // 2. PowerShell 7+ (pwsh.exe)
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const pwshCandidates = [
      `${programFiles}\\PowerShell\\7\\pwsh.exe`,
      `${programFilesX86}\\PowerShell\\7\\pwsh.exe`
    ]
    for (const candidate of pwshCandidates) {
      if (this.fsExists(candidate)) return candidate
    }

    // 3. Windows PowerShell 5.1 (absolute path under %SystemRoot%)
    const systemRoot = process.env.SystemRoot || 'C:\\Windows'
    const winPowerShell = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    if (this.fsExists(winPowerShell)) {
      return winPowerShell
    }

    // 4. cmd.exe (absolute) – last-resort fallback. Validate %COMSPEC% and
    //    the hardcoded path so we never return a stale binding.
    const comspec = process.env.COMSPEC
    if (comspec && this.fsExists(comspec)) {
      return comspec
    }
    const cmdAbsolute = `${systemRoot}\\System32\\cmd.exe`
    if (this.fsExists(cmdAbsolute)) {
      return cmdAbsolute
    }

    // Truly nothing resolved – log and return the hardcoded path so the
    // PTY spawn produces a clear, observable error rather than us throwing
    // here from inside the resolver.
    logger.warn(
      '⚠️ resolveWindowsShell: no shell candidates exist; returning unvalidated cmd.exe path'
    )
    return cmdAbsolute
  }
}

// Export singleton instance
export const terminalService = new TerminalService()
