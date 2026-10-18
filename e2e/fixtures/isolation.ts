// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Process-level isolation for the Electron apps the e2e fixtures launch.
 *
 * Three things the fixtures used to get wrong:
 *
 * 1. The app resolves `~/.erfana` (settings, API keys, logs) and `~/.claude`
 *    from `os.homedir()`, which `--user-data-dir` does not move. Every worker
 *    therefore wrote into the developer's real home, and shared it with every
 *    other worker. {@link createWorkerHome} gives a worker its own.
 * 2. The app was launched with `{ ...process.env }`, so every secret in the
 *    runner's environment (API keys loaded from `.env`, cloud tokens, ...)
 *    reached the app and every shell the terminal spawned. {@link buildAppEnv}
 *    builds the environment from an allowlist instead.
 * 3. Temp folders were removed once, straight after the app closed. On Windows
 *    the app still holds handles for a moment (EBUSY, #134).
 *    {@link closeAppAndWait} waits for the process to be gone and
 *    {@link removeDirWithRetry} retries the removal.
 */

import type { ElectronApplication } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

import { LOGS_DIR_RELATIVE } from '../../src/shared/constants'

/** Scratch root for everything the fixtures create (git-ignored). */
export const E2E_TEMP_DIR = path.join(__dirname, '..', '..', '.e2e-temp')

/**
 * Variables the app, Electron and the shells it spawns need to run. Anything
 * not listed here (or matching {@link APP_ENV_PREFIXES}) is NOT passed on.
 */
const APP_ENV_ALLOWLIST: ReadonlySet<string> = new Set([
  // POSIX basics
  'PATH',
  'SHELL',
  'USER',
  'LOGNAME',
  'LANG',
  'LANGUAGE',
  'TERM',
  'COLORTERM',
  'TZ',
  'TMPDIR',
  // Display / session (Linux CI runs under xvfb)
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XDG_RUNTIME_DIR',
  'XDG_SESSION_TYPE',
  'DBUS_SESSION_BUS_ADDRESS',
  // Windows basics (Node hands the environment over with its original
  // casing, so list the usual spellings)
  'SystemRoot',
  'SYSTEMROOT',
  'SystemDrive',
  'windir',
  'WINDIR',
  'ComSpec',
  'COMSPEC',
  'PATHEXT',
  'Path',
  'TEMP',
  'TMP',
  'USERNAME',
  'USERDOMAIN',
  'COMPUTERNAME',
  'OS',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'CommonProgramFiles',
  'CommonProgramFiles(x86)',
  'CommonProgramW6432',
  // Behaviour switches the suite itself reads
  'CI',
  'NODE_ENV'
])

/** Variable-name prefixes passed through whole (`LC_*`, `ERFANA_E2E_*`, ...). */
const APP_ENV_PREFIXES: readonly string[] = ['LC_', 'ERFANA_', 'ELECTRON_']

export interface AppEnvOptions {
  /**
   * Sandbox home directory. When set, every variable the platform uses to
   * locate "the user's home" (and the per-user config/cache folders under it)
   * points inside it.
   */
  homeDir?: string
  /** Extra variables, applied last (so they win over everything else). */
  extra?: Record<string, string>
}

/**
 * Build the environment for a launched app from an allowlist.
 *
 * @param options - Sandbox home and per-launch additions
 * @returns A fresh env object; `process.env` is not mutated
 */
export function buildAppEnv(options: AppEnvOptions = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (APP_ENV_ALLOWLIST.has(name) || APP_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      env[name] = value
    }
  }
  env.NODE_ENV = 'development'

  if (options.homeDir) {
    const home = options.homeDir
    // `os.homedir()` reads HOME on POSIX and USERPROFILE on Windows.
    env.HOME = home
    env.USERPROFILE = home
    env.APPDATA = path.join(home, 'AppData', 'Roaming')
    env.LOCALAPPDATA = path.join(home, 'AppData', 'Local')
    env.XDG_CONFIG_HOME = path.join(home, '.config')
    env.XDG_CACHE_HOME = path.join(home, '.cache')
    env.XDG_DATA_HOME = path.join(home, '.local', 'share')
    env.XDG_STATE_HOME = path.join(home, '.local', 'state')
  }

  return { ...env, ...options.extra }
}

/** Where the app writes its logs, for a given (sandbox) home directory. */
export function appLogsDir(homeDir: string): string {
  return path.join(homeDir, LOGS_DIR_RELATIVE)
}

/**
 * Create a worker's sandbox home under `.e2e-temp`, with the per-user folders
 * {@link buildAppEnv} points at already in place.
 *
 * @param prefix - Folder-name prefix, e.g. `home-3-`
 */
export async function createWorkerHome(prefix: string): Promise<string> {
  await fs.promises.mkdir(E2E_TEMP_DIR, { recursive: true })
  const home = await fs.promises.mkdtemp(path.join(E2E_TEMP_DIR, prefix))
  const env = buildAppEnv({ homeDir: home })
  for (const dir of [
    env.APPDATA,
    env.LOCALAPPDATA,
    env.XDG_CONFIG_HOME,
    env.XDG_CACHE_HOME,
    env.XDG_DATA_HOME,
    env.XDG_STATE_HOME
  ]) {
    await fs.promises.mkdir(dir, { recursive: true })
  }
  return home
}

/** Removal retry budget: ~5s in total, enough for Windows to release handles. */
const REMOVE_MAX_RETRIES = 25
const REMOVE_RETRY_DELAY_MS = 200

/**
 * Remove a temp directory, retrying while the OS reports it busy (EBUSY /
 * EPERM / ENOTEMPTY on Windows). Never throws: a leftover folder under the
 * git-ignored `.e2e-temp` must not fail a test that already passed.
 */
export async function removeDirWithRetry(dir: string): Promise<void> {
  try {
    await fs.promises.rm(dir, {
      recursive: true,
      force: true,
      maxRetries: REMOVE_MAX_RETRIES,
      retryDelay: REMOVE_RETRY_DELAY_MS
    })
  } catch (error) {
    console.warn(`[fixture teardown] could not remove ${dir}:`, error)
  }
}

/** Longest teardown waits for the app process to exit after `close()`. */
const APP_EXIT_TIMEOUT_MS = 10_000

/**
 * Close the app and resolve only once its process has exited, so the folders
 * it had open can be removed. If a graceful close fails or hangs, the process
 * Playwright started (and only that one) is killed.
 */
export async function closeAppAndWait(app: ElectronApplication): Promise<void> {
  const child = app.process()
  const exited =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => child.once('exit', () => resolve()))

  try {
    await app.close()
  } catch (error) {
    console.warn('[fixture teardown] app.close() failed:', error)
  }

  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), APP_EXIT_TIMEOUT_MS)
  })
  const outcome = await Promise.race([exited.then(() => 'exited' as const), timedOut])
  if (timer) clearTimeout(timer)

  if (outcome === 'timeout') {
    console.warn('[fixture teardown] app did not exit in time, killing it')
    child.kill('SIGKILL')
    await exited
  }
}
