// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Quit-time backstop for Windows terminals (#305): nothing a terminal started may
 * outlive the app, and the main process must not hang on exit.
 *
 * Each ConPTY terminal has a `conhost.exe` (or `OpenConsole.exe`) child of the
 * main process next to its shell. node-pty and `terminalTreeKill.ts` are meant to
 * end both, but a leftover keeps running after the app is gone. This cleanup does
 * not depend on either.
 *
 * It is started FIRST in the quit sequence. A short launcher PowerShell (a child of the
 * app) starts the real helper with `Start-Process -WindowStyle Hidden` and exits, so the
 * helper is a grandchild that outlives the app (see {@link startConptyHostReaper}). The
 * helper is one hidden PowerShell that:
 * 1. while our process is still alive (at most the grace period), lists the processes
 *    every second and learns our terminal tree – console hosts that are our children,
 *    the shells we pass in, and everything below them – each by pid AND creation time,
 *    so a process whose parent ends first is still recognised later. An app that is
 *    still listed while its start time cannot be read is still exiting: the helper looks
 *    again for up to 1 s before it calls the start time unreadable;
 * 2. force-ends our process if it is still alive after the grace period (a worker
 *    thread stuck while the environment is torn down). If our process cannot be
 *    checked (no handle, or its start time is unreadable), it is never ended: the
 *    helper waits out the grace period instead (or until it sees the app gone). The
 *    sweeps then run even if the app is still alive, because that could not be told;
 * 3. then sweeps: lists the processes again, ends every member of the tree that is
 *    still alive, and repeats every 500 ms until two sweeps in a row find nothing
 *    (at most {@link MAX_SWEEPS}). One listing is not enough: a failed, partial or
 *    timed-out query, or a host still being torn down, would otherwise go unchecked.
 *    Each phase and each sweep has its own error handling, so one error is traced and
 *    the next step still runs.
 *
 * It writes what it saw to {@link QUIT_TRACE_FILE} in the log folder, so a run can be
 * checked afterwards: pids, parent pids, PowerShell error ids (`FullyQualifiedErrorId`;
 * for a plain `throw` that is its message), and image names only of
 * console hosts and of the shells we passed (any other process is written as
 * `other`); never a command line, path or window title. The last lines say
 * `result=clean members-left=0` when nothing of ours was left running.
 *
 * Safety:
 * - Only three kinds of process are members: a console host whose parent is our pid,
 *   a shell we passed (pid AND a creation time within {@link SHELL_SPAWN_TOLERANCE_MS}
 *   of its spawn) whose parent is our pid, and a process whose parent is a member that
 *   was created no later than it. A program opened from the app (`shell.openPath`) is
 *   our child too, but none of these, so it is never touched – even when it got the
 *   pid of a shell that has ended.
 * - The shells we pass are members from the start, even if no list ever shows them
 *   (the helper often starts after the app and its shells are gone): a process whose
 *   parent pid is such a shell counts if it was created after the shell's spawn time
 *   (minus the 5 s tolerance) and no later than the quit moment + 250 ms. Known gap:
 *   a shell that ended just before the quit, whose pid was reused at once by a process
 *   that started a child before quit + 250 ms, would make that child look like ours.
 * - Our direct children must have been created between our process start and the quit
 *   moment (+ 250 ms rounding). A process below a member may be newer only while that
 *   member is alive: it counts when the member is in the same list, or when it was
 *   created no later than the last snapshot (taken before the query starts) that saw the
 *   member alive. Once the member is gone its pid may be reused, so a newer child is not
 *   ours.
 * - A process is ended through a handle opened on it at kill time, and only after its
 *   start time read through that handle matches the creation time recorded for the
 *   member (1 ms tolerance). A pid reused between the listing and the kill is skipped.
 *   Our own process is ended only if it started before the quit moment.
 * - Under Constrained Language Mode / AppLocker the date guard stops the script before
 *   anything is ended (nothing is ever ended on a guess).
 * - Quit only. On a window close the other windows' terminals are alive and their
 *   hosts have the same parent pid, so nothing can be told apart.
 *
 * `wmic` is removed on current Windows, hence PowerShell. Only integers and constants
 * are placed in the scripts. The trace path and the shell table travel in environment
 * variables (the table is integers only and is checked again inside the script). The
 * helper reaches the launcher as `-EncodedCommand` (base64, so its own quoting does not
 * matter); the launcher script has no double quotes or backslashes, so its command-line
 * quoting is trivial.
 */
