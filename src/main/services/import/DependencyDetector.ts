// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { execFile } from 'child_process'
import { tmpdir } from 'os'
import { posix, win32 } from 'path'
import { resolveLibreOffice, type LibreOfficeResolution } from './conversionToolGuard'
import type { DependencyStatus, ToolState } from './types'

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
    return { libreOffice: await this.detectLibreOffice() }
  }

  private async detectLibreOffice(): Promise<ToolState> {
    let resolution: LibreOfficeResolution
    try {
      resolution = this.resolve(this.untrustedRoots())
    } catch {
      return 'missing'
    }
    if (resolution.state !== 'found') return resolution.state
    return (await this.tryCommand(resolution.path, ['--version'])) ? 'found' : 'missing'
  }

  /**
   * Run `command args` with a timeout. Only ever called with an absolute path.
   *
   * @returns true if the command exits with code 0
   */
  private tryCommand(command: string, args: string[]): Promise<boolean> {
    const pathApi = process.platform === 'win32' ? win32 : posix
    if (!pathApi.isAbsolute(command)) return Promise.resolve(false)
    return new Promise((resolve) => {
      try {
        const child = execFile(
          command,
          args,
          // cwd outside any project; minimal env
          { timeout: DETECTION_TIMEOUT_MS, cwd: tmpdir(), windowsHide: true, env: probeEnv() },
          (error) => {
            resolve(!error)
          }
        )

        // Safety: handle unexpected errors on the child process
        child.on('error', () => resolve(false))
      } catch {
        // execFile itself threw (e.g., invalid command)
        resolve(false)
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
