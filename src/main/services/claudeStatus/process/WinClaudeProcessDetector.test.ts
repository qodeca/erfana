// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WinClaudeProcessDetector, parseWin32Processes } from './WinClaudeProcessDetector'
import type { ExecLike } from './exec'

type ExecOpts = { timeout: number; maxBuffer: number; env?: NodeJS.ProcessEnv; cwd?: string }

/**
 * Build a mock exec that records every `{file,args,opts}` call and returns a
 * configurable JSON stdout (or throws a configured error). NEVER spawns a real
 * PowerShell — every test injects this.
 */
function makeExec(opts: { stdout?: string; error?: Error }): {
  exec: ExecLike
  calls: Array<{ file: string; args: string[]; opts: ExecOpts }>
} {
  const calls: Array<{ file: string; args: string[]; opts: ExecOpts }> = []
  const exec: ExecLike = async (file, args, execOpts) => {
    calls.push({ file, args, opts: execOpts })
    if (opts.error) throw opts.error
    return { stdout: opts.stdout ?? '' }
  }
  return { exec, calls }
}

/** Shape of a single fixture row before JSON.stringify (matches the PS projection). */
interface FixtureRow {
  ProcessId: number
  ParentProcessId: number
  Name: string
  CommandLine: string | null
  StartMs: number | null
}

function row(
  pid: number,
  ppid: number,
  name: string,
  commandLine: string | null,
  startMs: number | null = null
): FixtureRow {
  return { ProcessId: pid, ParentProcessId: ppid, Name: name, CommandLine: commandLine, StartMs: startMs }
}

function json(rows: FixtureRow[]): string {
  return JSON.stringify(rows)
}

