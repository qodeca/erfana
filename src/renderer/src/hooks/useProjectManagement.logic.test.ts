// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useProjectManagement Pure Logic
 *
 * Tests extracted pure functions without React rendering.
 * All tests are synchronous and deterministic.
 */

import { describe, it, expect } from 'vitest'
import {
  shouldLoadLastProject,
  shouldOpenExternalProject,
  shouldCloseExternalProject,
  shouldRefreshFiles,
  shouldProceedWithStateUpdate,
  createProjectOpenedMessage,
  createProjectClosedMessage,
  createOpenErrorMessage,
  createCloseErrorMessage,
  createLoadErrorMessage,
  formatErrorForState,
  createProjectChangedLogMessage,
  createCallbackWarningMessage,
  createLoadProjectErrorLog,
  createNewProjectTreeErrorLog,
  createRefreshErrorLog,
  createOpenProjectErrorLog,
  createCloseProjectErrorLog,
  shouldMarkInitialLoadComplete,
  extractProjectName,
  formatProjectPath,
  isValidProjectPath,
  isFileOperationError,
  isSafeToInvokeCallback,
  type ProjectChangeData
} from './useProjectManagement.logic'

describe('useProjectManagement.logic', () => {
  describe('shouldLoadLastProject', () => {
    it('should return true when mounted is true', () => {
      expect(shouldLoadLastProject(true)).toBe(true)
    })

    it('should return false when mounted is false', () => {
      expect(shouldLoadLastProject(false)).toBe(false)
    })
  })

  describe('shouldOpenExternalProject', () => {
    it('should return true for valid path', () => {
      expect(shouldOpenExternalProject('/test/project')).toBe(true)
    })

    it('should return false for null', () => {
      expect(shouldOpenExternalProject(null)).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(shouldOpenExternalProject('')).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(shouldOpenExternalProject(undefined as any)).toBe(false)
    })
  })

  describe('shouldCloseExternalProject', () => {
    it('should return true for null path', () => {
      expect(shouldCloseExternalProject(null)).toBe(true)
    })

    it('should return false for valid path', () => {
      expect(shouldCloseExternalProject('/test/project')).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(shouldCloseExternalProject('')).toBe(false)
    })
  })

  describe('shouldRefreshFiles', () => {
    it('should return true for valid project path', () => {
      expect(shouldRefreshFiles('/test/project')).toBe(true)
    })

    it('should return false for null', () => {
      expect(shouldRefreshFiles(null)).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(shouldRefreshFiles('')).toBe(false)
    })
  })

  describe('shouldProceedWithStateUpdate', () => {
    it('should return true when mounted and has lastPath', () => {
      expect(shouldProceedWithStateUpdate(true, '/test/project')).toBe(true)
    })

    it('should return false when not mounted', () => {
      expect(shouldProceedWithStateUpdate(false, '/test/project')).toBe(false)
    })

    it('should return false when lastPath is null', () => {
      expect(shouldProceedWithStateUpdate(true, null)).toBe(false)
    })

    it('should return false when both conditions fail', () => {
      expect(shouldProceedWithStateUpdate(false, null)).toBe(false)
    })
  })

  describe('createProjectOpenedMessage', () => {
    it('should return the path as message', () => {
      expect(createProjectOpenedMessage('/test/project')).toBe('/test/project')
    })

    it('should handle long paths', () => {
      const longPath = '/very/long/path/to/project'
      expect(createProjectOpenedMessage(longPath)).toBe(longPath)
    })
  })

  describe('createProjectClosedMessage', () => {
    it('should return consistent close message', () => {
      expect(createProjectClosedMessage()).toBe('Current project has been closed.')
    })

    it('should return same message on multiple calls', () => {
      expect(createProjectClosedMessage()).toBe(createProjectClosedMessage())
    })
  })

  describe('createOpenErrorMessage', () => {
    it('should extract message from Error object', () => {
      const error = new Error('Failed to open')
      expect(createOpenErrorMessage(error)).toBe('Failed to open')
    })

    it('should convert string error to string', () => {
      expect(createOpenErrorMessage('String error')).toBe('String error')
    })

    it('should convert other types to string', () => {
      expect(createOpenErrorMessage(42)).toBe('42')
      expect(createOpenErrorMessage({ code: 'ERR' })).toContain('object')
    })
  })

  describe('createCloseErrorMessage', () => {
    it('should extract message from Error object', () => {
      const error = new Error('Failed to close')
      expect(createCloseErrorMessage(error)).toBe('Failed to close')
    })

    it('should convert non-Error to string', () => {
      expect(createCloseErrorMessage('Error text')).toBe('Error text')
    })
  })

  describe('createLoadErrorMessage', () => {
    it('should extract message from Error object', () => {
      const error = new Error('ENOENT: file not found')
      expect(createLoadErrorMessage(error)).toBe('ENOENT: file not found')
    })

    it('should return default message for non-Error', () => {
      expect(createLoadErrorMessage('some error')).toBe('Failed to load project')
    })

    it('should return default message for null', () => {
      expect(createLoadErrorMessage(null)).toBe('Failed to load project')
    })
  })

  describe('formatErrorForState', () => {
    it('should extract message from Error object', () => {
      const error = new Error('State error')
      expect(formatErrorForState(error)).toBe('State error')
    })

    it('should return string error as-is', () => {
      expect(formatErrorForState('Direct error')).toBe('Direct error')
    })

    it('should return default for unknown types', () => {
      expect(formatErrorForState(42)).toBe('An unknown error occurred')
      expect(formatErrorForState(null)).toBe('An unknown error occurred')
      expect(formatErrorForState(undefined)).toBe('An unknown error occurred')
    })
  })

  describe('createProjectChangedLogMessage', () => {
    it('should format project change data', () => {
      const data: ProjectChangeData = { oldPath: '/old', newPath: '/new' }
      const message = createProjectChangedLogMessage(data)
      expect(message).toContain('🌳 useProjectManagement: Project changed:')
      expect(message).toContain('oldPath')
      expect(message).toContain('newPath')
    })

    it('should handle null paths', () => {
      const data: ProjectChangeData = { oldPath: null, newPath: null }
      const message = createProjectChangedLogMessage(data)
      expect(message).toContain('null')
    })
  })

  describe('createCallbackWarningMessage', () => {
    it('should format callback error warning', () => {
      const message = createCallbackWarningMessage(new Error('Callback failed'))
      expect(message).toContain('onProjectChanged callback threw:')
      expect(message).toContain('Error')
    })
  })

  describe('Error log messages', () => {
    it('createLoadProjectErrorLog should return consistent message', () => {
      expect(createLoadProjectErrorLog()).toBe('Error loading last project:')
    })

    it('createNewProjectTreeErrorLog should return consistent message', () => {
      expect(createNewProjectTreeErrorLog()).toBe('Error loading new project tree:')
    })

    it('createRefreshErrorLog should return consistent message', () => {
      expect(createRefreshErrorLog()).toBe('Error refreshing file tree:')
    })

    it('createOpenProjectErrorLog should return consistent message', () => {
      expect(createOpenProjectErrorLog()).toBe('Error opening project:')
    })

    it('createCloseProjectErrorLog should return consistent message', () => {
      expect(createCloseProjectErrorLog()).toBe('Error closing project:')
    })
  })

  describe('shouldMarkInitialLoadComplete', () => {
    it('should return true when lastPath and fileTree are valid', () => {
      expect(shouldMarkInitialLoadComplete('/test/project', [])).toBe(true)
      expect(shouldMarkInitialLoadComplete('/test/project', [{ name: 'file' }])).toBe(true)
    })

    it('should return false when lastPath is null', () => {
      expect(shouldMarkInitialLoadComplete(null, [])).toBe(false)
    })

    it('should return false when fileTree is null', () => {
      expect(shouldMarkInitialLoadComplete('/test/project', null as any)).toBe(false)
    })

    it('should return false when fileTree is undefined', () => {
      expect(shouldMarkInitialLoadComplete('/test/project', undefined as any)).toBe(false)
    })
  })

  describe('extractProjectName', () => {
    it('should extract name from Unix path', () => {
      expect(extractProjectName('/home/user/project')).toBe('project')
    })

    it('should extract name from Windows path', () => {
      expect(extractProjectName('C:\\Users\\user\\project')).toBe('project')
    })

    it('should extract name from mixed path', () => {
      expect(extractProjectName('/home/user\\project')).toBe('project')
    })

    it('should handle single segment path', () => {
      expect(extractProjectName('project')).toBe('project')
    })

    it('should handle empty path', () => {
      expect(extractProjectName('')).toBe('')
    })

    it('should handle path with trailing slash', () => {
      expect(extractProjectName('/home/user/project/')).toBe('project')
    })
  })

  describe('formatProjectPath', () => {
    it('should return path as-is if shorter than maxLength', () => {
      expect(formatProjectPath('/short/path', 50)).toBe('/short/path')
    })

    it('should truncate long path with ellipsis', () => {
      const longPath = '/very/long/path/to/some/deeply/nested/project/folder'
      const formatted = formatProjectPath(longPath, 30)
      expect(formatted).toContain('...')
      expect(formatted.length).toBeLessThanOrEqual(30 + 3) // +3 for ellipsis
    })

    it('should use default maxLength of 50', () => {
      const path = 'a'.repeat(60)
      const formatted = formatProjectPath(path)
      expect(formatted).toContain('...')
    })

    it('should preserve start and end of path', () => {
      const path = '/start/middle/end'
      const formatted = formatProjectPath(path, 10)
      expect(formatted).toContain('...')
      expect(formatted.startsWith('/st')).toBe(true)
      expect(formatted.endsWith('end')).toBe(true)
    })
  })

  describe('isValidProjectPath', () => {
    it('should return true for valid paths', () => {
      expect(isValidProjectPath('/test/project')).toBe(true)
      expect(isValidProjectPath('C:\\project')).toBe(true)
      expect(isValidProjectPath('project')).toBe(true)
    })

    it('should return false for null', () => {
      expect(isValidProjectPath(null)).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isValidProjectPath(undefined as any)).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isValidProjectPath('')).toBe(false)
    })
  })

  describe('isFileOperationError', () => {
    it('should detect ENOENT errors', () => {
      const error = new Error('ENOENT: no such file or directory')
      expect(isFileOperationError(error)).toBe(true)
    })

    it('should detect EACCES errors', () => {
      const error = new Error('EACCES: permission denied')
      expect(isFileOperationError(error)).toBe(true)
    })

    it('should detect EPERM errors', () => {
      const error = new Error('EPERM: operation not permitted')
      expect(isFileOperationError(error)).toBe(true)
    })

    it('should detect file-related errors', () => {
      const error = new Error('File not found')
      expect(isFileOperationError(error)).toBe(true)
    })

    it('should detect directory-related errors', () => {
      const error = new Error('Directory does not exist')
      expect(isFileOperationError(error)).toBe(true)
    })

    it('should return false for non-file errors', () => {
      const error = new Error('Network timeout')
      expect(isFileOperationError(error)).toBe(false)
    })

    it('should return false for non-Error types', () => {
      expect(isFileOperationError('string error')).toBe(false)
      expect(isFileOperationError(null)).toBe(false)
    })
  })

  describe('isSafeToInvokeCallback', () => {
    it('should return true for function', () => {
      expect(isSafeToInvokeCallback(() => {})).toBe(true)
      expect(isSafeToInvokeCallback(function () {})).toBe(true)
    })

    it('should return false for non-function', () => {
      expect(isSafeToInvokeCallback(null)).toBe(false)
      expect(isSafeToInvokeCallback(undefined)).toBe(false)
      expect(isSafeToInvokeCallback('string')).toBe(false)
      expect(isSafeToInvokeCallback(42)).toBe(false)
      expect(isSafeToInvokeCallback({})).toBe(false)
    })
  })

  describe('Integration scenarios', () => {
    it('should handle complete open flow logic', () => {
      const path = '/home/user/my-project'

      // Guard checks
      expect(isValidProjectPath(path)).toBe(true)

      // Success message
      const message = createProjectOpenedMessage(path)
      expect(message).toBe(path)

      // Extract name for display
      const name = extractProjectName(path)
      expect(name).toBe('my-project')
    })

    it('should handle complete close flow logic', () => {
      const currentPath = '/test/project'

      // Validation
      expect(shouldRefreshFiles(currentPath)).toBe(true)

      // After close
      expect(shouldCloseExternalProject(null)).toBe(true)
      expect(shouldRefreshFiles(null)).toBe(false)

      // Message
      const message = createProjectClosedMessage()
      expect(message).toContain('closed')
    })

    it('should handle external project change flow', () => {
      const data: ProjectChangeData = {
        oldPath: '/old/project',
        newPath: '/new/project'
      }

      // Log the change
      const logMessage = createProjectChangedLogMessage(data)
      expect(logMessage).toContain('Project changed')

      // Determine action
      expect(shouldOpenExternalProject(data.newPath)).toBe(true)
      expect(shouldCloseExternalProject(data.newPath)).toBe(false)

      // Extract new project name
      const newName = extractProjectName(data.newPath!)
      expect(newName).toBe('project')
    })

    it('should handle error scenarios correctly', () => {
      const fsError = new Error('ENOENT: file not found')

      // Detect error type
      expect(isFileOperationError(fsError)).toBe(true)

      // Format for different contexts
      const stateError = formatErrorForState(fsError)
      const openError = createOpenErrorMessage(fsError)
      const loadError = createLoadErrorMessage(fsError)

      expect(stateError).toBe('ENOENT: file not found')
      expect(openError).toBe('ENOENT: file not found')
      expect(loadError).toBe('ENOENT: file not found')
    })

    it('should validate callback safety before invocation', () => {
      const validCallback = () => console.log('test')
      const invalidCallback = null

      expect(isSafeToInvokeCallback(validCallback)).toBe(true)
      expect(isSafeToInvokeCallback(invalidCallback)).toBe(false)

      // Safe pattern:
      if (isSafeToInvokeCallback(validCallback)) {
        // Can safely call validCallback
      }
    })
  })
})
