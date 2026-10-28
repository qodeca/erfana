// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { writeFakeNpx, isAlive } from './lib/mcp-stand-in.mjs'
import { isMcpLauncher, isSameProcess, parseStart, findOrphans, listProcesses, stopOrphanMcp } from './stop-orphan-mcp.mjs'

const TIMEOUT_MS = 10_000

describe('isMcpLauncher', () => {
  it('matches the orphan command line seen on macOS', () => {
    expect(isMcpLauncher('npm exec @snowfort/circuit-electron@latest HOME=/Users/x PATH=/usr/bin')).toBe(true)
    expect(isMcpLauncher('npm exec @snowfort/circuit-electron@0.0.18')).toBe(true)
    expect(isMcpLauncher('node /usr/local/bin/npx -y @snowfort/circuit-electron')).toBe(true)
    expect(isMcpLauncher('/usr/local/bin/npx --yes @snowfort/circuit-electron@latest')).toBe(true)
    expect(isMcpLauncher('npx @snowfort/circuit-electron')).toBe(true)
  })

  it('rejects a command that only mentions npx and the package as arguments (S-1)', () => {
    expect(isMcpLauncher('viewer --topic npx @snowfort/circuit-electron')).toBe(false)
    expect(isMcpLauncher('node viewer.js npx @snowfort/circuit-electron')).toBe(false)
    expect(isMcpLauncher('grep npm exec @snowfort/circuit-electron')).toBe(false)
    expect(isMcpLauncher('npm run exec @snowfort/circuit-electron')).toBe(false)
  })

  it('rejects a launcher whose package argument is not the listed package (S-1)', () => {
    expect(isMcpLauncher('npx -y other-pkg @snowfort/circuit-electron')).toBe(false)
    expect(isMcpLauncher('npm exec other-pkg @snowfort/circuit-electron')).toBe(false)
    expect(isMcpLauncher('npx @snowfort/circuit-electron-evil')).toBe(false)
    expect(isMcpLauncher('npx @snowfort/circuit-electron@latest;rm')).toBe(false)
  })

  it('rejects ambiguous command lines: unknown options before the package, or a split executable path (S-1)', () => {
    expect(isMcpLauncher('npx --package=@snowfort/circuit-electron circuit-electron')).toBe(false)
    expect(isMcpLauncher('npx -p evil @snowfort/circuit-electron')).toBe(false)
    expect(isMcpLauncher('/opt/my tools/npx @snowfort/circuit-electron')).toBe(false)
    expect(isMcpLauncher('')).toBe(false)
  })

  it('rejects other packages, lookalike names and non-launchers', () => {
    expect(isMcpLauncher('npm exec chrome-devtools-mcp@1.10.1')).toBe(false)
    expect(isMcpLauncher('npm exec @snowfort/circuit-electron-extra')).toBe(false)
    expect(isMcpLauncher('node /Users/x/.npm/_npx/abc/node_modules/.bin/circuit-electron')).toBe(false)
    expect(isMcpLauncher('vim notes-about-npx @snowfort/circuit-electron')).toBe(false)
  })
})

describe('findOrphans', () => {
  it('returns orphaned launchers with all their descendants, and skips live-session launchers', () => {
    const processes = [
      { pid: 10, ppid: 1, age: '1:00', command: 'npm exec @snowfort/circuit-electron@latest' },
      { pid: 11, ppid: 10, age: '1:00', command: 'node .bin/circuit-electron' },
      { pid: 12, ppid: 11, age: '1:00', command: 'electron' },
      { pid: 20, ppid: 500, age: '1:00', command: 'npm exec @snowfort/circuit-electron@latest' },
      { pid: 21, ppid: 20, age: '1:00', command: 'node .bin/circuit-electron' },
      { pid: 30, ppid: 1, age: '1:00', command: 'npm exec some-other-server' },
    ]
    expect(findOrphans(processes).map((proc) => proc.pid)).toEqual([10, 11, 12])
  })
})

describe('parseStart', () => {
  it('reads a UTC lstart value, including a space-padded day', () => {
    expect(parseStart('Fri Sep 25 16:00:00 2026')).toBe(Date.UTC(2026, 8, 25, 16, 0, 0))
    expect(parseStart('Sat Sep  5 07:08:09 2026')).toBe(Date.UTC(2026, 8, 5, 7, 8, 9))
  })

  it('returns NaN for anything else', () => {
    for (const bad of [undefined, '', 'Fri Sept 25 16:00:00 2026', 'Fri Sep 25 16:00 2026', '25/09/2026 16:00:00']) {
      expect(parseStart(bad)).toBeNaN()
    }
  })
})

