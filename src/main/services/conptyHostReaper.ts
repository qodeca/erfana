// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Quit-time backstop for Windows terminals (#305): ends console hosts left
 * behind by node-pty, and guarantees the main process does not hang on exit.
 *
 * Each ConPTY terminal has a `conhost.exe` (or `OpenConsole.exe`) child of the
 * main process. node-pty is meant to close it, but a leftover keeps the process
 * tree alive after the app is gone. The cleanup does not depend on node-pty.
 *
 * It is started RIGHT BEFORE `app.exit(0)`, outside the 2 s dispose race, as one
 * hidden, detached, absolute-path PowerShell that:
 * 1. waits for our process to exit; if it is still alive after the grace period
 *    (a worker thread stuck while the environment is torn down), force-ends it;
 * 2. then ends every console host that is still a direct child of our pid. A
 *    child keeps its parent pid after the parent is gone, so orphans match.
 *
 * Safety:
 * - Hosts are matched by image name AND parent pid, never by name alone, in the
 *   same query that selects them.
 * - A pid reused after we exit cannot be hit: hosts must have been created between
 *   our process start and the quit moment (+ 250 ms rounding), and the process
 *   force-ended must have started before the quit moment.
 * - Under Constrained Language Mode / AppLocker the date guard stops the script before
 *   anything is ended, so the force-end and the host cleanup are skipped (nothing is
 *   ever ended on a guess).
 * - Quit only. On a window close the other windows' terminals are alive and their
 *   hosts have the same parent pid, so nothing can be told apart.
 *
 * `wmic` is removed on current Windows, hence PowerShell. All values placed in the
 * script are integers.
 */
import { spawn as nodeSpawn } from 'child_process'
import { win32 } from 'path'
import { logger } from './LoggingService'
import { taskkillPath } from './terminalTreeKill'

/**
 * How long the helper waits for our process to exit on its own before force-ending
 * it. Normal quits measured on Windows take 3.6–6.2 s with 32 terminals.
 */
export const QUIT_GRACE_SEC = 15

/**
 * Rounding allowance after the quit moment, for the clock difference between Node
 * and WMI. Kept tiny: no legitimate host is created after `terminalService.dispose()`,
 * and the script can run after we exit, when Windows may already have reused our pid.
 */
const CREATION_WINDOW_END_SLACK_MS = 250

/** Upper bound on the WMI query, so a stuck provider cannot keep the script alive. */
const CIM_OPERATION_TIMEOUT_SEC = 5

/** Image names of a console host; compared case-insensitively inside the script. */
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
 */
export function powershellEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const root = systemRoot(env)
  return {
    SystemRoot: root,
    windir: root,
    PSModulePath: win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules')
  }
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
 * @param startMs - earliest creation time (epoch ms) a host may have: our process start
 * @param quitMs - the quit moment (epoch ms)
 */
export function buildReapScript(parentPid: number, startMs: number, quitMs: number): string {
  assertInt(parentPid, 'parentPid')
  assertInt(startMs, 'startMs')
  assertInt(quitMs, 'quitMs')
  const endMs = quitMs + CREATION_WINDOW_END_SLACK_MS
  const names = HOST_IMAGE_NAMES.map((n) => `$_.Name -ieq '${n}'`).join(' -or ')
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$s = [DateTimeOffset]::FromUnixTimeMilliseconds(${startMs}).UtcDateTime`,
    `$q = [DateTimeOffset]::FromUnixTimeMilliseconds(${quitMs}).UtcDateTime`,
    `$e = [DateTimeOffset]::FromUnixTimeMilliseconds(${endMs}).UtcDateTime`,
    // Constrained Language Mode can leave a static call returning nothing: stop rather than match everything
    'if (-not $s -or -not $q -or -not $e) { exit }',
    // 1. Wait for our process; end it only if it is the same one (started before the quit
    //    moment). The checked process object is used for the wait and the end, so a pid
    //    reused in between cannot be hit.
    `$p = Get-Process -Id ${parentPid}`,
    'if ($p -and $p.StartTime.ToUniversalTime() -le $q) {',
    `  $p | Wait-Process -Timeout ${QUIT_GRACE_SEC}`,
    '  if (-not $p.HasExited) { $p | Stop-Process -Force }',
    '}',
    // 2. End the console hosts that are direct children of our pid
    `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${parentPid}' -OperationTimeoutSec ${CIM_OPERATION_TIMEOUT_SEC} |`,
    `  Where-Object { (${names}) -and $_.CreationDate.ToUniversalTime() -ge $s -and $_.CreationDate.ToUniversalTime() -le $e } |`,
    '  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }'
  ].join('\n')
}

export interface ReapOptions {
  platform?: NodeJS.Platform
  pid?: number
  now?: () => number
  uptimeSeconds?: () => number
  spawnFn?: typeof nodeSpawn
}

/**
 * Starts the helper and returns at once; it is detached, so it keeps running after
 * the app exits. Never throws, and does nothing off Windows.
 *
 * @returns true when the helper was started
 */
export function startConptyHostReaper(options: ReapOptions = {}): boolean {
  const {
    platform = process.platform,
    pid = process.pid,
    now = Date.now,
    uptimeSeconds = process.uptime,
    spawnFn = nodeSpawn
  } = options
  if (platform !== 'win32') return false

  try {
    const quitMs = Math.floor(now())
    const startMs = Math.max(1, Math.floor(quitMs - uptimeSeconds() * 1000))
    const script = buildReapScript(pid, startMs, quitMs)
    const child = spawnFn(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', script],
      { stdio: 'ignore', windowsHide: true, detached: true, env: powershellEnv() }
    )
    // No kill timer: the process is gone before one could fire. The script bounds itself
    // (grace period, 5 s query timeout).
    child.once('error', (error) => {
      logger.warn('Quit cleanup helper could not be started', { error: error.message })
    })
    child.unref()
    return true
  } catch (error) {
    logger.warn('Quit cleanup helper could not be started', {
      error: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}
