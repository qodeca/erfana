// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * file-handlers.openProjectByPath.test.ts
 *
 * todo003: Comprehensive test coverage for openProjectByPath IPC handler
 *
 * Test groups:
 * - Input validation (10+ tests)
 * - Path processing (5+ tests)
 * - ProjectService integration (10+ tests)
 * - Error propagation (5+ tests)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'

/** A rooted path on the host: `/x` is not absolute on Windows. */
const abs = (value: string): string => path.resolve(value)

// Capture registered handlers
const handlers: Record<string, (...args: unknown[]) => unknown> = {}

// Use vi.hoisted for mocks
const { mockSwitchProject, mockShowOpenDialog } = vi.hoisted(() => ({
  mockSwitchProject: vi.fn(),
  mockShowOpenDialog: vi.fn()
}))

// Mock electron
vi.mock('./senderValidation', () => ({ isTrustedSender: () => true,
    isTrustedAppSender: () => true }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers[channel] = handler
    })
  },
  dialog: {
    showOpenDialog: mockShowOpenDialog
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  }
}))

// Mock ProjectService as a class
vi.mock('../services/ProjectService', () => ({
  ProjectService: class MockProjectService {
    switchProject = mockSwitchProject
    session = { current: () => null, require: () => { throw new Error('no project') }, onChange: () => () => {} }
  }
}))

// Mock other services
vi.mock('../services/FileService', () => ({
  fileService: {
    getProjectPath: vi.fn(() => null),
    setProjectPath: vi.fn()
  }
}))

vi.mock('../services/FileWatcherService', () => ({
  fileWatcherService: {
    stopAll: vi.fn(),
    setProjectPath: vi.fn()
  }
}))

vi.mock('../services/DirectoryWatcherService', () => ({
  directoryWatcherService: {
    stopAll: vi.fn(),
    setProjectPath: vi.fn()
  }
}))

vi.mock('../services/SettingsService', () => ({
  settingsService: {
    setLastProjectPath: vi.fn(),
    getLastProjectPath: vi.fn(),
    clearLastProjectPath: vi.fn(),
    addRecentProject: vi.fn()
  }
}))

vi.mock('fs/promises', () => ({
  stat: vi.fn()
}))

// Mock ProjectLockService to avoid app.getPath dependency
vi.mock('../services/ProjectLockService', () => ({
  projectLockService: {
    acquireLock: vi.fn(async () => ({ status: 'acquired' })),
    releaseLock: vi.fn(async () => {}),
    checkLock: vi.fn(async () => ({ status: 'unlocked' })),
    requestFocus: vi.fn(async () => true),
    cleanupStaleLocks: vi.fn(async () => 0),
    dispose: vi.fn(async () => {})
  }
}))

// Import after mocks
import { registerFileHandlers } from './file-handlers'

