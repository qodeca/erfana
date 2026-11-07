// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What is in front in a terminal, read main side for `TerminalService` (spec
 * 025, 025-FR-061; solution design § 9.4, Q8). The browser send guard
 * (`browser/capture/BrowserTargetStatus.ts`) turns a read into its verdict.
 *
 * - macOS and Linux: node-pty's `IPty.process`, the foreground process
 *   group's name.
 * - Windows: node-pty only ever names the shell there, so the read walks the
 *   shell's child processes in the shared process snapshot
 *   (`process/processSnapshot.ts`) – see {@link windowsForeground}. Display
 *   accepts a snapshot up to {@link DISPLAY_MAX_AGE_MS} old and, when there is
 *   none, answers `unknown` (`fresh: false`) and starts one; a send waits up to
 *   {@link SEND_LOOKUP_TIMEOUT_MS} for a new one, else `unknown`.
 * - The terminal's own shell in front reads as `shell`; any other program as
 *   `program`, by name; an unreadable foreground as `unknown`; an unknown id
 *   as null.
 *
 * Start-up window: the bootstrap prints its marker *before* it execs the
 * login shell, so the login shell's start-up files run afterwards with short
 * helpers in front – `path_helper` from macOS's `/etc/zprofile`, and whatever
 * the user's rc files run (`brew shellenv`, `oh-my-posh`, …). A prompt typed
 * then would land in the shell, so until the terminal's first typed input or
 * {@link START_UP_WINDOW_MS} after spawn, whichever comes first, a program in
 * front reads as the shell. Nothing the user started can be in front before
 * they typed; an agent launched by an rc file shows after the window.
 */
import { platform as osPlatform } from 'os'
import { isForegroundBusy, normaliseProcessName } from './terminalForeground'
import { sharedProcessSnapshot, type ProcessSnapshot, type WinProcRow } from './process/processSnapshot'
import { withTimeout } from '../utils/withTimeout'
import { logger } from './LoggingService'

/** Oldest Windows snapshot the toolbar's status accepts (design Q8). */
export const DISPLAY_MAX_AGE_MS = 10_000

/** Longest a send waits for a new Windows snapshot before reading `unknown` (design Q8). */
export const SEND_LOOKUP_TIMEOUT_MS = 3_000

/** How long after spawn, without input, a program in front still reads as the shell starting up. */
export const START_UP_WINDOW_MS = 10_000

/** Deepest chain of nested shells the Windows walk follows (a cycle guard). */
const MAX_WALK_DEPTH = 32

/** Console hosts that sit below a Windows shell without being what runs in it. */
const CONSOLE_HOSTS: ReadonlySet<string> = new Set(['conhost', 'openconsole'])

/**
 * Shells the Windows walk descends through to reach what runs inside them, on
 * top of the terminal's own shell names (`cmd` started from `pwsh`, Git Bash).
 * `wsl` is not here: what runs inside it is not in the Windows process table.
 */
const NESTED_SHELLS: ReadonlySet<string> = new Set(['cmd', 'powershell', 'pwsh', 'bash', 'sh', 'zsh', 'fish', 'nu'])

/** A terminal's foreground as read main side. */
export type ForegroundRead =
  | { readonly kind: 'shell'; readonly name: string }
  | { readonly kind: 'program'; readonly name: string }
  | { readonly kind: 'unknown'; readonly fresh: boolean }

/** The part of a terminal the reader needs (`TerminalService`'s instance). */
export interface ForegroundTerminal {
  readonly ptyProcess: { readonly process: string }
  /** OS pid of the PTY's shell; main-only, never from the renderer. */
  readonly pid?: number
  readonly shellNames: ReadonlySet<string>
  readonly spawnedAtMs: number
  /** Set by the first write to the terminal that is not an escape sequence (xterm's replies are). */
  readonly inputSeen?: boolean
}

export interface ForegroundReaderOptions {
  readonly platform?: () => NodeJS.Platform
  readonly snapshot?: () => ProcessSnapshot
  readonly now?: () => number
}

const UNKNOWN: ForegroundRead = { kind: 'unknown', fresh: true }
const UNKNOWN_STALE: ForegroundRead = { kind: 'unknown', fresh: false }

export class TerminalForegroundReader {
  private readonly platform: () => NodeJS.Platform
  private readonly snapshot: () => ProcessSnapshot
  private readonly now: () => number

  constructor(
    private readonly lookup: (terminalId: string) => ForegroundTerminal | undefined,
    options: ForegroundReaderOptions = {}
  ) {
    this.platform = options.platform ?? osPlatform
    this.snapshot = options.snapshot ?? sharedProcessSnapshot
    this.now = options.now ?? Date.now
  }

  /**
   * Whether a program other than the shell is in front (`TerminalService.getActivity`).
   * On Windows node-pty names only the shell, so the answer is `known: false`.
   *
   * @returns null for an unknown id
   */
  activity(terminalId: string): { busy: boolean; known: boolean } | null {
    const terminal = this.lookup(terminalId)
    if (!terminal) return null
    if (this.platform() === 'win32') return { busy: false, known: false }
    const foreground = ptyForeground(terminal)
    if (foreground === null) return { busy: false, known: false }
    return { busy: isForegroundBusy(foreground, terminal.shellNames), known: true }
  }

