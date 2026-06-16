// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi } from 'vitest'
import { MacClaudeProcessDetector, parsePsLstart, type ExecLike } from './MacClaudeProcessDetector'

/**
 * Build a mock exec that branches on the requested binary (and, for `ps`, on the
 * `lstart=` arg) so a single test can supply distinct process-table, start-time,
 * and `lsof` outputs (or errors). The scoped `ps -p <pid> -o lstart=` start-time
 * probe is told apart from the main `ps -axo` table by its `lstart=` arg.
 * NEVER spawns a real process — every test injects this.
 */
function makeExec(opts: {
  ps?: string
  psError?: Error
  psLstart?: string
  psLstartError?: Error
  lsof?: string
  lsofError?: Error
}): {
  exec: ExecLike
  calls: Array<{
    file: string
    args: string[]
    opts: { timeout: number; maxBuffer: number; env?: NodeJS.ProcessEnv }
  }>
} {
  const calls: Array<{
    file: string
    args: string[]
    opts: { timeout: number; maxBuffer: number; env?: NodeJS.ProcessEnv }
  }> = []
  const exec: ExecLike = async (file, args, execOpts) => {
    calls.push({ file, args, opts: execOpts })
    if (file.endsWith('/ps')) {
      // The scoped start-time probe carries the `lstart=` output spec.
      if (args.includes('lstart=')) {
        if (opts.psLstartError) throw opts.psLstartError
        return { stdout: opts.psLstart ?? '' }
      }
      if (opts.psError) throw opts.psError
      return { stdout: opts.ps ?? '' }
    }
    if (file.endsWith('lsof')) {
      if (opts.lsofError) throw opts.lsofError
      return { stdout: opts.lsof ?? '' }
    }
    throw new Error(`unexpected exec: ${file}`)
  }
  return { exec, calls }
}

// A realistic `lsof -Fn` cwd record.
const LSOF_CWD_OUTPUT = ['p4321', 'fcwd', 'n/Users/x/Projects/erfana', ''].join('\n')