describe('file:openProjectByPath IPC handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear handlers
    Object.keys(handlers).forEach(k => delete handlers[k])
    // Register handlers
    registerFileHandlers()
    // Default: successful switch
    mockSwitchProject.mockResolvedValue({
      success: true,
      path: abs('/test/project'),
      action: 'switched'
    })
  })

  describe('Input validation', () => {
    it('should reject empty string', async () => {
      const handler = handlers['file:openProjectByPath']
      await expect(handler({}, { projectPath: '' })).rejects.toThrow('Invalid project path')
    })

    it('should reject null', async () => {
      const handler = handlers['file:openProjectByPath']
      await expect(handler({}, { projectPath: null })).rejects.toThrow('Invalid project path')
    })

    it('should reject undefined', async () => {
      const handler = handlers['file:openProjectByPath']
      await expect(handler({}, { projectPath: undefined })).rejects.toThrow('Invalid project path')
    })

    it('should reject number', async () => {
      const handler = handlers['file:openProjectByPath']
      await expect(handler({}, { projectPath: 123 })).rejects.toThrow('Invalid project path')
    })

    it('should reject object', async () => {
      const handler = handlers['file:openProjectByPath']
      await expect(handler({}, { projectPath: { path: abs('/test') } })).rejects.toThrow('Invalid project path')
    })

    it('should reject array', async () => {
      const handler = handlers['file:openProjectByPath']
      await expect(handler({}, { projectPath: [abs('/test')] })).rejects.toThrow('Invalid project path')
    })

    it('should reject whitespace-only string', async () => {
      const handler = handlers['file:openProjectByPath']
      await expect(handler({}, { projectPath: '   ' })).rejects.toThrow('path is empty after trimming')
    })

    it('should reject tabs-only string', async () => {
      const handler = handlers['file:openProjectByPath']
      await expect(handler({}, { projectPath: '\t\t' })).rejects.toThrow('path is empty after trimming')
    })

    it('should reject newlines-only string', async () => {
      const handler = handlers['file:openProjectByPath']
      await expect(handler({}, { projectPath: '\n\n' })).rejects.toThrow('path is empty after trimming')
    })

    it('should reject mixed whitespace string', async () => {
      const handler = handlers['file:openProjectByPath']
      await expect(handler({}, { projectPath: ' \t\n ' })).rejects.toThrow('path is empty after trimming')
    })
  })

  describe('Path processing', () => {
    it('should trim leading whitespace', async () => {
      const handler = handlers['file:openProjectByPath']
      await handler({}, { projectPath: `  ${abs('/test/project')}` })
      expect(mockSwitchProject).toHaveBeenCalledWith(abs('/test/project'), expect.objectContaining({ source: 'recent' }))
    })

    it('should trim trailing whitespace', async () => {
      const handler = handlers['file:openProjectByPath']
      await handler({}, { projectPath: `${abs('/test/project')}  ` })
      expect(mockSwitchProject).toHaveBeenCalledWith(abs('/test/project'), expect.objectContaining({ source: 'recent' }))
    })

    it('should trim both leading and trailing whitespace', async () => {
      const handler = handlers['file:openProjectByPath']
      await handler({}, { projectPath: `  ${abs('/test/project')}  ` })
      expect(mockSwitchProject).toHaveBeenCalledWith(abs('/test/project'), expect.objectContaining({ source: 'recent' }))
    })

    it('should preserve internal spaces in path', async () => {
      const handler = handlers['file:openProjectByPath']
      mockSwitchProject.mockResolvedValue({
        success: true,
        path: abs('/test/my project/folder'),
        action: 'switched'
      })
      await handler({}, { projectPath: abs('/test/my project/folder') })
      expect(mockSwitchProject).toHaveBeenCalledWith(abs('/test/my project/folder'), expect.objectContaining({ source: 'recent' }))
    })

    it('should handle paths with special characters', async () => {
      const handler = handlers['file:openProjectByPath']
      const specialPath = abs('/test/project-name_v2.0')
      mockSwitchProject.mockResolvedValue({
        success: true,
        path: specialPath,
        action: 'switched'
      })
      await handler({}, { projectPath: specialPath })
      expect(mockSwitchProject).toHaveBeenCalledWith(specialPath, expect.objectContaining({ source: 'recent' }))
    })
  })

  describe('ProjectService integration', () => {
    it('should call projectService.switchProject with path', async () => {
      const handler = handlers['file:openProjectByPath']
      await handler({}, { projectPath: abs('/test/project') })
      expect(mockSwitchProject).toHaveBeenCalledWith(abs('/test/project'), expect.objectContaining({ source: 'recent' }))
    })

    it('should return path on successful switch', async () => {
      const handler = handlers['file:openProjectByPath']
      mockSwitchProject.mockResolvedValue({
        success: true,
        path: abs('/test/project'),
        action: 'switched'
      })
      const result = await handler({}, { projectPath: abs('/test/project') })
      expect(result).toBe(abs('/test/project'))
    })

    it('should return path on noop (same project)', async () => {
      const handler = handlers['file:openProjectByPath']
      mockSwitchProject.mockResolvedValue({
        success: true,
        path: abs('/test/project'),
        action: 'noop'
      })
      const result = await handler({}, { projectPath: abs('/test/project') })
      expect(result).toBe(abs('/test/project'))
    })

    it('should throw on validation failure', async () => {
      const handler = handlers['file:openProjectByPath']
      mockSwitchProject.mockResolvedValue({
        success: false,
        path: '',
        action: 'noop',
        error: 'Security validation failed'
      })
      await expect(handler({}, { projectPath: abs('/etc') })).rejects.toThrow('Security validation failed')
    })

    it('should throw on directory not found', async () => {
      const handler = handlers['file:openProjectByPath']
      mockSwitchProject.mockResolvedValue({
        success: false,
        path: '',
        action: 'noop',
        error: 'Project directory not found'
      })
      await expect(handler({}, { projectPath: abs('/nonexistent') })).rejects.toThrow('Project directory not found')
    })

    it('should throw on permission denied', async () => {
      const handler = handlers['file:openProjectByPath']
      mockSwitchProject.mockResolvedValue({
        success: false,
        path: '',
        action: 'noop',
        error: 'Cannot access project directory'
      })
      await expect(handler({}, { projectPath: abs('/private') })).rejects.toThrow('Cannot access')
    })

    it('should throw generic error when error is undefined', async () => {
      const handler = handlers['file:openProjectByPath']
      mockSwitchProject.mockResolvedValue({
        success: false,
        path: '',
        action: 'noop'
        // No error property
      })
      await expect(handler({}, { projectPath: abs('/test') })).rejects.toThrow('Unknown error')
    })

    it('should handle system directory rejection', async () => {
      const handler = handlers['file:openProjectByPath']
      mockSwitchProject.mockResolvedValue({
        success: false,
        path: '',
        action: 'noop',
        error: 'Cannot open system or sensitive directories'
      })
      await expect(handler({}, { projectPath: abs('/System') })).rejects.toThrow('system or sensitive')
    })

    it('should handle symlink attack rejection', async () => {
      const handler = handlers['file:openProjectByPath']
      mockSwitchProject.mockResolvedValue({
        success: false,
        path: '',
        action: 'noop',
        error: 'Cannot open symlink to system directory'
      })
      await expect(handler({}, { projectPath: abs('/symlink-to-etc') })).rejects.toThrow('symlink')
    })
  })

  describe('Error propagation', () => {
    it('should mark the error code on the message so the renderer can word the refusal', async () => {
      const handler = handlers['file:openProjectByPath']
      mockSwitchProject.mockResolvedValue({
        success: false,
        path: '',
        action: 'noop',
        error: 'Security validation failed: refused',
        errorCode: 'PATH_SYSTEM_DIR'
      })
      await expect(handler({}, { projectPath: abs('/test') })).rejects.toThrow(
        'Security validation failed: refused [PATH_SYSTEM_DIR]'
      )
    })

    it('should propagate projectService errors', async () => {
      const handler = handlers['file:openProjectByPath']
      mockSwitchProject.mockRejectedValue(new Error('Service error'))
      await expect(handler({}, { projectPath: abs('/test') })).rejects.toThrow('Service error')
    })

    it('should preserve error message from projectService', async () => {
      const handler = handlers['file:openProjectByPath']
      const errorMessage = 'Specific error from ProjectService'
      mockSwitchProject.mockResolvedValue({
        success: false,
        path: '',
        action: 'noop',
        error: errorMessage
      })
      await expect(handler({}, { projectPath: abs('/test') })).rejects.toThrow(errorMessage)
    })

    it('should handle async errors correctly', async () => {
      const handler = handlers['file:openProjectByPath']
      mockSwitchProject.mockImplementation(async () => {
        throw new Error('Async error')
      })
      await expect(handler({}, { projectPath: abs('/test') })).rejects.toThrow('Async error')
    })

    it('should not expose internal stack traces to renderer', async () => {
      const handler = handlers['file:openProjectByPath']
      mockSwitchProject.mockResolvedValue({
        success: false,
        path: '',
        action: 'noop',
        error: 'User-friendly error message'
      })

      try {
        await handler({}, { projectPath: abs('/test') })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBe('User-friendly error message')
      }
    })

    it('should handle timeout-like scenarios', async () => {
      const handler = handlers['file:openProjectByPath']
      mockSwitchProject.mockImplementation(() =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Operation timed out')), 10)
        )
      )
      await expect(handler({}, { projectPath: abs('/test') })).rejects.toThrow('timed out')
    })
  })

  describe('Handler registration', () => {
    it('should register file:openProjectByPath handler', () => {
      expect(handlers['file:openProjectByPath']).toBeDefined()
      expect(typeof handlers['file:openProjectByPath']).toBe('function')
    })

    it('should register file:openProject handler', () => {
      expect(handlers['file:openProject']).toBeDefined()
      expect(typeof handlers['file:openProject']).toBe('function')
    })
  })
})

describe('file:openProject IPC handler (dialog)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(handlers).forEach(k => delete handlers[k])
    registerFileHandlers()
    mockSwitchProject.mockResolvedValue({
      success: true,
      path: abs('/test/project'),
      action: 'switched'
    })
  })

  it('should return null when dialog is canceled', async () => {
    const handler = handlers['file:openProject']
    mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    const result = await handler({})
    expect(result).toBeNull()
  })

  it('should call switchProject with selected path', async () => {
    const handler = handlers['file:openProject']
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/selected/path']
    })

    await handler({ sender: { id: 7 } })
    expect(mockSwitchProject).toHaveBeenCalledWith('/selected/path', { senderId: 7, source: 'dialog' })
  })

  it('should return path on successful selection', async () => {
    const handler = handlers['file:openProject']
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/selected/path']
    })
    mockSwitchProject.mockResolvedValue({
      success: true,
      path: '/selected/path',
      action: 'switched'
    })

    const result = await handler({})
    expect(result).toBe('/selected/path')
  })
})
