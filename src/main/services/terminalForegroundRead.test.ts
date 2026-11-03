// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'
import type { ProcessSnapshot, ProcessSnapshotReading, WinProcRow } from './process/processSnapshot'
import {
  DISPLAY_MAX_AGE_MS,
  SEND_LOOKUP_TIMEOUT_MS,
  START_UP_WINDOW_MS,
  TerminalForegroundReader,
  windowsForeground,
  type ForegroundTerminal
} from './terminalForegroundRead'

vi.mock('./LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

const NOW = 100_000
const ZSH = new Set(['zsh'])
const PWSH = new Set(['pwsh'])
const SHELL_PID = 2000

/** A terminal well past its start-up window unless told otherwise. */
function terminal(over: Partial<ForegroundTerminal> & { process?: string } = {}): ForegroundTerminal {
  const { process, ...rest } = over
  // `'process' in over` keeps an explicit undefined (node-pty naming nothing).
  return { ptyProcess: { process: 'process' in over ? (process as string) : 'zsh' }, pid: SHELL_PID, shellNames: ZSH, spawnedAtMs: NOW - START_UP_WINDOW_MS, ...rest }
}

function row(pid: number, ppid: number, name: string): WinProcRow {
  return { pid, ppid, name, commandLine: '' }
}

/** A stand-in for the shared snapshot: `latest` answers from `young`, `read` from `next`. */
function snapshotOf(young: readonly WinProcRow[] | null, next: () => Promise<ProcessSnapshotReading> = async () => ({ rows: young ?? [], takenAtMs: NOW })) {
  const reads: number[] = []
  const snapshot = {
    latest: (maxAgeMs: number) => {
      expect(maxAgeMs).toBe(DISPLAY_MAX_AGE_MS)
      return young === null ? null : { rows: young, takenAtMs: NOW }
    },
    read: (maxAgeMs: number) => {
      reads.push(maxAgeMs)
      return next()
    }
  } as unknown as ProcessSnapshot
  return { snapshot, reads }
}

function reader(terminals: Record<string, ForegroundTerminal>, platform: NodeJS.Platform = 'darwin', snapshot?: ProcessSnapshot) {
  return new TerminalForegroundReader((id) => terminals[id], {
    platform: () => platform,
    now: () => NOW,
    ...(snapshot ? { snapshot: () => snapshot } : {})
  })
}

describe('TerminalForegroundReader on macOS and Linux (IPty.process)', () => {
  it('reads null for an unknown terminal', async () => {
    const r = reader({})
    expect(r.read('t')).toBeNull()
    await expect(r.readAtSend('t')).resolves.toBeNull()
    expect(r.activity('t')).toBeNull()
  })

  it('reads the terminal\'s own shell, login dash and path stripped, as shell', () => {
    expect(reader({ t: terminal({ process: '-zsh' }) }).read('t')).toEqual({ kind: 'shell', name: 'zsh' })
    expect(reader({ t: terminal({ process: '/bin/zsh' }) }).read('t')).toEqual({ kind: 'shell', name: 'zsh' })
  })

  it('reads another program by name', async () => {
    const r = reader({ t: terminal({ process: 'claude' }) })
    expect(r.read('t')).toEqual({ kind: 'program', name: 'claude' })
    await expect(r.readAtSend('t')).resolves.toEqual({ kind: 'program', name: 'claude' })
  })

  it('reads unknown when node-pty names nothing or the read throws (the process went)', () => {
    expect(reader({ t: terminal({ process: undefined as unknown as string }) }).read('t')).toEqual({ kind: 'unknown', fresh: true })
    expect(reader({ t: terminal({ process: '' }) }).read('t')).toEqual({ kind: 'unknown', fresh: true })
    const gone = { ...terminal(), ptyProcess: { get process(): string { throw new Error('exited') } } }
    expect(reader({ t: gone }).read('t')).toEqual({ kind: 'unknown', fresh: true })
  })

  describe('start-up window', () => {
    it('reads a start-up helper (path_helper) in front of a just-spawned shell as the shell', () => {
      const t = terminal({ process: 'path_helper', spawnedAtMs: NOW - 50 })
      expect(reader({ t }).read('t')).toEqual({ kind: 'shell', name: 'zsh' })
    })

    it('names the interactive shell, the last name recorded, during the window', () => {
      const t = terminal({ process: 'brew', shellNames: new Set(['bash', 'zsh']), spawnedAtMs: NOW - 50 })
      expect(reader({ t }).read('t')).toEqual({ kind: 'shell', name: 'zsh' })
    })

    it('falls back to the program\'s name when the terminal recorded no shell name', () => {
      const t = terminal({ process: 'brew', shellNames: new Set(), spawnedAtMs: NOW - 50 })
      expect(reader({ t }).read('t')).toEqual({ kind: 'shell', name: 'brew' })
    })

    it('ends at the first typed input', () => {
      const t = terminal({ process: 'claude', spawnedAtMs: NOW - 50, inputSeen: true })
      expect(reader({ t }).read('t')).toEqual({ kind: 'program', name: 'claude' })
    })

    it('ends after START_UP_WINDOW_MS without input (an agent an rc file started shows then)', () => {
      expect(reader({ t: terminal({ process: 'tmux', spawnedAtMs: NOW - START_UP_WINDOW_MS + 1 }) }).read('t')).toEqual({ kind: 'shell', name: 'zsh' })
      expect(reader({ t: terminal({ process: 'tmux', spawnedAtMs: NOW - START_UP_WINDOW_MS }) }).read('t')).toEqual({ kind: 'program', name: 'tmux' })
    })
  })

  describe('activity (TerminalService.getActivity)', () => {
    it('is busy for another program, idle for the shell, unknowable without a name', () => {
      expect(reader({ t: terminal({ process: 'node' }) }).activity('t')).toEqual({ busy: true, known: true })
      expect(reader({ t: terminal({ process: '-zsh' }) }).activity('t')).toEqual({ busy: false, known: true })
      expect(reader({ t: terminal({ process: undefined as unknown as string }) }).activity('t')).toEqual({ busy: false, known: false })
    })

    it('cannot tell on Windows', () => {
      expect(reader({ t: terminal({ process: 'node' }) }, 'win32').activity('t')).toEqual({ busy: false, known: false })
    })
  })
})

describe('TerminalForegroundReader on Windows (shared process snapshot)', () => {
  const pwsh = (over: Partial<ForegroundTerminal> = {}): ForegroundTerminal => terminal({ process: 'pwsh.exe', shellNames: PWSH, ...over })
  const withClaude = [row(SHELL_PID, 1, 'pwsh.exe'), row(4321, SHELL_PID, 'claude.exe')]

  it('reads a snapshot up to 10 s old for display without starting a query', () => {
    const { snapshot, reads } = snapshotOf(withClaude)
    expect(reader({ t: pwsh() }, 'win32', snapshot).read('t')).toEqual({ kind: 'program', name: 'claude' })
    expect(reads).toEqual([])
  })

  it('reads the shell alone in the tree as shell', () => {
    const { snapshot } = snapshotOf([row(SHELL_PID, 1, 'pwsh.exe')])
    expect(reader({ t: pwsh() }, 'win32', snapshot).read('t')).toEqual({ kind: 'shell', name: 'pwsh' })
  })

  it('without a current snapshot answers unknown, not fresh, and starts one', async () => {
    const { snapshot, reads } = snapshotOf(null)
    expect(reader({ t: pwsh() }, 'win32', snapshot).read('t')).toEqual({ kind: 'unknown', fresh: false })
    expect(reads).toEqual([DISPLAY_MAX_AGE_MS])
  })

  it('swallows a failed background query (logged, the next read retries)', async () => {
    const { snapshot } = snapshotOf(null, () => Promise.reject(new Error('powershell timeout')))
    expect(reader({ t: pwsh() }, 'win32', snapshot).read('t')).toEqual({ kind: 'unknown', fresh: false })
    await Promise.resolve()
  })

  it('reads unknown for a terminal without a usable pid', () => {
    const { snapshot } = snapshotOf(withClaude)
    expect(reader({ t: pwsh({ pid: undefined }) }, 'win32', snapshot).read('t')).toEqual({ kind: 'unknown', fresh: true })
    expect(reader({ t: pwsh({ pid: 0 }) }, 'win32', snapshot).read('t')).toEqual({ kind: 'unknown', fresh: true })
  })

  it('reads unknown when the shell is not in the snapshot or the tree is ambiguous', () => {
    expect(reader({ t: pwsh() }, 'win32', snapshotOf([row(9, 1, 'x.exe')]).snapshot).read('t')).toEqual({ kind: 'unknown', fresh: true })
    const twoJobs = [row(SHELL_PID, 1, 'pwsh.exe'), row(3000, SHELL_PID, 'node.exe'), row(3001, SHELL_PID, 'claude.exe')]
    expect(reader({ t: pwsh() }, 'win32', snapshotOf(twoJobs).snapshot).read('t')).toEqual({ kind: 'unknown', fresh: true })
  })

  it('applies the start-up window to a profile helper (oh-my-posh)', () => {
    const { snapshot } = snapshotOf([row(SHELL_PID, 1, 'pwsh.exe'), row(5, SHELL_PID, 'oh-my-posh.exe')])
    expect(reader({ t: pwsh({ spawnedAtMs: NOW - 50 }) }, 'win32', snapshot).read('t')).toEqual({ kind: 'shell', name: 'pwsh' })
  })

  describe('at send', () => {
    it('asks for a snapshot up to 10 s old – a stale one is replaced', async () => {
      const { snapshot, reads } = snapshotOf(null, async () => ({ rows: withClaude, takenAtMs: NOW }))
      await expect(reader({ t: pwsh() }, 'win32', snapshot).readAtSend('t')).resolves.toEqual({ kind: 'program', name: 'claude' })
      expect(reads).toEqual([DISPLAY_MAX_AGE_MS])
    })

    it('reads unknown when the snapshot fails', async () => {
      const { snapshot } = snapshotOf(null, () => Promise.reject(new Error('ENOBUFS')))
      await expect(reader({ t: pwsh() }, 'win32', snapshot).readAtSend('t')).resolves.toEqual({ kind: 'unknown', fresh: true })
    })

    it(`reads unknown when no snapshot arrives within ${SEND_LOOKUP_TIMEOUT_MS} ms`, async () => {
      vi.useFakeTimers()
      try {
        const { snapshot } = snapshotOf(null, () => new Promise<ProcessSnapshotReading>(() => {}))
        const pending = reader({ t: pwsh() }, 'win32', snapshot).readAtSend('t')
        await vi.advanceTimersByTimeAsync(SEND_LOOKUP_TIMEOUT_MS)
        await expect(pending).resolves.toEqual({ kind: 'unknown', fresh: true })
      } finally {
        vi.useRealTimers()
      }
    })

    it('reads null when the terminal closed while the snapshot ran, whether it arrived or failed', async () => {
      const terminals: Record<string, ForegroundTerminal> = { t: pwsh() }
      const arrives = snapshotOf(null, async () => {
        delete terminals.t
        return { rows: withClaude, takenAtMs: NOW }
      })
      await expect(reader(terminals, 'win32', arrives.snapshot).readAtSend('t')).resolves.toBeNull()

      terminals.t = pwsh()
      const fails = snapshotOf(null, async () => {
        delete terminals.t
        throw new Error('timeout')
      })
      await expect(reader(terminals, 'win32', fails.snapshot).readAtSend('t')).resolves.toBeNull()
    })
  })
})

describe('windowsForeground', () => {
  it('follows nested shells to the program running in them', () => {
    const rows = [row(SHELL_PID, 1, 'pwsh.exe'), row(3000, SHELL_PID, 'cmd.exe'), row(3001, 3000, 'claude.exe')]
    expect(windowsForeground(rows, SHELL_PID, PWSH)).toBe('claude.exe')
  })

  it('stops at the first program, so an agent\'s own tool shell does not count', () => {
    const rows = [row(SHELL_PID, 1, 'pwsh.exe'), row(3000, SHELL_PID, 'claude.exe'), row(3001, 3000, 'bash.exe')]
    expect(windowsForeground(rows, SHELL_PID, PWSH)).toBe('claude.exe')
  })

  it('ignores console hosts and self-parented rows', () => {
    const rows = [row(0, 0, 'System Idle Process'), row(SHELL_PID, 1, 'pwsh.exe'), row(3000, SHELL_PID, 'conhost.exe'), row(3002, SHELL_PID, 'OpenConsole.exe')]
    expect(windowsForeground(rows, SHELL_PID, PWSH)).toBe('pwsh.exe')
  })

  it('reads the innermost shell when a nested shell has no child (wsl stops the walk)', () => {
    expect(windowsForeground([row(SHELL_PID, 1, 'pwsh.exe'), row(3000, SHELL_PID, 'cmd.exe')], SHELL_PID, PWSH)).toBe('cmd.exe')
    expect(windowsForeground([row(SHELL_PID, 1, 'pwsh.exe'), row(3000, SHELL_PID, 'wsl.exe'), row(3001, 3000, 'wslhost.exe')], SHELL_PID, PWSH)).toBe('wsl.exe')
  })

  it('gives up on a cycle or a chain deeper than the walk allows', () => {
    // A pid-reuse cycle: the shell's child names the shell as its child.
    const cycle = [row(SHELL_PID, 3000, 'pwsh.exe'), row(3000, SHELL_PID, 'cmd.exe')]
    expect(windowsForeground(cycle, SHELL_PID, PWSH)).toBe('cmd.exe')
    const deep = [row(SHELL_PID, 1, 'pwsh.exe'), ...Array.from({ length: 40 }, (_, i) => row(3000 + i, i === 0 ? SHELL_PID : 2999 + i, 'cmd.exe'))]
    expect(windowsForeground(deep, SHELL_PID, PWSH)).toBeNull()
  })
})
