// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useFileOperations Pure Logic
 *
 * Tests extracted pure functions without React rendering.
 * All tests are synchronous and deterministic.
 */

import { describe, it, expect } from 'vitest'
import type { FileNode } from '../interfaces/IProjectTreeApi'
import {
  getTargetPath,
  isValidTargetPath,
  getRelativePath,
  extractParentPath,
  getSiblingNames,
  createDeleteFileMessage,
  createDeleteFolderMessage,
  createRenameSuccessMessage,
  stripIpcErrorPrefix,
  isAlreadyExistsError,
  isInvalidFilenameError,
  formatCreateFileError,
  formatCreateFolderError,
  formatDeleteError,
  isPermissionError,
  isDiskSpaceError,
  isNotFoundError,
  createFileCreationErrorLog,
  createFolderCreationErrorLog,
  createFileDeletionErrorLog,
  createFolderDeletionErrorLog,
  createRenameErrorLog,
  buildChildPath,
  requiresConfirmation,
  getOperationTitle
} from './useFileOperations.logic'

describe('useFileOperations.logic', () => {
  describe('getTargetPath', () => {
    it('should return selectedFolder when available', () => {
      expect(getTargetPath('/project/subfolder', '/project')).toBe('/project/subfolder')
    })

    it('should return projectPath when selectedFolder is null', () => {
      expect(getTargetPath(null, '/project')).toBe('/project')
    })

    it('should return projectPath when selectedFolder is empty', () => {
      expect(getTargetPath('', '/project')).toBe('/project')
    })

    it('should return null when both are null', () => {
      expect(getTargetPath(null, null)).toBe(null)
    })

    it('should prioritize selectedFolder over projectPath', () => {
      expect(getTargetPath('/project/a', '/project/b')).toBe('/project/a')
    })
  })

  describe('isValidTargetPath', () => {
    it('should return true for valid path', () => {
      expect(isValidTargetPath('/project')).toBe(true)
    })

    it('should return false for null', () => {
      expect(isValidTargetPath(null)).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isValidTargetPath('')).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isValidTargetPath(undefined as any)).toBe(false)
    })
  })

  describe('getRelativePath', () => {
    it('should return relative path when projectPath exists', () => {
      expect(getRelativePath('/project/subfolder', '/project')).toBe('/subfolder')
    })

    it('should return / when at project root', () => {
      expect(getRelativePath('/project', '/project')).toBe('/')
    })

    it('should return full path when projectPath is null', () => {
      expect(getRelativePath('/project/subfolder', null)).toBe('/project/subfolder')
    })

    it('should handle nested paths', () => {
      expect(getRelativePath('/project/a/b/c', '/project')).toBe('/a/b/c')
    })
  })

  describe('extractParentPath', () => {
    it('should extract parent from nested path', () => {
      expect(extractParentPath('/project/folder/file.txt')).toBe('/project/folder')
    })

    it('should return / for root-level items', () => {
      expect(extractParentPath('/file.txt')).toBe('/')
    })

    it('should handle multiple levels', () => {
      expect(extractParentPath('/a/b/c/d.txt')).toBe('/a/b/c')
    })

    it('should handle single-level path', () => {
      expect(extractParentPath('/project')).toBe('/')
    })

    it('should extract parent from a Windows backslash path', () => {
      expect(extractParentPath('C:\\a\\b\\c.md')).toBe('C:\\a\\b')
    })
  })

  describe('getSiblingNames', () => {
    const mockFiles: FileNode[] = [
      { name: 'file1.txt', path: '/project/file1.txt', type: 'file', size: 0, modified: 0 },
      { name: 'file2.txt', path: '/project/file2.txt', type: 'file', size: 0, modified: 0 },
      { name: 'folder1', path: '/project/folder1', type: 'directory', size: 0, modified: 0 },
      {
        name: 'nested.txt',
        path: '/project/folder1/nested.txt',
        type: 'file',
        size: 0,
        modified: 0
      }
    ]

    it('should return sibling names excluding current item', () => {
      const siblings = getSiblingNames(mockFiles, '/project/file1.txt', 'file1.txt')
      expect(siblings).toContain('file2.txt')
      expect(siblings).toContain('folder1')
      expect(siblings).not.toContain('file1.txt')
      expect(siblings).not.toContain('nested.txt')
    })

    it('should return empty array when no siblings', () => {
      const siblings = getSiblingNames(mockFiles, '/project/folder1/nested.txt', 'nested.txt')
      expect(siblings).toEqual([])
    })

    it('should only return siblings from same parent', () => {
      const siblings = getSiblingNames(mockFiles, '/project/file2.txt', 'file2.txt')
      expect(siblings).toHaveLength(2) // file1.txt and folder1
      expect(siblings).not.toContain('nested.txt')
    })

    it('should group root-level siblings together', () => {
      const rootFiles: FileNode[] = [
        { name: 'c.md', path: '/c.md', type: 'file', size: 0, modified: 0 },
        { name: 'd.md', path: '/d.md', type: 'file', size: 0, modified: 0 },
        { name: 'nested.md', path: '/sub/nested.md', type: 'file', size: 0, modified: 0 }
      ]
      const siblings = getSiblingNames(rootFiles, '/c.md', 'c.md')
      expect(siblings).toEqual(['d.md'])
      expect(siblings).not.toContain('nested.md')
    })
  })

  describe('createDeleteFileMessage', () => {
    it('should create proper delete file message', () => {
      expect(createDeleteFileMessage('test.txt')).toBe(
        'Are you sure you want to delete "test.txt"? This action cannot be undone.'
      )
    })

    it('should handle long file names', () => {
      const message = createDeleteFileMessage('very-long-file-name-here.txt')
      expect(message).toContain('very-long-file-name-here.txt')
      expect(message).toContain('cannot be undone')
    })
  })

  describe('createDeleteFolderMessage', () => {
    it('should create proper delete folder message', () => {
      expect(createDeleteFolderMessage('myfolder')).toBe(
        'Are you sure you want to delete "myfolder" and all its contents? This action cannot be undone.'
      )
    })

    it('should mention "all its contents"', () => {
      const message = createDeleteFolderMessage('test')
      expect(message).toContain('all its contents')
    })
  })

  describe('createRenameSuccessMessage', () => {
    it('should return consistent success message', () => {
      expect(createRenameSuccessMessage()).toBe('Item renamed successfully')
    })
  })

  describe('stripIpcErrorPrefix', () => {
    it('should strip IPC error prefix', () => {
      const message =
        'Error invoking remote method "file:createFile": Error: File already exists'
      expect(stripIpcErrorPrefix(message)).toBe('File already exists')
    })

    it('should return original message if no prefix', () => {
      const message = 'Simple error message'
      expect(stripIpcErrorPrefix(message)).toBe('Simple error message')
    })

    it('should handle various IPC prefixes', () => {
      const message = 'Error invoking remote method "anything": Error: Real error'
      expect(stripIpcErrorPrefix(message)).toBe('Real error')
    })
  })

  describe('isAlreadyExistsError', () => {
    it('should detect "already exists" error', () => {
      expect(isAlreadyExistsError('File already exists')).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isAlreadyExistsError('Permission denied')).toBe(false)
    })

    it('should be case-sensitive', () => {
      expect(isAlreadyExistsError('Already Exists')).toBe(false)
      expect(isAlreadyExistsError('file already exists')).toBe(true)
    })
  })

  describe('isInvalidFilenameError (#161)', () => {
    it('detects the canonical phrase from main-process AppError', () => {
      expect(
        isInvalidFilenameError('"CON.md" is not a valid filename — try "_CON.md"'),
      ).toBe(true)
    })

    it('returns false for unrelated errors', () => {
      expect(isInvalidFilenameError('Permission denied')).toBe(false)
      expect(isInvalidFilenameError('File already exists')).toBe(false)
    })

    it('detects the phrase even after IPC prefix stripping', () => {
      const raw = 'Error invoking remote method \'file:createFile\': Error: "CON.md" is not a valid filename — try "_CON.md"'
      const stripped = stripIpcErrorPrefix(raw)
      expect(isInvalidFilenameError(stripped)).toBe(true)
    })
  })

  describe('formatCreateFileError #161 invalid-filename branch', () => {
    it('surfaces the structured AppError message verbatim for reserved names', () => {
      const error = new Error('Error invoking remote method: Error: "CON.md" is not a valid filename — try "_CON.md"')
      expect(formatCreateFileError(error)).toBe('"CON.md" is not a valid filename — try "_CON.md"')
    })

    it('surfaces the structured message for forbidden characters', () => {
      const error = new Error('Error invoking remote method: Error: "foo:bar" is not a valid filename — remove the characters < > : " / \\ | ? *')
      expect(formatCreateFileError(error)).toContain('"foo:bar" is not a valid filename')
    })
  })

  describe('formatCreateFolderError #161 invalid-filename branch', () => {
    it('surfaces the structured AppError message verbatim for reserved names', () => {
      const error = new Error('Error invoking remote method: Error: "PRN" is not a valid filename — try "_PRN"')
      expect(formatCreateFolderError(error)).toBe('"PRN" is not a valid filename — try "_PRN"')
    })
  })

  describe('formatCreateFileError', () => {
    it('should format Error object with IPC prefix', () => {
      const error = new Error('Error invoking remote method: Error: File already exists')
      expect(formatCreateFileError(error)).toBe('A file with this name already exists')
    })

    it('should format already exists error', () => {
      const error = new Error('File already exists')
      expect(formatCreateFileError(error)).toBe('A file with this name already exists')
    })

    it('should return cleaned message for other errors', () => {
      const error = new Error('Permission denied')
      expect(formatCreateFileError(error)).toBe('Permission denied')
    })

    it('should return default for non-Error types', () => {
      expect(formatCreateFileError('string error')).toBe('Failed to create file')
      expect(formatCreateFileError(null)).toBe('Failed to create file')
    })
  })

  describe('formatCreateFolderError', () => {
    it('should format Error object with IPC prefix', () => {
      const error = new Error('Error invoking remote method: Error: Folder already exists')
      expect(formatCreateFolderError(error)).toBe('A folder with this name already exists')
    })

    it('should format already exists error', () => {
      const error = new Error('Folder already exists')
      expect(formatCreateFolderError(error)).toBe('A folder with this name already exists')
    })

    it('should return cleaned message for other errors', () => {
      const error = new Error('Permission denied')
      expect(formatCreateFolderError(error)).toBe('Permission denied')
    })

    it('should return default for non-Error types', () => {
      expect(formatCreateFolderError('string error')).toBe('Failed to create folder')
    })
  })

  describe('formatDeleteError', () => {
    it('should extract message from Error for file', () => {
      const error = new Error('Permission denied')
      expect(formatDeleteError(error, 'file')).toBe('Permission denied')
    })

    it('should extract message from Error for folder', () => {
      const error = new Error('Folder in use')
      expect(formatDeleteError(error, 'folder')).toBe('Folder in use')
    })

    it('should return default for non-Error file', () => {
      expect(formatDeleteError('error', 'file')).toBe('Failed to delete file')
    })

    it('should return default for non-Error folder', () => {
      expect(formatDeleteError(null, 'folder')).toBe('Failed to delete folder')
    })
  })

  describe('isPermissionError', () => {
    it('should detect EACCES error', () => {
      const error = new Error('EACCES: permission denied')
      expect(isPermissionError(error)).toBe(true)
    })

    it('should detect EPERM error', () => {
      const error = new Error('EPERM: operation not permitted')
      expect(isPermissionError(error)).toBe(true)
    })

    it('should detect permission keyword', () => {
      const error = new Error('Permission denied by administrator')
      expect(isPermissionError(error)).toBe(true)
    })

    it('should return false for other errors', () => {
      const error = new Error('File not found')
      expect(isPermissionError(error)).toBe(false)
    })

    it('should return false for non-Error', () => {
      expect(isPermissionError('permission')).toBe(false)
    })
  })

  describe('isDiskSpaceError', () => {
    it('should detect ENOSPC error', () => {
      const error = new Error('ENOSPC: no space left on device')
      expect(isDiskSpaceError(error)).toBe(true)
    })

    it('should detect "no space" keyword', () => {
      const error = new Error('Disk has no space available')
      expect(isDiskSpaceError(error)).toBe(true)
    })

    it('should return false for other errors', () => {
      const error = new Error('File not found')
      expect(isDiskSpaceError(error)).toBe(false)
    })

    it('should return false for non-Error', () => {
      expect(isDiskSpaceError('no space')).toBe(false)
    })
  })

  describe('isNotFoundError', () => {
    it('should detect ENOENT error', () => {
      const error = new Error('ENOENT: no such file or directory')
      expect(isNotFoundError(error)).toBe(true)
    })

    it('should detect "not found" keyword', () => {
      const error = new Error('File not found')
      expect(isNotFoundError(error)).toBe(true)
    })

    it('should return false for other errors', () => {
      const error = new Error('Permission denied')
      expect(isNotFoundError(error)).toBe(false)
    })

    it('should return false for non-Error', () => {
      expect(isNotFoundError('not found')).toBe(false)
    })
  })

  describe('Error log messages', () => {
    it('createFileCreationErrorLog should return consistent message', () => {
      expect(createFileCreationErrorLog()).toBe('Error creating file:')
    })

    it('createFolderCreationErrorLog should return consistent message', () => {
      expect(createFolderCreationErrorLog()).toBe('Error creating folder:')
    })

    it('createFileDeletionErrorLog should return consistent message', () => {
      expect(createFileDeletionErrorLog()).toBe('Error deleting file:')
    })

    it('createFolderDeletionErrorLog should return consistent message', () => {
      expect(createFolderDeletionErrorLog()).toBe('Error deleting folder:')
    })

    it('createRenameErrorLog should return consistent message', () => {
      expect(createRenameErrorLog()).toBe('Error renaming item:')
    })
  })

  describe('buildChildPath', () => {
    it('should build path from normal parent', () => {
      expect(buildChildPath('/project/folder', 'file.txt')).toBe('/project/folder/file.txt')
    })

    it('should handle root parent', () => {
      expect(buildChildPath('/', 'file.txt')).toBe('/file.txt')
    })

    it('should handle parent with trailing slash', () => {
      expect(buildChildPath('/project/folder/', 'file.txt')).toBe('/project/folder/file.txt')
    })

    it('should build nested paths correctly', () => {
      expect(buildChildPath('/a/b/c', 'd')).toBe('/a/b/c/d')
    })
  })

  describe('requiresConfirmation', () => {
    it('should require confirmation for delete', () => {
      expect(requiresConfirmation('delete')).toBe(true)
    })

    it('should not require confirmation for create', () => {
      expect(requiresConfirmation('create')).toBe(false)
    })

    it('should not require confirmation for rename', () => {
      expect(requiresConfirmation('rename')).toBe(false)
    })
  })

  describe('getOperationTitle', () => {
    it('should create title for create file', () => {
      expect(getOperationTitle('create', 'file')).toBe('Create New File')
    })

    it('should create title for create folder', () => {
      expect(getOperationTitle('create', 'folder')).toBe('Create New Folder')
    })

    it('should create title for rename file', () => {
      expect(getOperationTitle('rename', 'file')).toBe('Rename File')
    })

    it('should create title for rename folder', () => {
      expect(getOperationTitle('rename', 'folder')).toBe('Rename Folder')
    })

    it('should create title for delete file', () => {
      expect(getOperationTitle('delete', 'file')).toBe('Delete File')
    })

    it('should create title for delete folder', () => {
      expect(getOperationTitle('delete', 'folder')).toBe('Delete Folder')
    })
  })

  describe('Integration scenarios', () => {
    it('should handle complete file creation flow logic', () => {
      const selectedFolder = '/project/subfolder'
      const projectPath = '/project'

      // Get target path
      const targetPath = getTargetPath(selectedFolder, projectPath)
      expect(targetPath).toBe('/project/subfolder')

      // Validate
      expect(isValidTargetPath(targetPath)).toBe(true)

      // Get relative path for display
      const relativePath = getRelativePath(targetPath, projectPath)
      expect(relativePath).toBe('/subfolder')

      // Simulate error
      const error = new Error('File already exists')
      const errorMessage = formatCreateFileError(error)
      expect(errorMessage).toBe('A file with this name already exists')
    })

    it('should handle complete deletion flow logic', () => {
      const fileName = 'test.txt'

      // Create confirmation message
      const confirmMessage = createDeleteFileMessage(fileName)
      expect(confirmMessage).toContain(fileName)
      expect(confirmMessage).toContain('cannot be undone')

      // Check if requires confirmation
      expect(requiresConfirmation('delete')).toBe(true)

      // Simulate error
      const error = new Error('EACCES: permission denied')
      expect(isPermissionError(error)).toBe(true)
      const errorMessage = formatDeleteError(error, 'file')
      expect(errorMessage).toBe('EACCES: permission denied')
    })

    it('should handle complete rename flow logic', () => {
      const mockFiles: FileNode[] = [
        { name: 'file1.txt', path: '/project/file1.txt', type: 'file', size: 0, modified: 0 },
        { name: 'file2.txt', path: '/project/file2.txt', type: 'file', size: 0, modified: 0 }
      ]

      // Extract parent path
      const parentPath = extractParentPath('/project/file1.txt')
      expect(parentPath).toBe('/project')

      // Get siblings for duplicate detection
      const siblings = getSiblingNames(mockFiles, '/project/file1.txt', 'file1.txt')
      expect(siblings).toContain('file2.txt')

      // Get operation title
      const title = getOperationTitle('rename', 'file')
      expect(title).toBe('Rename File')

      // Success message
      const successMessage = createRenameSuccessMessage()
      expect(successMessage).toBe('Item renamed successfully')
    })

    it('should handle error detection and categorization', () => {
      const permError = new Error('EACCES: permission denied')
      const spaceError = new Error('ENOSPC: no space left')
      const notFoundError = new Error('ENOENT: file not found')

      expect(isPermissionError(permError)).toBe(true)
      expect(isPermissionError(spaceError)).toBe(false)
      expect(isPermissionError(notFoundError)).toBe(false)

      expect(isDiskSpaceError(permError)).toBe(false)
      expect(isDiskSpaceError(spaceError)).toBe(true)
      expect(isDiskSpaceError(notFoundError)).toBe(false)

      expect(isNotFoundError(permError)).toBe(false)
      expect(isNotFoundError(spaceError)).toBe(false)
      expect(isNotFoundError(notFoundError)).toBe(true)
    })

    it('should handle path building for various scenarios', () => {
      // Root folder
      expect(buildChildPath('/', 'test.txt')).toBe('/test.txt')

      // Normal folder
      expect(buildChildPath('/project', 'test.txt')).toBe('/project/test.txt')

      // Nested folder
      expect(buildChildPath('/project/sub/deep', 'test.txt')).toBe('/project/sub/deep/test.txt')

      // With trailing slash (defensive programming)
      expect(buildChildPath('/project/', 'test.txt')).toBe('/project/test.txt')
    })
  })
})
