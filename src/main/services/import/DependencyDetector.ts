// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { execFile } from 'child_process'
import { access, constants } from 'fs/promises'
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
 *
 * @see Issue #132 – LiteParse document import
 */
export class DependencyDetector {
  private cachedResult: DependencyStatus | null = null
  private pendingDetection: Promise<DependencyStatus> | null = null

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
    if (await this.tryCommand('soffice', ['--version'])) {
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
    if (await this.tryCommand('magick', ['--version'])) {
      return true
    }

    // ImageMagick v6 fallback
    return this.tryCommand('convert', ['--version'])
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
          { timeout: DETECTION_TIMEOUT_MS },
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
   * Clear cached detection result.
   * Primarily used for testing.
   */
  clearCache(): void {
    this.cachedResult = null
    this.pendingDetection = null
  }
}
