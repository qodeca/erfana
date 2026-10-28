// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Starting the user's default web browser on one confined `.html` file
 * (issue #124, design part 4 §4.3 and §4.4).
 *
 * | Platform | Default browser | Command |
 * |---|---|---|
 * | macOS | `app.getApplicationInfoForProtocol('https://example.com')` → the `.app` bundle (spike S7; a `file://` lookup throws) | `/usr/bin/open -a <app> <file>` |
 * | Windows | the same lookup → the browser's executable (unverified: manual QA with Edge as default) | `<exe> <file>` |
 * | Linux | not attempted (out of scope) | – |
 *
 * **Fallback (RX7).** Only when the lookup errors, times out, or returns an
 * empty or unusable path – or the platform has no lookup – does the file go to
 * `shell.openPath`, the app the system uses for `.html` files, and the answer
 * says `usedFallback`. A launch that FAILS does not fall back: that app may be a
 * code editor, and the user asked for a browser.
 *
 * **Argument safety.** The argument is always the confined real path – never a
 * `file://` URL, never with `#` or a query. It must be absolute (`/`, a drive
 * letter or `\\`), so it can never be read as an option, and it travels as one
 * argv element with no shell, keeping spaces, non-ASCII characters and UNC
 * paths intact.
 *
 * Failures come back as a stage and a short cause, never as message text: a
 * Node spawn error quotes the whole command line, file path included.
 */
import { execFile as nodeExecFile, spawn } from 'node:child_process'
import { app, shell } from 'electron'
import { logger } from '../LoggingService'
import { TimeoutError, withTimeout } from '../../utils/withTimeout'

/** The address whose handler is the default browser (S7: a `file://` lookup throws). */
export const DEFAULT_BROWSER_PROBE_URL = 'https://example.com'

/** Bound on the default-browser lookup (part 4 §4.3). */
export const BROWSER_LOOKUP_TIMEOUT_MS = 3_000

/** Bound on one launch: `open` on macOS, the spawn on Windows, `openPath` in the fallback. */
export const BROWSER_LAUNCH_TIMEOUT_MS = 10_000

/** macOS `open`, by absolute path so no `PATH` entry can stand in for it. */
export const MACOS_OPEN_BIN = '/usr/bin/open'

/** The environment variable that arms the e2e seam in an unpackaged build. */
export const E2E_BROWSER_SEAM_ENV = 'ERFANA_E2E_BROWSER_SEAM'

/** What the e2e seam receives – and all it receives (RX6). */
export interface E2eBrowserLaunch {
  via: 'browser' | 'fallback'
  /** The default browser the lookup found; `null` on the fallback. */
  appPath: string | null
  /** The confined real path. */
  filePath: string
}

/**
 * The launcher's seams. Every default is a call-time lambda (for example
 * `(url) => app.getApplicationInfoForProtocol(url)`), so a stub the e2e
 * installs on `app` after startup is seen.
 */
export interface BrowserLauncherDeps {
  getApplicationInfoForProtocol: (url: string) => Promise<{ path: string }>
  /** Run a program with an argument array, never a shell; rejects on a spawn error or a non-zero exit. */
  execFile: (file: string, args: readonly string[]) => Promise<void>
  /** `shell.openPath`: resolves `''` on success, otherwise an error text. */
  openPath: (filePath: string) => Promise<string>
  platform: NodeJS.Platform
}

/** A launch that did not happen. `cause` is a code (`ENOENT`, `exit 1`, `timeout`), never message text. */
export interface BrowserLaunchFailure {
  ok: false
  stage: 'argument' | 'browser' | 'fallback'
  cause: string
}

export type BrowserLaunchResult = { ok: true; usedFallback: boolean } | BrowserLaunchFailure

export interface BrowserLauncher {
  /** Open `realPath` in the default browser. Never rejects. */
  open(realPath: string): Promise<BrowserLaunchResult>
}

/** Where the e2e installs its launch function (`app.evaluate`). */
interface SeamScope {
  __erfanaE2eBrowserLaunch?: unknown
}

/** What {@link resolveLauncher} reads to decide on the seam; injectable for its tests. */
export interface SeamRuntime {
  isPackaged: () => boolean
  env: Readonly<Record<string, string | undefined>>
  scope: SeamScope
}

/** How one launch ends once the lookup has answered: real programs, or the e2e seam. */
interface LaunchActions {
  viaBrowser(appPath: string, filePath: string): Promise<void>
  /** Resolves `''` on success, otherwise a refusal text (never logged). */
  viaFallback(filePath: string): Promise<string>
}

const DEFAULT_RUNTIME: SeamRuntime = {
  isPackaged: () => app.isPackaged,
  env: process.env,
  scope: globalThis as SeamScope
}

/** Absolute in the platform's own terms: `/…` on POSIX; `X:\…` or `\\…` on Windows. */
function isAbsoluteArgument(platform: NodeJS.Platform, candidate: string): boolean {
  if (platform === 'win32') {
    return /^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith('\\\\')
  }
  return candidate.startsWith('/')
}

/** A lookup answer worth running: absolute, and on Windows an `.exe`. */
function isUsableBrowserPath(platform: NodeJS.Platform, appPath: string): boolean {
  if (!isAbsoluteArgument(platform, appPath)) return false
  return platform !== 'win32' || appPath.toLowerCase().endsWith('.exe')
}

/** A short, path-free description of why something failed. */
function describeCause(error: unknown): string {
  if (error instanceof TimeoutError) return 'timeout'
  if (typeof error === 'object' && error !== null) {
    const { code, signal } = error as { code?: unknown; signal?: unknown }
    if (typeof code === 'string') return code
    if (typeof code === 'number') return `exit ${code}`
    if (typeof signal === 'string') return `signal ${signal}`
  }
  return 'error'
}

/** The default browser's path, or `null` when the fallback must run instead. */
async function findDefaultBrowser(deps: BrowserLauncherDeps): Promise<string | null> {
  if (deps.platform !== 'darwin' && deps.platform !== 'win32') {
    logger.info('Default-browser lookup is not attempted here; using the .html app', {
      platform: deps.platform
    })
    return null
  }
  try {
    const info = await withTimeout(
      deps.getApplicationInfoForProtocol(DEFAULT_BROWSER_PROBE_URL),
      BROWSER_LOOKUP_TIMEOUT_MS,
      'Default browser lookup'
    )
    const appPath = typeof info?.path === 'string' ? info.path.trim() : ''
    if (isUsableBrowserPath(deps.platform, appPath)) return appPath
    logger.warn('Default browser lookup gave no usable path; using the .html app', {
      empty: appPath === ''
    })
  } catch (error) {
    logger.warn('Default browser lookup failed; using the .html app', {
      cause: describeCause(error)
    })
  }
  return null
}

async function runFallback(realPath: string, actions: LaunchActions): Promise<BrowserLaunchResult> {
  try {
    const refusal = await withTimeout(
      actions.viaFallback(realPath),
      BROWSER_LAUNCH_TIMEOUT_MS,
      'Open with the .html app'
    )
    return refusal ? { ok: false, stage: 'fallback', cause: 'refused' } : { ok: true, usedFallback: true }
  } catch (error) {
    return { ok: false, stage: 'fallback', cause: describeCause(error) }
  }
}

async function launch(
  realPath: string,
  deps: BrowserLauncherDeps,
  actions: LaunchActions
): Promise<BrowserLaunchResult> {
  if (!isAbsoluteArgument(deps.platform, realPath)) {
    return { ok: false, stage: 'argument', cause: 'not-absolute' }
  }
  const appPath = await findDefaultBrowser(deps)
  if (appPath === null) return runFallback(realPath, actions)
  try {
    await withTimeout(actions.viaBrowser(appPath, realPath), BROWSER_LAUNCH_TIMEOUT_MS, 'Browser launch')
    return { ok: true, usedFallback: false }
  } catch (error) {
    // No fallback here: the lookup found a browser, so the `.html` app would
    // not be what the user asked for.
    return { ok: false, stage: 'browser', cause: describeCause(error) }
  }
}

/**
 * The real `execFile` seam.
 *
 * macOS `open` hands the file to LaunchServices and exits, so its exit code is
 * the answer, and it is killed if it overruns the launch bound. On Windows the
 * command is the browser itself: with no instance running, that process IS the
 * browser and lives until the user closes it, so waiting for its exit would
 * hold the renderer's busy state that long, and a timeout would kill the
 * browser. It is started detached instead and settles once it has spawned;
 * a spawn error still rejects. Exported for its unit test.
 */
export function runLaunchCommand(
  platform: NodeJS.Platform,
  file: string,
  args: readonly string[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (platform === 'win32') {
      const child = spawn(file, [...args], { detached: true, stdio: 'ignore', shell: false })
      child.once('error', reject)
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
      return
    }
    nodeExecFile(file, [...args], { timeout: BROWSER_LAUNCH_TIMEOUT_MS }, error =>
      error ? reject(error) : resolve()
    )
  })
}

