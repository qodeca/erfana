// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * file-handlers.validatePath.test.ts
 *
 * Tests for file:validatePath IPC handler
 *
 * Test groups:
 * - Input validation
 * - Security: system path blocking
 * - Security: project root containment
 * - File existence checks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture registered handlers
const handlers: Record<string, (...args: unknown[]) => unknown> = {}

// Use vi.hoisted for mocks
const { mockStat } = vi.hoisted(() => ({
  mockStat: vi.fn()
}))

// Mock electron
vi.mock('./senderValidation', () => ({ isTrustedSender: () => true }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers[channel] = handler
    })
  },
  dialog: {
    showOpenDialog: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  }
}))

// Mock ProjectService as a class
vi.mock('../services/ProjectService', () => ({
  ProjectService: class MockProjectService {
    switchProject = vi.fn()
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
  stat: mockStat
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

describe('file:validatePath', () => {
  let validatePath: (event: unknown, filePath: string, projectRoot?: string) => Promise<unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    // Clear handlers
    Object.keys(handlers).forEach((key) => delete handlers[key])
    // Register handlers
    registerFileHandlers()
    validatePath = handlers['file:validatePath'] as typeof validatePath
  })

  describe('input validation', () => {
    it('returns error for null filePath', async () => {
      const result = await validatePath({}, null as unknown as string)
      expect(result).toEqual({ exists: false, error: 'Invalid file path' })
    })

    it('returns error for undefined filePath', async () => {
      const result = await validatePath({}, undefined as unknown as string)
      expect(result).toEqual({ exists: false, error: 'Invalid file path' })
    })

    it('returns error for non-string filePath', async () => {
      const result = await validatePath({}, 123 as unknown as string)
      expect(result).toEqual({ exists: false, error: 'Invalid file path' })
    })

    it('returns error for empty string', async () => {
      const result = await validatePath({}, '')
      expect(result).toEqual({ exists: false, error: 'Invalid file path' })
    })

    it('returns error for whitespace-only string', async () => {
      const result = await validatePath({}, '   ')
      expect(result).toEqual({ exists: false, error: 'Empty file path' })
    })
  })

  describe('security: system path blocking', () => {
    const isWindows = process.platform === 'win32'

    if (isWindows) {
      it('blocks C:\\Windows paths', async () => {
        const result = await validatePath({}, 'C:\\Windows\\System32\\cmd.exe')
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })

      it('blocks C:\\Program Files paths', async () => {
        const result = await validatePath({}, 'C:\\Program Files\\app\\file.exe')
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })

      it('blocks paths case-insensitively on Windows', async () => {
        const result = await validatePath({}, 'c:\\windows\\system32\\file.dll')
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })
    } else {
      it('blocks /etc paths', async () => {
        const result = await validatePath({}, '/etc/passwd')
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })

      it('blocks /usr paths', async () => {
        const result = await validatePath({}, '/usr/bin/node')
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })

      it('blocks /bin paths', async () => {
        const result = await validatePath({}, '/bin/bash')
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })

      it('blocks /sbin paths', async () => {
        const result = await validatePath({}, '/sbin/init')
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })

      it('blocks /System paths (macOS)', async () => {
        const result = await validatePath({}, '/System/Library/file')
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })

      it('blocks /Library paths (macOS)', async () => {
        const result = await validatePath({}, '/Library/Application Support/file')
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })

      it('blocks /private/var paths (macOS)', async () => {
        const result = await validatePath({}, '/private/var/log/system.log')
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })

      it('allows user home directory paths', async () => {
        mockStat.mockResolvedValue({ isFile: () => true })
        const result = await validatePath({}, '/Users/test/project/file.ts')
        expect(result).toHaveProperty('exists', true)
      })

      it('allows project paths', async () => {
        mockStat.mockResolvedValue({ isFile: () => true })
        const result = await validatePath({}, '/home/user/projects/myapp/src/index.ts')
        expect(result).toHaveProperty('exists', true)
      })
    }
  })

  describe('security: project root containment', () => {
    it('allows paths within project root', async () => {
      mockStat.mockResolvedValue({ isFile: () => true })
      const result = await validatePath({}, '/project/src/file.ts', '/project')
      expect(result).toHaveProperty('exists', true)
    })

    it('blocks paths outside project root', async () => {
      const result = await validatePath({}, '/other/file.ts', '/project')
      expect(result).toEqual({ exists: false, error: 'Path outside project root' })
    })

    it('blocks path traversal attempts', async () => {
      const result = await validatePath({}, '/project/../other/file.ts', '/project')
      expect(result).toEqual({ exists: false, error: 'Path outside project root' })
    })
  })

  describe('file existence', () => {
    it('returns exists: true for existing file', async () => {
      mockStat.mockResolvedValue({ isFile: () => true })
      const result = await validatePath({}, '/home/user/file.ts')
      expect(result).toEqual({
        exists: true,
        absolutePath: '/home/user/file.ts',
        isFile: true
      })
    })

    it('returns exists: false for directories', async () => {
      mockStat.mockResolvedValue({ isFile: () => false })
      const result = await validatePath({}, '/home/user/folder')
      expect(result).toEqual({ exists: false, error: 'Path is not a file' })
    })

    it('returns exists: false for non-existent paths (ENOENT)', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      mockStat.mockRejectedValue(error)
      const result = await validatePath({}, '/home/user/missing.ts')
      expect(result).toEqual({ exists: false })
    })

    it('returns error message for permission errors', async () => {
      const error = new Error('Permission denied') as NodeJS.ErrnoException
      error.code = 'EACCES'
      mockStat.mockRejectedValue(error)
      const result = await validatePath({}, '/home/user/protected.ts')
      expect(result).toEqual({ exists: false, error: 'Permission denied' })
    })
  })
})
