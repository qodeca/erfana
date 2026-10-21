// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { execFile } from 'child_process'
import { access, constants, realpath } from 'fs/promises'
import { tmpdir } from 'os'
import { posix, win32 } from 'path'
import { findOnPath } from '../../utils/hardenedGit'
import { isInsideRoot, normaliseResolved } from '../../utils/pathCompare'
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

/** Looks a bare command name up on PATH and returns the hits it printed. */
export type PathFinder = (name: string, timeout: number) => Promise<string[]>

/** Construction options – both exist so tests and callers can narrow the lookup. */
export interface DependencyDetectorOptions {
  /**
   * PATH lookup. Defaults to the absolute `which` / `where.exe` from
   * `hardenedGit`, run from a safe cwd, so a binary planted in the current
   * directory can never answer it.
   */
  findOnPath?: PathFinder
  /**
   * Folders whose binaries must never be run – the open project, which the
   * user (or a cloned repository) controls. Evaluated on every detection.
   */
  untrustedRoots?: () => ReadonlyArray<string | null | undefined>
}

/**
 * Dependency detector service
 *
 * Checks for optional system tools (LibreOffice, ImageMagick) required
 * for Office document and image OCR import. Results are cached for the
 * session lifetime – detection runs at most once.
 *
 * Design:
 * - Non-blocking: all checks are async, never blocks app startup
 * - Timeout: 5s per command to prevent hangs
 * - Caching: single detection per session, concurrent calls share one promise
 * - Graceful: missing tools or errors result in false, never thrown errors
 * - Safe lookup: a bare name is resolved to an ABSOLUTE path first, through the
 *   absolute `which` / `where.exe`; relative hits and hits inside an untrusted
 *   root (the open project) are dropped, and the probe runs from `os.tmpdir()`.
 *   Spawning a bare name would let Windows search the current directory first.
 *
 * @see Issue #132 – LiteParse document import
 */
export class DependencyDetector {
  private cachedResult: DependencyStatus | null = null
  private pendingDetection: Promise<DependencyStatus> | null = null
  private readonly findOnPath: PathFinder
  private readonly untrustedRoots: () => ReadonlyArray<string | null | undefined>

  constructor(options: DependencyDetectorOptions = {}) {
    this.findOnPath = options.findOnPath ?? findOnPath
    this.untrustedRoots = options.untrustedRoots ?? (() => [])
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
   * 1. Try `soffice --version` (works if soffice is on PATH)
   * 2. On macOS, fall back to the known .app bundle path
   * 3. On Windows (#162), fall back to standard Program Files locations
   */
  private async detectLibreOffice(): Promise<boolean> {
    // Try PATH-based detection first
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
    // Each candidate must pass BOTH `F_OK` (file exists) AND a `--version`
    // liveness probe (binary actually runs and produces output). This
    // mirrors the git-resolver pattern at `git-status.worker.ts:isExecutableGit`.
    //
    // Why not F_OK only (security review HIGH): an attacker with write
    // access to `C:\Program Files\LibreOffice\program\soffice.exe` (e.g. a
    // malicious installer that drops a stub) could otherwise plant a path
    // that satisfies detection. By the time we try to `execFile(soffice,
    // [user-supplied args])` it would be too late — attacker code would
    // have already run. The liveness probe forces the candidate to behave
    // like a real LibreOffice binary first.
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
   * 1. Try `magick --version` (ImageMagick v7+)
   * 2. Fall back to `convert --version` (ImageMagick v6)
   */
  private async detectImageMagick(): Promise<boolean> {
    // ImageMagick v7+
    if (await this.tryOnPath('magick')) {
      return true
    }

    // ImageMagick v6 fallback
    return this.tryOnPath('convert')
  }

  /**
   * Resolve `name` on PATH to an absolute, trusted path and probe it with
   * `--version`. Each hit is tried in order; the first that runs wins.
   */
  private async tryOnPath(name: string): Promise<boolean> {
    let hits: string[]
    try {
      hits = await this.findOnPath(name, DETECTION_TIMEOUT_MS)
    } catch {
      return false
    }
    for (const hit of hits) {
      if (!(await this.isTrustedCandidate(hit))) continue
      if (await this.tryCommand(hit, ['--version'])) return true
    }
    return false
  }

  /**
   * A candidate is trusted when it is absolute and neither it nor its real
   * path (a PATH symlink may point anywhere) lies inside an untrusted root.
   * Case-insensitive on Windows and macOS, whose default file systems are.
   */
  private async isTrustedCandidate(candidate: string): Promise<boolean> {
    const flavour = { path: process.platform === 'win32' ? win32 : posix, platform: process.platform }
    if (!flavour.path.isAbsolute(candidate)) return false
    const roots = this.untrustedRoots().filter((root): root is string => !!root)
    if (roots.length === 0) return true

    const caseSensitive = process.platform === 'linux'
    const forms = [normaliseResolved(flavour.path.resolve(candidate), flavour)]
    try {
      forms.push(normaliseResolved(await realpath(candidate), flavour))
    } catch {
      // Unresolvable: the probe below fails on its own; the raw form is still checked.
    }
    return !roots.some((root) => {
      const rootForm = normaliseResolved(flavour.path.resolve(root), flavour)
      return forms.some((form) => isInsideRoot(form, rootForm, caseSensitive, flavour))
    })
  }

  /**
   * Try running a command with timeout.
   *
   * @returns true if the command exits with code 0
   */
  private tryCommand(command: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const child = execFile(
          command,
          args,
          // cwd outside any project: a tool's own lookups never start in it
          { timeout: DETECTION_TIMEOUT_MS, cwd: tmpdir(), windowsHide: true },
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
