// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * DependencyDetector.test.ts
 *
 * Tests for the DependencyDetector service that checks for optional
 * system tools (LibreOffice, ImageMagick) required for document import.
 *
 * @see Issue #132 – LiteParse document import
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChildProcess } from 'child_process'

// Mock child_process before importing DependencyDetector
vi.mock('child_process', () => ({
  execFile: vi.fn()
}))

// Mock fs/promises before importing DependencyDetector
vi.mock('fs/promises', () => ({
  access: vi.fn(),
  constants: { X_OK: 1, F_OK: 0 }
}))

import { execFile } from 'child_process'
import { access } from 'fs/promises'
import { DependencyDetector } from './DependencyDetector'

const mockedExecFile = vi.mocked(execFile)
const mockedAccess = vi.mocked(access)

// Helper to set up execFile mock per command
function setupExecFileMock(config: Record<string, boolean>): void {
  mockedExecFile.mockImplementation(
    (command: string, _args: unknown, _options: unknown, callback: unknown) => {
      const cb = callback as (error: Error | null) => void
      const shouldSucceed = config[command] ?? false
      if (shouldSucceed) {
        cb(null)
      } else {
        const err = new Error('ENOENT')
        ;(err as NodeJS.ErrnoException).code = 'ENOENT'
        cb(err)
      }
      // Return a minimal fake ChildProcess
      return { on: vi.fn() } as unknown as ChildProcess
    }
  )
}

