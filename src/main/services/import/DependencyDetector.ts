// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { spawn } from 'child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, posix, win32 } from 'path'
import { pathToFileURL } from 'url'
import { resolveLibreOffice, type LibreOfficeResolution } from './conversionToolGuard'
import type { DependencyStatus, ToolState } from './types'
import { UNSAFE_TOOL_NAMES, type UnsafeToolName } from '../../../shared/unsafeTool'

/** Timeout for each dependency check command (ms) */
const DETECTION_TIMEOUT_MS = 5000

/**
 * The only variables a probe child gets. `--version` needs nothing else, and a
 * minimal env keeps `SAL_*` / `LD_*` / `DYLD_*` style overrides out of it.
 */
const PROBE_ENV_ALLOWLIST = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'LANG', 'PATHEXT']

/** Construction options – all exist so tests and callers can narrow the lookup. */
export interface DependencyDetectorOptions {
  /**
   * Folders whose binaries must never be run – the open project, which the
   * user (or a cloned repository) controls. Evaluated on every detection; the
   * temp folders are always added.
   */
  untrustedRoots?: () => ReadonlyArray<string | null | undefined>
  /** LibreOffice lookup; defaults to {@link resolveLibreOffice} (the replay of LiteParse's). */
  resolve?: (roots: ReadonlyArray<string | null | undefined>) => LibreOfficeResolution
}

/**
 * Dependency detector service
 *
 * Checks for LibreOffice, which Office document import needs. Images and PDF
 * need no external tool. Results are cached for the session lifetime –
 * `clearCache()` ("Check again") forces a new probe.
 *
 * Design:
 * - Same answer as a conversion (#250): the candidate comes from
 *   {@link resolveLibreOffice}, which replays LiteParse's own lookup – `which
 *   libreoffice-fresh` / `libreoffice` / `soffice`, then its fixed paths. A
 *   candidate a conversion would refuse is reported `unsafe` and never run, so
 *   the status never says "found" while every conversion would be refused.
 * - Liveness: a `found` candidate must answer `--version`, so a stub planted at
 *   a fixed path is rejected. Only absolute paths are run, from `os.tmpdir()`
 *   with a minimal env. A `.bat` / `.cmd` fails safely: Node refuses to
 *   `execFile` one without a shell (EINVAL, CVE-2024-27980).
 * - Non-blocking, 5 s timeout, concurrent calls share one promise, never throws.
 *
 * @see Issue #132 – LiteParse document import
 */
export class DependencyDetector {
  private cachedResult: DependencyStatus | null = null
  private pendingDetection: Promise<DependencyStatus> | null = null
  private readonly untrustedRoots: () => ReadonlyArray<string | null | undefined>
  private readonly resolve: (roots: ReadonlyArray<string | null | undefined>) => LibreOfficeResolution

  constructor(options: DependencyDetectorOptions = {}) {
    this.untrustedRoots = options.untrustedRoots ?? (() => [])
    this.resolve = options.resolve ?? ((roots) => resolveLibreOffice(roots))
  }

  /**
   * Detect available system dependencies.
   *
   * First call runs actual detection; subsequent calls return cached result.
   * Concurrent calls during detection share the same promise.
   */
  async detect(): Promise<DependencyStatus> {
    if (this.cachedResult) return this.cachedResult
    if (this.pendingDetection) return this.pendingDetection

    this.pendingDetection = this.runDetection()

    try {
      this.cachedResult = await this.pendingDetection
      return this.cachedResult
    } finally {
      this.pendingDetection = null
    }
  }

  private async runDetection(): Promise<DependencyStatus> {
    let resolution: LibreOfficeResolution
    try {
      resolution = this.resolve(this.untrustedRoots())
    } catch {
      return { libreOffice: 'missing', unsafe: null }
    }
    if (resolution.state === 'missing') return { libreOffice: 'missing', unsafe: null }
    if (resolution.state === 'unsafe') {
      // The name always comes from LiteParse's fixed list; anything else is reported as soffice.
      const tool = (UNSAFE_TOOL_NAMES as readonly string[]).includes(resolution.name)
        ? (resolution.name as UnsafeToolName)
        : 'soffice'
      return { libreOffice: 'unsafe', unsafe: { tool, reason: resolution.reason } }
    }
    return this.probe(resolution.path)
  }

