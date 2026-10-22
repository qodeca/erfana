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
 * It is started FIRST in the quit sequence, as one hidden, detached, absolute-path
 * PowerShell that:
 * 1. while our process is still alive (at most the grace period), lists the processes
 *    every second and learns our terminal tree – console hosts that are our children,
 *    the shells we pass in, and everything below them – each by pid AND creation time,
 *    so a process whose parent ends first is still recognised later;
 * 2. force-ends our process if it is still alive after the grace period (a worker
 *    thread stuck while the environment is torn down);
 * 3. then sweeps: lists the processes again, ends every member of the tree that is
 *    still alive, and repeats every 500 ms until two sweeps in a row find nothing
 *    (at most {@link MAX_SWEEPS}). One listing is not enough: a failed or timed-out
 *    query, or a host still being torn down, would otherwise go unchecked.
 *
 * It writes what it saw to {@link QUIT_TRACE_FILE} in the log folder, so a run can be
 * checked afterwards: pids, image names and parent pids only, never a command line,
 * path or window title. The last line says `result=clean leftovers=0` when nothing
 * of ours was left running.
 *
 * Safety:
 * - Only three kinds of process are members: a console host whose parent is our pid,
 *   a shell pid we passed whose parent is our pid, and a process whose parent is a
 *   member that was created no later than it. A program opened from the app
 *   (`shell.openPath`) is our child too, but none of these, so it is never touched.
 * - A pid reused after we exit cannot match: members must have been created between
 *   our process start and the quit moment (+ 250 ms rounding), and the process
 *   force-ended must have started before the quit moment.
 * - Under Constrained Language Mode / AppLocker the date guard stops the script before
 *   anything is ended (nothing is ever ended on a guess).
 * - Quit only. On a window close the other windows' terminals are alive and their
 *   hosts have the same parent pid, so nothing can be told apart.
 *
 * `wmic` is removed on current Windows, hence PowerShell. All values placed in the
 * script are integers; the trace path travels in an environment variable. The script
 * has no double quotes or backslashes, so its command-line quoting is trivial.
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

/**
 * Rounding allowance after the quit moment, for the clock difference between Node
 * and WMI. Kept tiny: no terminal is created once the shutdown has started
 * (`TerminalService.dispose()` refuses new ones), and the script can run after we
 * exit, when Windows may already have reused our pid.
 */
const CREATION_WINDOW_END_SLACK_MS = 250

/** Upper bound on each WMI query, so a stuck provider cannot keep the script alive. */
const CIM_OPERATION_TIMEOUT_SEC = 5

/** Most shell pids passed in; far above any real terminal count, keeps the command line short. */
const MAX_SHELL_PIDS = 512

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
 * The trace path is added when it is an absolute drive or UNC path.
 */
export function powershellEnv(env: NodeJS.ProcessEnv = process.env, tracePath?: string): NodeJS.ProcessEnv {
  const root = systemRoot(env)
  const out: NodeJS.ProcessEnv = {
    SystemRoot: root,
    windir: root,
    PSModulePath: win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules')
  }
  if (tracePath && isDriveOrUncPath(tracePath)) out[QUIT_TRACE_ENV] = tracePath
  return out
}

function assertInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
}

/**
 * Builds the helper script. Exported for tests.
 *
 * @param parentPid - our main process pid
 * @param startMs - earliest creation time (epoch ms) a member may have: our process start
 * @param quitMs - the quit moment (epoch ms)
 * @param shellPids - pids of the terminal shells still running at the quit moment
 */