  /** The foreground for display: never waits; on Windows a missing or old snapshot reads `unknown` and starts a new one. */
  read(terminalId: string): ForegroundRead | null {
    const terminal = this.lookup(terminalId)
    if (!terminal) return null
    if (this.platform() !== 'win32') return this.fromPty(terminal)
    const snapshot = this.snapshot()
    const reading = snapshot.latest(DISPLAY_MAX_AGE_MS)
    if (reading !== null) return this.fromRows(terminal, reading.rows)
    snapshot.read(DISPLAY_MAX_AGE_MS).catch((error: unknown) => {
      logger.debug('Terminal foreground: process snapshot failed', { error: error instanceof Error ? error.name : 'other' })
    })
    return UNKNOWN_STALE
  }

  /** The foreground at send: on Windows an old snapshot is replaced, waiting at most {@link SEND_LOOKUP_TIMEOUT_MS}. Never rejects. */
  async readAtSend(terminalId: string): Promise<ForegroundRead | null> {
    if (this.lookup(terminalId) === undefined) return null
    if (this.platform() !== 'win32') return this.read(terminalId)
    try {
      const reading = await withTimeout(this.snapshot().read(DISPLAY_MAX_AGE_MS), SEND_LOOKUP_TIMEOUT_MS, 'Process snapshot')
      // The terminal may have closed while the snapshot ran.
      const terminal = this.lookup(terminalId)
      return terminal === undefined ? null : this.fromRows(terminal, reading.rows)
    } catch (error) {
      logger.debug('Terminal foreground: no process snapshot for the send', { error: error instanceof Error ? error.name : 'other' })
      return this.lookup(terminalId) === undefined ? null : UNKNOWN
    }
  }

  private fromPty(terminal: ForegroundTerminal): ForegroundRead {
    const foreground = ptyForeground(terminal)
    return foreground === null || normaliseProcessName(foreground) === '' ? UNKNOWN : this.classify(terminal, foreground)
  }

  private fromRows(terminal: ForegroundTerminal, rows: readonly WinProcRow[]): ForegroundRead {
    const pid = terminal.pid
    if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 0) return UNKNOWN
    const name = windowsForeground(rows, pid, terminal.shellNames)
    return name === null ? UNKNOWN : this.classify(terminal, name)
  }

  private classify(terminal: ForegroundTerminal, foreground: string): ForegroundRead {
    const name = normaliseProcessName(foreground)
    if (terminal.shellNames.has(name)) return { kind: 'shell', name }
    if (this.startingUp(terminal)) return { kind: 'shell', name: shellLabel(terminal) ?? name }
    return { kind: 'program', name }
  }

  private startingUp(terminal: ForegroundTerminal): boolean {
    return terminal.inputSeen !== true && this.now() - terminal.spawnedAtMs < START_UP_WINDOW_MS
  }
}

/** node-pty's foreground name, or null when it gives none or the read throws (the process exited). */
function ptyForeground(terminal: ForegroundTerminal): string | null {
  try {
    const foreground = terminal.ptyProcess.process
    return typeof foreground === 'string' ? foreground : null
  } catch {
    return null
  }
}

/** The name the terminal's interactive shell shows as: the last one recorded (`$SHELL`, or `sh` for the fast e2e shell). */
function shellLabel(terminal: ForegroundTerminal): string | undefined {
  return [...terminal.shellNames].at(-1)
}

/**
 * The image name of what runs in the Windows terminal whose shell is
 * `rootPid`, or null when the snapshot cannot say.
 *
 * Windows has no foreground process group, so the walk starts at the shell
 * and follows its one child (console hosts ignored) while that child is
 * itself a shell; the first child that is not a shell is the program in
 * front, and a shell with no child is itself in front. Null when the shell is
 * not in the snapshot (it started after it) or a shell has several children
 * (a background job makes "in front" ambiguous). Programs below the first
 * non-shell – an agent's own tool shells – are never looked at, so an agent
 * running `bash` for a tool still reads as the agent.
 */
export function windowsForeground(rows: readonly WinProcRow[], rootPid: number, shellNames: ReadonlySet<string>): string | null {
  const children = new Map<number, WinProcRow[]>()
  let root: WinProcRow | undefined
  for (const row of rows) {
    if (row.pid === rootPid) root = row
    if (row.pid === row.ppid || CONSOLE_HOSTS.has(normaliseProcessName(row.name))) continue
    const siblings = children.get(row.ppid)
    if (siblings) siblings.push(row)
    else children.set(row.ppid, [row])
  }
  if (root === undefined) return null
  const isShell = (row: WinProcRow): boolean => {
    const name = normaliseProcessName(row.name)
    return shellNames.has(name) || NESTED_SHELLS.has(name)
  }
  const visited = new Set<number>([rootPid])
  let current: WinProcRow = root
  for (let depth = 0; depth < MAX_WALK_DEPTH; depth++) {
    const kids = (children.get(current.pid) ?? []).filter((row) => !visited.has(row.pid))
    if (kids.length === 0) return current.name
    if (kids.length > 1) return null
    const kid = kids[0]
    if (!isShell(kid)) return kid.name
    visited.add(kid.pid)
    current = kid
  }
  return null
}