function withDefaults(overrides: Partial<BrowserLauncherDeps>): BrowserLauncherDeps {
  const platform = overrides.platform ?? process.platform
  return {
    getApplicationInfoForProtocol: url => app.getApplicationInfoForProtocol(url),
    execFile: (file, args) => runLaunchCommand(platform, file, args),
    openPath: filePath => shell.openPath(filePath),
    ...overrides,
    platform
  }
}

function realActions(deps: BrowserLauncherDeps): LaunchActions {
  return {
    viaBrowser: (appPath, filePath) =>
      deps.platform === 'darwin'
        ? deps.execFile(MACOS_OPEN_BIN, ['-a', appPath, filePath])
        : deps.execFile(appPath, [filePath]),
    viaFallback: filePath => deps.openPath(filePath)
  }
}

function seamActions(seam: (launch: E2eBrowserLaunch) => unknown): LaunchActions {
  return {
    viaBrowser: async (appPath, filePath) => {
      await seam({ via: 'browser', appPath, filePath })
    },
    viaFallback: async filePath => {
      await seam({ via: 'fallback', appPath: null, filePath })
      return ''
    }
  }
}

/** The real launcher: the lookup, then `execFile` or `openPath`. */
export function createBrowserLauncher(overrides: Partial<BrowserLauncherDeps> = {}): BrowserLauncher {
  const deps = withDefaults(overrides)
  return { open: realPath => launch(realPath, deps, realActions(deps)) }
}