describe('MacClaudeProcessDetector', () => {
  it('finds a direct child claude process', async () => {
    const ps = [
      '  PID  PPID COMMAND',
      ' 1000     1 /sbin/launchd',
      ' 2000  1000 login -fp user',
      ' 4321  2000 /opt/homebrew/bin/claude',
    ].join('\n')
    const { exec } = makeExec({ ps, lsof: LSOF_CWD_OUTPUT })
    const detector = new MacClaudeProcessDetector(exec)

    const result = await detector.isClaudeRunning(2000)

    expect(result.running).toBe(true)
    expect(result.cwd).toBe('/Users/x/Projects/erfana')
  })

  it('finds a deep descendant launched via node /…/cli.js named claude', async () => {
    const ps = [
      '  PID  PPID COMMAND',
      ' 2000     1 -zsh',
      ' 3000  2000 node /Users/x/.nvm/versions/node/v22/bin/npm',
      ' 4321  3000 node /Users/x/.nvm/.../node_modules/@anthropic-ai/claude-code/cli.js claude',
    ].join('\n')
    const { exec } = makeExec({ ps, lsof: LSOF_CWD_OUTPUT })
    const detector = new MacClaudeProcessDetector(exec)

    const result = await detector.isClaudeRunning(2000)

    expect(result.running).toBe(true)
  })

  it('matches a /path/to/claude token in a node argv', async () => {
    const ps = [
      '  PID  PPID COMMAND',
      ' 2000     1 -zsh',
      ' 4321  2000 node /opt/homebrew/bin/claude --foo',
    ].join('\n')
    const { exec } = makeExec({ ps, lsof: LSOF_CWD_OUTPUT })
    const detector = new MacClaudeProcessDetector(exec)

    expect((await detector.isClaudeRunning(2000)).running).toBe(true)
  })

  it('does NOT match an unrelated process with "claude" only inside a file path argument', async () => {
    // `/tmp/claude-notes.txt` has basename `claude-notes.txt`, not `claude`.
    const ps = [
      '  PID  PPID COMMAND',
      ' 2000     1 -zsh',
      ' 4321  2000 vim /tmp/claude-notes.txt',
      ' 4400  2000 cat /home/claudexyz/file',
      ' 4500  2000 ./claude-foo --run',
    ].join('\n')
    const { exec } = makeExec({ ps })
    const detector = new MacClaudeProcessDetector(exec)

    expect((await detector.isClaudeRunning(2000)).running).toBe(false)
  })

  it('returns running:false when no claude descendant exists', async () => {
    const ps = [
      '  PID  PPID COMMAND',
      ' 2000     1 -zsh',
      ' 4321  2000 vim README.md',
    ].join('\n')
    const { exec } = makeExec({ ps })
    const detector = new MacClaudeProcessDetector(exec)

    expect(await detector.isClaudeRunning(2000)).toEqual({ running: false })
  })

  it('only walks descendants of rootPid, not unrelated subtrees', async () => {
    const ps = [
      '  PID  PPID COMMAND',
      ' 2000     1 -zsh',
      ' 5000     1 -zsh',
      ' 5001  5000 /opt/homebrew/bin/claude', // descendant of 5000, NOT 2000
    ].join('\n')
    const { exec } = makeExec({ ps })
    const detector = new MacClaudeProcessDetector(exec)

    expect((await detector.isClaudeRunning(2000)).running).toBe(false)
  })

  it('resolves cwd from a mocked lsof -Fn output', async () => {
    const ps = [
      '  PID  PPID COMMAND',
      ' 4321  2000 /opt/homebrew/bin/claude',
    ].join('\n')
    const lsof = ['p4321', 'fcwd', 'n/Users/me/work', ''].join('\n')
    const { exec, calls } = makeExec({ ps, lsof })
    const detector = new MacClaudeProcessDetector(exec)

    const result = await detector.isClaudeRunning(2000)

    expect(result).toEqual({ running: true, cwd: '/Users/me/work' })
    // lsof was invoked with the matched pid as a numeric string.
    const lsofCall = calls.find((c) => c.file.endsWith('lsof'))
    expect(lsofCall?.args).toContain('4321')
  })

  it('keeps running:true but cwd undefined when lsof errors', async () => {
    const ps = [
      '  PID  PPID COMMAND',
      ' 4321  2000 /opt/homebrew/bin/claude',
    ].join('\n')
    const { exec } = makeExec({ ps, lsofError: new Error('lsof boom') })
    const detector = new MacClaudeProcessDetector(exec)

    const result = await detector.isClaudeRunning(2000)

    expect(result).toEqual({ running: true })
    expect(result.cwd).toBeUndefined()
  })

  it('returns running:true but cwd undefined when lsof yields a non-absolute path', async () => {
    const ps = [
      '  PID  PPID COMMAND',
      ' 4321  2000 /opt/homebrew/bin/claude',
    ].join('\n')
    const lsof = ['p4321', 'fcwd', 'nrelative/path', ''].join('\n')
    const { exec } = makeExec({ ps, lsof })
    const detector = new MacClaudeProcessDetector(exec)

    expect(await detector.isClaudeRunning(2000)).toEqual({ running: true })
  })

  describe('start time (ps lstart)', () => {
    const matchPs = ['  PID  PPID COMMAND', ' 4321  2000 /opt/homebrew/bin/claude'].join('\n')

    it('resolves startedAtMs, scopes the probe to the matched pid, and forces the C locale', async () => {
      const lstart = 'Sat Jun  6 11:16:39 2026'
      const { exec, calls } = makeExec({ ps: matchPs, lsof: LSOF_CWD_OUTPUT, psLstart: lstart })
      const detector = new MacClaudeProcessDetector(exec)

      const result = await detector.isClaudeRunning(2000)

      expect(result.running).toBe(true)
      expect(result.cwd).toBe('/Users/x/Projects/erfana')
      // Assert against an INDEPENDENT local-time construction (numeric-component
      // Date), not Date.parse of the same string. This is non-tautological and
      // timezone-stable (both honor the runner's local zone), and it would catch a
      // regression that bolts a fixed timezone onto the parsed string.
      expect(result.startedAtMs).toBe(new Date(2026, 5, 6, 11, 16, 39).getTime())

      // The start-time probe was the scoped single-pid form, not the -axo table.
      const lstartCall = calls.find((c) => c.file.endsWith('/ps') && c.args.includes('lstart='))
      expect(lstartCall?.args).toEqual(['-p', '4321', '-o', 'lstart='])
      // It carried a C-locale env so a non-English LC_TIME cannot localize lstart.
      expect(lstartCall?.opts.env?.LC_ALL).toBe('C')
      expect(lstartCall?.opts.env?.LC_TIME).toBe('C')
    })

    it('parses a localized-looking lstart once the C-locale env is in force (English output)', async () => {
      // With LC_ALL=C the kernel emits English ctime regardless of the user's
      // locale; the parser only ever sees English, so a real run resolves.
      const { exec } = makeExec({
        ps: matchPs,
        lsof: LSOF_CWD_OUTPUT,
        psLstart: 'Mon Dec 14 09:05:00 2026',
      })
      const detector = new MacClaudeProcessDetector(exec)

      const result = await detector.isClaudeRunning(2000)

      expect(result.startedAtMs).toBe(new Date(2026, 11, 14, 9, 5, 0).getTime())
    })

    it.each([
      ['non-date text', 'not a date'],
      ['empty string', ''],
      ['whitespace/newline only', '   \n  '],
      ['shape without a time', 'Sat Jun 6 2026'],
      ['shape without a year', 'Sat Jun 6 11:16:39'],
    ])('omits startedAtMs but keeps running:true when lstart is %s', async (_label, psLstart) => {
      const { exec } = makeExec({ ps: matchPs, lsof: LSOF_CWD_OUTPUT, psLstart })
      const detector = new MacClaudeProcessDetector(exec)

      const result = await detector.isClaudeRunning(2000)

      expect(result).toEqual({ running: true, cwd: '/Users/x/Projects/erfana' })
      expect(result.startedAtMs).toBeUndefined()
    })

    it('omits startedAtMs but keeps running:true when the lstart probe errors', async () => {
      const { exec } = makeExec({
        ps: matchPs,
        lsof: LSOF_CWD_OUTPUT,
        psLstartError: new Error('ps -p boom'),
      })
      const detector = new MacClaudeProcessDetector(exec)

      const result = await detector.isClaudeRunning(2000)

      expect(result).toEqual({ running: true, cwd: '/Users/x/Projects/erfana' })
      expect(result.startedAtMs).toBeUndefined()
    })

    it('does not run the lstart probe when there is no claude match', async () => {
      const ps = ['  PID  PPID COMMAND', ' 4321  2000 vim README.md'].join('\n')
      const { exec, calls } = makeExec({ ps, psLstart: 'Sat Jun  6 11:16:39 2026' })
      const detector = new MacClaudeProcessDetector(exec)

      await detector.isClaudeRunning(2000)

      expect(calls.some((c) => c.args.includes('lstart='))).toBe(false)
    })
  })

  describe('parsePsLstart (unit)', () => {
    it('parses an English ctime string to its local-time epoch (double-space day tolerated)', () => {
      // Independent numeric-component construction; equal in every timezone.
      expect(parsePsLstart('Sat Jun  6 11:16:39 2026')).toBe(new Date(2026, 5, 6, 11, 16, 39).getTime())
    })

    it('tolerates a trailing newline from execFile stdout', () => {
      expect(parsePsLstart('Sat Jun  6 11:16:39 2026\n')).toBe(new Date(2026, 5, 6, 11, 16, 39).getTime())
    })

    it.each([
      ['empty', ''],
      ['whitespace + newline only', '   \n  '],
      ['non-date text', 'not a date'],
      ['missing time component', 'Sat Jun 6 2026'],
      ['missing 4-digit year', 'Sat Jun 6 11:16:39'],
    ])('returns undefined for %s', (_label, input) => {
      expect(parsePsLstart(input)).toBeUndefined()
    })
  })

  it.each([0, -1, 1.5, NaN, Number.POSITIVE_INFINITY])(
    'returns running:false for invalid rootPid %s without exec',
    async (pid) => {
      const { exec, calls } = makeExec({ ps: '' })
      const detector = new MacClaudeProcessDetector(exec)

      expect(await detector.isClaudeRunning(pid as number)).toEqual({ running: false })
      expect(calls).toHaveLength(0)
    }
  )

  it('returns running:false when ps errors (fail-closed)', async () => {
    const { exec } = makeExec({ psError: new Error('ps timeout') })
    const detector = new MacClaudeProcessDetector(exec)

    expect(await detector.isClaudeRunning(2000)).toEqual({ running: false })
  })

  it('tolerates malformed ps lines (missing/non-numeric columns)', async () => {
    const ps = [
      '  PID  PPID COMMAND',
      'garbage line without numbers',
      ' 4321  2000 /opt/homebrew/bin/claude',
      '   x    y bogus',
    ].join('\n')
    const { exec } = makeExec({ ps, lsof: LSOF_CWD_OUTPUT })
    const detector = new MacClaudeProcessDetector(exec)

    expect((await detector.isClaudeRunning(2000)).running).toBe(true)
  })

  it('does not invoke lsof when there is no match', async () => {
    const ps = [
      '  PID  PPID COMMAND',
      ' 4321  2000 vim README.md',
    ].join('\n')
    const { exec, calls } = makeExec({ ps })
    const detector = new MacClaudeProcessDetector(exec)

    await detector.isClaudeRunning(2000)

    expect(calls.some((c) => c.file.endsWith('lsof'))).toBe(false)
  })

  it('passes a 5s timeout and explicit maxBuffer to ps', async () => {
    const ps = [' 4321  2000 vim x'].join('\n')
    const exec = vi.fn<ExecLike>().mockResolvedValue({ stdout: ps })
    const detector = new MacClaudeProcessDetector(exec)

    await detector.isClaudeRunning(2000)

    expect(exec).toHaveBeenCalledWith(
      expect.stringContaining('ps'),
      expect.arrayContaining(['-axo']),
      expect.objectContaining({ timeout: 5000, maxBuffer: 16 * 1024 * 1024 })
    )
  })

  it('passes an explicit maxBuffer to lsof as well', async () => {
    const ps = ['  PID  PPID COMMAND', ' 4321  2000 /opt/homebrew/bin/claude'].join('\n')
    const { exec, calls } = makeExec({ ps, lsof: LSOF_CWD_OUTPUT })
    const detector = new MacClaudeProcessDetector(exec)

    await detector.isClaudeRunning(2000)

    const lsofCall = calls.find((c) => c.file.endsWith('lsof'))
    expect(lsofCall?.opts.maxBuffer).toBe(16 * 1024 * 1024)
  })

  describe('liveness cache (short TTL)', () => {
    const ps = ['  PID  PPID COMMAND', ' 4321  2000 /opt/homebrew/bin/claude'].join('\n')

    it('does NOT re-exec within the TTL (cached value reused)', async () => {
      let nowMs = 1000
      const { exec, calls } = makeExec({ ps, lsof: LSOF_CWD_OUTPUT })
      const detector = new MacClaudeProcessDetector(exec, () => nowMs)

      const first = await detector.isClaudeRunning(2000)
      const psCallsAfterFirst = calls.filter((c) => c.file.endsWith('/ps')).length

      nowMs = 1000 + 3999 // still inside the 4000ms TTL
      const second = await detector.isClaudeRunning(2000)

      expect(second).toEqual(first)
      expect(calls.filter((c) => c.file.endsWith('/ps')).length).toBe(psCallsAfterFirst)
    })

    it('re-execs after the TTL elapses', async () => {
      let nowMs = 1000
      const { exec, calls } = makeExec({ ps, lsof: LSOF_CWD_OUTPUT })
      const detector = new MacClaudeProcessDetector(exec, () => nowMs)

      await detector.isClaudeRunning(2000)
      const psCallsAfterFirst = calls.filter((c) => c.file.endsWith('/ps')).length

      nowMs = 1000 + 4001 // just past the TTL
      const second = await detector.isClaudeRunning(2000)

      // A recompute makes TWO ps calls on a match: the `-axo` table + the scoped
      // `-o lstart=` start-time probe.
      expect(calls.filter((c) => c.file.endsWith('/ps')).length).toBe(psCallsAfterFirst + 2)
      // Behaviour, not just call count: the recompute returns fresh detection data
      // (this fixture supplies no lstart output, so startedAtMs is absent).
      expect(second).toEqual({ running: true, cwd: '/Users/x/Projects/erfana' })
    })

    it('caches different rootPids independently', async () => {
      // ps reports claude under both 2000 and 3000.
      const psBoth = [
        '  PID  PPID COMMAND',
        ' 4321  2000 /opt/homebrew/bin/claude',
        ' 4322  3000 /opt/homebrew/bin/claude',
      ].join('\n')
      const nowMs = 1000
      const { exec, calls } = makeExec({ ps: psBoth, lsof: LSOF_CWD_OUTPUT })
      const detector = new MacClaudeProcessDetector(exec, () => nowMs)

      await detector.isClaudeRunning(2000) // populates cache[2000]
      const psCallsAfter2000 = calls.filter((c) => c.file.endsWith('/ps')).length

      // A different pid is a cache miss → must exec again (table + lstart probe).
      await detector.isClaudeRunning(3000)
      expect(calls.filter((c) => c.file.endsWith('/ps')).length).toBe(psCallsAfter2000 + 2)

      // Re-querying 2000 within TTL still hits its own cache (no new exec).
      const psCallsAfter3000 = calls.filter((c) => c.file.endsWith('/ps')).length
      await detector.isClaudeRunning(2000)
      expect(calls.filter((c) => c.file.endsWith('/ps')).length).toBe(psCallsAfter3000)
    })

    it('does not cache an invalid pid (no exec, repeatable)', async () => {
      const { exec, calls } = makeExec({ ps, lsof: LSOF_CWD_OUTPUT })
      const detector = new MacClaudeProcessDetector(exec, () => 1000)

      expect(await detector.isClaudeRunning(0)).toEqual({ running: false })
      expect(await detector.isClaudeRunning(-5)).toEqual({ running: false })
      expect(calls).toHaveLength(0)
    })

    it('clearCache() forces a recompute on the next call', async () => {
      const { exec, calls } = makeExec({ ps, lsof: LSOF_CWD_OUTPUT })
      const detector = new MacClaudeProcessDetector(exec, () => 1000)

      await detector.isClaudeRunning(2000)
      const psCallsAfterFirst = calls.filter((c) => c.file.endsWith('/ps')).length

      detector.clearCache()
      await detector.isClaudeRunning(2000)

      // Recompute on a match = table ps + scoped lstart ps = two more calls.
      expect(calls.filter((c) => c.file.endsWith('/ps')).length).toBe(psCallsAfterFirst + 2)
    })
  })
})