describe('WinClaudeProcessDetector', () => {
  // resolvePowershell reads %SystemRoot%; pin it so tests are host-independent.
  let savedSystemRoot: string | undefined
  let savedWindir: string | undefined

  beforeEach(() => {
    savedSystemRoot = process.env.SystemRoot
    savedWindir = process.env.windir
    process.env.SystemRoot = 'C:\\Windows'
    delete process.env.windir
  })

  afterEach(() => {
    if (savedSystemRoot === undefined) delete process.env.SystemRoot
    else process.env.SystemRoot = savedSystemRoot
    if (savedWindir === undefined) delete process.env.windir
    else process.env.windir = savedWindir
  })

  it.each([0, -1, 1.5, NaN, Number.POSITIVE_INFINITY])(
    'returns running:false for invalid rootPid %s without exec',
    async (pid) => {
      const { exec, calls } = makeExec({ stdout: '[]' })
      const detector = new WinClaudeProcessDetector(exec)

      expect(await detector.isClaudeRunning(pid as number)).toEqual({ running: false })
      expect(calls).toHaveLength(0)
    }
  )

  it('detects a ConPTY-style deep node descendant running cli.js (startedAtMs from that row)', async () => {
    // PTY (2000) → powershell shell (3000) → node.exe running cli.js (4321).
    const stdout = json([
      row(2000, 1, 'OpenConsole.exe', 'C:\\Windows\\System32\\OpenConsole.exe', 100),
      row(3000, 2000, 'powershell.exe', 'powershell.exe', 200),
      row(
        4321,
        3000,
        'node.exe',
        'node C:\\Users\\x\\AppData\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js',
        1717668000000
      ),
    ])
    const { exec } = makeExec({ stdout })
    const detector = new WinClaudeProcessDetector(exec)

    const result = await detector.isClaudeRunning(2000)

    expect(result).toEqual({ running: true, startedAtMs: 1717668000000 })
  })

  it('detects a node-launched cli.js whose path contains spaces (Program Files)', async () => {
    // node.exe launching cli.js from under "C:\Program Files\" — the internal
    // space splits the token mid-path, so only the whole-command-line fallback
    // can match it.
    const stdout = json([
      row(2000, 1, 'powershell.exe', 'powershell.exe', 100),
      row(
        4321,
        2000,
        'node.exe',
        '"C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\cli.js"',
        700
      ),
    ])
    const { exec } = makeExec({ stdout })
    const detector = new WinClaudeProcessDetector(exec)

    expect(await detector.isClaudeRunning(2000)).toEqual({ running: true, startedAtMs: 700 })
  })

  it('does NOT over-match a cli.js.txt look-alike via the whole-line fallback', async () => {
    // CommandLine ends with `cli.js.txt`, not the exact anchored `cli.js` suffix,
    // so the whole-line fallback must stay anchored and reject it.
    const stdout = json([
      row(2000, 1, 'powershell.exe', 'powershell.exe', 100),
      row(
        4321,
        2000,
        'notepad.exe',
        'notepad "C:\\Users\\me\\@anthropic-ai\\claude-code\\cli.js.txt"',
        200
      ),
    ])
    const { exec } = makeExec({ stdout })
    const detector = new WinClaudeProcessDetector(exec)

    expect(await detector.isClaudeRunning(2000)).toEqual({ running: false })
  })

  it('detects a claude.cmd shim descendant', async () => {
    const stdout = json([
      row(2000, 1, 'powershell.exe', 'powershell.exe', 100),
      row(4321, 2000, 'claude.cmd', 'C:\\Users\\x\\AppData\\npm\\claude.cmd', 500),
    ])
    const { exec } = makeExec({ stdout })
    const detector = new WinClaudeProcessDetector(exec)

    expect(await detector.isClaudeRunning(2000)).toEqual({ running: true, startedAtMs: 500 })
  })

  it('detects a claude.exe shim descendant', async () => {
    const stdout = json([
      row(2000, 1, 'powershell.exe', 'powershell.exe', 100),
      row(4321, 2000, 'claude.exe', '"C:\\tools\\claude.exe" --foo', null),
    ])
    const { exec } = makeExec({ stdout })
    const detector = new WinClaudeProcessDetector(exec)

    // StartMs null → startedAtMs omitted, running still true.
    expect(await detector.isClaudeRunning(2000)).toEqual({ running: true })
  })

  it('rejects over-match look-alikes (claude in a file path / claude-foo.exe)', async () => {
    const stdout = json([
      row(2000, 1, 'powershell.exe', 'powershell.exe', 100),
      row(4321, 2000, 'notepad.exe', 'notepad C:\\Users\\claude\\notes.txt', 200),
      row(4400, 2000, 'claude-foo.exe', 'C:\\bin\\claude-foo.exe --run', 300),
    ])
    const { exec } = makeExec({ stdout })
    const detector = new WinClaudeProcessDetector(exec)

    expect(await detector.isClaudeRunning(2000)).toEqual({ running: false })
  })

  it('returns running:false when no claude descendant exists', async () => {
    const stdout = json([
      row(2000, 1, 'powershell.exe', 'powershell.exe', 100),
      row(4321, 2000, 'vim.exe', 'vim README.md', 200),
    ])
    const { exec } = makeExec({ stdout })
    const detector = new WinClaudeProcessDetector(exec)

    expect(await detector.isClaudeRunning(2000)).toEqual({ running: false })
  })

  it('only walks descendants of rootPid, not unrelated subtrees', async () => {
    const stdout = json([
      row(2000, 1, 'powershell.exe', 'powershell.exe', 100),
      row(5000, 1, 'powershell.exe', 'powershell.exe', 100),
      row(5001, 5000, 'claude.exe', 'C:\\tools\\claude.exe', 200), // under 5000, not 2000
    ])
    const { exec } = makeExec({ stdout })
    const detector = new WinClaudeProcessDetector(exec)

    expect(await detector.isClaudeRunning(2000)).toEqual({ running: false })
  })

  describe('invocation hardening', () => {
    const stdout = json([row(4321, 2000, 'claude.exe', 'C:\\tools\\claude.exe', 100)])

    it('uses powershell.exe by absolute path with -NoProfile/-NonInteractive and the static query, no pid interpolation', async () => {
      const { exec, calls } = makeExec({ stdout })
      const detector = new WinClaudeProcessDetector(exec)

      await detector.isClaudeRunning(2000)

      const call = calls[0]
      expect(call.file.endsWith('\\powershell.exe')).toBe(true)
      expect(call.args).toContain('-NoProfile')
      expect(call.args).toContain('-NonInteractive')
      expect(call.args).toContain('-Command')
      // The static query is passed verbatim (StartMs projection present).
      const query = call.args[call.args.indexOf('-Command') + 1]
      expect(query).toContain('Get-CimInstance Win32_Process')
      expect(query).toContain('StartMs')
      expect(query).toContain('-InputObject @(')
      // No runtime value (the rootPid) is ever interpolated into the argv.
      expect(call.args.join(' ')).not.toContain('2000')
    })

    it('passes an 8s timeout, 16 MiB maxBuffer, and a System32 powershell cwd', async () => {
      const { exec, calls } = makeExec({ stdout })
      const detector = new WinClaudeProcessDetector(exec)

      await detector.isClaudeRunning(2000)

      expect(calls[0].opts.timeout).toBe(8000)
      expect(calls[0].opts.maxBuffer).toBe(16 * 1024 * 1024)
      expect(calls[0].opts.cwd?.endsWith('WindowsPowerShell\\v1.0')).toBe(true)
    })
  })

  it('returns running:false (no exec) when SystemRoot/windir are absent (fail-closed)', async () => {
    delete process.env.SystemRoot
    delete process.env.windir
    const { exec, calls } = makeExec({ stdout: json([row(4321, 2000, 'claude.exe', 'claude.exe', 1)]) })
    const detector = new WinClaudeProcessDetector(exec)

    expect(await detector.isClaudeRunning(2000)).toEqual({ running: false })
    expect(calls).toHaveLength(0)
  })

  it('resolves powershell off %windir% when SystemRoot is absent (windir fallback)', async () => {
    delete process.env.SystemRoot
    process.env.windir = 'C:\\Windows'
    const stdout = json([row(4321, 2000, 'claude.exe', 'C:\\tools\\claude.exe', 100)])
    const { exec, calls } = makeExec({ stdout })
    const detector = new WinClaudeProcessDetector(exec)

    expect(await detector.isClaudeRunning(2000)).toEqual({ running: true, startedAtMs: 100 })
    expect(calls).toHaveLength(1)
    expect(calls[0].file.endsWith('\\powershell.exe')).toBe(true)
  })

  it('returns running:false when exec throws (timeout / fail-closed)', async () => {
    const { exec } = makeExec({ error: new Error('powershell timeout') })
    const detector = new WinClaudeProcessDetector(exec)

    expect(await detector.isClaudeRunning(2000)).toEqual({ running: false })
  })

  describe('liveness cache (short TTL)', () => {
    const stdout = json([row(4321, 2000, 'claude.exe', 'C:\\tools\\claude.exe', 100)])

    it('does NOT re-exec within the 8s TTL (cached value reused)', async () => {
      let nowMs = 1000
      const { exec, calls } = makeExec({ stdout })
      const detector = new WinClaudeProcessDetector(exec, () => nowMs)

      const first = await detector.isClaudeRunning(2000)
      expect(calls).toHaveLength(1)

      nowMs = 1000 + 7999 // still inside the 8000ms TTL
      const second = await detector.isClaudeRunning(2000)

      expect(second).toEqual(first)
      expect(calls).toHaveLength(1)
    })

    it('re-execs after the 8s TTL elapses', async () => {
      let nowMs = 1000
      const { exec, calls } = makeExec({ stdout })
      const detector = new WinClaudeProcessDetector(exec, () => nowMs)

      await detector.isClaudeRunning(2000)
      expect(calls).toHaveLength(1)

      nowMs = 1000 + 8001 // just past the TTL
      await detector.isClaudeRunning(2000)
      expect(calls).toHaveLength(2)
    })

    it('does not cache an invalid pid (no exec, repeatable)', async () => {
      const { exec, calls } = makeExec({ stdout })
      const detector = new WinClaudeProcessDetector(exec, () => 1000)

      expect(await detector.isClaudeRunning(0)).toEqual({ running: false })
      expect(await detector.isClaudeRunning(-5)).toEqual({ running: false })
      expect(calls).toHaveLength(0)
    })

    it('clearCache() forces a recompute on the next call', async () => {
      const { exec, calls } = makeExec({ stdout })
      const detector = new WinClaudeProcessDetector(exec, () => 1000)

      await detector.isClaudeRunning(2000)
      expect(calls).toHaveLength(1)

      detector.clearCache()
      await detector.isClaudeRunning(2000)
      expect(calls).toHaveLength(2)
    })
  })

  describe('hardening (#217 review)', () => {
    const single = JSON.stringify({
      ProcessId: 4321,
      ParentProcessId: 2000,
      Name: 'claude.exe',
      CommandLine: 'C:\\tools\\claude.exe',
      StartMs: 100
    })

    it('detects a lone claude descendant when PowerShell returns a single bare object (5.1 unroll) (#12)', async () => {
      const { exec } = makeExec({ stdout: single })
      const detector = new WinClaudeProcessDetector(exec)
      expect(await detector.isClaudeRunning(2000)).toEqual({ running: true, startedAtMs: 100 })
    })

    it('projects StartMs defensively (try/catch + UTC) so one bad date cannot blank the snapshot (#13)', async () => {
      const { exec, calls } = makeExec({ stdout: single })
      const detector = new WinClaudeProcessDetector(exec)
      await detector.isClaudeRunning(2000)
      const query = calls[0].args[calls[0].args.indexOf('-Command') + 1]
      expect(query).toContain('ToUniversalTime')
      expect(query).toContain('try{')
      expect(query).toContain('catch{$null}')
    })

    it('does NOT cache a transient error — the next call retries (#8)', async () => {
      let fail = true
      const calls: Array<{ file: string }> = []
      const exec: ExecLike = async (file) => {
        calls.push({ file })
        if (fail) throw new Error('powershell timeout')
        return { stdout: single }
      }
      // Clock is fixed at 1000: a CACHED negative would skip the second exec, so a
      // re-exec here proves the transient error was NOT cached.
      const detector = new WinClaudeProcessDetector(exec, () => 1000)

      expect(await detector.isClaudeRunning(2000)).toEqual({ running: false })
      expect(calls).toHaveLength(1)

      fail = false
      expect(await detector.isClaudeRunning(2000)).toEqual({ running: true, startedAtMs: 100 })
      expect(calls).toHaveLength(2)
    })

    it('DOES cache a definite negative for the TTL (a completed snapshot with no claude)', async () => {
      const stdout = json([row(2000, 1, 'powershell.exe', 'powershell.exe', 100)])
      const { exec, calls } = makeExec({ stdout })
      const detector = new WinClaudeProcessDetector(exec, () => 1000)

      expect(await detector.isClaudeRunning(2000)).toEqual({ running: false })
      expect(await detector.isClaudeRunning(2000)).toEqual({ running: false })
      expect(calls).toHaveLength(1) // second call served from cache
    })

    it('re-execs at exactly now === expiresAt (strict-< boundary)', async () => {
      let nowMs = 1000
      const { exec, calls } = makeExec({ stdout: single })
      const detector = new WinClaudeProcessDetector(exec, () => nowMs)

      await detector.isClaudeRunning(2000)
      expect(calls).toHaveLength(1)

      nowMs = 1000 + 8000 // exactly at expiry; now() < expiresAt is false → expired
      await detector.isClaudeRunning(2000)
      expect(calls).toHaveLength(2)
    })

    it('forget(pid) drops the cached entry so the next call recomputes (#2)', async () => {
      const { exec, calls } = makeExec({ stdout: single })
      const detector = new WinClaudeProcessDetector(exec, () => 1000)

      await detector.isClaudeRunning(2000)
      expect(calls).toHaveLength(1)

      detector.forget(2000)
      await detector.isClaudeRunning(2000)
      expect(calls).toHaveLength(2)
    })
  })
})