import { spawn as nodeSpawn } from 'child_process'
import { appendFileSync, writeFileSync } from 'fs'
import { win32 } from 'path'
import { logger } from './LoggingService'
import { isDriveOrUncPath, taskkillPath } from './terminalTreeKill'

/**
 * How long the helper waits for our process to exit on its own before force-ending
 * it. Normal quits measured on Windows take 3.6–6.2 s with 32 terminals.
 */
export const QUIT_GRACE_SEC = 15

/** Most sweeps after our process is gone; with the 500 ms pause about 5 s plus the queries. */
export const MAX_SWEEPS = 10

/** Pause between two sweeps. */
export const SWEEP_PAUSE_MS = 500

/** Name of the trace file the helper writes in the log folder, replaced at every quit. */
export const QUIT_TRACE_FILE = 'quit-cleanup.log'

/** Environment variable that carries the trace path into the script. */
export const QUIT_TRACE_ENV = 'ERFANA_QUIT_TRACE'

/** Environment variable that carries the shell table (`pid:ticks,...`) into the helper. */
export const QUIT_SHELLS_ENV = 'ERFANA_QUIT_SHELLS'

/** Windows' limit on a whole command line (CreateProcess `lpCommandLine`). */
export const WINDOWS_COMMAND_LINE_MAX = 32_767

/**
 * Rounding allowance after the quit moment, for the clock difference between Node
 * and WMI. Kept tiny: no terminal is created once the shutdown has started
 * (`TerminalService.beginShutdown()` refuses new ones), and the script can run after we
 * exit, when Windows may already have reused our pid.
 */
const CREATION_WINDOW_END_SLACK_MS = 250

/** Upper bound on each WMI query, so a stuck provider cannot keep the script alive. */
const CIM_OPERATION_TIMEOUT_SEC = 5

/** Most shells passed in; far above any real terminal count, keeps the environment short. */
export const MAX_SHELLS = 512

/**
 * How far a shell's creation time may be from the moment node-pty returned its pid.
 * The spawn is synchronous, so the real gap is milliseconds; a few seconds absorb a
 * busy machine. A pid reused later by another program is far outside it.
 */
export const SHELL_SPAWN_TOLERANCE_MS = 5_000

/** Kill-time start-time check tolerance: 1 ms in .NET ticks (WMI keeps microseconds). */
const IDENTITY_TOLERANCE_TICKS = 10_000

/** .NET ticks of the Unix epoch, to place spawn times in the script as ticks. */
const UNIX_EPOCH_TICKS = 621_355_968_000_000_000n

/** A terminal shell still running at the quit moment. */
export interface LiveShell {
  pid: number
  /** `Date.now()` right after node-pty returned the pid */
  spawnedAtMs: number
}

/** Image names of a console host; `-contains` compares case-insensitively inside the script. */
const HOST_IMAGE_NAMES = ['conhost.exe', 'OpenConsole.exe'] as const

/** The validated Windows directory (`taskkillPath` ignores a relative `SystemRoot`). */
function systemRoot(env: NodeJS.ProcessEnv): string {
  return win32.dirname(win32.dirname(taskkillPath(env)))
}

