// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Git Watcher IPC Handlers Security Tests
 *
 * Tests path security validation in git-watcher IPC handlers
 *
 * Test groups:
 * - Path traversal rejection
 * - System directory rejection
 * - Sensitive user directory rejection
 * - Valid path acceptance
 * - Empty/invalid input handling
 *
 * @see Issue #74 - Real-time git status refresh
 * @see Spec #003 - Real-time git status refresh specification
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { AppError, ErrorCode } from '../../shared/errors'

// Capture registered handlers
const handlers: Record<string, (...args: unknown[]) => unknown> = {}

// Use vi.hoisted for mocks
const { mockValidateProjectPath, mockGitWatcherServiceStart, mockGitPollingServiceStart } = vi.hoisted(
  () => ({
    mockValidateProjectPath: vi.fn(),
    mockGitWatcherServiceStart: vi.fn(),
    mockGitPollingServiceStart: vi.fn()
  })
)

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers[channel] = handler
    })
  }
}))

// Mock GitWatcherService
vi.mock('../services/GitWatcherService', () => ({
  gitWatcherService: {
    start: mockGitWatcherServiceStart,
    stop: vi.fn(),
    isWatching: vi.fn(() => false),
    getWatchedPath: vi.fn(() => null),
    getLastEventTimestamp: vi.fn(() => null)
  }
}))

// Mock GitPollingService
vi.mock('../services/GitPollingService', () => ({
  gitPollingService: {
    start: mockGitPollingServiceStart,
    stop: vi.fn(),
    setInterval: vi.fn(),
    getInterval: vi.fn(() => 5000),
    setEnabled: vi.fn(),
    isEnabled: vi.fn(() => true)
  }
}))

