// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for CameraService
 *
 * Tests camera photo save functionality including file writing,
 * filename generation, validation, and error handling.
 *
 * @see Spec #014 - Camera photo capture specification
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import os from 'os'

// =============================================================================
// Test constants – platform-safe tmpdir for assertions
// =============================================================================

const REAL_TMPDIR = os.tmpdir()

// =============================================================================
// Mock fs/promises
// =============================================================================

const mockWriteFile = vi.fn()

vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile
}))

// =============================================================================
// Mock os.tmpdir
// =============================================================================

const mockTmpdir = vi.fn()

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    tmpdir: (...args: unknown[]) => mockTmpdir(...args)
  }
})

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
  CAMERA: {
    TEMP_PREFIX: 'erfana-camera-',
    FILE_EXTENSION: '.jpg'
  }
}))

// =============================================================================
// Mock shared errors
// =============================================================================

vi.mock('../../shared/errors', () => ({
  ErrorCode: {
    CAMERA_INVALID_DATA: 'CAMERA_INVALID_DATA',
    CAMERA_SAVE_FAILED: 'CAMERA_SAVE_FAILED'
  }
}))

// =============================================================================
// Tests
// =============================================================================

describe('CameraService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTmpdir.mockReturnValue(REAL_TMPDIR)
    mockWriteFile.mockResolvedValue(undefined)
  })

  // ===========================================================================
  // Valid Save Tests
  // ===========================================================================

  describe('valid save', () => {
    it('should write JPEG to tmpdir with correct filename', async () => {
      const { cameraService } = await import('./CameraService')

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      const timestamp = 1640000000000 // 2021-12-20 11:33:20 UTC

      const result = await cameraService.save(dataUrl, timestamp)

      expect(result.filePath).toBeDefined()
      expect(result.filePath).toMatch(new RegExp(`^${REAL_TMPDIR.replace(/[\\/]/g, '[/\\\\]')}[/\\\\]erfana-camera-\\d{4}-\\d{2}-\\d{2}-\\d{6}\\.jpg$`))
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^${REAL_TMPDIR.replace(/[\\/]/g, '[/\\\\]')}[/\\\\]erfana-camera-\\d{4}-\\d{2}-\\d{2}-\\d{6}\\.jpg$`)),
        expect.any(Buffer)
      )
    })

    it('should return success with filePath', async () => {
      const { cameraService } = await import('./CameraService')

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

      const result = await cameraService.save(dataUrl)

      expect(result.filePath).toBeDefined()
      expect(result.error).toBeUndefined()
      expect(result.errorCode).toBeUndefined()
    })

    it('should decode base64 data correctly', async () => {
      const { cameraService } = await import('./CameraService')

      const base64Data = '/9j/4AAQSkZJRg=='
      const dataUrl = `data:image/jpeg;base64,${base64Data}`

      await cameraService.save(dataUrl)

      expect(mockWriteFile).toHaveBeenCalled()
      const buffer = mockWriteFile.mock.calls[0][1] as Buffer
      expect(buffer).toBeInstanceOf(Buffer)
      expect(buffer.toString('base64')).toBe(base64Data)
    })
  })

  // ===========================================================================
  // Filename Format Tests
  // ===========================================================================

  describe('filename format', () => {
    it('should use camera-YYYY-MM-DD-HHMMSS.jpg pattern', async () => {
      const { cameraService } = await import('./CameraService')

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      // 2023-06-15 14:30:45 UTC
      const timestamp = new Date('2023-06-15T14:30:45Z').getTime()

      const result = await cameraService.save(dataUrl, timestamp)

      // Note: Filename uses local time, not UTC, so we check pattern not exact value
      expect(result.filePath).toMatch(/erfana-camera-2023-06-15-\d{6}\.jpg$/)
    })

    it('should pad single-digit months and days with zeros', async () => {
      const { cameraService } = await import('./CameraService')

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      // 2023-01-05 09:05:03 UTC
      const timestamp = new Date('2023-01-05T09:05:03Z').getTime()

      const result = await cameraService.save(dataUrl, timestamp)

      expect(result.filePath).toMatch(/erfana-camera-2023-01-05-\d{6}\.jpg$/)
    })

    it('should use current timestamp when not provided', async () => {
      const { cameraService } = await import('./CameraService')

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      const beforeTimestamp = Date.now()

      const result = await cameraService.save(dataUrl)

      // Extract timestamp from filename
      const match = result.filePath?.match(/erfana-camera-(\d{4})-(\d{2})-(\d{2})-(\d{6})\.jpg$/)
      expect(match).toBeTruthy()

      // Verify timestamp is within reasonable range
      const year = parseInt(match![1], 10)
      const beforeYear = new Date(beforeTimestamp).getFullYear()
      expect(year).toBe(beforeYear)
    })
  })

  // ===========================================================================
  // Custom Timestamp Tests
  // ===========================================================================

  describe('custom timestamp', () => {
    it('should use provided timestamp in filename', async () => {
      const { cameraService } = await import('./CameraService')

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      const timestamp = new Date('2024-12-25T10:30:00Z').getTime()

      const result = await cameraService.save(dataUrl, timestamp)

      expect(result.filePath).toMatch(/erfana-camera-2024-12-25-\d{6}\.jpg$/)
    })
  })

  // ===========================================================================
  // Invalid Data URL Tests
  // ===========================================================================

  describe('invalid data URL prefix', () => {
    it('should return CAMERA_INVALID_DATA error for wrong prefix', async () => {
      const { cameraService } = await import('./CameraService')

      const dataUrl = 'data:image/png;base64,iVBORw0KGgo='

      const result = await cameraService.save(dataUrl)

      expect(result.error).toBe('Invalid photo data format')
      expect(result.errorCode).toBe('CAMERA_INVALID_DATA')
      expect(result.filePath).toBeUndefined()
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('should return CAMERA_INVALID_DATA error for missing prefix', async () => {
      const { cameraService } = await import('./CameraService')

      const dataUrl = '/9j/4AAQSkZJRg=='

      const result = await cameraService.save(dataUrl)

      expect(result.error).toBe('Invalid photo data format')
      expect(result.errorCode).toBe('CAMERA_INVALID_DATA')
      expect(result.filePath).toBeUndefined()
    })

    it('should return CAMERA_INVALID_DATA error for empty string', async () => {
      const { cameraService } = await import('./CameraService')

      const result = await cameraService.save('')

      expect(result.error).toBe('Invalid photo data format')
      expect(result.errorCode).toBe('CAMERA_INVALID_DATA')
    })

    it('should return CAMERA_INVALID_DATA error for data URL exceeding size limit', async () => {
      const { cameraService } = await import('./CameraService')

      // Create a data URL that exceeds 20MB
      const largeBase64 = 'A'.repeat(21 * 1024 * 1024) // 21MB of 'A's
      const dataUrl = `data:image/jpeg;base64,${largeBase64}`

      const result = await cameraService.save(dataUrl)

      expect(result.error).toBe('Photo data too large')
      expect(result.errorCode).toBe('CAMERA_INVALID_DATA')
      expect(result.filePath).toBeUndefined()
      expect(mockWriteFile).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Invalid Base64 Tests
  // ===========================================================================

  describe('invalid base64', () => {
    it('should return CAMERA_SAVE_FAILED error for invalid base64', async () => {
      const { cameraService } = await import('./CameraService')

      // Buffer.from will accept invalid base64 but might produce unexpected results
      // More likely to fail during writeFile
      mockWriteFile.mockRejectedValue(new Error('Invalid data'))

      const dataUrl = 'data:image/jpeg;base64,!!!invalid!!!'

      const result = await cameraService.save(dataUrl)

      expect(result.error).toBe('Invalid data')
      expect(result.errorCode).toBe('CAMERA_SAVE_FAILED')
      expect(result.filePath).toBeUndefined()
    })
  })

  // ===========================================================================
  // File Write Error Tests
  // ===========================================================================

  describe('file write error', () => {
    it('should return CAMERA_SAVE_FAILED error when writeFile fails', async () => {
      const { cameraService } = await import('./CameraService')

      mockWriteFile.mockRejectedValue(new Error('Disk full'))

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

      const result = await cameraService.save(dataUrl)

      expect(result.error).toBe('Disk full')
      expect(result.errorCode).toBe('CAMERA_SAVE_FAILED')
      expect(result.filePath).toBeUndefined()
    })

    it('should return CAMERA_SAVE_FAILED error for permission denied', async () => {
      const { cameraService } = await import('./CameraService')

      const error = new Error('EACCES: permission denied')
      ;(error as NodeJS.ErrnoException).code = 'EACCES'
      mockWriteFile.mockRejectedValue(error)

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

      const result = await cameraService.save(dataUrl)

      expect(result.error).toBe('EACCES: permission denied')
      expect(result.errorCode).toBe('CAMERA_SAVE_FAILED')
    })

    it('should handle non-Error throws', async () => {
      const { cameraService } = await import('./CameraService')

      mockWriteFile.mockRejectedValue('String error')

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

      const result = await cameraService.save(dataUrl)

      expect(result.error).toBe('Unknown error')
      expect(result.errorCode).toBe('CAMERA_SAVE_FAILED')
    })
  })

  // ===========================================================================
  // Successful Response Tests
  // ===========================================================================

  describe('successful response', () => {
    it('should return success=true implicitly when filePath exists', async () => {
      const { cameraService } = await import('./CameraService')

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

      const result = await cameraService.save(dataUrl)

      expect(result.filePath).toBeDefined()
      expect(result.error).toBeUndefined()
      expect(result.errorCode).toBeUndefined()
    })

    it('should return absolute file path', async () => {
      const { cameraService } = await import('./CameraService')

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

      const result = await cameraService.save(dataUrl)

      expect(result.filePath).toMatch(new RegExp(`^${REAL_TMPDIR.replace(/[\\/]/g, '[/\\\\]')}[/\\\\]erfana-camera-\\d{4}-\\d{2}-\\d{2}-\\d{6}\\.jpg$`))
    })
  })

  // ===========================================================================
  // Temp Directory Tests
  // ===========================================================================

  describe('temp directory', () => {
    it('should use system temp directory from os.tmpdir', async () => {
      const customTmp = path.join(REAL_TMPDIR, 'custom-folder')
      mockTmpdir.mockReturnValue(customTmp)

      const { cameraService } = await import('./CameraService')

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

      const result = await cameraService.save(dataUrl)

      expect(result.filePath).toMatch(new RegExp(`^${customTmp.replace(/[\\/]/g, '[/\\\\]')}[/\\\\]erfana-camera-`))
    })
  })

  // ===========================================================================
  // Logging Tests
  // ===========================================================================

  describe('logging', () => {
    it('should log debug message before writing', async () => {
      const { cameraService } = await import('./CameraService')

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

      await cameraService.save(dataUrl)

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Camera save: writing photo',
        expect.objectContaining({
          filePath: expect.stringContaining('erfana-camera-'),
          size: expect.any(Number)
        })
      )
    })

    it('should log info message on success', async () => {
      const { cameraService } = await import('./CameraService')

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

      await cameraService.save(dataUrl)

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Camera photo saved successfully',
        expect.objectContaining({
          filePath: expect.stringContaining('erfana-camera-')
        })
      )
    })

    it('should log warning on invalid data URL', async () => {
      const { cameraService } = await import('./CameraService')

      const dataUrl = 'data:image/png;base64,iVBORw0KGgo='

      await cameraService.save(dataUrl)

      expect(mockLogger.warn).toHaveBeenCalledWith('Camera save: invalid data URL format')
    })

    it('should log error on save failure', async () => {
      const { cameraService } = await import('./CameraService')

      const error = new Error('Write failed')
      mockWriteFile.mockRejectedValue(error)

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

      await cameraService.save(dataUrl)

      expect(mockLogger.error).toHaveBeenCalledWith('Camera save failed', error)
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle very large base64 data', async () => {
      const { cameraService } = await import('./CameraService')

      // Create a large base64 string (1MB of base64 text, which encodes to ~768KB binary)
      const largeData = 'A'.repeat(1024 * 1024)
      const dataUrl = `data:image/jpeg;base64,${largeData}`

      const result = await cameraService.save(dataUrl)

      expect(result.filePath).toBeDefined()
      expect(mockWriteFile).toHaveBeenCalled()

      const buffer = mockWriteFile.mock.calls[0][1] as Buffer
      // Base64 encoding means output is 3/4 size of input
      expect(buffer.length).toBeGreaterThan(700 * 1024) // ~768KB
    })

    it('should handle midnight timestamp correctly', async () => {
      const { cameraService } = await import('./CameraService')

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      // Midnight UTC
      const timestamp = new Date('2023-01-01T00:00:00Z').getTime()

      const result = await cameraService.save(dataUrl, timestamp)

      expect(result.filePath).toMatch(/erfana-camera-\d{4}-\d{2}-\d{2}-\d{6}\.jpg$/)
    })

    it('should handle timestamp at end of year', async () => {
      const { cameraService } = await import('./CameraService')

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      // Last second of year in local time (not UTC to avoid timezone conversion issues)
      const timestamp = new Date(2023, 11, 31, 23, 59, 59).getTime()

      const result = await cameraService.save(dataUrl, timestamp)

      // Check it's a valid filename - might be 2023-12-31 or 2024-01-01 depending on timezone
      expect(result.filePath).toMatch(/erfana-camera-\d{4}-\d{2}-\d{2}-\d{6}\.jpg$/)
    })
  })

  // ===========================================================================
  // Singleton Pattern Tests
  // ===========================================================================

  describe('singleton pattern', () => {
    it('should export singleton instance', async () => {
      const { cameraService } = await import('./CameraService')

      expect(cameraService).toBeDefined()
      expect(typeof cameraService.save).toBe('function')
    })

    it('should maintain state across calls', async () => {
      const { cameraService } = await import('./CameraService')

      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

      const result1 = await cameraService.save(dataUrl)
      const result2 = await cameraService.save(dataUrl)

      expect(result1.filePath).toBeDefined()
      expect(result2.filePath).toBeDefined()
      expect(mockWriteFile).toHaveBeenCalledTimes(2)
    })
  })
})
