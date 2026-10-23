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
 * - Project containment (`insideProject`, the renderer's projectRoot ignored)
 * - File existence checks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'node:path'

/** A rooted path on the host: `/x` is not absolute on Windows. */
const abs = (value: string): string => path.resolve(value)

// Capture registered handlers
const handlers: Record<string, (...args: unknown[]) => unknown> = {}

// Use vi.hoisted for mocks
const { mockStat, sessionState } = vi.hoisted(() => ({
  mockStat: vi.fn(),
  sessionState: { snapshot: null as null | Record<string, unknown> }
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
    session = { current: () => sessionState.snapshot, require: () => { throw new Error('no project') }, onChange: () => () => {} }
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
  let validatePath: (event: unknown, request: unknown) => Promise<unknown>

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
      const result = await validatePath({}, { filePath: null as unknown as string })
      expect(result).toEqual({ exists: false, error: 'Invalid file path' })
    })

    it('returns error for undefined filePath', async () => {
      const result = await validatePath({}, { filePath: undefined as unknown as string })
      expect(result).toEqual({ exists: false, error: 'Invalid file path' })
    })

    it('returns error for non-string filePath', async () => {
      const result = await validatePath({}, { filePath: 123 as unknown as string })
      expect(result).toEqual({ exists: false, error: 'Invalid file path' })
    })

    it('returns error for empty string', async () => {
      const result = await validatePath({}, { filePath: '' })
      expect(result).toEqual({ exists: false, error: 'Invalid file path' })
    })

    it('returns error for whitespace-only string', async () => {
      const result = await validatePath({}, { filePath: '   ' })
      expect(result).toEqual({ exists: false, error: 'Empty file path' })
    })
  })

  describe('security: system path blocking', () => {
    const isWindows = process.platform === 'win32'

    if (isWindows) {
      it('blocks C:\\Windows paths', async () => {
        const result = await validatePath({}, { filePath: 'C:\\Windows\\System32\\cmd.exe' })
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })

      it('blocks C:\\Program Files paths', async () => {
        const result = await validatePath({}, { filePath: 'C:\\Program Files\\app\\file.exe' })
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })

      it('blocks paths case-insensitively on Windows', async () => {
        const result = await validatePath({}, { filePath: 'c:\\windows\\system32\\file.dll' })
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })
    } else {
      it('blocks /etc paths', async () => {
        const result = await validatePath({}, { filePath: '/etc/passwd' })
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })

      it('blocks /usr paths', async () => {
        const result = await validatePath({}, { filePath: '/usr/bin/node' })
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })

      it('blocks /bin paths', async () => {
        const result = await validatePath({}, { filePath: '/bin/bash' })
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })

      it('blocks /sbin paths', async () => {
        const result = await validatePath({}, { filePath: '/sbin/init' })
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })

      it('blocks /System paths (macOS)', async () => {
        const result = await validatePath({}, { filePath: '/System/Library/file' })
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })

      it('blocks /Library paths (macOS)', async () => {
        const result = await validatePath({}, { filePath: '/Library/Application Support/file' })
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })

      it('blocks /private/var paths (macOS)', async () => {
        const result = await validatePath({}, { filePath: '/private/var/log/system.log' })
        expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
      })

      it('allows user home directory paths', async () => {
        mockStat.mockResolvedValue({ isFile: () => true })
        const result = await validatePath({}, { filePath: '/Users/test/project/file.ts' })
        expect(result).toHaveProperty('exists', true)
      })

      it('allows project paths', async () => {
        mockStat.mockResolvedValue({ isFile: () => true })
        const result = await validatePath({}, { filePath: '/home/user/projects/myapp/src/index.ts' })
        expect(result).toHaveProperty('exists', true)
      })
    }
  })

  describe('project containment', () => {
    const projectRoot = abs('/project')

    beforeEach(() => {
      sessionState.snapshot = {
        generation: 1,
        root: projectRoot,
        realRoot: projectRoot,
        caseSensitive: process.platform === 'linux',
        ownerWebContentsId: null
      }
      mockStat.mockResolvedValue({ isFile: () => true })
    })

    afterEach(() => {
      sessionState.snapshot = null
    })

    it('reports a file inside the open project', async () => {
      const result = await validatePath({}, { filePath: abs('/project/src/file.ts') })
      expect(result).toEqual({
        exists: true,
        absolutePath: abs('/project/src/file.ts'),
        isFile: true,
        insideProject: true
      })
    })

    it('reports a file outside the open project, and still validates it', async () => {
      const result = await validatePath({}, { filePath: abs('/other/file.ts') })
      expect(result).toHaveProperty('exists', true)
      expect(result).toHaveProperty('insideProject', false)
    })

    it('does not take a sibling folder with the same name prefix for the project', async () => {
      const result = await validatePath({}, { filePath: abs('/project-evil/file.ts') })
      expect(result).toHaveProperty('insideProject', false)
    })

    it('resolves .. before it decides', async () => {
      const result = await validatePath({}, { filePath: abs('/project/../other/file.ts') })
      expect(result).toHaveProperty('insideProject', false)
    })

    it('refuses a request that names a project root, so the renderer cannot say where the project is', async () => {
      const lying = await validatePath(
        {},
        { filePath: abs('/other/file.ts'), projectRoot: abs('/other') }
      )
      expect(lying).toMatchObject({ exists: false, error: expect.stringContaining('projectRoot') })
    })

    it('refuses a bare string in place of the request object', async () => {
      const result = await validatePath({}, abs('/project/src/file.ts'))
      expect(result).toMatchObject({ exists: false })
      expect(result).not.toHaveProperty('insideProject')
    })

    it('reports false when no project is open', async () => {
      sessionState.snapshot = null
      const result = await validatePath({}, { filePath: abs('/project/src/file.ts') })
      expect(result).toHaveProperty('exists', true)
      expect(result).toHaveProperty('insideProject', false)
    })

    it('still blocks system paths whatever the project', async () => {
      if (process.platform === 'win32') return
      const result = await validatePath({}, { filePath: '/etc/passwd' })
      expect(result).toEqual({ exists: false, error: 'Access to system paths not allowed' })
    })
  })

  describe('file existence', () => {
    it('returns exists: true for existing file', async () => {
      mockStat.mockResolvedValue({ isFile: () => true })
      const result = await validatePath({}, { filePath: abs('/home/user/file.ts') })
      expect(result).toEqual({
        exists: true,
        absolutePath: abs('/home/user/file.ts'),
        isFile: true,
        insideProject: false
      })
    })

    it('returns exists: false for directories', async () => {
      mockStat.mockResolvedValue({ isFile: () => false })
      const result = await validatePath({}, { filePath: abs('/home/user/folder') })
      expect(result).toEqual({ exists: false, error: 'Path is not a file' })
    })

    it('returns exists: false for non-existent paths (ENOENT)', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      mockStat.mockRejectedValue(error)
      const result = await validatePath({}, { filePath: abs('/home/user/missing.ts') })
      expect(result).toEqual({ exists: false })
    })

    it('returns error message for permission errors', async () => {
      const error = new Error('Permission denied') as NodeJS.ErrnoException
      error.code = 'EACCES'
      mockStat.mockRejectedValue(error)
      const result = await validatePath({}, { filePath: abs('/home/user/protected.ts') })
      expect(result).toEqual({ exists: false, error: 'Permission denied' })
    })
  })
})