/** Absolute path of Windows PowerShell, next to `taskkill.exe`; never resolved through PATH. */
export function powershellPath(env: NodeJS.ProcessEnv = process.env): string {
  return win32.join(systemRoot(env), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/**
 * The only environment PowerShell gets: the validated Windows directory and the
 * module path under it, so nothing inherited (PSModulePath, profiles) can load code.
 * The trace path is added when it is an absolute drive or UNC path, and the shell
 * table when given (built by {@link shellsEnvValue}). The launcher passes this
 * environment on to the helper.
 */
export function powershellEnv(
  env: NodeJS.ProcessEnv = process.env,
  tracePath?: string,
  shells?: string
): NodeJS.ProcessEnv {
  const root = systemRoot(env)
  const out: NodeJS.ProcessEnv = {
    SystemRoot: root,
    windir: root,
    PSModulePath: win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules')
  }
  if (tracePath && isDriveOrUncPath(tracePath)) out[QUIT_TRACE_ENV] = tracePath
  if (shells && SHELLS_VALUE.test(shells)) out[QUIT_SHELLS_ENV] = shells
  return out
}

/** `pid:ticks` pairs, comma-separated; ticks are always 18 digits for current dates. */
const SHELLS_VALUE = /^[0-9]{1,9}:[0-9]{18}(?:,[0-9]{1,9}:[0-9]{18})*$/

function assertInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
}

/**
 * The shell table for {@link QUIT_SHELLS_ENV}: `pid:ticks` pairs (spawn time as .NET
 * ticks), duplicates dropped, at most {@link MAX_SHELLS}. Exported for tests.
 */
export function shellsEnvValue(shells: ReadonlyArray<LiveShell>): string {
  const byPid = new Map<number, number>()
  for (const shell of shells) {
    assertInt(shell.pid, 'shell pid')
    assertInt(shell.spawnedAtMs, 'shell spawn time')
    if (shell.pid > 999_999_999) throw new Error('shell pid out of range')
    if (byPid.size < MAX_SHELLS) byPid.set(shell.pid, shell.spawnedAtMs)
  }
  return [...byPid].map(([pid, ms]) => `${pid}:${BigInt(ms) * 10_000n + UNIX_EPOCH_TICKS}`).join(',')
}

/**
 * Builds the helper script. Exported for tests. The shells come from
 * {@link QUIT_SHELLS_ENV}, not from the script, so its size does not grow with them.
 *
 * @param parentPid - our main process pid
 * @param startMs - earliest creation time (epoch ms) a member may have: our process start
 * @param quitMs - the quit moment (epoch ms)
 * @param graceSec - how long to wait for our process before force-ending it
 */
export function buildReapScript(
  parentPid: number,
  startMs: number,
  quitMs: number,
  graceSec: number = QUIT_GRACE_SEC
): string {
  assertInt(parentPid, 'parentPid')
  assertInt(startMs, 'startMs')
  assertInt(quitMs, 'quitMs')
  assertInt(graceSec, 'graceSec')
  const endMs = quitMs + CREATION_WINDOW_END_SLACK_MS
  const hosts = HOST_IMAGE_NAMES.map((n) => `'${n}'`).join(', ')
  const shellTol = SHELL_SPAWN_TOLERANCE_MS * 10_000
  const idTol = IDENTITY_TOLERANCE_TICKS
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$tr = $env:${QUIT_TRACE_ENV}`,
    "function Trace([string]$m) { if ($tr) { Add-Content -LiteralPath $tr -Value ((Get-Date -Format 'o') + ' ' + $m) } }",
    "function ErrId($r) { [string]$r.FullyQualifiedErrorId }",
    `$app = ${parentPid}`,
    `$hosts = @(${hosts})`,
    // pid -> spawn time (ticks) of each shell we passed; only well-formed integer pairs
    '$shells = @{}',
    `try { foreach ($pair in (([string]$env:${QUIT_SHELLS_ENV}) -split ',')) { if ($pair -match '^[0-9]{1,9}:[0-9]{18}$') { $kv = $pair -split ':'; $shells[[int]$kv[0]] = [long]$kv[1] } } } catch { }`,
    // pid -> creation ticks (T), image name (N), parent pid (P) and the time of the last
    // listing that saw it alive (L) of every member seen
    '$known = @{}',
    "Trace ('helper started pid=' + $PID + ' app-pid=' + $app + ' shells=' + $shells.Count + ' language=' + $ExecutionContext.SessionState.LanguageMode)",
    'try {',
    `  $s = [DateTimeOffset]::FromUnixTimeMilliseconds(${startMs}).UtcDateTime`,
    `  $q = [DateTimeOffset]::FromUnixTimeMilliseconds(${quitMs}).UtcDateTime`,
    `  $e = [DateTimeOffset]::FromUnixTimeMilliseconds(${endMs}).UtcDateTime`,
    "} catch { Trace ('helper stopped: dates failed error=' + (ErrId $_)); exit }",
    // Constrained Language Mode can leave a static call returning nothing: stop rather than match everything
    "if (-not $s -or -not $q -or -not $e) { Trace 'helper stopped: dates unavailable'; exit }",
    // Handed-over members (Windows round 7: the helper often starts after the app is gone,
    // so nothing can be learned live): each shell we passed counts as a member from just
    // before its spawn (the 5 s tolerance) until the quit moment + 250 ms, so a process it
    // started is ours even if the shell itself has ended. H marks it as handed over; a
    // shell seen in a list replaces its entry with what was seen.
    `try { foreach ($k in @($shells.Keys)) { $known[[int]$k] = @{ T = $shells[$k] - ${shellTol}; N = 'shell'; P = $app; L = $e.Ticks; H = $true } } } catch { }`,
    // An empty result, or any error (a partial or timed-out list), means "unavailable"
    "$script:snapErr = ''",
    // snapAt is taken BEFORE the query: a process created while the query runs is newer
    // than it, so "seen alive at snapAt" never covers a process created after the snapshot
    'function Snap {',
    "  $script:snapErr = ''",
    '  $script:snapAt = (Get-Date).ToUniversalTime().Ticks',
    '  $err = $null',
    `  $r = @(Get-CimInstance -Query 'SELECT ProcessId,ParentProcessId,Name,CreationDate FROM Win32_Process' -OperationTimeoutSec ${CIM_OPERATION_TIMEOUT_SEC} -ErrorVariable err -ErrorAction SilentlyContinue)`,
    "  if ($err -and @($err).Count -gt 0) { $script:snapErr = ErrId @($err)[0]; return }",
    // A real list always holds System and this helper, so an empty one is a failed query
    "  if ($r.Count -eq 0) { $script:snapErr = 'empty'; return }",
    '  $r',
    '}',
    // Adds new members of the tree to $known (until nothing more is added), then returns
    // the processes of $list that are members
    'function Tree($list) {',
    // $here: members present in this list with their recorded creation time
    '  $now = $script:snapAt; $here = @{}',
    '  foreach ($x in $list) {',
    '    $id = [int]$x.ProcessId',
    '    if ($x.CreationDate -and $known.ContainsKey($id) -and $known[$id].T -eq $x.CreationDate.ToUniversalTime().Ticks) { $known[$id].L = $now; $here[$id] = $true }',
    '  }',
    '  $grew = $true',
    '  while ($grew) {',
    '    $grew = $false',
    '    foreach ($x in $list) {',
    '      $id = [int]$x.ProcessId',
    '      if ($id -eq $PID -or $id -eq $app -or -not $x.CreationDate) { continue }',
    '      $c = $x.CreationDate.ToUniversalTime().Ticks',
    '      if ($c -lt $s.Ticks) { continue }',
    '      if ($known.ContainsKey($id) -and $known[$id].T -eq $c) { continue }',
    '      $pp = [int]$x.ParentProcessId',
    '      $mine = $false',
    '      if ($pp -eq $app -and $c -le $e.Ticks) {',
    '        if ($hosts -contains [string]$x.Name) { $mine = $true }',
    `        elseif ($shells.ContainsKey($id)) { $d = $c - $shells[$id]; $mine = $d -le ${shellTol} -and $d -ge -${shellTol} }`,
    '      }',
    // below a member: no older than it, and either that member is in this same list, or
    // the child was created no later than the last snapshot that saw the member alive
    '      $below = $known.ContainsKey($pp) -and $known[$pp].T -le $c -and ($here.ContainsKey($pp) -or $c -le $known[$pp].L)',
    '      if ($mine -or $below) { $known[$id] = @{ T = $c; N = [string]$x.Name; P = $pp; L = $now }; $here[$id] = $true; $grew = $true }',
    '    }',
    '  }',
    '  foreach ($x in $list) {',
    '    $id = [int]$x.ProcessId',
    '    if ($x.CreationDate -and $known.ContainsKey($id) -and $known[$id].T -eq $x.CreationDate.ToUniversalTime().Ticks) { $x }',
    '  }',
    '}',
    // Image names only for console hosts and our shells; anything else is "other"
    "function Label($id, $name) { if (($hosts -contains [string]$name) -or $shells.ContainsKey([int]$id)) { [string]$name } else { 'other' } }",
    "function Fmt($items) { $t = @($items | ForEach-Object { [string]$_.ProcessId + ':' + (Label $_.ProcessId $_.Name) + '<' + $_.ParentProcessId }); if ($t.Count -eq 0) { 'none' } else { $t -join ',' } }",
    // 1. Learn the tree while our process runs, then wait for it. It is ended only if it is
    //    the same one (started before the quit moment), through the pinned process object.
    `$until = (Get-Date).AddSeconds(${graceSec})`,
    '$p = $null; $waited = $false',
    'try {',
    '  $p = Get-Process -Id $app -ErrorAction SilentlyContinue',
    "  if (-not $p) { Trace 'app already exited'; $waited = $true }",
    '  else {',
    // Reading Handle first makes the Process object hold an OS handle to this exact
    // process, so StartTime, the wait and the end all refer to it. No handle = not pinned.
    // An app that is still exiting can be listed while its start time cannot be read:
    // look again every 100 ms for up to 1 s before calling it unreadable
    "    $st = $null; $state = 'unreadable'",
    '    for ($try = 0; $try -le 10; $try++) {',
    '      if ($null -ne $p.Handle) { $st = $p.StartTime }',
    "      if ($st) { $state = 'ok'; break }",
    "      if ($p.HasExited -eq $true) { $state = 'gone'; break }",
    '      if ($try -eq 10 -or (Get-Date) -ge $until) { break }',
    '      Start-Sleep -Milliseconds 100',
    '      $again = Get-Process -Id $app -ErrorAction SilentlyContinue',
    "      if (-not $again) { $state = 'gone'; break }",
    '      $p = $again',
    '    }',
    "    if ($state -eq 'gone') { Trace 'app exited while being checked'; $waited = $true }",
    "    elseif ($state -ne 'ok') { Trace 'app start time unreadable' }",
    "    elseif ($st.ToUniversalTime() -gt $q) { Trace 'app pid reused, not waited for'; $waited = $true }",
    '    else {',
    '      while (-not $p.HasExited -and (Get-Date) -lt $until) {',
    // a listing error must not stop the wait: a verified hung app is still force-ended
    '        try { $null = Tree @(Snap) } catch { }',
    '        $p | Wait-Process -Timeout 1',
    '      }',
    "      if ($p.HasExited) { Trace 'app exited' } else { $p | Stop-Process -Force; Trace 'app force-ended after the grace period' }",
    '      $waited = $true',
    '    }',
    '  }',
    "} catch { Trace ('wait failed error=' + (ErrId $_)) }",
    // The app could not be checked: never end it, and give it the whole grace period
    // before the sweeps (which then run even if it is still alive)
    'if (-not $waited) {',
    '  $gone = $false',
    '  while ((Get-Date) -lt $until) {',
    '    try { $gone = $p -and ($p.HasExited -eq $true) } catch { }',
    '    if (-not $gone) { $gone = -not (Get-Process -Id $app -ErrorAction SilentlyContinue) }',
    '    if ($gone) { break }',
    '    try { $null = Tree @(Snap) } catch { }',
    '    Start-Sleep -Milliseconds 1000',
    '  }',
    "  if ($gone) { Trace 'app exited (not verified)' } else { Trace 'waited out the grace period' }",
    '}',
    // learned N (handed M, seen K): handed = shells passed in and not seen in any list
    "try { $hd = @($known.Values | Where-Object { $_.H }).Count; Trace ('learned ' + $known.Count + ' (handed ' + $hd + ', seen ' + ($known.Count - $hd) + '): ' + (Fmt @($known.Keys | Sort-Object | ForEach-Object { @{ ProcessId = $_; Name = $known[$_].N; ParentProcessId = $known[$_].P } }))) } catch { }",
    // 2. Sweep until two sweeps in a row find no member alive. members-left = members
    //    alive in the last list that could be read ("unknown" when it could not be).
    "$quiet = 0; $result = 'gave-up'; $left = 'unknown'",
    `for ($i = 1; $i -le ${MAX_SWEEPS}; $i++) {`,
    '  try {',
    '    $list = @(Snap)',
    "    if ($script:snapErr) { $quiet = 0; $left = 'unknown'; Trace ('sweep ' + $i + ' process list unavailable error=' + $script:snapErr) }",
    '    else {',
    '      $alive = @(Tree $list)',
    '      $left = $alive.Count',
    '      if ($alive.Count -eq 0) {',
    '        $quiet++',
    "        Trace ('sweep ' + $i + ' alive=none')",
    "        if ($quiet -ge 2) { $result = 'clean'; break }",
    '      } else {',
    '        $quiet = 0',
    '        $done = @(); $skip = @()',
    '        foreach ($x in $alive) {',
    '          $id = [int]$x.ProcessId',
    '          try {',
    // Pin the process, verify it is the member through that handle, end it through it
    '            $h = Get-Process -Id $id -ErrorAction SilentlyContinue',
    '            if ($h) {',
    '              $d = $null',
    '              if ($null -ne $h.Handle) {',
    '                $st = $h.StartTime',
    '                if ($st) { $d = $st.ToUniversalTime().Ticks - $known[$id].T }',
    '              }',
    `              if ($null -ne $d -and $d -le ${idTol} -and $d -ge -${idTol}) { $h | Stop-Process -Force; $done += $id } else { $skip += $id }`,
    '            }',
    "          } catch { $skip += $id; Trace ('sweep ' + $i + ' stop failed pid=' + $id + ' error=' + (ErrId $_)) }",
    '        }',
    "        Trace ('sweep ' + $i + ' alive=' + (Fmt $alive) + ' stopped=' + ($(if ($done.Count) { $done -join ',' } else { 'none' })) + ' skipped=' + ($(if ($skip.Count) { $skip -join ',' } else { 'none' })))",
    '      }',
    '    }',
    "  } catch { $quiet = 0; $left = 'unknown'; Trace ('sweep ' + $i + ' failed error=' + (ErrId $_)) }",
    `  Start-Sleep -Milliseconds ${SWEEP_PAUSE_MS}`,
    '}',
    "Trace ('helper done result=' + $result + ' members-left=' + $left)",
    // Error ids only (FullyQualifiedErrorId), not the full error records. The cmdlets used
    // here report fixed ids; a plain `throw` uses its message as the id, so an id can
    // carry a message. The expected ones (a pid already gone, a wait that timed out) are
    // left out.
    "$ids = @($Error | ForEach-Object { [string]$_.FullyQualifiedErrorId } | Where-Object { $_ -notlike 'ProcessNotTerminated*' -and $_ -notlike 'NoProcessFoundForGivenId*' } | Select-Object -Unique)",
    "Trace ('helper exit errors=' + $(if ($ids.Count -eq 0) { 'none' } else { $ids -join ';' }))"
  ].join('\n')
}

/** Base64 alphabet only: what may be placed in the launcher script. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/** `-EncodedCommand` form of a script: base64 of its UTF-16LE text. */
export function encodeCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/**
 * Builds the launcher script (Windows round 6): it starts the helper as a separate,
 * hidden PowerShell with its own console and exits. It holds only constants and the
 * base64 text, and writes one trace line, so a missing helper can be told apart from
 * a launcher that failed. Exported for tests.
 *
 * @param encodedHelper - {@link encodeCommand} of the helper script
 */
export function buildLauncherScript(encodedHelper: string): string {
  if (!BASE64.test(encodedHelper)) throw new Error('encodedHelper must be base64')
  return [
    "$ErrorActionPreference = 'Stop'",
    `$tr = $env:${QUIT_TRACE_ENV}`,
    "function Trace([string]$m) { if ($tr) { try { Add-Content -LiteralPath $tr -Value ((Get-Date -Format 'o') + ' ' + $m) } catch { } } }",
    'try {',
    // $PSHOME is this launcher's own folder: the same validated powershell.exe
    `  $h = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', '${encodedHelper}'`,
    "  Trace ('launcher started helper pid=' + $h.Id)",
    "} catch { Trace ('launcher failed error=' + [string]$_.FullyQualifiedErrorId); exit 1 }"
  ].join('\n')
}

/** The launcher's arguments, after the PowerShell path. Exported for tests. */
export function launcherArgs(launcherScript: string): string[] {
  return ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', launcherScript]
}

export interface ReapOptions {
  platform?: NodeJS.Platform
  pid?: number
  now?: () => number
  uptimeSeconds?: () => number
  spawnFn?: typeof nodeSpawn
  /** Terminal shells still running (`TerminalService.getLiveShells()`). */
  shells?: ReadonlyArray<LiveShell>
  /** Absolute path of the trace file; no trace when absent. */
  tracePath?: string
  writeFileFn?: typeof writeFileSync
  appendFileFn?: typeof appendFileSync
}

/**
 * Starts the launcher and returns at once. Never throws, and does nothing off Windows.
 *
 * Why a launcher (#305, Windows rounds 5 and 6):
 * - NOT `detached`: on Windows `detached: true` starts the child with DETACHED_PROCESS,
 *   so `powershell.exe` gets no console and exits with code 0 without running
 *   `-Command` (nodejs/node#51018). Round 5: 20 of 20 quits had no `helper started`.
 * - But not the helper itself either: libuv (`uv__init_global_job_handle` in
 *   src/win/process.c) puts every non-detached child into one job object with
 *   KILL_ON_JOB_CLOSE, which closes when the app exits and kills the child. Round 6:
 *   the helper's trace stopped after `helper started`.
 * - That job also has SILENT_BREAKAWAY_OK, so a process the child starts is NOT in it.
 *   The launcher (a non-detached, hidden child) starts the helper with `Start-Process
 *   -WindowStyle Hidden`, which gives it its own hidden console, and exits. Measured on
 *   Windows: the helper then ran the whole script after the app had exited.
 *
 * Still in any job the APP was started in: if a launcher or terminal runs Erfana inside
 * a job that kills its processes on close and does not allow breakaway, the helper ends
 * with the app. Node exposes no CREATE_BREAKAWAY_FROM_JOB and a native module is out of
 * scope; the trace shows it as `helper started` / `learned` with no `app exited` after.
 *
 * Before the start it replaces the trace file with one line from the app, so a file
 * that holds only that line means the launcher never ran.
 *
 * @returns true when the launcher was started
 */
export function startConptyHostReaper(options: ReapOptions = {}): boolean {
  const {
    platform = process.platform,
    pid = process.pid,
    now = Date.now,
    uptimeSeconds = process.uptime,
    spawnFn = nodeSpawn,
    shells: liveShells = [],
    tracePath,
    writeFileFn = writeFileSync,
    appendFileFn = appendFileSync
  } = options
  if (platform !== 'win32') return false

  const trace = tracePath && isDriveOrUncPath(tracePath) ? tracePath : undefined
  const note = (line: string, first = false): void => {
    if (!trace) return
    try {
      const text = `${new Date(now()).toISOString()} ${line}\n`
      if (first) writeFileFn(trace, text)
      else appendFileFn(trace, text)
    } catch {
      // The trace is for diagnosis only; the cleanup goes ahead without it
    }
  }

  try {
    const quitMs = Math.floor(now())
    const startMs = Math.max(1, Math.floor(quitMs - uptimeSeconds() * 1000))
    const shells = liveShells.filter(
      (sh) =>
        Number.isSafeInteger(sh.pid) &&
        sh.pid > 0 &&
        sh.pid <= 999_999_999 &&
        Number.isSafeInteger(sh.spawnedAtMs) &&
        sh.spawnedAtMs > 0
    )
    const shellsValue = shellsEnvValue(shells)
    const launcher = buildLauncherScript(encodeCommand(buildReapScript(pid, startMs, quitMs)))
    const shellCount = shellsValue ? shellsValue.split(',').length : 0
    note(`app starting quit helper app-pid=${pid} shells=${shellCount}`, true)
    const child = spawnFn(
      powershellPath(),
      launcherArgs(launcher),
      // No `detached` (see above): a detached powershell.exe never runs its script
      { stdio: 'ignore', windowsHide: true, env: powershellEnv(process.env, trace, shellsValue) }
    )
    // No kill timer: the launcher exits right after starting the helper, and the helper
    // bounds itself (grace period, query timeout, sweep count).
    child.once('error', (error) => {
      logger.warn('Quit cleanup helper could not be started', { error: error.message })
      note(`app: quit helper could not be started (${(error as NodeJS.ErrnoException).code ?? 'error'})`)
    })
    // The launcher exits at once; a non-zero code means it could not start the helper
    child.once('exit', (code) => {
      if (code === 0) return
      logger.warn('Quit cleanup launcher failed', { code })
      note(`app: quit launcher failed code=${code ?? 'none'}`)
    })
    child.unref()
    return true
  } catch (error) {
    logger.warn('Quit cleanup helper could not be started', {
      error: error instanceof Error ? error.message : String(error)
    })
    note('app: quit helper could not be started')
    return false
  }
}