describe('parseWin32Processes (unit)', () => {
  it('returns [] for an empty string', () => {
    expect(parseWin32Processes('')).toEqual([])
    expect(parseWin32Processes('   \n ')).toEqual([])
  })

  it('returns [] for malformed JSON', () => {
    expect(parseWin32Processes('{ not json')).toEqual([])
  })

  it('normalizes a single bare object (not array) to a one-element array', () => {
    const stdout = JSON.stringify({
      ProcessId: 10,
      ParentProcessId: 4,
      Name: 'claude.exe',
      CommandLine: 'claude.exe',
      StartMs: 1234,
    })
    expect(parseWin32Processes(stdout)).toEqual([
      { pid: 10, ppid: 4, name: 'claude.exe', commandLine: 'claude.exe', startMs: 1234 },
    ])
  })

  it('parses N rows', () => {
    const stdout = JSON.stringify([
      { ProcessId: 1, ParentProcessId: 0, Name: 'a.exe', CommandLine: 'a', StartMs: 1 },
      { ProcessId: 2, ParentProcessId: 1, Name: 'b.exe', CommandLine: 'b', StartMs: 2 },
    ])
    const rows = parseWin32Processes(stdout)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual({ pid: 2, ppid: 1, name: 'b.exe', commandLine: 'b', startMs: 2 })
  })

  it('omits startMs when StartMs is null', () => {
    const stdout = JSON.stringify([
      { ProcessId: 1, ParentProcessId: 0, Name: 'a.exe', CommandLine: 'a', StartMs: null },
    ])
    const rows = parseWin32Processes(stdout)
    expect(rows).toHaveLength(1)
    expect(rows[0].startMs).toBeUndefined()
  })

  it('drops rows with non-integer pids and defaults missing name/commandLine', () => {
    const stdout = JSON.stringify([
      { ProcessId: 'bad', ParentProcessId: 0, Name: 'x.exe', CommandLine: 'x', StartMs: 1 },
      { ProcessId: 5, ParentProcessId: 1, Name: null, CommandLine: null, StartMs: 1 },
    ])
    const rows = parseWin32Processes(stdout)
    expect(rows).toEqual([{ pid: 5, ppid: 1, name: '', commandLine: '', startMs: 1 }])
  })

  it.each([
    ['legacy /Date(ms)/ form', '/Date(1717668000000)/'],
    ['ISO-8601 string', '2026-06-06T11:16:39.000Z'],
    ['negative epoch', -5],
  ])('omits startMs for a non-numeric/implausible StartMs: %s (findings #6/#13)', (_label, startMs) => {
    const stdout = JSON.stringify([
      { ProcessId: 1, ParentProcessId: 0, Name: 'a.exe', CommandLine: 'a', StartMs: startMs },
    ])
    const rows = parseWin32Processes(stdout)
    expect(rows).toHaveLength(1)
    expect(rows[0].startMs).toBeUndefined()
  })
})
