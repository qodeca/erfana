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

import {
  buildLauncherScript,
  buildReapScript,
  HELPER_COMMAND,
  QUIT_HELPER_ENV,
  MAX_SWEEPS,
  QUIT_SHELLS_ENV,
  QUIT_TRACE_ENV,
  shellsEnvValue,
  type LiveShell
} from './conptyHostReaper'

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
  /** Our process's readable start time (epoch ms); default 5 s before START */
  appStartMs?: number
  /** HasExited of our process reads $null (not readable) */
  appHasExitedNull?: boolean
  /** Our process object has no Handle (it could not be pinned) */
  appNoHandle?: boolean
  /** Pids whose process object has no Handle at kill time */
  noHandle?: number[]
  /** Our process is no longer listed after this many lookups (it is mid-exit) */
  appGoneAtCheck?: number
  /** Listings that throw (a terminating error) */
  throwCalls?: number[]
  /** How long each listing takes after its snapshot (simulated ms); default 0 */
  listMs?: number
}

/** Mocks, defined as functions so they win over the cmdlets of the same name */
const PRELUDE = [
  '$sc = $env:REAP_SCENARIO | ConvertFrom-Json',
  '$global:calls = 0; $global:waits = 0; $global:stopped = @{}; $global:appExited = $false; $global:appChecks = 0',
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
  "  if (@($sc.throwCalls) -contains $n) { throw 'listing-broke' }",
  "  if (@($sc.partialCalls) -contains $n) { Write-Error -Message 'quota' -ErrorId 'HRESULT 0x80041006'; return }",
  // the rows are the snapshot; returning them takes listMs more
  '  $rows = @(foreach ($p in $sc.procs) { if (Visible $p) { Row $p.pid $p.ppid $p.name $p.createdMs } })',
  '  if ($sc.listMs) { $global:clock += [long]$sc.listMs }',
  '  $rows',
  '}',
  'function Get-Process { [CmdletBinding()] param($Id)',
  `  if ($Id -eq ${APP}) {`,
  '    if ($sc.appMissing) { return }',
  '    $global:appChecks++; if ($sc.appGoneAtCheck -and $global:appChecks -gt $sc.appGoneAtCheck) { return }',
  '    $o = [pscustomobject]@{ Id = $Id; Handle = 1 }',
  '    if ($sc.appNoHandle) { $o.Handle = $null }',
  "    if ($sc.appStart -eq 'null') { $o | Add-Member -NotePropertyName StartTime -NotePropertyValue $null }",
  "    elseif ($sc.appStart -eq 'bad') { $o | Add-Member -NotePropertyName StartTime -NotePropertyValue 'not-a-date' }",
  "    elseif ($sc.appStart -eq 'throw') { $o | Add-Member -MemberType ScriptProperty -Name StartTime -Value { throw [System.ComponentModel.Win32Exception]::new(5) } }",
  `    else { $ms = ${START - 5_000}; if ($sc.appStartMs) { $ms = [long]$sc.appStartMs }; $o | Add-Member -NotePropertyName StartTime -NotePropertyValue ([DateTimeOffset]::FromUnixTimeMilliseconds($ms).LocalDateTime) }`,
  '    if ($sc.appHasExitedNull) { $o | Add-Member -MemberType ScriptProperty -Name HasExited -Value { $null } }',
  '    else { $o | Add-Member -MemberType ScriptProperty -Name HasExited -Value { $global:appExited } }',
  '    return $o',
  '  }',
  '  foreach ($p in $sc.procs) {',
  '    if ([int]$p.pid -eq [int]$Id -and (Visible $p)) {',
  '      $ms = $p.createdMs; if ($p.pinnedCreatedMs) { $ms = $p.pinnedCreatedMs }',
  '      $hd = 1; if (@($sc.noHandle) -contains [int]$Id) { $hd = $null }',
  '      return [pscustomobject]@{ Id = [int]$Id; Handle = $hd; StartTime = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$ms).LocalDateTime }',
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
  const script = buildReapScript(APP, START, QUIT, graceSec)
  // run the helper the way the launcher starts it: its text from the environment
  const result = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', `${PRELUDE}\n${HELPER_COMMAND}`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      REAP_SCENARIO: JSON.stringify(scenario),
      [QUIT_TRACE_ENV]: tracePath,
      [QUIT_SHELLS_ENV]: shellsEnvValue(shells, QUIT),
      [QUIT_HELPER_ENV]: script
    },
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