describe('isSameProcess', () => {
  const target = { pid: 10, ppid: 1, start: 'Fri Sep 25 13:00:00 2026', command: 'npx @snowfort/circuit-electron' }

  it('confirms the same PID, start time, command and parent', () => {
    expect(isSameProcess(target, { ...target })).toBe(true)
    // a descendant re-parented to the orphan parent is still the same process
    expect(isSameProcess({ ...target, ppid: 10 }, { ...target, ppid: 1 })).toBe(true)
  })

  it('refuses a reused PID, a new parent or an unconfirmable identity', () => {
    expect(isSameProcess(target, { ...target, start: 'Fri Sep 25 13:00:05 2026' })).toBe(false)
    expect(isSameProcess(target, { ...target, command: 'vim' })).toBe(false)
    expect(isSameProcess(target, { ...target, ppid: 500 })).toBe(false)
    expect(isSameProcess(target, undefined)).toBe(false)
    expect(isSameProcess({ ...target, start: undefined }, { ...target, start: undefined })).toBe(false)
  })
})

describe('stopOrphanMcp against mocked process snapshots (S-2)', () => {
  const LAUNCHER = 'npm exec @snowfort/circuit-electron@latest'
  const T0 = 'Fri Sep 25 13:00:00 2026'
  const T1 = 'Fri Sep 25 13:00:01 2026'
  const T0_MS = Date.UTC(2026, 8, 25, 13, 0, 0)
  const proc = (pid, ppid, start, command) => ({ pid, ppid, start, age: '1:00', command })

  /**
   * `snapshots` answer successive `ps` calls (the last repeats); `alive` answers kill(pid, 0);
   * `scannedAt` is the wall clock when the first snapshot is taken (default: 10 s after T0).
   */
  async function run(snapshots, alive, { scannedAt = T0_MS + 10_000, dryRun = false } = {}) {
    const signals = []
    const lines = []
    let call = 0
    const exitCode = await stopOrphanMcp({
      dryRun,
      graceMs: 0,
      clock: () => scannedAt,
      log: (line) => lines.push(line),
      list: () => snapshots[Math.min(call++, snapshots.length - 1)],
      signal: (pid, sig) => signals.push([pid, sig]),
      isAlive: (pid) => alive.has(pid),
    })
    return { exitCode, signals, lines, calls: call }
  }

  it('does not SIGTERM a PID reused between the scan and the signal', async () => {
    const scan = [proc(10, 1, T0, LAUNCHER), proc(11, 10, T0, 'node .bin/circuit-electron')]
    // 10 exited and its PID now runs the same command, started later
    const beforeTerm = [proc(10, 1, T1, LAUNCHER), proc(11, 1, T0, 'node .bin/circuit-electron')]
    const { exitCode, signals, lines } = await run([scan, beforeTerm, [proc(10, 1, T1, LAUNCHER)]], new Set([10]))
    expect(signals).toEqual([[11, 'SIGTERM']])
    expect(exitCode).toBe(0)
    expect(lines[0]).toMatch(/^gone before stop, not signalled pid=10 /)
    expect(lines[1]).toMatch(/^stopped pid=11 /)
  })

  it('does not SIGTERM a PID now held by a live-session launcher (same start second: the parent check alone)', async () => {
    const scan = [proc(10, 1, T0, LAUNCHER)]
    const { signals } = await run([scan, [proc(10, 500, T0, LAUNCHER)]], new Set([10]))
    expect(signals).toEqual([])
  })

  it('does not SIGTERM a same-second PID reuse: a process younger than 2 s at the scan is refused', async () => {
    // The scan runs 0.5 s into T0's second; the pre-SIGTERM snapshot shows an identical tuple,
    // which may be a replacement that started in the same second.
    const same = [proc(10, 1, T0, LAUNCHER)]
    const { exitCode, signals, lines } = await run([same, same, same], new Set([10]), { scannedAt: T0_MS + 500 })
    expect(signals).toEqual([])
    expect(exitCode).toBe(1)
    expect(lines[0]).toMatch(/^NOT stopped \(too young to confirm identity\) pid=10 /)
  })

  it('does not SIGKILL a same-second PID reuse after SIGTERM', async () => {
    // Everything identical in every snapshot: without the age rule this would be SIGTERM then SIGKILL.
    const same = [proc(10, 1, T0, LAUNCHER), proc(11, 10, T0, 'electron')]
    const { signals } = await run([same, same, same, same], new Set([10, 11]), { scannedAt: T0_MS + 900 })
    expect(signals.filter(([, sig]) => sig === 'SIGKILL')).toEqual([])
    expect(signals).toEqual([])
  })

  it('refuses a process 1999 ms old at the scan and signals one 2000 ms old (boundary)', async () => {
    const scan = [proc(10, 1, T0, LAUNCHER)]
    const young = await run([scan, scan, []], new Set(), { scannedAt: T0_MS + 1999 })
    expect(young.signals).toEqual([])
    const old = await run([scan, scan, []], new Set(), { scannedAt: T0_MS + 2000 })
    expect(old.signals).toEqual([[10, 'SIGTERM']])
    expect(old.exitCode).toBe(0)
  })

  it('--dry-run marks a too-young process as refused', async () => {
    const scan = [proc(10, 1, T0, LAUNCHER)]
    const { signals, lines } = await run([scan], new Set([10]), { scannedAt: T0_MS + 500, dryRun: true })
    expect(signals).toEqual([])
    expect(lines).toEqual([
      expect.stringMatching(/^would NOT stop \(too young to confirm identity\) pid=10 /),
      '0 process(es) would be stopped, 1 refused (dry run, nothing stopped).',
    ])
  })

  it('does not SIGKILL a PID reused by the same command after SIGTERM', async () => {
    const scan = [proc(10, 1, T0, LAUNCHER)]
    const reused = [proc(10, 1, T1, LAUNCHER)]
    // kill(10, 0) keeps succeeding: the PID is alive, but it is a new process
    const { exitCode, signals, lines } = await run([scan, scan, reused, reused], new Set([10]))
    expect(signals).toEqual([[10, 'SIGTERM']])
    expect(exitCode).toBe(0)
    expect(lines[0]).toMatch(/^stopped pid=10 /)
  })

  it('does not SIGKILL a survivor whose parent became a live session', async () => {
    const scan = [proc(10, 1, T0, LAUNCHER), proc(11, 10, T0, 'electron')]
    const adopted = [proc(11, 500, T0, 'electron')]
    const { exitCode, signals, lines } = await run([scan, scan, adopted, adopted], new Set([11]))
    expect(signals).toEqual([
      [10, 'SIGTERM'],
      [11, 'SIGTERM'],
    ])
    expect(exitCode).toBe(1)
    expect(lines[1]).toMatch(/^FAILED to stop pid=11 /)
  })

  it('SIGKILLs a confirmed survivor, including a descendant re-parented to PID 1 (control)', async () => {
    const scan = [proc(10, 1, T0, LAUNCHER), proc(11, 10, T0, 'electron')]
    const survived = [proc(10, 1, T0, LAUNCHER), proc(11, 1, T0, 'electron')]
    const { exitCode, signals } = await run([scan, scan, survived, []], new Set([10, 11]))
    expect(signals).toEqual([
      [10, 'SIGTERM'],
      [11, 'SIGTERM'],
      [10, 'SIGKILL'],
      [11, 'SIGKILL'],
    ])
    expect(exitCode).toBe(0)
  })

  it('signals nothing when a start time is missing, and reports it still running', async () => {
    const scan = [proc(10, 1, undefined, LAUNCHER)]
    const { exitCode, signals, lines } = await run([scan], new Set([10]))
    expect(signals).toEqual([])
    // no identity can be confirmed, so it cannot be shown to be gone either
    expect(lines[0]).toMatch(/^NOT stopped \(identity not confirmed\) pid=10 /)
    expect(exitCode).toBe(1)
  })
})

