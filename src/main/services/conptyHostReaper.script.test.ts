// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Runs the real quit-helper script (#305) under PowerShell against a mocked process
 * list: functions defined before the script shadow `Get-CimInstance`, `Get-Process`,
 * `Wait-Process`, `Stop-Process` and `Start-Sleep`, so no real process is listed or
 * ended. Windows PowerShell is used on Windows, `pwsh` elsewhere; the suite is
 * skipped where neither is installed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('./LoggingService', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { buildReapScript, MAX_SWEEPS, QUIT_TRACE_ENV } from './conptyHostReaper'

const POWERSHELL = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
const hasPowerShell = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']).status === 0

const APP = 4000
const START = 1_700_000_000_000
const QUIT = START + 60_000

interface Proc {
  pid: number
  ppid: number
  name: string
  createdMs: number
  /** First listing (1-based) the process is in; default 1 */
  from?: number
  /** Last listing the process is in (it exits on its own after it); default never */
  until?: number
  /** How many stops it survives before it is gone; default 0 */
  survives?: number
}

interface Scenario {
  procs: Proc[]
  /** Listings that return nothing (a failed or timed-out query) */
  failCalls?: number[]
  /** Our process is not running when the helper starts */
  appMissing?: boolean
  /** Our process exits during this wait (1-based); 1 = during the first wait */
  appExitsAtWait?: number
}

/** Mocks, defined as functions so they win over the cmdlets of the same name */
const PRELUDE = [
  '$sc = $env:REAP_SCENARIO | ConvertFrom-Json',
  '$global:calls = 0; $global:waits = 0; $global:stopped = @{}; $global:appExited = $false',
  'function Get-CimInstance { param($Query, $OperationTimeoutSec)',
  '  $global:calls++; $n = $global:calls',
  '  if (@($sc.failCalls) -contains $n) { return }',
  // a real list always holds System, so only a failed query is empty
  "  [pscustomobject]@{ ProcessId = [uint32]4; ParentProcessId = [uint32]0; Name = 'System'; CreationDate = [DateTimeOffset]::FromUnixTimeMilliseconds(1).LocalDateTime }",
  '  foreach ($p in $sc.procs) {',
  '    $from = 1; if ($p.from) { $from = $p.from }',
  '    if ($n -lt $from -or ($p.until -and $n -gt $p.until) -or [int]$global:stopped[[int]$p.pid] -gt [int]$p.survives) { continue }',
  '    [pscustomobject]@{ ProcessId = [uint32]$p.pid; ParentProcessId = [uint32]$p.ppid; Name = $p.name; CreationDate = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$p.createdMs).LocalDateTime }',
  '  }',
  '}',
  'function Get-Process { param($Id)',
  `  if ($sc.appMissing -or $Id -ne ${APP}) { return }`,
  `  $o = [pscustomobject]@{ Id = $Id; Handle = 1; StartTime = [DateTimeOffset]::FromUnixTimeMilliseconds(${START - 5_000}).LocalDateTime }`,
  '  $o | Add-Member -MemberType ScriptProperty -Name HasExited -Value { $global:appExited }',
  '  $o',
  '}',
  'function Wait-Process { param([Parameter(ValueFromPipeline = $true)]$InputObject, $Timeout)',
  '  process { $global:waits++; $at = 1; if ($sc.appExitsAtWait) { $at = $sc.appExitsAtWait }; if ($global:waits -ge $at) { $global:appExited = $true } }',
  '}',
  'function Stop-Process { param([Parameter(ValueFromPipeline = $true)]$InputObject, $Id, [switch]$Force)',
  "  process { if ($InputObject) { $global:appExited = $true; 'STOP app' } else { $global:stopped[[int]$Id] = [int]$global:stopped[[int]$Id] + 1; 'STOP ' + $Id } }",
  '}',
  'function Start-Sleep { param($Milliseconds) }'
].join('\n')

let dir = ''
let tracePath = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'erfana-reaper-'))
  tracePath = join(dir, 'quit-cleanup.log')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Runs the script for `scenario`; returns the pids it ended and the trace lines */
function run(scenario: Scenario, shellPids: number[] = []): { stopped: string[]; trace: string[] } {
  const script = buildReapScript(APP, START, QUIT, shellPids)
  const result = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', `${PRELUDE}\n${script}`], {
    encoding: 'utf8',
    env: { ...process.env, REAP_SCENARIO: JSON.stringify(scenario), [QUIT_TRACE_ENV]: tracePath },
    timeout: 60_000
  })
  expect(result.error).toBeUndefined()
  const stopped = result.stdout
    .split(/\r?\n/)
    .filter((l) => l.startsWith('STOP '))
    .map((l) => l.slice(5))
  const trace = existsSync(tracePath)
    ? readFileSync(tracePath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        // drop the timestamp
        .map((l) => l.slice(l.indexOf(' ') + 1))
    : []
  return { stopped, trace }
}

