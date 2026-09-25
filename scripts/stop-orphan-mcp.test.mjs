// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { writeFakeNpx, isAlive } from './lib/mcp-stand-in.mjs'
import { isMcpLauncher, findOrphans, listProcesses, stopOrphanMcp } from './stop-orphan-mcp.mjs'

const TIMEOUT_MS = 10_000

describe('isMcpLauncher', () => {
  it('matches the orphan command line seen on macOS', () => {
    expect(isMcpLauncher('npm exec @snowfort/circuit-electron@latest HOME=/Users/x PATH=/usr/bin')).toBe(true)
    expect(isMcpLauncher('npm exec @snowfort/circuit-electron@0.0.18')).toBe(true)
    expect(isMcpLauncher('node /usr/local/bin/npx -y @snowfort/circuit-electron')).toBe(true)
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
