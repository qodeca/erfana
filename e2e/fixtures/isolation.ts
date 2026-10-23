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
import { execFile, type ChildProcess } from 'child_process'
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
  'XAUTHORITY',
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

/** Variable-name prefixes passed through whole (`LC_*`, `ERFANA_*`). */
const APP_ENV_PREFIXES: readonly string[] = ['LC_', 'ERFANA_']
// No ELECTRON_* variable is passed on: the built app reads none (only
// ELECTRON_RENDERER_URL, which electron-vite sets for dev servers), and
// ELECTRON_RUN_AS_NODE would turn the app into a plain Node process.

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
  // Switches on the app's e2e test hooks (window.__erfanaTest); main ignores it in a packaged build
  env.ERFANA_E2E_TEST_HOOKS = '1'

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

const SHELL_STARTUP_FILES = ['.zshrc', '.zshenv', '.zprofile', '.bashrc', '.bash_profile']

/**
 * What a seeded startup file holds. Only `.zshrc` carries anything: zsh's
 * PROMPT_SP prints a `%` end-of-line marker and pads to the terminal width
 * before each prompt, and a resize during startup left that marker on its own
 * line with the cursor at column 0 below the prompt (macOS, #288).
 */
const SHELL_STARTUP_CONTENT: Record<string, string> = { '.zshrc': 'unsetopt PROMPT_SP\n' }

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
  // Seeded shell startup files: zsh offers its interactive `zsh-newuser-install`
  // menu when none exists in $HOME, and that menu swallows typed input.
  for (const name of SHELL_STARTUP_FILES) {
    await fs.promises.writeFile(path.join(home, name), SHELL_STARTUP_CONTENT[name] ?? '', 'utf-8')
  }
  // A minimal identity for any VCS tool run in the terminal, so the real one is never read.
  await fs.promises.writeFile(
    path.join(home, '.gitconfig'),
    '[user]\n\tname = Erfana E2E\n\temail = e2e@erfana.test\n',
    'utf-8'
  )
  return home
}

/**
 * Removal retry budget: ~5.5s in total, enough for Windows to release handles.
 * `fs.rm` backs off linearly (the n-th retry waits n × retryDelay), so the total
 * is retryDelay × maxRetries × (maxRetries + 1) / 2 – 25 × 200 ms was 65 s,
 * longer than the 60 s test timeout.
 */
const REMOVE_MAX_RETRIES = 10
const REMOVE_RETRY_DELAY_MS = 100

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

/**
 * Longest teardown waits for `close()` AND the process exit together. One
 * deadline covers both, so a `close()` that never settles is cut too (#63).
 */
export const APP_EXIT_TIMEOUT_MS = 15_000
/** Longest teardown waits for the exit after the kill before moving on. */
const APP_KILL_TIMEOUT_MS = 5_000

/** Resolve with `value`, or with `'timeout'` after `ms`. */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms)
  })
  try {
    return await Promise.race([promise, timedOut])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * The teardown log line for a `taskkill /PID <pid> /T /F` run.
 *
 * taskkill exits non-zero when ANY process of the tree could not be ended – most
 * often a helper that had already exited by itself ("There is no running
 * instance of the task"). That is not a failed kill: what matters is whether
 * the app's own process was ended, which its output says by PID.
 */
export function describeTaskkill(pid: number, exitedNonZero: boolean, output: string): string {
  const mainEnded = new RegExp(`The process with PID ${pid} (\\([^)]*\\) )?has been terminated`).test(output)
  if (exitedNonZero && !mainEnded) return `taskkill /PID ${pid} /T /F failed: ${output}`
  const partial = exitedNonZero ? '; some child processes had already exited' : ''
  return `process tree of PID ${pid}${partial} (${output})`
}

/**
 * Kill the app Playwright started, and only that one: found by its own PID,
 * never by name or command-line pattern. On Windows `taskkill /T` also ends its
 * GPU, utility and renderer children, which otherwise outlive the main process
 * and keep the test folders locked. Elsewhere SIGKILL goes to the PID alone –
 * never to the process group, which Playwright's child shares with the runner.
 *
 * @returns What was killed, for the teardown log
 */
async function killAppProcess(child: ChildProcess): Promise<string> {
  const pid = child.pid
  if (pid === undefined) return 'nothing (the app has no PID)'
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`.trim().replace(/\s+/g, ' ')
        resolve(describeTaskkill(pid, error !== null, output || (error?.message ?? '')))
      })
    })
  }
  child.kill('SIGKILL')
  return `PID ${pid} (SIGKILL)`
}

/**
 * Close the app and resolve only once its process has exited, so the folders
 * it had open can be removed. If `close()` fails, hangs or never settles, or the
 * process outlives the deadline, the app Playwright started (and only that one)
 * is killed.
 */
export async function closeAppAndWait(app: ElectronApplication): Promise<void> {
  let child: ReturnType<ElectronApplication['process']>
  try {
    child = app.process()
  } catch {
    // The test already quit the app and Playwright dropped its handle: nothing left to close
    return
  }
  const exited =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => child.once('exit', () => resolve()))

  const closed = app.close().catch((error: unknown) => {
    console.warn('[fixture teardown] app.close() failed:', error)
  })
  const outcome = await withDeadline(
    closed.then(() => exited).then(() => 'exited' as const),
    APP_EXIT_TIMEOUT_MS
  )
  if (outcome === 'exited') return

  const killed = await killAppProcess(child)
  console.warn(
    `[fixture teardown] app did not close and exit within ${APP_EXIT_TIMEOUT_MS} ms; killed ${killed}`
  )
  if ((await withDeadline(exited, APP_KILL_TIMEOUT_MS)) === 'timeout') {
    console.warn(`[fixture teardown] PID ${child.pid} still running ${APP_KILL_TIMEOUT_MS} ms after the kill`)
  }
}
