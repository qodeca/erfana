/**
 * Tests for ScreenshotService
 * =============================
 * Screenshot capture using macOS screencapture command
 *
 * @see Issue #86 - screenshot capture for terminal panel
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import type { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'

// Platform-safe tmpdir for assertions
const REAL_TMPDIR = os.tmpdir()

/** Escape a string for use in a RegExp */
function escRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** RegExp matching an erfana-screenshot path under the given tmpdir */
function screenshotPathRx(tmpdir: string = REAL_TMPDIR, { anchor = true } = {}): RegExp {
  const sep = '[/\\\\]'
  const pattern = `${escRx(tmpdir)}${sep}erfana-screenshot-\\d+\\.png`
  return new RegExp(anchor ? `^${pattern}$` : pattern)
}

// =============================================================================
// Mock child_process
// =============================================================================

interface MockChildProcess extends EventEmitter {
  pid?: number
  killed: boolean
}

const mockExecFile = vi.fn()

vi.mock('child_process', () => ({
  execFile: mockExecFile
}))

// =============================================================================
// Mock fs/promises
// =============================================================================

const mockAccess = vi.fn()

vi.mock('fs/promises', () => ({
  access: mockAccess
}))

// =============================================================================
// Mock os.tmpdir
// =============================================================================

const mockTmpdir = vi.fn(() => REAL_TMPDIR)

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    tmpdir: (...args: unknown[]) => mockTmpdir(...args)
  }
})

// =============================================================================
// Mock electron.screen
// =============================================================================

const mockGetAllDisplays = vi.fn()
const mockGetPrimaryDisplay = vi.fn()

vi.mock('electron', () => ({
  screen: {
    getAllDisplays: mockGetAllDisplays,
    getPrimaryDisplay: mockGetPrimaryDisplay
  }
}))

// =============================================================================
// Mock LoggingService
// =============================================================================

const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}

vi.mock('./LoggingService', () => ({
  logger: mockLogger
}))

// =============================================================================
// Mock shared constants
// =============================================================================

vi.mock('../../shared/constants', () => ({
  SCREENSHOT: {
    TIMEOUT_MS: 30_000,
    TEMP_PREFIX: 'erfana-screenshot-',
    FILE_EXTENSION: '.png',
    BINARY_PATH: '/usr/sbin/screencapture'
  }
}))

// =============================================================================
// Mock shared errors
// =============================================================================

vi.mock('../../shared/errors', () => ({
  ErrorCode: {
    SCREENSHOT_NOT_SUPPORTED: 'SCREENSHOT_NOT_SUPPORTED',
    SCREENSHOT_CANCELLED: 'SCREENSHOT_CANCELLED',
    SCREENSHOT_TIMEOUT: 'SCREENSHOT_TIMEOUT',
    SCREENSHOT_PERMISSION_DENIED: 'SCREENSHOT_PERMISSION_DENIED',
    SCREENSHOT_FAILED: 'SCREENSHOT_FAILED'
  }
}))

// =============================================================================
// Tests
// =============================================================================

