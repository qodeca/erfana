// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * External File Handlers Tests
 *
 * Tests for IPC handlers that expose external file drop functionality to renderer.
 * Covers Spec #012: External File Drop to Project Tree
 *
 * Test coverage:
 * - file:validateExternal - validation handler
 * - file:copyFromExternal - copy handler
 * - file:moveFromExternal - move handler
 * - file:selectExternalFiles - file picker handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ipcMain, dialog } from 'electron'
import { ErrorCode } from '../../shared/errors'

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  },
  dialog: {
    showOpenDialog: vi.fn()
  }
}))

// Mock ExternalFileService
const mockValidateExternalFile = vi.fn()
const mockCopyFromExternal = vi.fn()
const mockMoveFromExternal = vi.fn()

vi.mock('../services/ExternalFileService', () => ({
  externalFileService: {
    validateExternalFile: mockValidateExternalFile,
    copyFromExternal: mockCopyFromExternal,
    moveFromExternal: mockMoveFromExternal
  }
}))

// Mock LoggingService
vi.mock('../services/LoggingService', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

type IpcHandler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

describe('External File Handlers', () => {
  let handlers: Map<string, IpcHandler>

  beforeEach(async () => {
    // Reset mocks
    vi.resetAllMocks()

    // Capture IPC handlers
    handlers = new Map()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    })

    // Import and call registration function
    const module = await import('./external-file-handlers')
    module.registerExternalFileHandlers()
  })

  afterEach(() => {
    vi.resetModules()
  })

  describe('file:validateExternal', () => {
    it('returns validation result from service', async () => {
      const handler = handlers.get('file:validateExternal')
      expect(handler).toBeDefined()

      const mockResponse = {
        valid: true,
        isSymlink: false,
        isDirectory: false,
        exists: true,
        isRegularFile: true
      }
      mockValidateExternalFile.mockResolvedValueOnce(mockResponse)

      const result = await handler!(
        {} as any,
        '/external/file.md',
        '/project'
      )

      expect(result).toEqual(mockResponse)
      expect(mockValidateExternalFile).toHaveBeenCalledWith('/external/file.md', '/project')
    })

    it('handles service errors', async () => {
      const handler = handlers.get('file:validateExternal')

      mockValidateExternalFile.mockRejectedValueOnce(new Error('Validation failed'))

      const result = await handler!(
        {} as any,
        '/external/file.md',
        '/project'
      )

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Validation failed')
      expect(result.errorCode).toBe('UNKNOWN_ERROR')
    })

    it('validates input schema - rejects non-absolute paths', async () => {
      const handler = handlers.get('file:validateExternal')

      const result = await handler!(
        {} as any,
        'relative/path/file.md',
        '/project'
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Path must be absolute')
      expect(result.errorCode).toBe('VALIDATION_ERROR')
      expect(mockValidateExternalFile).not.toHaveBeenCalled()
    })

    it('validates input schema - rejects empty paths', async () => {
      const handler = handlers.get('file:validateExternal')

      const result = await handler!(
        {} as any,
        '',
        '/project'
      )

      expect(result.valid).toBe(false)
      expect(result.errorCode).toBe('VALIDATION_ERROR')
      expect(mockValidateExternalFile).not.toHaveBeenCalled()
    })
  })

  describe('file:copyFromExternal', () => {
    it('delegates to service', async () => {
      const handler = handlers.get('file:copyFromExternal')
      expect(handler).toBeDefined()

      const mockResponse = {
        success: true,
        path: '/project/docs/file.md',
        isSymlink: false
      }
      mockCopyFromExternal.mockResolvedValueOnce(mockResponse)

      const result = await handler!(
        {} as any,
        '/external/file.md',
        '/project/docs',
        '/project',
        'keepBoth'
      )

      expect(result).toEqual(mockResponse)
      expect(mockCopyFromExternal).toHaveBeenCalledWith(
        '/external/file.md',
        '/project/docs',
        '/project',
        'keepBoth'
      )
    })

    it('returns success response', async () => {
      const handler = handlers.get('file:copyFromExternal')

      mockCopyFromExternal.mockResolvedValueOnce({
        success: true,
        path: '/project/file.md',
        isSymlink: false
      })

      const result = await handler!(
        {} as any,
        '/external/file.md',
        '/project',
        '/project'
      )

      expect(result.success).toBe(true)
      expect(result.path).toBe('/project/file.md')
    })

    it('returns error for invalid files', async () => {
      const handler = handlers.get('file:copyFromExternal')

      mockCopyFromExternal.mockResolvedValueOnce({
        success: false,
        error: 'File is a directory',
        errorCode: ErrorCode.EXTERNAL_FILE_IS_DIRECTORY
      })

      const result = await handler!(
        {} as any,
        '/external/folder',
        '/project',
        '/project'
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('File is a directory')
      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_IS_DIRECTORY)
    })

    it('handles service errors', async () => {
      const handler = handlers.get('file:copyFromExternal')

      mockCopyFromExternal.mockRejectedValueOnce(new Error('Copy failed'))

      const result = await handler!(
        {} as any,
        '/external/file.md',
        '/project',
        '/project'
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Copy failed')
      expect(result.errorCode).toBe('UNKNOWN_ERROR')
    })

    it('validates input schema - rejects non-absolute paths', async () => {
      const handler = handlers.get('file:copyFromExternal')

      const result = await handler!(
        {} as any,
        'relative/path.md',
        '/project',
        '/project'
      )

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('VALIDATION_ERROR')
      expect(mockCopyFromExternal).not.toHaveBeenCalled()
    })

    it('validates input schema - accepts valid conflict resolution', async () => {
      const handler = handlers.get('file:copyFromExternal')

      mockCopyFromExternal.mockResolvedValueOnce({
        success: true,
        path: '/project/file.md'
      })

      await handler!(
        {} as any,
        '/external/file.md',
        '/project',
        '/project',
        'replace'
      )

      expect(mockCopyFromExternal).toHaveBeenCalledWith(
        '/external/file.md',
        '/project',
        '/project',
        'replace'
      )
    })

    it('validates input schema - rejects invalid conflict resolution', async () => {
      const handler = handlers.get('file:copyFromExternal')

      const result = await handler!(
        {} as any,
        '/external/file.md',
        '/project',
        '/project',
        'invalid' as any
      )

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('VALIDATION_ERROR')
      expect(mockCopyFromExternal).not.toHaveBeenCalled()
    })
  })

  describe('file:moveFromExternal', () => {
    it('delegates to service', async () => {
      const handler = handlers.get('file:moveFromExternal')
      expect(handler).toBeDefined()

      const mockResponse = {
        success: true,
        path: '/project/docs/file.md',
        isSymlink: false
      }
      mockMoveFromExternal.mockResolvedValueOnce(mockResponse)

      const result = await handler!(
        {} as any,
        '/external/file.md',
        '/project/docs',
        '/project',
        'keepBoth'
      )

      expect(result).toEqual(mockResponse)
      expect(mockMoveFromExternal).toHaveBeenCalledWith(
        '/external/file.md',
        '/project/docs',
        '/project',
        'keepBoth'
      )
    })

    it('returns success response', async () => {
      const handler = handlers.get('file:moveFromExternal')

      mockMoveFromExternal.mockResolvedValueOnce({
        success: true,
        path: '/project/file.md',
        isSymlink: false
      })

      const result = await handler!(
        {} as any,
        '/external/file.md',
        '/project',
        '/project'
      )

      expect(result.success).toBe(true)
      expect(result.path).toBe('/project/file.md')
    })

    it('returns error for invalid files', async () => {
      const handler = handlers.get('file:moveFromExternal')

      mockMoveFromExternal.mockResolvedValueOnce({
        success: false,
        error: 'File not found',
        errorCode: ErrorCode.EXTERNAL_FILE_NOT_FOUND
      })

      const result = await handler!(
        {} as any,
        '/external/nonexistent.md',
        '/project',
        '/project'
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('File not found')
      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_NOT_FOUND)
    })

    it('handles service errors', async () => {
      const handler = handlers.get('file:moveFromExternal')

      mockMoveFromExternal.mockRejectedValueOnce(new Error('Move failed'))

      const result = await handler!(
        {} as any,
        '/external/file.md',
        '/project',
        '/project'
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Move failed')
      expect(result.errorCode).toBe('UNKNOWN_ERROR')
    })

    it('validates input schema - rejects non-absolute paths', async () => {
      const handler = handlers.get('file:moveFromExternal')

      const result = await handler!(
        {} as any,
        '/external/file.md',
        'relative/target',
        '/project'
      )

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('VALIDATION_ERROR')
      expect(mockMoveFromExternal).not.toHaveBeenCalled()
    })
  })

  describe('file:selectExternalFiles', () => {
    it('opens dialog and returns file paths', async () => {
      const handler = handlers.get('file:selectExternalFiles')
      expect(handler).toBeDefined()

      ;(dialog.showOpenDialog as any).mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/external/file1.md', '/external/file2.md']
      })

      const result = await handler!({} as any)

      expect(result).toEqual({
        paths: ['/external/file1.md', '/external/file2.md']
      })
      expect(dialog.showOpenDialog).toHaveBeenCalledWith({
        properties: ['openFile', 'multiSelections'],
        title: 'Select files to add',
        buttonLabel: 'Add to project'
      })
    })

    it('returns null when cancelled', async () => {
      const handler = handlers.get('file:selectExternalFiles')

      ;(dialog.showOpenDialog as any).mockResolvedValueOnce({
        canceled: true,
        filePaths: []
      })

      const result = await handler!({} as any)

      expect(result).toBeNull()
    })

    it('returns null when no files selected', async () => {
      const handler = handlers.get('file:selectExternalFiles')

      ;(dialog.showOpenDialog as any).mockResolvedValueOnce({
        canceled: false,
        filePaths: []
      })

      const result = await handler!({} as any)

      expect(result).toBeNull()
    })

    it('handles dialog errors', async () => {
      const handler = handlers.get('file:selectExternalFiles')

      ;(dialog.showOpenDialog as any).mockRejectedValueOnce(new Error('Dialog error'))

      await expect(handler!({} as any)).rejects.toThrow('Failed to open file picker')
    })
  })

  describe('handler registration', () => {
    it('registers all required handlers', () => {
      expect(handlers.has('file:validateExternal')).toBe(true)
      expect(handlers.has('file:copyFromExternal')).toBe(true)
      expect(handlers.has('file:moveFromExternal')).toBe(true)
      expect(handlers.has('file:selectExternalFiles')).toBe(true)
    })

    it('registers handlers once', () => {
      const handleCallCount = (ipcMain.handle as any).mock.calls.length
      expect(handleCallCount).toBeGreaterThanOrEqual(4)
    })
  })
})