describe.skipIf(process.platform === 'win32')('stopOrphanMcp against real processes', () => {
  let dir
  let npx
  let pkg
  let started = []

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'erfana-stop-orphan-mcp-'))
    npx = writeFakeNpx(dir)
    // A package name unique to this run, so the test can only ever match its own stand-ins.
    pkg = `erfana-test-mcp-${randomUUID()}`
  })

  afterEach(() => {
    for (const pid of started) if (isAlive(pid)) process.kill(pid, 'SIGKILL')
    started = []
    rmSync(dir, { recursive: true, force: true })
  })

  const readPids = (pidsFile) =>
    vi.waitFor(() => JSON.parse(readFileSync(pidsFile, 'utf8')), { timeout: TIMEOUT_MS, interval: 25 })

  /** Start a stand-in from a shell that exits at once, so the launcher is re-parented. */
  async function startOrphan() {
    const pidsFile = join(dir, 'orphan.json')
    const shell = spawn('/bin/sh', ['-c', '"$0" "$1" -y "$2" </dev/null >/dev/null 2>&1 &', process.execPath, npx, pkg], {
      stdio: 'ignore',
      env: { ...process.env, MCP_STAND_IN_PIDS: pidsFile },
    })
    const pids = await readPids(pidsFile)
    started.push(pids.launcher, pids.server)
    // macOS re-parents to launchd (PID 1); Linux may use a subreaper instead,
    // so the test passes whichever parent the orphan actually got.
    const orphanParentPid = await vi.waitFor(
      () => {
        const ppid = listProcesses().find((proc) => proc.pid === pids.launcher)?.ppid
        expect(ppid).toBeDefined()
        expect(ppid).not.toBe(shell.pid)
        return ppid
      },
      { timeout: TIMEOUT_MS, interval: 25 },
    )
    expect(orphanParentPid).not.toBe(process.pid)
    return { pids, orphanParentPid }
  }

  async function startLiveSession() {
    const pidsFile = join(dir, 'live.json')
    const launcher = spawn(process.execPath, [npx, '-y', pkg], {
      stdio: ['pipe', 'ignore', 'ignore'],
      env: { ...process.env, MCP_STAND_IN_PIDS: pidsFile },
    })
    started.push(launcher.pid)
    const pids = await readPids(pidsFile)
    started.push(pids.server)
    return pids
  }

  it('stops an orphaned stand-in that ignores SIGTERM and leaves a live-session one alone', async () => {
    const orphan = await startOrphan()
    const live = await startLiveSession()
    const lines = []

    const exitCode = await stopOrphanMcp({
      packages: [pkg],
      orphanParentPid: orphan.orphanParentPid,
      // the stand-ins are milliseconds old; the age rule is pinned by the mocked tests
      minAgeMs: 0,
      graceMs: 500,
      log: (line) => lines.push(line),
    })

    expect(exitCode).toBe(0)
    expect(isAlive(orphan.pids.launcher)).toBe(false)
    expect(isAlive(orphan.pids.server)).toBe(false)
    expect(isAlive(live.launcher)).toBe(true)
    expect(isAlive(live.server)).toBe(true)
    expect(lines).toEqual([
      expect.stringMatching(new RegExp(`^stopped pid=${orphan.pids.launcher} ppid=${orphan.orphanParentPid} age=\\S+ \\S*node `)),
      expect.stringMatching(new RegExp(`^stopped pid=${orphan.pids.server} ppid=${orphan.pids.launcher} age=\\S+ `)),
      'Stopped 2 process(es).',
    ])
    // The command is truncated so a long command line cannot flood the output.
    for (const line of lines.slice(0, 2)) expect(line.replace(/^.*? age=\S+ /, '').length).toBeLessThanOrEqual(100)
  }, 30_000)

  it('--dry-run lists the orphan and stops nothing', async () => {
    const orphan = await startOrphan()
    const lines = []

    const exitCode = await stopOrphanMcp({
      dryRun: true,
      packages: [pkg],
      orphanParentPid: orphan.orphanParentPid,
      minAgeMs: 0,
      log: (line) => lines.push(line),
    })

    expect(exitCode).toBe(0)
    expect(isAlive(orphan.pids.launcher)).toBe(true)
    expect(isAlive(orphan.pids.server)).toBe(true)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(new RegExp(`^would stop pid=${orphan.pids.launcher} `))
    expect(lines[2]).toBe('2 process(es) would be stopped (dry run, nothing stopped).')
  }, 30_000)

  it('reports nothing found and exits 0 when there is no orphan', async () => {
    const lines = []
    const exitCode = await stopOrphanMcp({ packages: [pkg], log: (line) => lines.push(line) })
    expect(exitCode).toBe(0)
    expect(lines).toEqual(['No orphaned MCP launchers found.'])
  })
})