  /**
   * Decide whether the resolved candidate is a live LibreOffice – without
   * launching it where launching leaves a process behind.
   *
   * - Windows: `soffice.exe` starts `soffice.bin` and exits, and `soffice.bin`
   *   never exits, so it is never run. The resolver already confirmed the file
   *   exists; the version is read from `program\version.ini` when present.
   * - macOS inside an app bundle: the version comes from `Contents/Info.plist`.
   * - Anywhere else (Linux, a bare binary): `--version` exits cleanly.
   */
  private async probe(path: string): Promise<DependencyStatus> {
    const pathApi = process.platform === 'win32' ? win32 : posix
    if (!pathApi.isAbsolute(path)) return { libreOffice: 'missing', unsafe: null }

    if (process.platform === 'win32') {
      return { libreOffice: 'found', unsafe: null, version: readWindowsVersion(path) }
    }
    if (process.platform === 'darwin') {
      const plist = bundlePlistPath(path)
      if (plist) {
        const version = parsePlistVersion(readTextOrNull(plist))
        return version
          ? { libreOffice: 'found', unsafe: null, version }
          : { libreOffice: 'missing', unsafe: null }
      }
    }
    const state: ToolState = (await this.tryCommand(path, ['--version'])) ? 'found' : 'missing'
    return { libreOffice: state, unsafe: null }
  }

  /**
   * Run `command args` with a timeout. Only ever called with an absolute path,
   * and never on Windows (see {@link probe}). stdio is ignored so the child
   * cannot hold the app's pipes, the profile is a private temp folder, and on
   * timeout the whole process group is killed (the child leads its own group).
   *
   * @returns true if the command exits with code 0
   */
  private tryCommand(command: string, args: string[]): Promise<boolean> {
    const pathApi = process.platform === 'win32' ? win32 : posix
    if (!pathApi.isAbsolute(command)) return Promise.resolve(false)
    return new Promise((resolve) => {
      let profile: string | null = null
      let timer: NodeJS.Timeout | undefined
      let settled = false
      const finish = (ok: boolean): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (profile) {
          try {
            rmSync(profile, { recursive: true, force: true })
          } catch {
            // best effort
          }
        }
        resolve(ok)
      }
      try {
        profile = mkdtempSync(join(tmpdir(), 'erfana-lo-probe-'))
        const child = spawn(
          command,
          [...args, '--headless', '--norestore', `-env:UserInstallation=${pathToFileURL(profile).href}`],
          // cwd outside any project; minimal env; no inherited stdio
          { cwd: tmpdir(), windowsHide: true, env: probeEnv(), stdio: 'ignore', detached: true }
        )
        timer = setTimeout(() => {
          killGroup(child.pid)
          finish(false)
        }, DETECTION_TIMEOUT_MS)
        child.on('error', () => finish(false))
        child.on('exit', (code) => finish(code === 0))
      } catch {
        // spawn itself threw (e.g., invalid command)
        finish(false)
      }
    })
  }

  /**
   * Clear cached detection result, so the next `detect()` probes again.
   * Used by "Check again" (#250, via `ImportToolStatusService`) and by tests.
   */
  clearCache(): void {
    this.cachedResult = null
    this.pendingDetection = null
  }
}

function probeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of PROBE_ENV_ALLOWLIST) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

/** Kill the process group a detached probe leads. Only the PID we started (POSIX). */
function killGroup(pid: number | undefined): void {
  if (pid === undefined) return
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // already gone
  }
}

function readTextOrNull(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** `<app>/Contents/Info.plist` for a binary inside an app bundle, else null. */
function bundlePlistPath(binary: string): string | null {
  let real = binary
  try {
    real = realpathSync.native(binary)
  } catch {
    // keep the given path
  }
  const marker = '/Contents/MacOS/'
  const at = real.indexOf(marker)
  return at === -1 ? null : `${real.slice(0, at)}/Contents/Info.plist`
}

/** `CFBundleShortVersionString` from an XML Info.plist, or null. */
export function parsePlistVersion(text: string | null): string | null {
  if (!text) return null
  const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(text)
  return match ? match[1].trim() : null
}

/** `ProductVersion` (or `Version`) from an ini file's text, or null. */
export function parseIniVersion(text: string | null): string | null {
  if (!text) return null
  for (const key of ['ProductVersion', 'Version']) {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*(\\S.*?)\\s*$`, 'mi').exec(text)
    if (match) return match[1]
  }
  return null
}

/** Best-effort version of a Windows install, from `version.ini` beside the exe. */
function readWindowsVersion(exe: string): string | null {
  return parseIniVersion(readTextOrNull(win32.join(win32.dirname(exe), 'version.ini')))
}
