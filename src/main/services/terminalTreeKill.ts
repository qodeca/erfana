// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Windows process-tree kill for terminal shells (#296).
 *
 * node-pty's own Windows kill forks a helper that calls `AttachConsole` on the
 * shell to list its console processes, then kills that list. The helper runs
 * after `ClosePseudoConsole` has already torn the console down, so it often
 * fails ("AttachConsole failed") and node-pty falls back to killing only the
 * shell – whatever the shell was running (and its `conhost.exe`) stays behind.
 * Every kill also pays for starting a whole extra Electron process, which is
 * slow when dozens of terminals are closed at once.
 *
 * `taskkill /T /F` walks the parent/child links itself, needs no console, and
 * is started detached, so it finishes the job even if the app has exited.
 */
import { spawn as nodeSpawn } from 'child_process'
import { join } from 'path'
import { logger } from './LoggingService'

/** A tree kill that has not finished by now is stopped; `taskkill` normally takes well under a second. */
export const TREE_KILL_TIMEOUT_MS = 3_000

/** Absolute path of `taskkill.exe`; never resolved through PATH. */
export function taskkillPath(env: NodeJS.ProcessEnv = process.env): string {
  const systemRoot = env.SystemRoot || env.windir || 'C:\\Windows'
  return join(systemRoot, 'System32', 'taskkill.exe')
}

/**
 * Starts `taskkill /PID <pid> /T /F` for the shell and everything it started.
 * Fire-and-forget and never throws: a failed tree kill must not stop the pty
 * kill that follows it, and a quit must not wait for it.
 *
 * Only call this for a shell that is still running – a pid can be reused once
 * its process has exited.
 *
 * @returns true when the kill was started
 */
export function killProcessTree(
  pid: number | undefined,
  spawnFn: typeof nodeSpawn = nodeSpawn
): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
  try {
    const child = spawnFn(taskkillPath(), ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      detached: true
    })
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // already gone
      }
    }, TREE_KILL_TIMEOUT_MS)
    timer.unref()
    child.once('exit', () => clearTimeout(timer))
    child.once('error', (error) => {
      clearTimeout(timer)
      logger.warn('taskkill could not be started', { error: error.message })
    })
    child.unref()
    return true
  } catch (error) {
    logger.warn('taskkill could not be started', {
      error: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}