/** A shell we passed, spawned at `createdMs` (and asked to end at `endBeforeMs`) */
const shell = (pid: number, createdMs: number, endBeforeMs?: number): LiveShell =>
  endBeforeMs === undefined ? { pid, spawnedAtMs: createdMs } : { pid, spawnedAtMs: createdMs, endBeforeMs }

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
    expect(trace).toContain('learned 4 (handed 0, seen 4): 5001:conhost.exe<4000,6001:pwsh.exe<4000,6002:other<6001,6003:conhost.exe<6002')
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

  it('does not take a child of a reused pid for ours when the listing is slow', () => {
    // listing 1 snapshots at quit + ~300 ms and takes 300 ms. The shell and its node
    // child are in it, then end; pid 6002 is reused at quit + 350 ms by an unrelated
    // program R, which starts U at quit + 400 ms. U's parent pid is 6002, but it was
    // created after the snapshot that last saw node 6002 alive.
    const { stopped } = run(
      {
        appExitsAtWait: 2,
        listMs: 300,
        procs: [
          { pid: 6001, ppid: APP, name: 'pwsh.exe', createdMs: START + 2_000, until: 1 },
          { pid: 6002, ppid: 6001, name: 'node.exe', createdMs: START + 3_000, until: 1 },
          { pid: 6002, ppid: 999, name: 'R.exe', createdMs: QUIT + 350, from: 2 },
          { pid: 8002, ppid: 6002, name: 'U.exe', createdMs: QUIT + 400, from: 2 }
        ]
      },
      [shell(6001, START + 2_000)]
    )
    expect(stopped).toEqual([])
  })

  it('never ends a process it could not pin, and never ends an app it could not pin', () => {
    const { stopped, trace } = run(
      { appExitsAtWait: 1_000, appNoHandle: true, noHandle: [5001], procs: [host(5001), host(5002)] },
      [],
      3
    )
    // the app is hung but not pinned: never ended; host 5001 has no handle: skipped
    expect(stopped).toEqual(['5002'])
    expect(trace).toContain('app start time unreadable')
    expect(trace).toContain('waited out the grace period')
    expect(trace).toContain('sweep 1 alive=5001:conhost.exe<4000,5002:conhost.exe<4000 stopped=5002 skipped=5001')
  })

  it('still force-ends a verified hung app when a listing throws during the wait', () => {
    const { stopped, trace } = run({ appExitsAtWait: 1_000, throwCalls: [1], procs: [host(5001)] }, [], 3)
    expect(stopped).toEqual(['app waits=3', '5001'])
    expect(trace).toContain('app force-ended after the grace period')
    expect(trace).not.toContain('waited out the grace period')
  })

  it('judges the tree from the handed-over shells when the app was gone before the helper started (Windows round 7)', () => {
    const { stopped, trace } = run(
      {
        appMissing: true,
        procs: [
          // a console host of ours that survived
          host(5001),
          // shell 6001 (handed over) has ended; its child and that child's host survive
          { pid: 6002, ppid: 6001, name: 'ping.exe', createdMs: START + 3_000 },
          { pid: 6003, ppid: 6002, name: 'conhost.exe', createdMs: START + 3_001 },
          // our pid and the shell's pid were reused after the quit; their children are newer
          host(7001, { createdMs: QUIT + 260 }),
          { pid: 7002, ppid: 6001, name: 'other.exe', createdMs: QUIT + 260 }
        ]
      },
      [shell(6001, START + 2_000)]
    )
    expect(stopped.sort()).toEqual(['5001', '6002', '6003'])
    expect(trace).toContain('learned 1 (handed 1, seen 0): 6001:shell<4000')
    expect(trace.at(-2)).toBe('helper done result=clean members-left=0')
  })

  it('waits for an app that is still listed while exiting, instead of giving up on it', () => {
    // the start time cannot be read while the app exits; two lookups later it is gone
    const { stopped, trace } = run({ appStart: 'null', appGoneAtCheck: 2, procs: [host(5001)] })
    expect(stopped).toEqual(['5001'])
    expect(trace).toContain('app exited while being checked')
    expect(trace).not.toContain('app start time unreadable')
    expect(trace).not.toContain('waited out the grace period')
  })

  it('A: never ends the children of an unrelated process now holding a stale shell pid', () => {
    const { stopped } = run(
      {
        appMissing: true,
        procs: [
          // shell 6001 ended long ago without an exit event; a browser holds the pid now
          { pid: 6001, ppid: 999, name: 'chrome.exe', createdMs: START + 30_000 },
          { pid: 6100, ppid: 6001, name: 'chrome.exe', createdMs: START + 40_000 },
          { pid: 6101, ppid: 6001, name: 'chrome.exe', createdMs: START + 41_000 }
        ]
      },
      [shell(6001, START + 2_000)]
    )
    expect(stopped).toEqual([])
  })

  it('B: never ends a child of the pid’s previous holder, created before the shell was spawned', () => {
    const { stopped } = run(
      { appMissing: true, procs: [{ pid: 6050, ppid: 6001, name: 'app.exe', createdMs: START + 7_000 }] },
      [shell(6001, START + 10_000)]
    )
    expect(stopped).toEqual([])
  })

  it('C: never ends a child of a process that took the shell pid just after the quit', () => {
    const { stopped } = run(
      {
        appMissing: true,
        procs: [
          { pid: 6001, ppid: 999, name: 'r.exe', createdMs: QUIT + 100 },
          { pid: 6060, ppid: 6001, name: 'u.exe', createdMs: QUIT + 200 }
        ]
      },
      [shell(6001, START + 2_000)]
    )
    expect(stopped).toEqual([])
  })

  it('bounds a dead shell’s children by the moment it was asked to end', () => {
    // shell 6001 was asked to end at START + 50 s; its pid can be anyone's after that
    const { stopped } = run(
      {
        appMissing: true,
        procs: [
          { pid: 6002, ppid: 6001, name: 'node.exe', createdMs: START + 45_000 },
          { pid: 6003, ppid: 6001, name: 'other.exe', createdMs: START + 50_100 }
        ]
      },
      [shell(6001, START + 2_000, START + 50_000)]
    )
    expect(stopped).toEqual(['6002'])
  })

  it('sweeps at once, without ending it, when the app pid is held by a process started after the quit', () => {
    const { stopped, trace } = run({ appStartMs: QUIT + 100, appExitsAtWait: 1_000, procs: [host(5001)] })
    expect(stopped).toEqual(['5001'])
    expect(trace).toContain('app pid reused, not waited for')
    expect(trace).not.toContain('waited out the grace period')
  })

  it('sweeps at once when the app pid is unreadable but listed as created after the quit', () => {
    const { stopped, trace } = run(
      {
        appStart: 'null',
        appHasExitedNull: true,
        procs: [{ pid: APP, ppid: 1, name: 'x.exe', createdMs: QUIT + 100 }, host(5001)]
      },
      [],
      3
    )
    expect(stopped).toEqual(['5001'])
    expect(trace).toContain('app pid reused (listed as newer than the quit), not waited for')
    expect(trace).not.toContain('waited out the grace period')
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
      'learned 0 (handed 0, seen 0): none',
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

describe.skipIf(!hasPowerShell)('quit launcher script with a mocked Start-Process', { timeout: 60_000 }, () => {
  /** Runs the launcher; `fail` makes Start-Process throw */
  function launch(fail: boolean): { status: number | null; started: string[]; trace: string[] } {
    const mock = [
      // Write-Host: the launcher keeps the function's output in $h
      'function Start-Process { [CmdletBinding()] param($FilePath, $WindowStyle, [switch]$PassThru, $ArgumentList)',
      `  if (${fail ? '$true' : '$false'}) { throw 'blocked' }`,
      "  Write-Host ('FILE ' + (Split-Path -Leaf $FilePath))",
      "  Write-Host ('STYLE ' + $WindowStyle)",
      "  Write-Host ('ARGS ' + (@($ArgumentList)[0..3] -join ' '))",
      "  Write-Host ('CMD ' + @($ArgumentList)[4])",
      '  [pscustomobject]@{ Id = 4321 }',
      '}'
    ].join('\n')
    const result = spawnSync(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', `${mock}\n${buildLauncherScript()}`],
      { encoding: 'utf8', env: { ...process.env, [QUIT_TRACE_ENV]: tracePath }, timeout: 60_000 }
    )
    const trace = existsSync(tracePath)
      ? readFileSync(tracePath, 'utf8')
          .split(/\r?\n/)
          .filter(Boolean)
          .map((l) => l.slice(l.indexOf(' ') + 1))
      : []
    const started = result.stdout.split(/\r?\n/).filter((l) => /^(FILE|STYLE|ARGS|CMD) /.test(l))
    return { status: result.status, started, trace }
  }

  it('starts the helper hidden, running its text from the environment, and traces its pid', () => {
    const { status, started, trace } = launch(false)
    expect(started).toEqual([
      'FILE powershell.exe',
      'STYLE Hidden',
      'ARGS -NoProfile -NonInteractive -NoLogo -Command',
      `CMD ${HELPER_COMMAND}`
    ])
    expect(trace).toEqual(['launcher started helper pid=4321'])
    expect(status).toBe(0)
  })

  it('traces a launcher failure and exits 1', () => {
    const { status, started, trace } = launch(true)
    expect(started).toEqual([])
    expect(trace).toEqual(['launcher failed error=blocked'])
    expect(status).toBe(1)
  })
})