const host = (pid: number, extra: Partial<Proc> = {}): Proc => ({
  pid,
  ppid: APP,
  name: 'conhost.exe',
  createdMs: START + 1_000,
  ...extra
})

describe.skipIf(!hasPowerShell)('quit helper script against a mocked process list', { timeout: 60_000 }, () => {
  it('ends a console host that the first sweep could not see (query failed)', () => {
    // listing 1 is the learning pass while the app runs; listing 2 is sweep 1 and fails
    const { stopped, trace } = run({ procs: [host(5001)], failCalls: [2] })
    expect(stopped).toEqual(['5001'])
    expect(trace).toContain('sweep 1 process list unavailable')
    expect(trace).toContain('sweep 2 alive=5001:conhost.exe<4000 stopping')
    expect(trace.at(-2)).toBe('helper done result=clean leftovers=0')
  })

  it('keeps sweeping until a host that survives its first stop is gone', () => {
    const { stopped } = run({ procs: [host(5001, { survives: 1 })] })
    expect(stopped).toEqual(['5001', '5001'])
  })

  it('ends what the shells started even when the shell ended first (orphans)', () => {
    const { stopped, trace } = run(
      {
        appExitsAtWait: 2,
        procs: [
          // the shell is seen while the app runs (listings 1-2), then ends
          { pid: 6001, ppid: APP, name: 'pwsh.exe', createdMs: START + 2_000, until: 2 },
          { pid: 6002, ppid: 6001, name: 'PING.EXE', createdMs: START + 3_000 },
          { pid: 6003, ppid: 6002, name: 'conhost.exe', createdMs: START + 3_001 },
          host(5001)
        ]
      },
      [6001]
    )
    expect(stopped.sort()).toEqual(['5001', '6002', '6003'])
    expect(trace).toContain('learned 4: 5001:conhost.exe<4000,6001:pwsh.exe<4000,6002:PING.EXE<6001,6003:conhost.exe<6002')
  })

  it('never ends a program opened from the app, an unlisted child, or anything outside the creation window', () => {
    const { stopped } = run(
      {
        procs: [
          // opened with shell.openPath: our child, but not a host and not a terminal shell
          { pid: 7001, ppid: APP, name: 'WINWORD.EXE', createdMs: START + 5_000 },
          // a PowerShell child that is not one of the shells we passed
          { pid: 7002, ppid: APP, name: 'powershell.exe', createdMs: START + 5_000 },
          // created before our start (our pid was reused) and after the quit moment
          host(7003, { createdMs: START - 1 }),
          host(7004, { createdMs: QUIT + 251 }),
          // a console host below that program
          { pid: 7005, ppid: 7001, name: 'conhost.exe', createdMs: START + 4_000 },
          // our terminal shell, and a host inside the window edge
          { pid: 6001, ppid: APP, name: 'cmd.exe', createdMs: START + 2_000 },
          host(5001, { createdMs: QUIT + 250 })
        ]
      },
      [6001]
    )
    expect(stopped.sort()).toEqual(['5001', '6001'])
  })

  it('still sweeps when the app had already exited before the helper started', () => {
    const { stopped, trace } = run({ appMissing: true, procs: [host(5001)] })
    expect(stopped).toEqual(['5001'])
    expect(trace[1]).toBe('app already exited')
  })

  it('traces every step and ends with leftovers=0 when nothing was left', () => {
    const { stopped, trace } = run({ procs: [] })
    expect(stopped).toEqual([])
    expect(trace).toEqual([
      expect.stringMatching(/^helper started pid=\d+ app-pid=4000 shells=0 language=FullLanguage$/),
      'app exited',
      'learned 0: none',
      'sweep 1 alive=none',
      'sweep 2 alive=none',
      'helper done result=clean leftovers=0',
      'helper exit errors=none'
    ])
  })

  it('says it gave up, with leftovers unknown, when no listing ever works', () => {
    const fail = Array.from({ length: MAX_SWEEPS + 2 }, (_, i) => i + 1)
    const { stopped, trace } = run({ procs: [host(5001)], failCalls: fail })
    expect(stopped).toEqual([])
    expect(trace.filter((l) => l.endsWith('process list unavailable'))).toHaveLength(MAX_SWEEPS)
    expect(trace.at(-2)).toBe('helper done result=gave-up leftovers=unknown')
  })
})
