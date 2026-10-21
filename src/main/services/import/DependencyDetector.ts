// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { execFile } from 'child_process'
import { access, constants } from 'fs/promises'
import { tmpdir } from 'os'
import { posix, win32 } from 'path'
import {
  findOnPathEntries,
  isTrustedHit,
  untrustedFolders,
  windowsImageMagickDirs,
  POSIX_TOOL_DIRS,
  type PathHit
} from '../../utils/pathLookup'
import type { DependencyStatus } from './types'

/** Timeout for each dependency check command (ms) */
const DETECTION_TIMEOUT_MS = 5000

/** Known macOS bundle path for LibreOffice */
const MACOS_LIBREOFFICE_PATH = '/Applications/LibreOffice.app/Contents/MacOS/soffice'

/**
 * Standard Windows install locations for LibreOffice (#162).
 * Probed in priority order when `soffice` is not on PATH. The user-installer
 * defaults to `Program Files\LibreOffice\program\soffice.exe`; the 32-bit
 * installer on a 64-bit Windows lands in `Program Files (x86)`.
 */
const WIN32_LIBREOFFICE_PATHS = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
]

/**
 * The only variables a probe child gets. `--version` needs nothing else, and a
 * minimal env keeps `MAGICK_*` / `SAL_*` / `LD_*` style overrides out of it.
 */
const PROBE_ENV_ALLOWLIST = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'LANG', 'PATHEXT']

/** Walks PATH for a bare command name; see `utils/pathLookup`. */
export type PathFinder = (name: string) => PathHit[]

/** Construction options – all exist so tests and callers can narrow the lookup. */
export interface DependencyDetectorOptions {
  /** PATH walk. Defaults to {@link findOnPathEntries} over this process's PATH. */
  findOnPath?: PathFinder
  /**
   * Folders whose binaries must never be run – the open project, which the
   * user (or a cloned repository) controls. Evaluated on every detection; the
   * temp folder is always added.
   */
  untrustedRoots?: () => ReadonlyArray<string | null | undefined>
  /** Fixed ImageMagick candidates; defaults per platform (Homebrew, MacPorts, Program Files). */
  imageMagickFallbacks?: () => string[]
  /** Real-path resolver for the trust check; injectable for tests. */
  realpath?: (p: string) => string
}

function defaultImageMagickFallbacks(): string[] {
  if (process.platform === 'win32') {
    return windowsImageMagickDirs().map((dir) => win32.join(dir, 'magick.exe'))
  }
  return POSIX_TOOL_DIRS.flatMap((dir) => [posix.join(dir, 'magick'), posix.join(dir, 'convert')])
}

/**
 * Dependency detector service
 *
 * Checks for optional system tools (LibreOffice, ImageMagick) required
 * for Office document and image OCR import. Results are cached for the
 * session lifetime – `clearCache()` ("Check again") forces a new probe.
 *
 * Design:
 * - Non-blocking: all checks are async, never blocks app startup
 * - Timeout: 5s per command to prevent hangs
 * - Caching: single detection per session, concurrent calls share one promise
 * - Graceful: missing tools or errors result in false, never thrown errors
 * - Safe lookup (#250): a bare name is resolved by walking PATH in-process
 *   ({@link findOnPathEntries}), never by spawning the bare name or a lookup
 *   tool. A hit from a relative or empty PATH entry, a UNC hit, and a hit whose
 *   path or real path is inside the open project or the temp folder is never
 *   run. At most four hits per name are probed. Probes run from `os.tmpdir()`
 *   with a minimal env.
 * - Fixed fallbacks: ImageMagick is also looked for in Homebrew / MacPorts
 *   folders and `C:\Program Files\ImageMagick-*`, because a macOS Dock launch
 *   and a running Windows app do not see a PATH change made by an installer.
 *
 * @see Issue #132 – LiteParse document import
 */
export class DependencyDetector {
  private cachedResult: DependencyStatus | null = null
  private pendingDetection: Promise<DependencyStatus> | null = null
  private readonly findOnPath: PathFinder
  private readonly untrustedRoots: () => ReadonlyArray<string | null | undefined>
  private readonly imageMagickFallbacks: () => string[]
  private readonly realpath?: (p: string) => string