describe('DependencyDetector', () => {
  let detector: DependencyDetector
  let originalPlatform: PropertyDescriptor | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    detector = new DependencyDetector()
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  })

  afterEach(() => {
    // Restore platform after tests that override it
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  // --------------------------------------------------------------------------
  // Both found
  // --------------------------------------------------------------------------

  describe('both soffice and magick found', () => {
    it('should return { libreOffice: true, imageMagick: true } when both succeed', async () => {
      setupExecFileMock({ soffice: true, magick: true })

      const result = await detector.detect()

      expect(result).toEqual({ libreOffice: true, imageMagick: true })
    })
  })

  // --------------------------------------------------------------------------
  // Neither found
  // --------------------------------------------------------------------------

  describe('neither soffice nor magick found', () => {
    it('should return { libreOffice: false, imageMagick: false } when all commands fail', async () => {
      // Set platform to non-darwin to skip macOS fallback
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      })

      setupExecFileMock({})

      const result = await detector.detect()

      expect(result).toEqual({ libreOffice: false, imageMagick: false })
    })
  })

  // --------------------------------------------------------------------------
  // LibreOffice only
  // --------------------------------------------------------------------------

  describe('LibreOffice only', () => {
    it('should return { libreOffice: true, imageMagick: false } when only soffice succeeds', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      })

      setupExecFileMock({ soffice: true })

      const result = await detector.detect()

      expect(result).toEqual({ libreOffice: true, imageMagick: false })
    })
  })

  // --------------------------------------------------------------------------
  // ImageMagick v6 fallback (magick fails, convert succeeds)
  // --------------------------------------------------------------------------

  describe('ImageMagick v6 fallback', () => {
    it('should detect imageMagick via convert when magick fails but convert succeeds', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      })

      setupExecFileMock({ convert: true })

      const result = await detector.detect()

      expect(result.imageMagick).toBe(true)
    })

    it('should use v7 magick first and skip convert check when magick succeeds', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      })

      setupExecFileMock({ soffice: true, magick: true })
      mockedExecFile.mockImplementation(
        (command: string, _args: unknown, _options: unknown, callback: unknown) => {
          const cb = callback as (error: Error | null) => void
          if (command === 'magick') {
            cb(null)
          } else {
            const err = new Error('ENOENT')
            cb(err)
          }
          return { on: vi.fn() } as unknown as ChildProcess
        }
      )

      const result = await detector.detect()

      expect(result.imageMagick).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // Caching
  // --------------------------------------------------------------------------

  describe('caching', () => {
    it('should return the same result on second detect() call without re-running commands', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      })

      setupExecFileMock({ soffice: true, magick: true })

      const result1 = await detector.detect()
      const result2 = await detector.detect()

      expect(result1).toBe(result2) // Same object reference (cached)

      // execFile called for first detect only: soffice + magick = 2 calls
      const callCount = mockedExecFile.mock.calls.length
      expect(callCount).toBeLessThanOrEqual(3) // at most soffice + magick (+ possibly convert)
    })

    it('should not call execFile again after caching', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      })

      setupExecFileMock({ soffice: true, magick: true })

      await detector.detect()
      const callsAfterFirst = mockedExecFile.mock.calls.length

      await detector.detect()
      const callsAfterSecond = mockedExecFile.mock.calls.length

      expect(callsAfterSecond).toBe(callsAfterFirst) // No new calls
    })
  })

  // --------------------------------------------------------------------------
  // Concurrent calls
  // --------------------------------------------------------------------------

  describe('concurrent calls', () => {
    it('should share the same promise for concurrent detect() calls', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      })

      setupExecFileMock({ soffice: true, magick: true })

      const [result1, result2] = await Promise.all([detector.detect(), detector.detect()])

      expect(result1).toEqual(result2)
    })
  })

  // --------------------------------------------------------------------------
  // Command error (non-zero exit)
  // --------------------------------------------------------------------------

  describe('command error (non-zero exit)', () => {
    it('should return false for libreOffice when soffice exits with error', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      })

      mockedExecFile.mockImplementation(
        (command: string, _args: unknown, _options: unknown, callback: unknown) => {
          const cb = callback as (error: Error | null) => void
          if (command === 'soffice') {
            const err = new Error('Command failed with exit code 1')
            cb(err)
          } else {
            cb(null) // imageMagick succeeds
          }
          return { on: vi.fn() } as unknown as ChildProcess
        }
      )

      const result = await detector.detect()

      expect(result.libreOffice).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // clearCache()
  // --------------------------------------------------------------------------

  describe('clearCache()', () => {
    it('should re-run commands after cache is cleared', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      })

      setupExecFileMock({ soffice: true, magick: true })

      await detector.detect()
      const callsAfterFirst = mockedExecFile.mock.calls.length

      detector.clearCache()
      await detector.detect()
      const callsAfterSecond = mockedExecFile.mock.calls.length

      expect(callsAfterSecond).toBeGreaterThan(callsAfterFirst)
    })

    it('should allow detect() to produce a new result after clearCache()', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      })

      // First detect: both found
      setupExecFileMock({ soffice: true, magick: true })
      const result1 = await detector.detect()
      expect(result1).toEqual({ libreOffice: true, imageMagick: true })

      // Clear cache and change mock: nothing found
      detector.clearCache()
      setupExecFileMock({})
      const result2 = await detector.detect()
      expect(result2).toEqual({ libreOffice: false, imageMagick: false })
    })
  })

  // --------------------------------------------------------------------------
  // tryCommand edge cases
  // --------------------------------------------------------------------------

  describe('tryCommand edge cases', () => {
    it('should resolve to false when execFile throws synchronously', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      })

      // Make execFile throw instead of returning a child process
      mockedExecFile.mockImplementation(() => {
        throw new Error('spawn EACCES')
      })

      const detector = new DependencyDetector()
      const result = await detector.detect()

      expect(result).toEqual({ libreOffice: false, imageMagick: false })
    })

    it('should resolve to false when child process emits error event', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      })

      // execFile returns a child process that emits 'error' immediately
      // but never fires the callback
      mockedExecFile.mockImplementation((_cmd, _args, _opts, _callback) => {
        const handlers: Record<string, (...args: unknown[]) => void> = {}
        const fakeChild = {
          on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            handlers[event] = handler
            // Immediately fire the error event
            if (event === 'error') {
              handler(new Error('spawn ENOENT'))
            }
          })
        }
        return fakeChild as any
      })

      const detector = new DependencyDetector()
      const result = await detector.detect()

      expect(result).toEqual({ libreOffice: false, imageMagick: false })
    })
  })

  // --------------------------------------------------------------------------
  // ImageMagick only
  // --------------------------------------------------------------------------

  describe('ImageMagick only', () => {
    it('should detect ImageMagick only when soffice fails on non-darwin', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      })

      setupExecFileMock({
        magick: true
      })

      const detector = new DependencyDetector()
      const result = await detector.detect()

      expect(result).toEqual({ libreOffice: false, imageMagick: true })
    })
  })

  // --------------------------------------------------------------------------
  // macOS bundle path fallback
  // --------------------------------------------------------------------------

  describe('macOS bundle path fallback', () => {
    it('should detect libreOffice via bundle path on darwin when soffice command fails', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true
      })

      // soffice command fails, but bundle path is accessible
      setupExecFileMock({ magick: true })
      mockedAccess.mockResolvedValue(undefined)

      const result = await detector.detect()

      expect(result.libreOffice).toBe(true)
    })

    it('should return false for libreOffice on darwin when soffice fails and bundle path inaccessible', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true
      })

      setupExecFileMock({})
      mockedAccess.mockRejectedValue(new Error('ENOENT'))

      const result = await detector.detect()

      expect(result.libreOffice).toBe(false)
    })

    it('should not check bundle path on non-darwin platforms', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      })

      setupExecFileMock({})

      await detector.detect()

      // access() should not be called when platform is not darwin
      expect(mockedAccess).not.toHaveBeenCalled()
    })

    it('should prefer PATH-based soffice over macOS bundle path', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true
      })

      // soffice on PATH succeeds – no need for bundle path check
      setupExecFileMock({ soffice: true, magick: true })

      const result = await detector.detect()

      expect(result.libreOffice).toBe(true)
      // access() should not be called when PATH-based detection succeeds
      expect(mockedAccess).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Windows install-path fallback (#162)
  // --------------------------------------------------------------------------

  describe('Windows install-path fallback (#162) — F_OK + liveness probe (post security review)', () => {
    /**
     * Updated post-security-review: the Windows fallback now uses `tryCommand`
     * (execFile + `--version` liveness probe), not bare `fs.access(F_OK)`.
     * Mirrors the git-resolver pattern in `git-status.worker.ts`.
     */

    const PF_GIT = 'C:\\Program Files\\LibreOffice\\program\\soffice.exe'
    const PFx86_GIT = 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'

    it('detects libreOffice via Program Files path on win32 when soffice command fails (liveness succeeds)', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

      // soffice on PATH fails; Program Files candidate exists AND its
      // `--version` liveness probe succeeds.
      mockedExecFile.mockImplementation(
        (command: string, _args: unknown, _options: unknown, callback: unknown) => {
          const cb = callback as (error: Error | null) => void
          if (command === PF_GIT || command === 'magick') {
            cb(null)
          } else {
            const err = new Error('ENOENT')
            ;(err as NodeJS.ErrnoException).code = 'ENOENT'
            cb(err)
          }
          return { on: vi.fn() } as unknown as ChildProcess
        },
      )

      const result = await detector.detect()

      expect(result.libreOffice).toBe(true)
      expect(mockedExecFile).toHaveBeenCalledWith(
        PF_GIT,
        ['--version'],
        expect.any(Object),
        expect.any(Function),
      )
    })

    it('rejects a candidate that exists but FAILS the --version liveness probe (security)', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

      // PF candidate is "present" but its --version invocation fails
      // (simulates an attacker-planted stub that does not behave like soffice).
      mockedExecFile.mockImplementation(
        (command: string, _args: unknown, _options: unknown, callback: unknown) => {
          const cb = callback as (error: Error | null) => void
          if (command === 'magick') {
            cb(null)
          } else {
            // soffice on PATH and BOTH PF candidates fail liveness.
            const err = new Error('not a valid Win32 application')
            cb(err)
          }
          return { on: vi.fn() } as unknown as ChildProcess
        },
      )

      const result = await detector.detect()

      expect(result.libreOffice).toBe(false)
    })

    it('detects libreOffice via Program Files (x86) path when 64-bit path is missing', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

      mockedExecFile.mockImplementation(
        (command: string, _args: unknown, _options: unknown, callback: unknown) => {
          const cb = callback as (error: Error | null) => void
          if (command === PFx86_GIT || command === 'magick') {
            cb(null)
          } else {
            cb(new Error('ENOENT'))
          }
          return { on: vi.fn() } as unknown as ChildProcess
        },
      )

      const result = await detector.detect()

      expect(result.libreOffice).toBe(true)
    })

    it('returns false when both Program Files paths fail liveness and PATH probe fails', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

      setupExecFileMock({}) // every command fails

      const result = await detector.detect()

      expect(result.libreOffice).toBe(false)
    })

    it('does NOT probe Windows paths on linux (POSIX regression)', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

      setupExecFileMock({})

      await detector.detect()

      // No Windows .exe paths should appear in execFile calls.
      const calledCommands = mockedExecFile.mock.calls.map((c) => c[0] as string)
      expect(calledCommands.some((cmd) => cmd.startsWith('C:\\'))).toBe(false)
    })

    it('prefers PATH-based soffice over Windows install paths', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

      // soffice on PATH succeeds – no need for install-path probe
      setupExecFileMock({ soffice: true })

      const result = await detector.detect()

      expect(result.libreOffice).toBe(true)
      // execFile should have been called for `soffice` but not for any `C:\` path.
      const calledCommands = mockedExecFile.mock.calls.map((c) => c[0] as string)
      expect(calledCommands.some((cmd) => cmd.startsWith('C:\\'))).toBe(false)
    })
  })
})
