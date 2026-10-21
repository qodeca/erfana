// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Last-resort cleanup of console hosts left behind by terminals on Windows (#305).
 *
 * Each ConPTY terminal has a `conhost.exe` (or `OpenConsole.exe`) child of the
 * main process. node-pty is meant to close it, but a leftover keeps the
 * process tree alive after the app is gone. At app quit, after every shell has
 * been killed, this ends any such host that is still a direct child of THIS
 * process. It does not depend on node-pty.
 *
 * Safety:
 * - Only direct children of our own pid, matched by image name AND parent pid,
 *   never by name alone.
 * - The parent link is checked in the same query that selects the process, and
 *   only hosts created between this process's start and the quit moment match,
 *   so a pid reused after we exit cannot make us touch someone else's hosts.
 * - Quit only. On a window close the other windows' terminals are alive and
 *   their hosts are children of the same pid too, so nothing can be told apart.
 *
 * It runs one hidden, absolute-path PowerShell (a CIM query plus Stop-Process;
 * `wmic` is removed on current Windows). The caller waits for it only briefly;
 * the process is detached, so it still finishes if the app exits first. All
 * values placed in the script are integers.
 */
import { spawn as nodeSpawn } from 'child_process'
import { win32 } from 'path'
import { logger } from './LoggingService'
import { taskkillPath } from './terminalTreeKill'

/** How long quit waits for the cleanup before going on (it keeps running on its own). */
export const CONPTY_REAP_AWAIT_MS = 1_000

/** A cleanup that has not finished by now is stopped. */
export const CONPTY_REAP_TIMEOUT_MS = 10_000

/** Margin around the creation-time window, for clock rounding between Node and WMI. */
const CREATION_WINDOW_SLACK_MS = 5_000

/** Image names of a console host; compared case-insensitively inside the script. */
const HOST_IMAGE_NAMES = ['conhost.exe', 'OpenConsole.exe'] as const

/** Absolute path of Windows PowerShell, next to `taskkill.exe`; never resolved through PATH. */
export function powershellPath(env: NodeJS.ProcessEnv = process.env): string {
  return win32.join(win32.dirname(taskkillPath(env)), 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function assertInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
}

/**
 * Builds the cleanup script. Exported for tests.
 *
 * @param parentPid - our main process pid; only its direct children match
 * @param startMs - earliest creation time (epoch ms) a host may have
 * @param endMs - latest creation time (epoch ms) a host may have
 */
export function buildReapScript(parentPid: number, startMs: number, endMs: number): string {
  assertInt(parentPid, 'parentPid')
  assertInt(startMs, 'startMs')
  assertInt(endMs, 'endMs')
  const names = HOST_IMAGE_NAMES.map((n) => `$_.Name -ieq '${n}'`).join(' -or ')
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$s = [DateTimeOffset]::FromUnixTimeMilliseconds(${startMs}).LocalDateTime`,
    `$e = [DateTimeOffset]::FromUnixTimeMilliseconds(${endMs}).LocalDateTime`,
    `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${parentPid}' |`,
    `  Where-Object { (${names}) -and $_.CreationDate -ge $s -and $_.CreationDate -le $e } |`,
    '  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }'
  ].join('\n')
}

export interface ReapOptions {
  platform?: NodeJS.Platform
  pid?: number
  now?: () => number
  uptimeSeconds?: () => number
  spawnFn?: typeof nodeSpawn
  awaitMs?: number
}

/**
 * Starts the cleanup and waits at most `awaitMs` for it. Never throws or
 * rejects, and does nothing off Windows.
 *
 * @returns true when the cleanup was started
 */
export function reapConptyHosts(options: ReapOptions = {}): Promise<boolean> {
  const {
    platform = process.platform,
    pid = process.pid,
    now = Date.now,
    uptimeSeconds = process.uptime,
    spawnFn = nodeSpawn,
    awaitMs = CONPTY_REAP_AWAIT_MS
  } = options
  if (platform !== 'win32') return Promise.resolve(false)

  return new Promise<boolean>((resolve) => {
    let waitTimer: ReturnType<typeof setTimeout> | undefined
    const done = (started: boolean): void => {
      if (waitTimer) clearTimeout(waitTimer)
      resolve(started)
    }
    try {
      const quitMs = Math.floor(now())
      const startMs = Math.max(1, Math.floor(quitMs - uptimeSeconds() * 1000) - CREATION_WINDOW_SLACK_MS)
      const script = buildReapScript(pid, startMs, quitMs + CREATION_WINDOW_SLACK_MS)
      const child = spawnFn(
        powershellPath(),
        ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command', script],
        { stdio: 'ignore', windowsHide: true, detached: true }
      )
      const killTimer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // already gone
        }
      }, CONPTY_REAP_TIMEOUT_MS)
      killTimer.unref()
      child.once('exit', () => {
        clearTimeout(killTimer)
        done(true)
      })
      child.once('error', (error) => {
        clearTimeout(killTimer)
        logger.warn('Console host cleanup could not be started', { error: error.message })
        done(false)
      })
      child.unref()
      waitTimer = setTimeout(() => done(true), awaitMs)
    } catch (error) {
      logger.warn('Console host cleanup could not be started', {
        error: error instanceof Error ? error.message : String(error)
      })
      done(false)
    }
  })
}
