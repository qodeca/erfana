// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Runs the real quit-helper script (#305) under PowerShell against a mocked process
 * list: functions defined before the script shadow `Get-CimInstance`, `Get-Process`,
 * `Wait-Process`, `Stop-Process`, `Start-Sleep` and `Get-Date`, so no real process is
 * listed or ended and time is simulated. Windows PowerShell is used on Windows, `pwsh`
 * elsewhere; the suite is skipped where neither is installed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('./LoggingService', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { buildReapScript, MAX_SWEEPS, QUIT_TRACE_ENV, type LiveShell } from './conptyHostReaper'

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
  /** Start time a handle opened at kill time reads: another process took the pid */
  pinnedCreatedMs?: number
}

interface Scenario {
  procs: Proc[]
  /** Listings that return nothing (a failed query) */
  failCalls?: number[]
  /** Listings that return only System plus an error (a partial or timed-out query) */
  partialCalls?: number[]
  /** Our process is not running when the helper starts */
  appMissing?: boolean
  /** Our process exits during this wait (1-based); 1 = during the first wait */
  appExitsAtWait?: number
  /** How our process's StartTime reads; 'bad' is a value whose use throws */
  appStart?: 'ok' | 'null' | 'throw' | 'bad'
  /** HasExited of our process reads $null (not readable) */
  appHasExitedNull?: boolean
}

