// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Windows process-tree kill for terminal shells on app quit and window close (#296).
 *
 * node-pty's own Windows kill forks a helper that calls `AttachConsole` on the
 * shell to list its console processes, then kills that list. The helper runs
 * after `ClosePseudoConsole` has already torn the console down, so it often
 * fails ("AttachConsole failed") and node-pty falls back to killing only the
 * shell – whatever the shell was running (and its `conhost.exe`) stays behind.
 * Every kill also pays for starting a whole extra Electron process, which is
 * slow when dozens of terminals are closed at once. (In a packaged build the
 * `RunAsNode` fuse is off, so `child_process.fork` throws and node-pty's list
 * is never built at all.)
 *
 * `taskkill /T /F` walks the parent/child links itself and needs no console. It
 * is started detached, so it finishes the job even if the app has exited.
 *
 * Only quit and window close use it. Closing one tab or restarting ends the
 * shell the normal way, so a program the user started can keep running.
 *
 * Limit: `/T` follows the parent pid recorded in each process. If the shell's
 * pid was reused, old orphans of the earlier owner of that pid can match too, so
 * call this only for a shell known to be alive. Only a Job Object fully prevents
 * that, and node-pty does not expose one.
 */
import { spawn as nodeSpawn } from 'child_process'
import { win32 } from 'path'
import { logger } from './LoggingService'

/** A tree kill that has not finished by now is stopped; `taskkill` normally takes well under a second. */
export const TREE_KILL_TIMEOUT_MS = 3_000

/** How long a caller waits for `taskkill` before going on (it keeps running on its own). */
export const TREE_KILL_AWAIT_MS = 500

const DEFAULT_SYSTEM_ROOT = 'C:\\Windows'

/** `win32.isAbsolute` also accepts a rooted path with no drive (`\\Windows`), which still depends on the current drive. */
export function isDriveOrUncPath(value: string): boolean {
  return win32.isAbsolute(value) && /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value)
}

/**
 * Absolute path of `taskkill.exe`; never resolved through PATH. A `SystemRoot`
 * that is not an absolute Windows path is ignored, because a relative value
 * would make the lookup depend on the working directory.
 */
export function taskkillPath(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [env.SystemRoot, env.windir]
  const root = candidates.find((c): c is string => typeof c === 'string' && isDriveOrUncPath(c))
  return win32.join(root ?? DEFAULT_SYSTEM_ROOT, 'System32', 'taskkill.exe')
}

/**
 * Starts one `taskkill /T /F /PID a /PID b …` for the given shells and waits at
 * most {@link TREE_KILL_AWAIT_MS} for it, so a shell is still alive (its pid not
 * yet freed) when the tree is looked up. Never throws or rejects: a failed tree
 * kill must not stop the pty kill that follows it.
 *
 * Only pass shells that are still running – a pid can be reused once its
 * process has exited.
 *
 * @returns true when the kill was started
 */
export function killProcessTrees(
  pids: ReadonlyArray<number | undefined>,
  spawnFn: typeof nodeSpawn = nodeSpawn,
  awaitMs: number = TREE_KILL_AWAIT_MS
): Promise<boolean> {
  const valid = pids.filter((p): p is number => typeof p === 'number' && Number.isInteger(p) && p > 0)
  if (valid.length === 0) return Promise.resolve(false)

  return new Promise<boolean>((resolve) => {
    let waitTimer: ReturnType<typeof setTimeout> | undefined
    const done = (started: boolean): void => {
      if (waitTimer) clearTimeout(waitTimer)
      resolve(started)
    }
    try {
      const args = ['/T', '/F', ...valid.flatMap((pid) => ['/PID', String(pid)])]
      // No `shell` option: the arguments go to taskkill.exe as they are
      const child = spawnFn(taskkillPath(), args, {
        stdio: 'ignore',
        windowsHide: true,
        detached: true
      })
      const killTimer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // already gone
        }
      }, TREE_KILL_TIMEOUT_MS)
      killTimer.unref()
      child.once('exit', () => {
        clearTimeout(killTimer)
        done(true)
      })
      child.once('error', (error) => {
        clearTimeout(killTimer)
        logger.warn('taskkill could not be started', { error: error.message })
        done(false)
      })
      child.unref()
      waitTimer = setTimeout(() => done(true), awaitMs)
    } catch (error) {
      logger.warn('taskkill could not be started', {
        error: error instanceof Error ? error.message : String(error)
      })
      done(false)
    }
  })
}