// Mock LoggingService
vi.mock('../services/LoggingService', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

// Mock pathSecurity
vi.mock('../utils/pathSecurity', () => ({
  validateProjectPath: mockValidateProjectPath
}))

// Import after mocks
import { registerGitWatcherHandlers } from './git-watcher-handlers'

// Mock console.warn for logging tests
let consoleWarnSpy: ReturnType<typeof vi.spyOn>

describe('git-watcher:start security', () => {
  let startHandler: (event: unknown, projectPath: string) => Promise<unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Clear handlers
    Object.keys(handlers).forEach((key) => delete handlers[key])
    // Register handlers
    registerGitWatcherHandlers()
    startHandler = handlers['git-watcher:start'] as typeof startHandler
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
  })

  describe('path traversal rejection', () => {
    it('should reject ../../etc/passwd', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Path traversal attack detected', ErrorCode.PATH_TRAVERSAL)
      )

      const result = await startHandler({}, '../../etc/passwd')

      expect(result).toEqual({
        success: false,
        error: 'Invalid path: path traversal detected'
      })
      expect(mockValidateProjectPath).toHaveBeenCalledWith('../../etc/passwd')
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should reject ../../../System', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Path traversal attack detected', ErrorCode.PATH_TRAVERSAL)
      )

      const result = await startHandler({}, '../../../System')

      expect(result).toEqual({
        success: false,
        error: 'Invalid path: path traversal detected'
      })
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should reject relative path with ..', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError(
          'Project path must be absolute. Relative paths are not allowed for security reasons.',
          ErrorCode.PATH_NOT_ABSOLUTE
        )
      )

      const result = await startHandler({}, '../project')

      expect(result).toEqual({
        success: false,
        error: 'Please select an absolute path'
      })
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should reject path with embedded traversal', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Path traversal attack detected', ErrorCode.PATH_TRAVERSAL)
      )

      const result = await startHandler({}, '/home/user/../../../etc')

      expect(result).toEqual({
        success: false,
        error: 'Invalid path: path traversal detected'
      })
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })
  })

  describe('system directory rejection', () => {
    it('should reject /etc', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Cannot open system or sensitive directories as projects', ErrorCode.PATH_SYSTEM_DIR)
      )

      const result = await startHandler({}, '/etc')

      expect(result).toEqual({
        success: false,
        error: 'System directories cannot be opened as projects'
      })
      expect(mockValidateProjectPath).toHaveBeenCalledWith('/etc')
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should reject /System', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Cannot open system or sensitive directories as projects', ErrorCode.PATH_SYSTEM_DIR)
      )

      const result = await startHandler({}, '/System')

      expect(result).toEqual({
        success: false,
        error: 'System directories cannot be opened as projects'
      })
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should reject /usr', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Cannot open system or sensitive directories as projects', ErrorCode.PATH_SYSTEM_DIR)
      )

      const result = await startHandler({}, '/usr')

      expect(result).toEqual({
        success: false,
        error: 'System directories cannot be opened as projects'
      })
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should reject /var', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Cannot open system or sensitive directories as projects', ErrorCode.PATH_SYSTEM_DIR)
      )

      const result = await startHandler({}, '/var')

      expect(result).toEqual({
        success: false,
        error: 'System directories cannot be opened as projects'
      })
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should reject /System subdirectory', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Cannot open system or sensitive directories as projects', ErrorCode.PATH_SYSTEM_DIR)
      )

      const result = await startHandler({}, '/System/Library')

      expect(result).toEqual({
        success: false,
        error: 'System directories cannot be opened as projects'
      })
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should reject /usr subdirectory', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Cannot open system or sensitive directories as projects', ErrorCode.PATH_SYSTEM_DIR)
      )

      const result = await startHandler({}, '/usr/bin')

      expect(result).toEqual({
        success: false,
        error: 'System directories cannot be opened as projects'
      })
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })
  })

  describe('sensitive user directory rejection', () => {
    it('should reject ~/.ssh', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Cannot open system or sensitive directories as projects', ErrorCode.PATH_SYSTEM_DIR)
      )

      const result = await startHandler({}, '/Users/test/.ssh')

      expect(result).toEqual({
        success: false,
        error: 'System directories cannot be opened as projects'
      })
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should reject ~/.aws', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Cannot open system or sensitive directories as projects', ErrorCode.PATH_SYSTEM_DIR)
      )

      const result = await startHandler({}, '/Users/test/.aws')

      expect(result).toEqual({
        success: false,
        error: 'System directories cannot be opened as projects'
      })
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should reject ~/.gnupg', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Cannot open system or sensitive directories as projects', ErrorCode.PATH_SYSTEM_DIR)
      )

      const result = await startHandler({}, '/Users/test/.gnupg')

      expect(result).toEqual({
        success: false,
        error: 'System directories cannot be opened as projects'
      })
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should reject sensitive subdirectory', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Cannot open system or sensitive directories as projects', ErrorCode.PATH_SYSTEM_DIR)
      )

      const result = await startHandler({}, '/Users/test/.ssh/keys')

      expect(result).toEqual({
        success: false,
        error: 'System directories cannot be opened as projects'
      })
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })
  })

  describe('valid path acceptance', () => {
    it('should accept valid project path', async () => {
      mockValidateProjectPath.mockResolvedValue(undefined)
      mockGitWatcherServiceStart.mockResolvedValue({ success: true })

      const result = await startHandler({}, '/Users/test/myproject')

      expect(result).toEqual({ success: true })
      expect(mockValidateProjectPath).toHaveBeenCalledWith('/Users/test/myproject')
      expect(mockGitWatcherServiceStart).toHaveBeenCalledWith('/Users/test/myproject')
    })

    it('should accept user home project', async () => {
      mockValidateProjectPath.mockResolvedValue(undefined)
      mockGitWatcherServiceStart.mockResolvedValue({ success: true })

      const result = await startHandler({}, '/Users/test/Projects/app')

      expect(result).toEqual({ success: true })
      expect(mockGitWatcherServiceStart).toHaveBeenCalledWith('/Users/test/Projects/app')
    })

    it('should accept deep project path', async () => {
      mockValidateProjectPath.mockResolvedValue(undefined)
      mockGitWatcherServiceStart.mockResolvedValue({ success: true })

      const result = await startHandler({}, '/Users/test/Projects/team/frontend/app')

      expect(result).toEqual({ success: true })
      expect(mockGitWatcherServiceStart).toHaveBeenCalledWith('/Users/test/Projects/team/frontend/app')
    })

    it('should trim whitespace from valid path', async () => {
      mockValidateProjectPath.mockResolvedValue(undefined)
      mockGitWatcherServiceStart.mockResolvedValue({ success: true })

      const result = await startHandler({}, '  /Users/test/myproject  ')

      expect(result).toEqual({ success: true })
      expect(mockValidateProjectPath).toHaveBeenCalledWith('/Users/test/myproject')
      expect(mockGitWatcherServiceStart).toHaveBeenCalledWith('/Users/test/myproject')
    })
  })

  describe('empty/invalid input handling', () => {
    it('should reject empty string', async () => {
      const result = await startHandler({}, '')

      expect(result).toEqual({
        success: false,
        error: 'Invalid project path'
      })
      expect(mockValidateProjectPath).not.toHaveBeenCalled()
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should reject whitespace-only string', async () => {
      const result = await startHandler({}, '   ')

      expect(result).toEqual({
        success: false,
        error: 'Project path is empty'
      })
      expect(mockValidateProjectPath).not.toHaveBeenCalled()
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should reject null', async () => {
      const result = await startHandler({}, null as unknown as string)

      expect(result).toEqual({
        success: false,
        error: 'Invalid project path'
      })
      expect(mockValidateProjectPath).not.toHaveBeenCalled()
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should reject undefined', async () => {
      const result = await startHandler({}, undefined as unknown as string)

      expect(result).toEqual({
        success: false,
        error: 'Invalid project path'
      })
      expect(mockValidateProjectPath).not.toHaveBeenCalled()
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should reject non-string (number)', async () => {
      const result = await startHandler({}, 123 as unknown as string)

      expect(result).toEqual({
        success: false,
        error: 'Invalid project path'
      })
      expect(mockValidateProjectPath).not.toHaveBeenCalled()
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should reject non-string (object)', async () => {
      const result = await startHandler({}, { path: '/test' } as unknown as string)

      expect(result).toEqual({
        success: false,
        error: 'Invalid project path'
      })
      expect(mockValidateProjectPath).not.toHaveBeenCalled()
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should reject non-string (array)', async () => {
      const result = await startHandler({}, ['/test'] as unknown as string)

      expect(result).toEqual({
        success: false,
        error: 'Invalid project path'
      })
      expect(mockValidateProjectPath).not.toHaveBeenCalled()
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })
  })

  describe('error propagation', () => {
    // Note: All error messages are sanitized for security (Issue #74 review fix)
    // Internal error details are never exposed to the renderer

    it('should return sanitized error for validation failures', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Custom validation error', ErrorCode.PATH_INVALID)
      )

      const result = await startHandler({}, '/test')

      expect(result).toEqual({
        success: false,
        // Sanitized message for PATH_INVALID
        error: 'The selected path is invalid'
      })
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should return sanitized error for non-Error validation failures', async () => {
      mockValidateProjectPath.mockRejectedValue('String error')

      const result = await startHandler({}, '/test')

      expect(result).toEqual({
        success: false,
        // Non-AppError thrown objects are mapped to generic message
        error: 'An unexpected error occurred'
      })
      expect(mockGitWatcherServiceStart).not.toHaveBeenCalled()
    })

    it('should return sanitized error for service failures', async () => {
      mockValidateProjectPath.mockResolvedValue(undefined)
      mockGitWatcherServiceStart.mockRejectedValue(new Error('Service error'))

      const result = await startHandler({}, '/Users/test/project')

      expect(result).toEqual({
        success: false,
        // Generic Error objects are mapped to generic message
        error: 'An unexpected error occurred'
      })
    })

    it('should return sanitized error for non-Error service failures', async () => {
      mockValidateProjectPath.mockResolvedValue(undefined)
      mockGitWatcherServiceStart.mockRejectedValue('Service string error')

      const result = await startHandler({}, '/Users/test/project')

      expect(result).toEqual({
        success: false,
        // Non-Error thrown values are mapped to generic message
        error: 'An unexpected error occurred'
      })
    })
  })
})

