// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Camera IPC Handlers
 *
 * Tests the IPC handler registration and request/response handling
 * for camera photo save operations.
 *
 * @see Spec #014 - Camera photo capture specification
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

// =============================================================================
// Mock electron
// =============================================================================

const mockIpcMainHandle = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcMainHandle
  }
}))

// =============================================================================
// Mock CameraService
// =============================================================================

const mockCameraServiceSave = vi.fn()

vi.mock('../services/CameraService', () => ({
  cameraService: {
    save: mockCameraServiceSave
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

vi.mock('../services/LoggingService', () => ({
  logger: mockLogger
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

describe('camera-handlers', () => {
  // Mock IPC event
  const mockEvent = {} as IpcMainInvokeEvent

  beforeEach(async () => {
    vi.clearAllMocks()
    mockCameraServiceSave.mockResolvedValue({ filePath: '/tmp/camera-photo.jpg' })
  })

  // ===========================================================================
  // Handler Registration Tests
  // ===========================================================================

  describe('handler registration', () => {
    it('should register camera:save handler', async () => {
      const { registerCameraHandlers } = await import('./camera-handlers')

      registerCameraHandlers()

      expect(mockIpcMainHandle).toHaveBeenCalledWith('camera:save', expect.any(Function))
    })
  })

  // ===========================================================================
  // Valid Request Tests
  // ===========================================================================

  describe('valid request', () => {
    it('should call cameraService.save and return result', async () => {
      const { registerCameraHandlers } = await import('./camera-handlers')

      registerCameraHandlers()

      // Get the handler function
      const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === 'camera:save')?.[1]
      expect(handler).toBeDefined()

      const request = {
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
        timestamp: 1640000000000
      }

      const result = await handler(mockEvent, request)

      expect(mockCameraServiceSave).toHaveBeenCalledWith(
        'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
        1640000000000
      )
      expect(result).toEqual({
        success: true,
        filePath: '/tmp/camera-photo.jpg'
      })
    })

    it('should handle request without timestamp', async () => {
      const { registerCameraHandlers } = await import('./camera-handlers')

      registerCameraHandlers()

      const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === 'camera:save')?.[1]

      const request = {
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      }

      const result = await handler(mockEvent, request)

      expect(mockCameraServiceSave).toHaveBeenCalledWith(
        'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
        undefined
      )
      expect(result.success).toBe(true)
    })
  })

  // ===========================================================================
  // Invalid Request Tests
  // ===========================================================================

  describe('invalid request', () => {
    it('should return validation error when dataUrl is missing', async () => {
      const { registerCameraHandlers } = await import('./camera-handlers')

      registerCameraHandlers()

      const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === 'camera:save')?.[1]

      const request = {
        timestamp: 1640000000000
      }

      const result = await handler(mockEvent, request)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid request')
      expect(result.errorCode).toBe('CAMERA_INVALID_DATA')
      expect(mockCameraServiceSave).not.toHaveBeenCalled()
    })

    it('should return validation error when dataUrl has wrong format', async () => {
      const { registerCameraHandlers } = await import('./camera-handlers')

      registerCameraHandlers()

      const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === 'camera:save')?.[1]

      const request = {
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=' // Wrong format (PNG not JPEG)
      }

      const result = await handler(mockEvent, request)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid request')
      expect(result.errorCode).toBe('CAMERA_INVALID_DATA')
      expect(mockCameraServiceSave).not.toHaveBeenCalled()
    })

    it('should return validation error when dataUrl is not a string', async () => {
      const { registerCameraHandlers } = await import('./camera-handlers')

      registerCameraHandlers()

      const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === 'camera:save')?.[1]

      const request = {
        dataUrl: 12345 // Wrong type
      }

      const result = await handler(mockEvent, request)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid request')
      expect(result.errorCode).toBe('CAMERA_INVALID_DATA')
    })

    it('should return validation error when timestamp is not a number', async () => {
      const { registerCameraHandlers } = await import('./camera-handlers')

      registerCameraHandlers()

      const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === 'camera:save')?.[1]

      const request = {
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
        timestamp: 'not a number'
      }

      const result = await handler(mockEvent, request)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid request')
      expect(result.errorCode).toBe('CAMERA_INVALID_DATA')
    })

    it('should return validation error for completely invalid request', async () => {
      const { registerCameraHandlers } = await import('./camera-handlers')

      registerCameraHandlers()

      const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === 'camera:save')?.[1]

      const result = await handler(mockEvent, null)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid request')
      expect(result.errorCode).toBe('CAMERA_INVALID_DATA')
    })
  })

  // ===========================================================================
  // Service Error Tests
  // ===========================================================================

  describe('service error', () => {
    it('should propagate error from service', async () => {
      mockCameraServiceSave.mockResolvedValue({
        error: 'Disk full',
        errorCode: 'CAMERA_SAVE_FAILED'
      })

      const { registerCameraHandlers } = await import('./camera-handlers')

      registerCameraHandlers()

      const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === 'camera:save')?.[1]

      const request = {
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      }

      const result = await handler(mockEvent, request)

      expect(result).toEqual({
        success: false,
        error: 'Disk full',
        errorCode: 'CAMERA_SAVE_FAILED'
      })
    })

    it('should handle service exceptions', async () => {
      mockCameraServiceSave.mockRejectedValue(new Error('Unexpected error'))

      const { registerCameraHandlers } = await import('./camera-handlers')

      registerCameraHandlers()

      const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === 'camera:save')?.[1]

      const request = {
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      }

      const result = await handler(mockEvent, request)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Unexpected error')
      expect(result.errorCode).toBe('CAMERA_SAVE_FAILED')
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('should handle non-Error service exceptions', async () => {
      mockCameraServiceSave.mockRejectedValue('String error')

      const { registerCameraHandlers } = await import('./camera-handlers')

      registerCameraHandlers()

      const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === 'camera:save')?.[1]

      const request = {
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      }

      const result = await handler(mockEvent, request)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Unknown error')
      expect(result.errorCode).toBe('CAMERA_SAVE_FAILED')
    })
  })

  // ===========================================================================
  // Logging Tests
  // ===========================================================================

  describe('logging', () => {
    it('should log validation errors', async () => {
      const { registerCameraHandlers } = await import('./camera-handlers')

      registerCameraHandlers()

      const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === 'camera:save')?.[1]

      const request = {
        dataUrl: 'invalid'
      }

      await handler(mockEvent, request)

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Camera save validation error',
        expect.anything()
      )
    })

    it('should log handler errors', async () => {
      mockCameraServiceSave.mockRejectedValue(new Error('Service error'))

      const { registerCameraHandlers } = await import('./camera-handlers')

      registerCameraHandlers()

      const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === 'camera:save')?.[1]

      const request = {
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      }

      await handler(mockEvent, request)

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Camera save handler error',
        expect.any(Error)
      )
    })
  })

  // ===========================================================================
  // Success Response Tests
  // ===========================================================================

  describe('success response', () => {
    it('should return success response with filePath', async () => {
      mockCameraServiceSave.mockResolvedValue({
        filePath: '/tmp/camera-2023-06-15-143045.jpg'
      })

      const { registerCameraHandlers } = await import('./camera-handlers')

      registerCameraHandlers()

      const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === 'camera:save')?.[1]

      const request = {
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      }

      const result = await handler(mockEvent, request)

      expect(result).toEqual({
        success: true,
        filePath: '/tmp/camera-2023-06-15-143045.jpg'
      })
    })

    it('should set success to true when service returns filePath', async () => {
      mockCameraServiceSave.mockResolvedValue({
        filePath: '/tmp/photo.jpg'
      })

      const { registerCameraHandlers } = await import('./camera-handlers')

      registerCameraHandlers()

      const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === 'camera:save')?.[1]

      const request = {
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      }

      const result = await handler(mockEvent, request)

      expect(result.success).toBe(true)
      expect(result.filePath).toBe('/tmp/photo.jpg')
      expect(result.error).toBeUndefined()
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle empty object request', async () => {
      const { registerCameraHandlers } = await import('./camera-handlers')

      registerCameraHandlers()

      const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === 'camera:save')?.[1]

      const result = await handler(mockEvent, {})

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('CAMERA_INVALID_DATA')
    })

    it('should handle very long dataUrl', async () => {
      const { registerCameraHandlers } = await import('./camera-handlers')

      registerCameraHandlers()

      const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === 'camera:save')?.[1]

      // Create very long base64 string
      const longBase64 = 'A'.repeat(10000)
      const request = {
        dataUrl: `data:image/jpeg;base64,${longBase64}`
      }

      await handler(mockEvent, request)

      expect(mockCameraServiceSave).toHaveBeenCalledWith(
        expect.stringContaining('data:image/jpeg;base64,'),
        undefined
      )
    })

    it('should handle timestamp of 0', async () => {
      const { registerCameraHandlers } = await import('./camera-handlers')

      registerCameraHandlers()

      const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === 'camera:save')?.[1]

      const request = {
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
        timestamp: 0
      }

      const result = await handler(mockEvent, request)

      expect(mockCameraServiceSave).toHaveBeenCalledWith(expect.any(String), 0)
      expect(result.success).toBe(true)
    })
  })
})
