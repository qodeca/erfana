// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * project-lock-handlers.test.ts
 *
 * Tests for project lock IPC handlers
 *
 * Coverage:
 * - registerProjectLockHandlers registers all handlers
 * - acquire handler validates payload with Zod
 * - acquire handler rejects invalid paths
 * - release handler calls service
 * - check handler returns status
 * - cleanup handler returns removed count
 * - requestFocus handler calls service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { registerProjectLockHandlers } from './project-lock-handlers'

// Mock electron ipcMain
const mockHandlers = new Map<string, (event: any, payload: unknown) => Promise<any>>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: any, payload: unknown) => Promise<any>) => {
      mockHandlers.set(channel, handler)
    })
  }
}))

// Mock ProjectLockService
vi.mock('../services/ProjectLockService', () => ({
  projectLockService: {
    acquireLock: vi.fn(),
    releaseLock: vi.fn(),
    checkLock: vi.fn(),
    requestFocus: vi.fn(),
    cleanupStaleLocks: vi.fn()
  }
}))

// Mock path security
vi.mock('../utils/pathSecurity', () => ({
  validatePath: vi.fn()
}))

// Mock error utilities
vi.mock('../../shared/errors', () => ({
  getUserFriendlyMessage: vi.fn((error) => {
    if (error instanceof Error) return error.message
    return String(error)
  })
}))