describe('git-polling:start security', () => {
  let startPollingHandler: (event: unknown, projectPath: string) => Promise<unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Clear handlers
    Object.keys(handlers).forEach((key) => delete handlers[key])
    // Register handlers
    registerGitWatcherHandlers()
    startPollingHandler = handlers['git-polling:start'] as typeof startPollingHandler
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
  })

  describe('path traversal rejection', () => {
    it('should reject ../../etc/passwd', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Path traversal attack detected', ErrorCode.PATH_TRAVERSAL)
      )

      const result = await startPollingHandler({}, '../../etc/passwd')

      expect(result).toEqual({
        success: false,
        error: 'Invalid path: path traversal detected'
      })
      expect(mockValidateProjectPath).toHaveBeenCalledWith('../../etc/passwd')
      expect(mockGitPollingServiceStart).not.toHaveBeenCalled()
    })

    it('should reject ../../../System', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Path traversal attack detected', ErrorCode.PATH_TRAVERSAL)
      )

      const result = await startPollingHandler({}, '../../../System')

      expect(result).toEqual({
        success: false,
        error: 'Invalid path: path traversal detected'
      })
      expect(mockGitPollingServiceStart).not.toHaveBeenCalled()
    })
  })

  describe('system directory rejection', () => {
    it('should reject /etc', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Cannot open system or sensitive directories as projects', ErrorCode.PATH_SYSTEM_DIR)
      )

      const result = await startPollingHandler({}, '/etc')

      expect(result).toEqual({
        success: false,
        error: 'System directories cannot be opened as projects'
      })
      expect(mockGitPollingServiceStart).not.toHaveBeenCalled()
    })

    it('should reject /System', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Cannot open system or sensitive directories as projects', ErrorCode.PATH_SYSTEM_DIR)
      )

      const result = await startPollingHandler({}, '/System')

      expect(result).toEqual({
        success: false,
        error: 'System directories cannot be opened as projects'
      })
      expect(mockGitPollingServiceStart).not.toHaveBeenCalled()
    })

    it('should reject /usr', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Cannot open system or sensitive directories as projects', ErrorCode.PATH_SYSTEM_DIR)
      )

      const result = await startPollingHandler({}, '/usr')

      expect(result).toEqual({
        success: false,
        error: 'System directories cannot be opened as projects'
      })
      expect(mockGitPollingServiceStart).not.toHaveBeenCalled()
    })
  })

  describe('sensitive user directory rejection', () => {
    it('should reject ~/.ssh', async () => {
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Cannot open system or sensitive directories as projects', ErrorCode.PATH_SYSTEM_DIR)
      )

      const result = await startPollingHandler({}, '/Users/test/.ssh')

      expect(result).toEqual({
        success: false,
        error: 'System directories cannot be opened as projects'
      })
      expect(mockGitPollingServiceStart).not.toHaveBeenCalled()
    })

    it('should reject ~/.aws', async () => {
      // Note: Internal error messages are sanitized for security (Issue #74 review fix)
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Cannot open system or sensitive directories as projects', ErrorCode.PATH_SYSTEM_DIR)
      )

      const result = await startPollingHandler({}, '/Users/test/.aws')

      expect(result).toEqual({
        success: false,
        // Sanitized message for PATH_SYSTEM_DIR
        error: 'System directories cannot be opened as projects'
      })
      expect(mockGitPollingServiceStart).not.toHaveBeenCalled()
    })
  })

  describe('valid path acceptance', () => {
    it('should accept valid project path', async () => {
      mockValidateProjectPath.mockResolvedValue(undefined)

      const result = await startPollingHandler({}, '/Users/test/myproject')

      expect(result).toEqual({ success: true })
      expect(mockValidateProjectPath).toHaveBeenCalledWith('/Users/test/myproject')
      expect(mockGitPollingServiceStart).toHaveBeenCalledWith('/Users/test/myproject')
    })

    it('should trim whitespace from valid path', async () => {
      mockValidateProjectPath.mockResolvedValue(undefined)

      const result = await startPollingHandler({}, '  /Users/test/myproject  ')

      expect(result).toEqual({ success: true })
      expect(mockValidateProjectPath).toHaveBeenCalledWith('/Users/test/myproject')
      expect(mockGitPollingServiceStart).toHaveBeenCalledWith('/Users/test/myproject')
    })
  })

  describe('empty/invalid input handling', () => {
    it('should reject empty string', async () => {
      const result = await startPollingHandler({}, '')

      expect(result).toEqual({
        success: false,
        error: 'Invalid project path'
      })
      expect(mockValidateProjectPath).not.toHaveBeenCalled()
      expect(mockGitPollingServiceStart).not.toHaveBeenCalled()
    })

    it('should reject whitespace-only string', async () => {
      const result = await startPollingHandler({}, '   ')

      expect(result).toEqual({
        success: false,
        error: 'Project path is empty'
      })
      expect(mockValidateProjectPath).not.toHaveBeenCalled()
      expect(mockGitPollingServiceStart).not.toHaveBeenCalled()
    })

    it('should reject null', async () => {
      const result = await startPollingHandler({}, null as unknown as string)

      expect(result).toEqual({
        success: false,
        error: 'Invalid project path'
      })
      expect(mockValidateProjectPath).not.toHaveBeenCalled()
      expect(mockGitPollingServiceStart).not.toHaveBeenCalled()
    })

    it('should reject undefined', async () => {
      const result = await startPollingHandler({}, undefined as unknown as string)

      expect(result).toEqual({
        success: false,
        error: 'Invalid project path'
      })
      expect(mockValidateProjectPath).not.toHaveBeenCalled()
      expect(mockGitPollingServiceStart).not.toHaveBeenCalled()
    })

    it('should reject non-string (number)', async () => {
      const result = await startPollingHandler({}, 123 as unknown as string)

      expect(result).toEqual({
        success: false,
        error: 'Invalid project path'
      })
      expect(mockValidateProjectPath).not.toHaveBeenCalled()
      expect(mockGitPollingServiceStart).not.toHaveBeenCalled()
    })
  })

  describe('error propagation', () => {
    it('should return sanitized error for validation failures', async () => {
      // Note: Internal error messages are sanitized for security (Issue #74 review fix)
      mockValidateProjectPath.mockRejectedValue(
        new AppError('Custom validation error', ErrorCode.PATH_INVALID)
      )

      const result = await startPollingHandler({}, '/test')

      expect(result).toEqual({
        success: false,
        // Sanitized message for PATH_INVALID - no internal details exposed
        error: 'The selected path is invalid'
      })
      expect(mockGitPollingServiceStart).not.toHaveBeenCalled()
    })

    it('should return sanitized error for service failures', async () => {
      // Note: Internal error messages are sanitized for security (Issue #74 review fix)
      mockValidateProjectPath.mockResolvedValue(undefined)
      mockGitPollingServiceStart.mockImplementation(() => {
        throw new Error('Polling service error')
      })

      const result = await startPollingHandler({}, '/Users/test/project')

      expect(result).toEqual({
        success: false,
        // Generic errors are mapped to user-friendly messages
        error: 'An unexpected error occurred'
      })
    })
  })
})