/**
 * Pick the launcher for one call (part 4 §4.4).
 *
 * `app.isPackaged` is evaluated FIRST: a packaged build gets the real launcher
 * before the environment is read or the global is probed (RX6). Only an
 * unpackaged build with `ERFANA_E2E_BROWSER_SEAM=1` AND a function at
 * `globalThis.__erfanaE2eBrowserLaunch` gets the seam – the same
 * unpackaged-only, environment-gated pattern as `ERFANA_E2E_FORCE_CRASH`.
 *
 * The seam replaces `execFile` / `openPath` only and receives nothing but
 * `{ via, appPath, filePath }`. The lookup still runs, so the e2e forces the
 * fallback by stubbing `app.getApplicationInfoForProtocol` to reject. Called
 * per request, so a function installed after startup is seen.
 */
export function resolveLauncher(
  runtime: SeamRuntime = DEFAULT_RUNTIME,
  overrides: Partial<BrowserLauncherDeps> = {}
): BrowserLauncher {
  if (runtime.isPackaged()) return createBrowserLauncher(overrides)
  if (runtime.env[E2E_BROWSER_SEAM_ENV] !== '1') return createBrowserLauncher(overrides)
  const seam = runtime.scope.__erfanaE2eBrowserLaunch
  if (typeof seam !== 'function') return createBrowserLauncher(overrides)

  logger.info('Browser launch goes to the e2e seam (unpackaged build)')
  const deps = withDefaults(overrides)
  const actions = seamActions(seam as (launch: E2eBrowserLaunch) => unknown)
  return { open: realPath => launch(realPath, deps, actions) }
}