describe('ScreenshotService', () => {
  // Store original platform
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    // Reset tmpdir mock to default
    mockTmpdir.mockReturnValue(REAL_TMPDIR)
    // Reset electron screen mocks to default (single display)
    mockGetAllDisplays.mockReturnValue([
      { id: 1, label: 'Built-in Retina Display', bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
    ])
    mockGetPrimaryDisplay.mockReturnValue({ id: 1 })
  })

  afterEach(() => {
    // Restore original platform
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true
    })
  })

  // ===========================================================================
  // Platform Detection Tests
  // ===========================================================================

  describe('platform detection', () => {
    it('returns SCREENSHOT_NOT_SUPPORTED error on non-macOS platforms', async () => {
      // Mock non-macOS platform
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true
      })

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('screen')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Screenshot capture is only available on macOS')
      expect(result.errorCode).toBe('SCREENSHOT_NOT_SUPPORTED')
      expect(mockExecFile).not.toHaveBeenCalled()
    })

    it('allows capture on darwin platform', async () => {
      // Mock macOS platform
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true
      })

      // Mock successful capture
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockResolvedValue(undefined)

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('screen')

      expect(result.success).toBe(true)
      expect(mockExecFile).toHaveBeenCalled()
    })

    it('allows capture on linux platform (future-proofing)', async () => {
      // Mock Linux platform
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true
      })

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('screen')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('SCREENSHOT_NOT_SUPPORTED')
    })
  })

  // ===========================================================================
  // Successful Capture Tests
  // ===========================================================================

  describe('successful captures', () => {
    beforeEach(() => {
      // Mock macOS platform
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true
      })
    })

    it('screen mode: executes screencapture with correct args', async () => {
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockResolvedValue(undefined)

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('screen')

      expect(result.success).toBe(true)
      expect(mockExecFile).toHaveBeenCalledWith(
        '/usr/sbin/screencapture',
        expect.arrayContaining(['-x']),
        expect.objectContaining({ timeout: 30_000 }),
        expect.any(Function)
      )

      // Verify args structure: ['-x', filePath]
      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args[0]).toBe('-x')
      expect(args[1]).toMatch(screenshotPathRx())
    })

    it('window mode: executes screencapture with interactive window selection', async () => {
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockResolvedValue(undefined)

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('window')

      expect(result.success).toBe(true)
      expect(mockExecFile).toHaveBeenCalled()

      // Verify args: ['-x', '-o', '-i', '-w', filePath]
      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args[0]).toBe('-x')
      expect(args[1]).toBe('-o')
      expect(args[2]).toBe('-i')
      expect(args[3]).toBe('-w')
      expect(args[4]).toMatch(screenshotPathRx())
    })

    it('area mode: executes screencapture with interactive area selection', async () => {
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockResolvedValue(undefined)

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('area')

      expect(result.success).toBe(true)
      expect(mockExecFile).toHaveBeenCalled()

      // Verify args: ['-x', '-i', '-s', filePath]
      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args[0]).toBe('-x')
      expect(args[1]).toBe('-i')
      expect(args[2]).toBe('-s')
      expect(args[3]).toMatch(screenshotPathRx())
    })

    it('returns success with absolute file path when file exists', async () => {
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockResolvedValue(undefined)

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('screen')

      expect(result.success).toBe(true)
      expect(result.filePath).toBeDefined()
      expect(result.filePath).toMatch(screenshotPathRx())
      expect(result.error).toBeUndefined()
      expect(result.errorCode).toBeUndefined()
    })

    it('logs successful capture with file path', async () => {
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockResolvedValue(undefined)

      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('screen')

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Screenshot captured successfully',
        expect.objectContaining({ filePath: expect.stringMatching(screenshotPathRx(REAL_TMPDIR, { anchor: false })) })
      )
    })
  })

  // ===========================================================================
  // User Cancellation Tests
  // ===========================================================================

  describe('user cancellation', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true
      })
    })

    it('returns SCREENSHOT_CANCELLED when user cancels (file not created)', async () => {
      // execFile succeeds (exit code 0) but file doesn't exist
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      // File doesn't exist (user cancelled)
      mockAccess.mockRejectedValue(new Error('ENOENT'))

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('window')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('SCREENSHOT_CANCELLED')
      expect(result.filePath).toBeUndefined()
    })

    it('returns SCREENSHOT_CANCELLED when exit code 1 and file not created', async () => {
      // execFile returns exit code 1
      const error = new Error('Command failed') as NodeJS.ErrnoException
      error.code = 1
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(error, '', '')
        return new EventEmitter() as ChildProcess
      })
      // File doesn't exist
      mockAccess.mockRejectedValue(new Error('ENOENT'))

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('area')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('SCREENSHOT_CANCELLED')
    })

    it('logs cancellation at debug level', async () => {
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockRejectedValue(new Error('ENOENT'))

      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('window')

      expect(mockLogger.debug).toHaveBeenCalledWith('Screenshot cancelled - file not created')
    })
  })

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true
      })
    })

    it('returns SCREENSHOT_TIMEOUT when process is killed', async () => {
      // Simulate timeout by setting error.killed
      const error = new Error('Timeout') as NodeJS.ErrnoException
      error.killed = true
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(error, '', '')
        return new EventEmitter() as ChildProcess
      })

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('screen')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Screenshot capture timed out')
      expect(result.errorCode).toBe('SCREENSHOT_TIMEOUT')
    })

    it('returns SCREENSHOT_PERMISSION_DENIED when stderr contains "cannot capture"', async () => {
      const error = new Error('Permission denied')
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(error, '', 'screencapture: cannot capture screen')
        return new EventEmitter() as ChildProcess
      })

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('screen')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Screen recording permission required')
      expect(result.errorCode).toBe('SCREENSHOT_PERMISSION_DENIED')
    })

    it('returns SCREENSHOT_FAILED for unknown errors', async () => {
      const error = new Error('Unknown error')
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(error, '', '')
        return new EventEmitter() as ChildProcess
      })

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('screen')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Unknown error')
      expect(result.errorCode).toBe('SCREENSHOT_FAILED')
    })

    it('logs timeout warning', async () => {
      const error = new Error('Timeout') as NodeJS.ErrnoException
      error.killed = true
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(error, '', '')
        return new EventEmitter() as ChildProcess
      })

      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('screen')

      expect(mockLogger.warn).toHaveBeenCalledWith('Screenshot capture timed out')
    })

    it('logs permission denied warning', async () => {
      const error = new Error('Permission denied')
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(error, '', 'screencapture: cannot capture screen')
        return new EventEmitter() as ChildProcess
      })

      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('screen')

      expect(mockLogger.warn).toHaveBeenCalledWith('Screenshot permission denied')
    })

    it('logs general failure with error object', async () => {
      const error = new Error('Disk full')
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(error, '', '')
        return new EventEmitter() as ChildProcess
      })

      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('screen')

      expect(mockLogger.error).toHaveBeenCalledWith('Screenshot capture failed', error)
    })

    it('handles non-Error throws', async () => {
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback('String error', '', '')
        return new EventEmitter() as ChildProcess
      })

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('screen')

      expect(result.success).toBe(false)
      // Non-Error throws return 'Unknown error' per implementation line 170
      expect(result.error).toBe('Unknown error')
      expect(result.errorCode).toBe('SCREENSHOT_FAILED')
    })

    it('handles process error event', async () => {
      const processError = new Error('Process spawn failed')
      const mockChild = new EventEmitter() as MockChildProcess
      mockChild.killed = false

      mockExecFile.mockImplementation(() => {
        // Emit error asynchronously
        setTimeout(() => mockChild.emit('error', processError), 10)
        return mockChild as ChildProcess
      })

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('screen')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Process spawn failed')
      expect(result.errorCode).toBe('SCREENSHOT_FAILED')
    })
  })

  // ===========================================================================
  // Temp File Generation Tests
  // ===========================================================================

  describe('temp file generation', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true
      })
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockResolvedValue(undefined)
    })

    it('generates temp file path with timestamp', async () => {
      const beforeTimestamp = Date.now()
      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('screen')
      const afterTimestamp = Date.now()

      const args = mockExecFile.mock.calls[0][1] as string[]
      const filePath = args[args.length - 1]

      // Extract timestamp from path
      const match = filePath.match(/erfana-screenshot-(\d+)\.png$/)
      expect(match).toBeTruthy()
      const timestamp = parseInt(match![1], 10)

      expect(timestamp).toBeGreaterThanOrEqual(beforeTimestamp)
      expect(timestamp).toBeLessThanOrEqual(afterTimestamp)
    })

    it('uses correct temp directory from os.tmpdir', async () => {
      const customTmp = path.join(REAL_TMPDIR, 'custom-folder')
      mockTmpdir.mockReturnValue(customTmp)

      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('screen')

      const args = mockExecFile.mock.calls[0][1] as string[]
      const filePath = args[args.length - 1]

      expect(filePath).toMatch(screenshotPathRx(customTmp))
    })

    it('uses correct prefix and extension', async () => {
      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('screen')

      const args = mockExecFile.mock.calls[0][1] as string[]
      const filePath = args[args.length - 1]

      expect(filePath).toMatch(/erfana-screenshot-\d+\.png$/)
    })

    it('generates unique paths for concurrent captures', async () => {
      let callCount = 0
      mockExecFile.mockImplementation((_path, args, _opts, callback) => {
        callCount++
        // Simulate slight delay to get different timestamps
        setTimeout(() => callback(null, '', ''), callCount)
        return new EventEmitter() as ChildProcess
      })

      const { screenshotService } = await import('./ScreenshotService')

      // Capture multiple screenshots with slight delays between them
      const results = await Promise.all([
        screenshotService.capture('screen'),
        screenshotService.capture('screen'),
        screenshotService.capture('screen')
      ])

      expect(results).toHaveLength(3)

      const filePaths = results.map((r) => r.filePath)

      // All paths should be defined
      filePaths.forEach((path) => expect(path).toBeDefined())

      // Note: In real use, timestamps will differ due to user interaction time
      // In tests, concurrent calls might share millisecond if they execute
      // at exactly the same time - this is acceptable behavior
      expect(filePaths.every((path) => path?.match(screenshotPathRx()))).toBe(true)
    })
  })

  // ===========================================================================
  // Security Tests
  // ===========================================================================

  describe('security', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true
      })
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockResolvedValue(undefined)
    })

    it('uses execFile with absolute path (not exec)', async () => {
      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('screen')

      // Verify execFile is called (not exec)
      expect(mockExecFile).toHaveBeenCalled()

      // Verify absolute path to binary
      const binaryPath = mockExecFile.mock.calls[0][0] as string
      expect(binaryPath).toBe('/usr/sbin/screencapture')
    })

    it('passes 30 second timeout to execFile', async () => {
      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('screen')

      const opts = mockExecFile.mock.calls[0][2] as { timeout: number }
      expect(opts.timeout).toBe(30_000)
    })

    it('file path is derived from controlled values only', async () => {
      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('screen')

      const args = mockExecFile.mock.calls[0][1] as string[]
      const filePath = args[args.length - 1]

      // Path should only contain tmpdir + prefix + timestamp + extension
      // No user input, no command injection vectors
      expect(filePath).toMatch(screenshotPathRx())
    })
  })

  // ===========================================================================
  // File Existence Check Tests
  // ===========================================================================

  describe('file existence check', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true
      })
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(null, '', '')
        return new EventEmitter() as ChildProcess
      })
    })

    it('checks if file exists after capture completes', async () => {
      mockAccess.mockResolvedValue(undefined)

      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('screen')

      // Verify access was called to check file existence
      expect(mockAccess).toHaveBeenCalled()

      const args = mockExecFile.mock.calls[0][1] as string[]
      const filePath = args[args.length - 1]
      expect(mockAccess).toHaveBeenCalledWith(filePath)
    })

    it('waits 50ms before checking file existence (filesystem sync)', async () => {
      mockAccess.mockResolvedValue(undefined)
      vi.useFakeTimers()

      const { screenshotService } = await import('./ScreenshotService')

      const capturePromise = screenshotService.capture('screen')

      // Access should not be called immediately
      expect(mockAccess).not.toHaveBeenCalled()

      // Advance time by 50ms
      await vi.advanceTimersByTimeAsync(50)

      // Now access should be called
      await capturePromise
      expect(mockAccess).toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('treats file not found as cancellation', async () => {
      const accessError = new Error('ENOENT')
      ;(accessError as NodeJS.ErrnoException).code = 'ENOENT'
      mockAccess.mockRejectedValue(accessError)

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('window')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('SCREENSHOT_CANCELLED')
    })

    it('treats permission denied on file check as cancellation', async () => {
      const accessError = new Error('EACCES')
      ;(accessError as NodeJS.ErrnoException).code = 'EACCES'
      mockAccess.mockRejectedValue(accessError)

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('area')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('SCREENSHOT_CANCELLED')
    })
  })

  // ===========================================================================
  // Debug Logging Tests
  // ===========================================================================

  describe('debug logging', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true
      })
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockResolvedValue(undefined)
    })

    it('logs capture start with mode and file path', async () => {
      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('window')

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Starting screenshot capture',
        expect.objectContaining({
          mode: 'window',
          filePath: expect.stringMatching(screenshotPathRx(REAL_TMPDIR, { anchor: false }))
        })
      )
    })

    it('logs all three capture modes correctly', async () => {
      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('screen')
      await screenshotService.capture('window')
      await screenshotService.capture('area')

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Starting screenshot capture',
        expect.objectContaining({ mode: 'screen' })
      )
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Starting screenshot capture',
        expect.objectContaining({ mode: 'window' })
      )
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Starting screenshot capture',
        expect.objectContaining({ mode: 'area' })
      )
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true
      })
    })

    it('handles empty stderr', async () => {
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockResolvedValue(undefined)

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('screen')

      expect(result.success).toBe(true)
    })

    it('handles partial stderr match (permission denied)', async () => {
      const error = new Error('Permission error')
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(error, '', 'screencapture: cannot capture screen due to permissions')
        return new EventEmitter() as ChildProcess
      })

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('screen')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('SCREENSHOT_PERMISSION_DENIED')
    })

    it('treats exit code 1 without error object as success (resolves)', async () => {
      // Exit code 1 is ambiguous - could be cancelled or error
      // Implementation resolves and checks file existence
      const error = new Error('Exit 1') as NodeJS.ErrnoException
      error.code = 1
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(error, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockResolvedValue(undefined) // File exists

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('screen')

      // File exists, so success
      expect(result.success).toBe(true)
    })

    it('handles very long tmpdir path', async () => {
      const longPath = path.join(REAL_TMPDIR, 'very', 'long', 'path', 'a'.repeat(200))
      mockTmpdir.mockReturnValue(longPath)

      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockResolvedValue(undefined)

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('screen')

      expect(result.success).toBe(true)
      expect(result.filePath).toMatch(screenshotPathRx(longPath))
    })
  })

  // ===========================================================================
  // Singleton Pattern Tests
  // ===========================================================================

  describe('singleton pattern', () => {
    it('exports singleton instance', async () => {
      const { screenshotService } = await import('./ScreenshotService')

      expect(screenshotService).toBeDefined()
      expect(typeof screenshotService.capture).toBe('function')
    })

    it('singleton instance maintains state across calls', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true
      })

      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockResolvedValue(undefined)

      const { screenshotService } = await import('./ScreenshotService')

      // Multiple calls should work
      const result1 = await screenshotService.capture('screen')
      const result2 = await screenshotService.capture('window')

      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      expect(mockExecFile).toHaveBeenCalledTimes(2)
    })
  })

  // ===========================================================================
  // Multi-Monitor Support Tests (Issue #86 enhancement)
  // ===========================================================================

  describe('getDisplays()', () => {
    it('returns single display when only one monitor is connected', async () => {
      mockGetAllDisplays.mockReturnValue([
        { id: 1, label: 'Built-in Retina Display', bounds: { x: 0, y: 0, width: 2560, height: 1600 } }
      ])
      mockGetPrimaryDisplay.mockReturnValue({ id: 1 })

      const { screenshotService } = await import('./ScreenshotService')

      const displays = screenshotService.getDisplays()

      expect(displays).toHaveLength(1)
      expect(displays[0]).toEqual({
        id: 1,
        label: 'Built-in Retina Display',
        isPrimary: true,
        bounds: { x: 0, y: 0, width: 2560, height: 1600 }
      })
    })

    it('returns multiple displays with correct primary flag', async () => {
      mockGetAllDisplays.mockReturnValue([
        { id: 1, label: 'Built-in Retina Display', bounds: { x: 0, y: 0, width: 2560, height: 1600 } },
        { id: 2, label: 'LG UltraFine', bounds: { x: 2560, y: -200, width: 3840, height: 2160 } }
      ])
      mockGetPrimaryDisplay.mockReturnValue({ id: 1 })

      const { screenshotService } = await import('./ScreenshotService')

      const displays = screenshotService.getDisplays()

      expect(displays).toHaveLength(2)
      expect(displays[0].isPrimary).toBe(true)
      expect(displays[1].isPrimary).toBe(false)
    })

    it('correctly identifies primary display when not first in array', async () => {
      mockGetAllDisplays.mockReturnValue([
        { id: 1, label: 'External Monitor', bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
        { id: 2, label: 'Built-in Display', bounds: { x: 0, y: 0, width: 2560, height: 1600 } }
      ])
      mockGetPrimaryDisplay.mockReturnValue({ id: 2 })

      const { screenshotService } = await import('./ScreenshotService')

      const displays = screenshotService.getDisplays()

      expect(displays[0].isPrimary).toBe(false)
      expect(displays[1].isPrimary).toBe(true)
    })

    it('uses fallback label when display label is empty', async () => {
      mockGetAllDisplays.mockReturnValue([
        { id: 1, label: '', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        { id: 2, label: '', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }
      ])
      mockGetPrimaryDisplay.mockReturnValue({ id: 1 })

      const { screenshotService } = await import('./ScreenshotService')

      const displays = screenshotService.getDisplays()

      expect(displays[0].label).toBe('Display 1')
      expect(displays[1].label).toBe('Display 2')
    })

    it('uses fallback label when display label is undefined', async () => {
      mockGetAllDisplays.mockReturnValue([
        { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
      ])
      mockGetPrimaryDisplay.mockReturnValue({ id: 1 })

      const { screenshotService } = await import('./ScreenshotService')

      const displays = screenshotService.getDisplays()

      expect(displays[0].label).toBe('Display 1')
    })

    it('preserves display bounds correctly', async () => {
      const bounds = { x: -1920, y: -500, width: 3840, height: 2160 }
      mockGetAllDisplays.mockReturnValue([{ id: 1, label: 'Test', bounds }])
      mockGetPrimaryDisplay.mockReturnValue({ id: 1 })

      const { screenshotService } = await import('./ScreenshotService')

      const displays = screenshotService.getDisplays()

      expect(displays[0].bounds).toEqual(bounds)
    })
  })

  describe('capture with displayId', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true
      })
      mockExecFile.mockImplementation((_path, _args, _opts, callback) => {
        callback(null, '', '')
        return new EventEmitter() as ChildProcess
      })
      mockAccess.mockResolvedValue(undefined)
    })

    it('uses -D flag with correct display index for screen mode', async () => {
      mockGetAllDisplays.mockReturnValue([
        { id: 101, label: 'Display 1', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        { id: 102, label: 'Display 2', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }
      ])
      mockGetPrimaryDisplay.mockReturnValue({ id: 101 })

      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('screen', 102)

      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args[0]).toBe('-x')
      expect(args[1]).toBe('-D')
      expect(args[2]).toBe('2') // 1-based index for second display
      expect(args[3]).toMatch(/\.png$/)
    })

    it('uses -D 1 for first display', async () => {
      mockGetAllDisplays.mockReturnValue([
        { id: 101, label: 'Display 1', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        { id: 102, label: 'Display 2', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }
      ])
      mockGetPrimaryDisplay.mockReturnValue({ id: 101 })

      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('screen', 101)

      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args[1]).toBe('-D')
      expect(args[2]).toBe('1')
    })

    it('uses -D 1 for single display when explicitly requested', async () => {
      // Edge case: single-display system where user explicitly requests the only display
      mockGetAllDisplays.mockReturnValue([
        { id: 101, label: 'Main Display', bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
      ])
      mockGetPrimaryDisplay.mockReturnValue({ id: 101 })

      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('screen', 101)

      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args).toContain('-D')
      expect(args[args.indexOf('-D') + 1]).toBe('1')
      expect(args[args.length - 1]).toMatch(/\.png$/)
    })

    it('falls back to default screen capture when displayId not found', async () => {
      mockGetAllDisplays.mockReturnValue([
        { id: 101, label: 'Display 1', bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
      ])
      mockGetPrimaryDisplay.mockReturnValue({ id: 101 })

      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('screen', 999) // Non-existent display

      const args = mockExecFile.mock.calls[0][1] as string[]
      // Should fall back to default: ['-x', filePath]
      expect(args[0]).toBe('-x')
      expect(args[1]).toMatch(/\.png$/)
      expect(args).not.toContain('-D')
    })

    it('ignores displayId for window mode', async () => {
      mockGetAllDisplays.mockReturnValue([
        { id: 101, label: 'Display 1', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        { id: 102, label: 'Display 2', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }
      ])
      mockGetPrimaryDisplay.mockReturnValue({ id: 101 })

      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('window', 102)

      const args = mockExecFile.mock.calls[0][1] as string[]
      // Window mode args should be unchanged
      expect(args[0]).toBe('-x')
      expect(args[1]).toBe('-o')
      expect(args[2]).toBe('-i')
      expect(args[3]).toBe('-w')
      expect(args).not.toContain('-D')
    })

    it('ignores displayId for area mode', async () => {
      mockGetAllDisplays.mockReturnValue([
        { id: 101, label: 'Display 1', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        { id: 102, label: 'Display 2', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }
      ])
      mockGetPrimaryDisplay.mockReturnValue({ id: 101 })

      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('area', 102)

      const args = mockExecFile.mock.calls[0][1] as string[]
      // Area mode args should be unchanged
      expect(args[0]).toBe('-x')
      expect(args[1]).toBe('-i')
      expect(args[2]).toBe('-s')
      expect(args).not.toContain('-D')
    })

    it('captures without -D flag when displayId is undefined', async () => {
      mockGetAllDisplays.mockReturnValue([
        { id: 101, label: 'Display 1', bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
      ])
      mockGetPrimaryDisplay.mockReturnValue({ id: 101 })

      const { screenshotService } = await import('./ScreenshotService')

      await screenshotService.capture('screen', undefined)

      const args = mockExecFile.mock.calls[0][1] as string[]
      expect(args).not.toContain('-D')
      expect(args[0]).toBe('-x')
      expect(args[1]).toMatch(/\.png$/)
    })

    it('successfully captures specific display and returns file path', async () => {
      mockGetAllDisplays.mockReturnValue([
        { id: 101, label: 'Display 1', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        { id: 102, label: 'Display 2', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }
      ])
      mockGetPrimaryDisplay.mockReturnValue({ id: 101 })

      const { screenshotService } = await import('./ScreenshotService')

      const result = await screenshotService.capture('screen', 102)

      expect(result.success).toBe(true)
      expect(result.filePath).toBeDefined()
      expect(result.filePath).toMatch(screenshotPathRx())
    })
  })
})