// Mock logger
vi.mock('../services/LoggingService', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

// Import after mocking
import { ipcMain } from 'electron'
import { projectLockService } from '../services/ProjectLockService'
import { validatePath } from '../utils/pathSecurity'
// getUserFriendlyMessage is mocked via vi.mock

const mockedAcquireLock = vi.mocked(projectLockService.acquireLock)
const mockedReleaseLock = vi.mocked(projectLockService.releaseLock)
const mockedCheckLock = vi.mocked(projectLockService.checkLock)
const mockedRequestFocus = vi.mocked(projectLockService.requestFocus)
const mockedCleanupStaleLocks = vi.mocked(projectLockService.cleanupStaleLocks)
const mockedValidatePath = vi.mocked(validatePath)

// Helper to invoke IPC handler
async function invokeHandler(channel: string, payload?: unknown): Promise<any> {
  const handler = mockHandlers.get(channel)
  if (!handler) {
    throw new Error(`No handler registered for channel: ${channel}`)
  }
  return handler({} as IpcMainInvokeEvent, payload)
}

describe('project-lock-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandlers.clear()

    // Default: path validation succeeds
    mockedValidatePath.mockResolvedValue(undefined)

    // Register handlers
    registerProjectLockHandlers()
  })

  describe('registerProjectLockHandlers', () => {
    it('registers all required handlers', () => {
      expect(ipcMain.handle).toHaveBeenCalledWith('project-lock:acquire', expect.any(Function))
      expect(ipcMain.handle).toHaveBeenCalledWith('project-lock:release', expect.any(Function))
      expect(ipcMain.handle).toHaveBeenCalledWith('project-lock:check', expect.any(Function))
      expect(ipcMain.handle).toHaveBeenCalledWith('project-lock:requestFocus', expect.any(Function))
      expect(ipcMain.handle).toHaveBeenCalledWith('project-lock:cleanup', expect.any(Function))
    })
  })

  describe('project-lock:acquire handler', () => {
    it('validates payload schema with Zod', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedAcquireLock.mockResolvedValue({
        status: 'acquired',
        lockPath: '/Users/test/.erfana/locks/abc123.lock'
      })

      const result = await invokeHandler('project-lock:acquire', payload)

      expect(result).toEqual({
        status: 'acquired',
        lockPath: '/Users/test/.erfana/locks/abc123.lock'
      })
    })

    it('rejects invalid payload schema', async () => {
      const payload = {
        invalidField: 'invalid'
      }

      const result = await invokeHandler('project-lock:acquire', payload)

      expect(result.status).toBe('error')
      expect(result.message).toContain('Invalid payload')
    })

    it('rejects empty projectPath', async () => {
      const payload = {
        projectPath: ''
      }

      const result = await invokeHandler('project-lock:acquire', payload)

      expect(result.status).toBe('error')
      expect(result.message).toContain('Invalid payload')
    })

    it('rejects missing projectPath', async () => {
      const result = await invokeHandler('project-lock:acquire', {})

      expect(result.status).toBe('error')
      expect(result.message).toContain('Invalid payload')
    })

    it('validates project path security', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedAcquireLock.mockResolvedValue({
        status: 'acquired',
        lockPath: '/Users/test/.erfana/locks/abc123.lock'
      })

      await invokeHandler('project-lock:acquire', payload)

      expect(mockedValidatePath).toHaveBeenCalledWith('/Users/test/projects/my-project')
    })

    it('rejects invalid paths (path traversal)', async () => {
      const payload = {
        projectPath: '/Users/test/../../../etc/passwd'
      }

      mockedValidatePath.mockRejectedValue(new Error('Invalid path'))

      const result = await invokeHandler('project-lock:acquire', payload)

      expect(result.status).toBe('error')
      expect(result.message).toContain('Invalid path')
      expect(mockedAcquireLock).not.toHaveBeenCalled()
    })

    it('rejects system directories', async () => {
      const payload = {
        projectPath: '/System/Library'
      }

      mockedValidatePath.mockRejectedValue(new Error('System directory access denied'))

      const result = await invokeHandler('project-lock:acquire', payload)

      expect(result.status).toBe('error')
      expect(result.message).toContain('System directory')
      expect(mockedAcquireLock).not.toHaveBeenCalled()
    })

    it('returns acquired status when lock is obtained', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedAcquireLock.mockResolvedValue({
        status: 'acquired',
        lockPath: '/Users/test/.erfana/locks/abc123.lock'
      })

      const result = await invokeHandler('project-lock:acquire', payload)

      expect(result).toEqual({
        status: 'acquired',
        lockPath: '/Users/test/.erfana/locks/abc123.lock'
      })
    })

    it('returns already_locked status when another instance holds lock', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedAcquireLock.mockResolvedValue({
        status: 'already_locked',
        holderPid: 12345,
        holderHostname: 'other-machine.local'
      })

      const result = await invokeHandler('project-lock:acquire', payload)

      expect(result).toEqual({
        status: 'already_locked',
        holderPid: 12345,
        holderHostname: 'other-machine.local'
      })
    })

    it('returns error status on service error', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedAcquireLock.mockResolvedValue({
        status: 'error',
        message: 'Failed to create lock file'
      })

      const result = await invokeHandler('project-lock:acquire', payload)

      expect(result).toEqual({
        status: 'error',
        message: 'Failed to create lock file'
      })
    })

    it('handles service exceptions gracefully', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedAcquireLock.mockRejectedValue(new Error('Unexpected error'))

      const result = await invokeHandler('project-lock:acquire', payload)

      expect(result.status).toBe('error')
      expect(result.message).toContain('Unexpected error')
    })
  })

  describe('project-lock:release handler', () => {
    it('validates payload schema with Zod', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedReleaseLock.mockResolvedValue(undefined)

      const result = await invokeHandler('project-lock:release', payload)

      expect(result).toEqual({ success: true })
    })

    it('rejects invalid payload schema', async () => {
      const payload = {
        invalidField: 'invalid'
      }

      const result = await invokeHandler('project-lock:release', payload)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid payload')
    })

    it('calls service releaseLock method', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedReleaseLock.mockResolvedValue(undefined)

      await invokeHandler('project-lock:release', payload)

      expect(mockedReleaseLock).toHaveBeenCalledWith('/Users/test/projects/my-project')
    })

    it('returns success when lock is released', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedReleaseLock.mockResolvedValue(undefined)

      const result = await invokeHandler('project-lock:release', payload)

      expect(result).toEqual({ success: true })
    })

    it('handles service exceptions gracefully', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedReleaseLock.mockRejectedValue(new Error('Unexpected error'))

      const result = await invokeHandler('project-lock:release', payload)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Unexpected error')
    })
  })

  describe('project-lock:check handler', () => {
    it('validates payload schema with Zod', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedCheckLock.mockResolvedValue({ status: 'unlocked' })

      const result = await invokeHandler('project-lock:check', payload)

      expect(result).toEqual({ status: 'unlocked' })
    })

    it('rejects invalid payload schema', async () => {
      const payload = {
        invalidField: 'invalid'
      }

      const result = await invokeHandler('project-lock:check', payload)

      expect(result.status).toBe('error')
      expect(result.message).toContain('Invalid payload')
    })

    it('returns unlocked status when no lock exists', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedCheckLock.mockResolvedValue({ status: 'unlocked' })

      const result = await invokeHandler('project-lock:check', payload)

      expect(result).toEqual({ status: 'unlocked' })
    })

    it('returns locked_by_self status when this instance holds lock', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedCheckLock.mockResolvedValue({
        status: 'locked_by_self',
        lockPath: '/Users/test/.erfana/locks/abc123.lock'
      })

      const result = await invokeHandler('project-lock:check', payload)

      expect(result).toEqual({
        status: 'locked_by_self',
        lockPath: '/Users/test/.erfana/locks/abc123.lock'
      })
    })

    it('returns locked_by_other status when another instance holds lock', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedCheckLock.mockResolvedValue({
        status: 'locked_by_other',
        holderPid: 12345,
        holderHostname: 'other-machine.local'
      })

      const result = await invokeHandler('project-lock:check', payload)

      expect(result).toEqual({
        status: 'locked_by_other',
        holderPid: 12345,
        holderHostname: 'other-machine.local'
      })
    })

    it('returns error status on service error', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedCheckLock.mockResolvedValue({
        status: 'error',
        message: 'Failed to read lock file'
      })

      const result = await invokeHandler('project-lock:check', payload)

      expect(result).toEqual({
        status: 'error',
        message: 'Failed to read lock file'
      })
    })

    it('handles service exceptions gracefully', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedCheckLock.mockRejectedValue(new Error('Unexpected error'))

      const result = await invokeHandler('project-lock:check', payload)

      expect(result.status).toBe('error')
      expect(result.message).toContain('Unexpected error')
    })
  })

  describe('project-lock:requestFocus handler', () => {
    it('validates payload schema with Zod', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedRequestFocus.mockResolvedValue(true)

      const result = await invokeHandler('project-lock:requestFocus', payload)

      expect(result).toEqual({ success: true })
    })

    it('rejects invalid payload schema', async () => {
      const payload = {
        invalidField: 'invalid'
      }

      const result = await invokeHandler('project-lock:requestFocus', payload)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid payload')
    })

    it('calls service requestFocus method', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedRequestFocus.mockResolvedValue(true)

      await invokeHandler('project-lock:requestFocus', payload)

      expect(mockedRequestFocus).toHaveBeenCalledWith('/Users/test/projects/my-project')
    })

    it('returns success true when focus request is sent', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedRequestFocus.mockResolvedValue(true)

      const result = await invokeHandler('project-lock:requestFocus', payload)

      expect(result).toEqual({ success: true })
    })

    it('returns success false when no lock file exists', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedRequestFocus.mockResolvedValue(false)

      const result = await invokeHandler('project-lock:requestFocus', payload)

      expect(result).toEqual({ success: false })
    })

    it('handles service exceptions gracefully', async () => {
      const payload = {
        projectPath: '/Users/test/projects/my-project'
      }

      mockedRequestFocus.mockRejectedValue(new Error('Unexpected error'))

      const result = await invokeHandler('project-lock:requestFocus', payload)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Unexpected error')
    })
  })

  describe('project-lock:cleanup handler', () => {
    it('calls service cleanupStaleLocks method', async () => {
      mockedCleanupStaleLocks.mockResolvedValue(3)

      await invokeHandler('project-lock:cleanup')

      expect(mockedCleanupStaleLocks).toHaveBeenCalled()
    })

    it('returns success with removed count', async () => {
      mockedCleanupStaleLocks.mockResolvedValue(5)

      const result = await invokeHandler('project-lock:cleanup')

      expect(result).toEqual({
        success: true,
        removedCount: 5
      })
    })

    it('returns success with zero count when no stale locks', async () => {
      mockedCleanupStaleLocks.mockResolvedValue(0)

      const result = await invokeHandler('project-lock:cleanup')

      expect(result).toEqual({
        success: true,
        removedCount: 0
      })
    })

    it('handles service exceptions gracefully', async () => {
      mockedCleanupStaleLocks.mockRejectedValue(new Error('Unexpected error'))

      const result = await invokeHandler('project-lock:cleanup')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Unexpected error')
    })

    it('does not require payload', async () => {
      mockedCleanupStaleLocks.mockResolvedValue(2)

      // Should work with undefined payload
      const result = await invokeHandler('project-lock:cleanup', undefined)

      expect(result.success).toBe(true)
      expect(result.removedCount).toBe(2)
    })
  })
})