/** Mocks, defined as functions so they win over the cmdlets of the same name */
const PRELUDE = [
  '$sc = $env:REAP_SCENARIO | ConvertFrom-Json',
  '$global:calls = 0; $global:waits = 0; $global:stopped = @{}; $global:appExited = $false',
  // simulated clock (epoch ms); the helper starts just after the quit moment
  `$global:clock = ${QUIT + 300}`,
  'function Get-Date { [CmdletBinding()] param($Format)',
  '  $global:clock += 1',
  '  $d = [DateTimeOffset]::FromUnixTimeMilliseconds($global:clock).LocalDateTime',
  '  if ($Format) { $d.ToString($Format) } else { $d }',
  '}',
  'function Start-Sleep { [CmdletBinding()] param($Milliseconds) $global:clock += [long]$Milliseconds }',
  'function Visible($p) {',
  '  $from = 1; if ($p.from) { $from = $p.from }',
  '  -not ($global:calls -lt $from -or ($p.until -and $global:calls -gt $p.until) -or [int]$global:stopped[[int]$p.pid] -gt [int]$p.survives -or [long]$p.createdMs -gt $global:clock)',
  '}',
  'function Row($id, $ppid, $name, $ms) { [pscustomobject]@{ ProcessId = [uint32]$id; ParentProcessId = [uint32]$ppid; Name = $name; CreationDate = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$ms).LocalDateTime } }',
  'function Get-CimInstance { [CmdletBinding()] param($Query, $OperationTimeoutSec)',
  '  $global:calls++; $n = $global:calls',
  '  if (@($sc.failCalls) -contains $n) { return }',
  // a real list always holds System
  "  Row 4 0 'System' 1",
  "  if (@($sc.partialCalls) -contains $n) { Write-Error -Message 'quota' -ErrorId 'HRESULT 0x80041006'; return }",
  '  foreach ($p in $sc.procs) { if (Visible $p) { Row $p.pid $p.ppid $p.name $p.createdMs } }',
  '}',
  'function Get-Process { [CmdletBinding()] param($Id)',
  `  if ($Id -eq ${APP}) {`,
  '    if ($sc.appMissing) { return }',
  '    $o = [pscustomobject]@{ Id = $Id; Handle = 1 }',
  "    if ($sc.appStart -eq 'null') { $o | Add-Member -NotePropertyName StartTime -NotePropertyValue $null }",
  "    elseif ($sc.appStart -eq 'bad') { $o | Add-Member -NotePropertyName StartTime -NotePropertyValue 'not-a-date' }",
  "    elseif ($sc.appStart -eq 'throw') { $o | Add-Member -MemberType ScriptProperty -Name StartTime -Value { throw [System.ComponentModel.Win32Exception]::new(5) } }",
  `    else { $o | Add-Member -NotePropertyName StartTime -NotePropertyValue ([DateTimeOffset]::FromUnixTimeMilliseconds(${START - 5_000}).LocalDateTime) }`,
  '    if ($sc.appHasExitedNull) { $o | Add-Member -MemberType ScriptProperty -Name HasExited -Value { $null } }',
  '    else { $o | Add-Member -MemberType ScriptProperty -Name HasExited -Value { $global:appExited } }',
  '    return $o',
  '  }',
  '  foreach ($p in $sc.procs) {',
  '    if ([int]$p.pid -eq [int]$Id -and (Visible $p)) {',
  '      $ms = $p.createdMs; if ($p.pinnedCreatedMs) { $ms = $p.pinnedCreatedMs }',
  '      return [pscustomobject]@{ Id = [int]$Id; Handle = 1; StartTime = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$ms).LocalDateTime }',
  '    }',
  '  }',
  '}',
  'function Wait-Process { [CmdletBinding()] param([Parameter(ValueFromPipeline = $true)]$InputObject, $Timeout)',
  '  process {',
  '    $global:waits++; $at = 1; if ($sc.appExitsAtWait) { $at = $sc.appExitsAtWait }',
  '    if ($global:waits -ge $at) { $global:appExited = $true } else { $global:clock += 1000 }',
  '  }',
  '}',
  'function Stop-Process { [CmdletBinding()] param([Parameter(ValueFromPipeline = $true)]$InputObject, $Id, [switch]$Force)',
  '  process {',
  '    if ($InputObject) { $Id = $InputObject.Id }',
  `    if ([int]$Id -eq ${APP}) { $global:appExited = $true; 'STOP app waits=' + $global:waits; return }`,
  "    $global:stopped[[int]$Id] = [int]$global:stopped[[int]$Id] + 1; 'STOP ' + $Id",
  '  }',
  '}'
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

/** Runs the script for `scenario`; returns what it ended and the trace lines */
function run(
  scenario: Scenario,
  shells: LiveShell[] = [],
  graceSec?: number
): { stopped: string[]; trace: string[] } {
  const script = buildReapScript(APP, START, QUIT, shells, graceSec)
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

/** A shell we passed, spawned at `createdMs` */
const shell = (pid: number, createdMs: number): LiveShell => ({ pid, spawnedAtMs: createdMs })

describe.skipIf(!hasPowerShell)('quit helper script against a mocked process list', { timeout: 60_000 }, () => {
  it('ends a console host that the first sweep could not see (query failed)', () => {
    // listing 1 is the learning pass while the app runs; listing 2 is sweep 1 and fails
    const { stopped, trace } = run({ procs: [host(5001)], failCalls: [2] })
    expect(stopped).toEqual(['5001'])
    expect(trace).toContain('sweep 1 process list unavailable error=empty')
    expect(trace).toContain('sweep 2 alive=5001:conhost.exe<4000 stopped=5001 skipped=none')
    expect(trace.at(-2)).toBe('helper done result=clean members-left=0')
  })

  it('does not take a list that came with an error for a quiet sweep', () => {
    // sweeps 1 and 2 get only System plus an error (a partial list); the host is alive
    const { stopped, trace } = run({ procs: [host(5001)], partialCalls: [2, 3] })
    expect(stopped).toEqual(['5001'])
    expect(trace.filter((l) => /^sweep [12] process list unavailable error=HRESULT 0x80041006/.test(l))).toHaveLength(2)
    expect(trace).not.toContain('sweep 1 alive=none')
  })

  it('keeps sweeping until a host that survives its first stop is gone', () => {
    const { stopped } = run({ procs: [host(5001, { survives: 1 })] })
    expect(stopped).toEqual(['5001', '5001'])
  })

  it('does not end a process that took a member pid between the list and the stop', () => {
    const { stopped, trace } = run({ procs: [host(5001, { pinnedCreatedMs: START + 9_999 })] })
    expect(stopped).toEqual([])
    expect(trace).toContain('sweep 1 alive=5001:conhost.exe<4000 stopped=none skipped=5001')
    expect(trace.at(-2)).toBe('helper done result=gave-up members-left=1')
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
      [shell(6001, START + 2_000)]
    )
    expect(stopped.sort()).toEqual(['5001', '6002', '6003'])
    // the name of a process that is neither a host nor our shell is not written
    expect(trace).toContain('learned 4: 5001:conhost.exe<4000,6001:pwsh.exe<4000,6002:other<6001,6003:conhost.exe<6002')
  })

  it('ends a child started after the quit moment below a member that is still alive', () => {
    const { stopped } = run(
      {
        appExitsAtWait: 3,
        procs: [
          { pid: 6001, ppid: APP, name: 'pwsh.exe', createdMs: START + 2_000 },
          // a supervisor below the shell restarts its worker 1.5 s after the quit
          { pid: 6002, ppid: 6001, name: 'node.exe', createdMs: START + 3_000 },
          { pid: 6003, ppid: 6002, name: 'node.exe', createdMs: QUIT + 1_500 },
          // below a shell that was last seen alive in listing 1: created later, so its
          // parent pid may belong to someone else by now
          { pid: 6101, ppid: APP, name: 'cmd.exe', createdMs: START + 2_500, until: 1 },
          { pid: 6102, ppid: 6101, name: 'other.exe', createdMs: QUIT + 2_000 }
        ]
      },
      [shell(6001, START + 2_000), shell(6101, START + 2_500)]
    )
    expect(stopped.sort()).toEqual(['6001', '6002', '6003'])
  })

  it('never ends a program opened from the app, an unlisted child, or anything outside the creation window', () => {
    const { stopped, trace } = run(
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
      [shell(6001, START + 2_000)]
    )
    expect(stopped.sort()).toEqual(['5001', '6001'])
    expect(trace.join('\n')).not.toMatch(/WINWORD|powershell\.exe/)
  })

  it('never ends a program that got the pid of a shell which has ended', () => {
    // shell 6001 was spawned at START + 2 s and ended without an exit event; its pid now
    // belongs to a program opened with shell.openPath, also our child
    const { stopped } = run(
      { procs: [{ pid: 6001, ppid: APP, name: 'WINWORD.EXE', createdMs: START + 30_000 }] },
      [shell(6001, START + 2_000)]
    )
    expect(stopped).toEqual([])
  })

  it('still sweeps when the app had already exited before the helper started', () => {
    const { stopped, trace } = run({ appMissing: true, procs: [host(5001)] })
    expect(stopped).toEqual(['5001'])
    expect(trace[1]).toBe('app already exited')
  })

  it('force-ends the app after the grace period, and only then sweeps', () => {
    const { stopped, trace } = run({ appExitsAtWait: 1_000, procs: [host(5001)] }, [], 3)
    expect(stopped).toEqual(['app waits=3', '5001'])
    expect(trace).toContain('app force-ended after the grace period')
  })

  it('with an unreadable start time, never ends the app, waits out the grace period, then sweeps', () => {
    const { stopped, trace } = run({ appStart: 'null', appHasExitedNull: true, procs: [host(5001)] }, [], 3)
    expect(stopped).toEqual(['5001'])
    expect(trace).toContain('app start time unreadable')
    expect(trace).toContain('waited out the grace period')
    expect(trace.at(-2)).toBe('helper done result=clean members-left=0')
  })

  it('takes a start time that throws on read as unreadable (PowerShell reads it as $null)', () => {
    const { stopped, trace } = run({ appStart: 'throw', procs: [host(5001)] }, [], 3)
    expect(stopped).toEqual(['5001'])
    expect(trace).toContain('app start time unreadable')
    expect(trace).toContain('waited out the grace period')
  })

  it('traces an error while checking the app and still waits out the grace period and sweeps', () => {
    // a start time that is not a date makes ToUniversalTime() throw
    const { stopped, trace } = run({ appStart: 'bad', procs: [host(5001)] }, [], 3)
    expect(stopped).toEqual(['5001'])
    expect(trace.some((l) => l.startsWith('wait failed error=MethodNotFound'))).toBe(true)
    expect(trace).toContain('waited out the grace period')
  })

  it('traces every step and ends with members-left=0 when nothing was left', () => {
    const { stopped, trace } = run({ procs: [] })
    expect(stopped).toEqual([])
    expect(trace).toEqual([
      expect.stringMatching(/^helper started pid=\d+ app-pid=4000 shells=0 language=FullLanguage$/),
      'app exited',
      'learned 0: none',
      'sweep 1 alive=none',
      'sweep 2 alive=none',
      'helper done result=clean members-left=0',
      'helper exit errors=none'
    ])
  })

  it('says it gave up, with members-left unknown, when no listing ever works', () => {
    const fail = Array.from({ length: MAX_SWEEPS + 2 }, (_, i) => i + 1)
    const { stopped, trace } = run({ procs: [host(5001)], failCalls: fail })
    expect(stopped).toEqual([])
    expect(trace.filter((l) => l.includes('process list unavailable'))).toHaveLength(MAX_SWEEPS)
    expect(trace.at(-2)).toBe('helper done result=gave-up members-left=unknown')
  })
})