export function buildReapScript(
  parentPid: number,
  startMs: number,
  quitMs: number,
  shellPids: ReadonlyArray<number> = []
): string {
  assertInt(parentPid, 'parentPid')
  assertInt(startMs, 'startMs')
  assertInt(quitMs, 'quitMs')
  shellPids.forEach((pid) => assertInt(pid, 'shellPid'))
  const shells = [...new Set(shellPids)].slice(0, MAX_SHELL_PIDS)
  const endMs = quitMs + CREATION_WINDOW_END_SLACK_MS
  const hosts = HOST_IMAGE_NAMES.map((n) => `'${n}'`).join(', ')
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$tr = $env:${QUIT_TRACE_ENV}`,
    "function Trace([string]$m) { if ($tr) { Add-Content -LiteralPath $tr -Value ((Get-Date -Format 'o') + ' ' + $m) } }",
    `$app = ${parentPid}`,
    `$hosts = @(${hosts})`,
    `$shells = @(${shells.join(', ')})`,
    // pid -> creation ticks (T), image name (N) and parent pid (P) of every member seen
    '$known = @{}',
    "Trace ('helper started pid=' + $PID + ' app-pid=' + $app + ' shells=' + $shells.Count + ' language=' + $ExecutionContext.SessionState.LanguageMode)",
    'try {',
    `$s = [DateTimeOffset]::FromUnixTimeMilliseconds(${startMs}).UtcDateTime`,
    `$q = [DateTimeOffset]::FromUnixTimeMilliseconds(${quitMs}).UtcDateTime`,
    `$e = [DateTimeOffset]::FromUnixTimeMilliseconds(${endMs}).UtcDateTime`,
    // Constrained Language Mode can leave a static call returning nothing: stop rather than match everything
    "if (-not $s -or -not $q -or -not $e) { Trace 'helper stopped: dates unavailable'; exit }",
    `function Snap { @(Get-CimInstance -Query 'SELECT ProcessId,ParentProcessId,Name,CreationDate FROM Win32_Process' -OperationTimeoutSec ${CIM_OPERATION_TIMEOUT_SEC}) }`,
    // Adds new members of the tree to $known (until nothing more is added), then returns
    // the processes of $list that are members
    'function Tree($list) {',
    '  $grew = $true',
    '  while ($grew) {',
    '    $grew = $false',
    '    foreach ($x in $list) {',
    '      $id = [int]$x.ProcessId',
    '      if ($id -eq $PID -or $id -eq $app -or -not $x.CreationDate) { continue }',
    '      $c = $x.CreationDate.ToUniversalTime().Ticks',
    '      if ($c -lt $s.Ticks -or $c -gt $e.Ticks) { continue }',
    '      if ($known.ContainsKey($id) -and $known[$id].T -eq $c) { continue }',
    '      $pp = [int]$x.ParentProcessId',
    '      $mine = $pp -eq $app -and (($hosts -contains [string]$x.Name) -or ($shells -contains $id))',
    '      $below = $known.ContainsKey($pp) -and $known[$pp].T -le $c',
    '      if ($mine -or $below) { $known[$id] = @{ T = $c; N = [string]$x.Name; P = $pp }; $grew = $true }',
    '    }',
    '  }',
    '  foreach ($x in $list) {',
    '    $id = [int]$x.ProcessId',
    '    if ($x.CreationDate -and $known.ContainsKey($id) -and $known[$id].T -eq $x.CreationDate.ToUniversalTime().Ticks) { $x }',
    '  }',
    '}',
    "function Fmt($items) { $t = @($items | ForEach-Object { [string]$_.ProcessId + ':' + $_.Name + '<' + $_.ParentProcessId }); if ($t.Count -eq 0) { 'none' } else { $t -join ',' } }",
    // 1. Learn the tree while our process runs, then wait for it; end it only if it is
    //    the same one (started before the quit moment). The checked process object is
    //    used for the wait and the end, so a pid reused in between cannot be hit.
    '$p = Get-Process -Id $app',
    "if (-not $p) { Trace 'app already exited' }",
    "elseif ($p.StartTime.ToUniversalTime() -gt $q) { Trace 'app pid reused, not waited for' }",
    'else {',
    // Touching Handle makes the Process object hold an OS handle to this exact process
    '  $null = $p.Handle',
    `  $until = (Get-Date).AddSeconds(${QUIT_GRACE_SEC})`,
    '  while (-not $p.HasExited -and (Get-Date) -lt $until) {',
    '    $null = Tree (Snap)',
    '    $p | Wait-Process -Timeout 1',
    '  }',
    "  if ($p.HasExited) { Trace 'app exited' } else { $p | Stop-Process -Force; Trace 'app force-ended after the grace period' }",
    '}',
    "Trace ('learned ' + $known.Count + ': ' + (Fmt @($known.Keys | Sort-Object | ForEach-Object { @{ ProcessId = $_; Name = $known[$_].N; ParentProcessId = $known[$_].P } })))",
    // 2. Sweep until two sweeps in a row find no member alive
    "$quiet = 0; $result = 'gave-up'; $left = 'unknown'",
    `for ($i = 1; $i -le ${MAX_SWEEPS}; $i++) {`,
    // A real list always holds System and this helper, so an empty one is a failed query
    '  $list = Snap',
    "  if ($list.Count -eq 0) { $quiet = 0; $left = 'unknown'; Trace ('sweep ' + $i + ' process list unavailable') }",
    '  else {',
    '    $alive = @(Tree $list)',
    '    $left = $alive.Count',
    '    if ($alive.Count -eq 0) {',
    '      $quiet++',
    "      Trace ('sweep ' + $i + ' alive=none')",
    "      if ($quiet -ge 2) { $result = 'clean'; break }",
    '    } else {',
    '      $quiet = 0',
    "      Trace ('sweep ' + $i + ' alive=' + (Fmt $alive) + ' stopping')",
    '      foreach ($x in $alive) { Stop-Process -Id ([int]$x.ProcessId) -Force }',
    '    }',
    '  }',
    `  Start-Sleep -Milliseconds ${SWEEP_PAUSE_MS}`,
    '}',
    "Trace ('helper done result=' + $result + ' leftovers=' + $left)",
    '} finally {',
    // Error ids only (no messages): they name the failing command, never user data
    "  $ids = @($Error | ForEach-Object { [string]$_.FullyQualifiedErrorId } | Where-Object { $_ -notlike 'ProcessNotTerminated*' } | Select-Object -Unique)",
    "  Trace ('helper exit errors=' + $(if ($ids.Count -eq 0) { 'none' } else { $ids -join ';' }))",
    '}'
  ].join('\n')
}

export interface ReapOptions {
  platform?: NodeJS.Platform
  pid?: number
  now?: () => number
  uptimeSeconds?: () => number
  spawnFn?: typeof nodeSpawn
  /** Terminal shells still running (`TerminalService.getLiveShellPids()`). */
  shellPids?: ReadonlyArray<number>
  /** Absolute path of the trace file; no trace when absent. */
  tracePath?: string
  writeFileFn?: typeof writeFileSync
  appendFileFn?: typeof appendFileSync
}

/**
 * Starts the helper and returns at once; it is detached, so it keeps running after
 * the app exits. Never throws, and does nothing off Windows.
 *
 * Before the start it replaces the trace file with one line from the app, so a file
 * that holds only that line means the helper never ran.
 *
 * @returns true when the helper was started
 */
export function startConptyHostReaper(options: ReapOptions = {}): boolean {
  const {
    platform = process.platform,
    pid = process.pid,
    now = Date.now,
    uptimeSeconds = process.uptime,
    spawnFn = nodeSpawn,
    shellPids = [],
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
    const shells = shellPids.filter((p) => Number.isSafeInteger(p) && p > 0)
    const script = buildReapScript(pid, startMs, quitMs, shells)
    note(`app starting quit helper app-pid=${pid} shells=${shells.length}`, true)
    const child = spawnFn(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', script],
      { stdio: 'ignore', windowsHide: true, detached: true, env: powershellEnv(process.env, trace) }
    )
    // No kill timer: the process is gone before one could fire. The script bounds itself
    // (grace period, query timeout, sweep count).
    child.once('error', (error) => {
      logger.warn('Quit cleanup helper could not be started', { error: error.message })
      note(`app: quit helper could not be started (${(error as NodeJS.ErrnoException).code ?? 'error'})`)
    })
    // The helper waits for us, so an exit seen here (we are still alive) is a failure
    child.once('exit', (code) => {
      logger.warn('Quit cleanup helper exited before the app', { code })
      note(`app: quit helper exited before the app code=${code ?? 'none'}`)
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