  constructor(options: DependencyDetectorOptions = {}) {
    this.findOnPath = options.findOnPath ?? ((name) => findOnPathEntries(name))
    this.untrustedRoots = options.untrustedRoots ?? (() => [])
    this.imageMagickFallbacks = options.imageMagickFallbacks ?? defaultImageMagickFallbacks
    this.realpath = options.realpath
  }

  /**
   * Detect available system dependencies.
   *
   * First call runs actual detection; subsequent calls return cached result.
   * Concurrent calls during detection share the same promise.
   *
   * @returns Detected dependency status
   */
  async detect(): Promise<DependencyStatus> {
    // Return cached result if available
    if (this.cachedResult) return this.cachedResult

    // Share pending detection promise for concurrent callers
    if (this.pendingDetection) return this.pendingDetection

    this.pendingDetection = this.runDetection()

    try {
      this.cachedResult = await this.pendingDetection
      return this.cachedResult
    } finally {
      this.pendingDetection = null
    }
  }

  /**
   * Run all dependency checks in parallel.
   */
  private async runDetection(): Promise<DependencyStatus> {
    const [libreOffice, imageMagick] = await Promise.all([
      this.detectLibreOffice(),
      this.detectImageMagick()
    ])

    return { libreOffice, imageMagick }
  }

  /**
   * Check if LibreOffice is available.
   *
   * Strategy:
   * 1. `soffice --version` on a trusted PATH hit
   * 2. On macOS, fall back to the known .app bundle path
   * 3. On Windows (#162), fall back to standard Program Files locations
   */
  private async detectLibreOffice(): Promise<boolean> {
    if (await this.tryOnPath('soffice')) {
      return true
    }

    // macOS fallback: check the standard .app bundle path.
    // `X_OK` is meaningful on POSIX — verifies the user has execute
    // permission on the binary. Combined with the system-protected
    // `/Applications/` location, this is sufficient (no liveness probe
    // needed; the Windows branch below adds liveness specifically because
    // `X_OK` is existence-only on Windows).
    if (process.platform === 'darwin') {
      try {
        await access(MACOS_LIBREOFFICE_PATH, constants.X_OK)
        return true
      } catch {
        return false
      }
    }

    // Windows fallback (#162): probe standard install locations.
    //
    // Each candidate must pass a `--version` liveness probe (binary actually
    // runs). This mirrors the git-resolver pattern at
    // `git-status.worker.ts:isExecutableGit`: a stub planted at the path that
    // does not behave like soffice is rejected.
    if (process.platform === 'win32') {
      for (const candidate of WIN32_LIBREOFFICE_PATHS) {
        if (await this.tryCommand(candidate, ['--version'])) {
          return true
        }
      }
      return false
    }

    return false
  }

  /**
   * Check if ImageMagick is available.
   *
   * Strategy:
   * 1. `magick --version` (v7+) on a trusted PATH hit
   * 2. `convert --version` (v6) – POSIX only: on Windows `convert` is the
   *    System32 FAT-to-NTFS converter, which must never be probed
   * 3. Fixed install folders (see {@link defaultImageMagickFallbacks})
   */
  private async detectImageMagick(): Promise<boolean> {
    if (await this.tryOnPath('magick')) {
      return true
    }
    if (process.platform !== 'win32' && (await this.tryOnPath('convert'))) {
      return true
    }
    for (const candidate of this.imageMagickFallbacks()) {
      if (!this.isTrusted({ path: candidate, fromRelativeEntry: false })) continue
      if (await this.tryCommand(candidate, ['--version'])) return true
    }
    return false
  }

  /**
   * Walk PATH for `name` and probe each trusted hit with `--version`; the
   * first that runs wins.
   */
  private async tryOnPath(name: string): Promise<boolean> {
    let hits: PathHit[]
    try {
      hits = this.findOnPath(name)
    } catch {
      return false
    }
    for (const hit of hits) {
      if (!this.isTrusted(hit)) continue
      if (await this.tryCommand(hit.path, ['--version'])) return true
    }
    return false
  }

  private isTrusted(hit: PathHit): boolean {
    return isTrustedHit(hit, untrustedFolders(this.untrustedRoots()), process.platform, this.realpath)
  }

  /**
   * Try running a command with timeout. Only ever called with an absolute
   * path. A `.bat` / `.cmd` fails safely: Node refuses to `execFile` a batch
   * file without a shell (EINVAL, CVE-2024-27980), which reads as "not found".
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
