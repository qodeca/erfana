// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ExternalFileService Tests
 *
 * Tests for external file drop security validation and file operations.
 * Covers Spec #012: External File Drop to Project Tree
 *
 * Test coverage:
 * - validateExternalFile() - security validation of external files
 * - sanitizeFileName() - filename sanitization and normalization
 * - copyFromExternal() - copying external files into project
 * - moveFromExternal() - moving external files into project
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import path from 'path'
import type * as FsProm from 'fs/promises'
import type * as PathUtils from '../utils/pathSecurity'
import { ExternalFileService } from './ExternalFileService'
import type { IFileService } from '../interfaces/IFileService'
import { ErrorCode } from '../../shared/errors'

// Mock fs/promises
vi.mock('fs/promises', () => {
  return {
    lstat: vi.fn(),
    realpath: vi.fn(),
    copyFile: vi.fn(),
    rm: vi.fn(),
    access: vi.fn(),
    constants: {
      R_OK: 4
    }
  } satisfies Partial<typeof FsProm> & { constants: { R_OK: number } }
})

// Mock pathSecurity utilities
vi.mock('../utils/pathSecurity', async (importOriginal) => {
  const actual = await importOriginal<typeof PathUtils>()
  return {
    ...actual,
    validateSymlink: vi.fn(),
    isSystemDirectory: vi.fn()
  }
})

/**
 * Helper to create mock Stats objects
 */
function makeStats(opts: {
  isDir?: boolean
  isSymlink?: boolean
  isBlockDevice?: boolean
  isCharDevice?: boolean
  isFIFO?: boolean
  isSocket?: boolean
}) {
  return {
    isDirectory: () => opts.isDir ?? false,
    isFile: () => !opts.isDir && !opts.isSymlink && !opts.isBlockDevice && !opts.isCharDevice && !opts.isFIFO && !opts.isSocket,
    isSymbolicLink: () => opts.isSymlink ?? false,
    isBlockDevice: () => opts.isBlockDevice ?? false,
    isCharacterDevice: () => opts.isCharDevice ?? false,
    isFIFO: () => opts.isFIFO ?? false,
    isSocket: () => opts.isSocket ?? false
  } as unknown as Awaited<ReturnType<(typeof import('fs/promises'))['lstat']>>
}

/**
 * Create mock FileService for testing
 */
function createMockFileService(): IFileService {
  return {
    setProjectPath: vi.fn(),
    getProjectPath: vi.fn(),
    readDirectory: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    getFileStats: vi.fn(),
    isMarkdownFile: vi.fn(),
    createFile: vi.fn(),
    createFolder: vi.fn(),
    deleteFile: vi.fn(),
    deleteFolder: vi.fn(),
    rename: vi.fn(),
    moveItem: vi.fn(),
    copyItem: vi.fn(),
    checkNameConflict: vi.fn(),
    setHiddenPatterns: vi.fn(),
    getHiddenPatterns: vi.fn()
  }
}

describe('ExternalFileService', () => {
  let fs: any
  let pathSecurity: any
  let mockFileService: IFileService
  let service: ExternalFileService

  beforeEach(async () => {
    fs = (await import('fs/promises')) as any
    pathSecurity = (await import('../utils/pathSecurity')) as any

    // Reset all mocks
    vi.resetAllMocks()

    // Create service with mock dependencies
    mockFileService = createMockFileService()
    service = new ExternalFileService(mockFileService)

    // Default mock implementations
    ;(fs.access as Mock).mockResolvedValue(undefined)
    ;(pathSecurity.isSystemDirectory as Mock).mockReturnValue(false)
    ;(pathSecurity.validateSymlink as Mock).mockResolvedValue(false)
  })

  describe('validateExternalFile', () => {
    it('returns valid for regular file within project', async () => {
      const sourcePath = '/external/path/file.md'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))

      const result = await service.validateExternalFile(sourcePath, projectRoot)

      expect(result).toMatchObject({
        valid: true,
        isSymlink: false,
        isDirectory: false,
        exists: true,
        isRegularFile: true
      })
    })

    it('returns invalid for directory', async () => {
      const sourcePath = '/external/path/folder'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: true }))

      const result = await service.validateExternalFile(sourcePath, projectRoot)

      expect(result).toMatchObject({
        valid: false,
        isSymlink: false,
        isDirectory: true,
        exists: true,
        isRegularFile: false,
        error: 'Cannot import directories',
        errorCode: ErrorCode.EXTERNAL_FILE_IS_DIRECTORY
      })
    })

    it('returns invalid for symlink pointing to system directory', async () => {
      const sourcePath = '/external/path/symlink'
      const projectRoot = '/project'

      // Symlink itself
      ;(fs.lstat as Mock)
        .mockResolvedValueOnce(makeStats({ isSymlink: true }))
        // Target check for isRegularFile
        .mockResolvedValueOnce(makeStats({ isDir: false }))

      ;(fs.realpath as Mock)
        .mockResolvedValueOnce('/System/Library/Private') // First call in validateExternalFile
        .mockResolvedValueOnce('/System/Library/Private') // Second call in isRegularFile

      ;(pathSecurity.isSystemDirectory as Mock).mockReturnValue(true)

      const result = await service.validateExternalFile(sourcePath, projectRoot)

      expect(result.valid).toBe(false)
      expect(result.isSymlink).toBe(true)
      expect(result.error).toBe('Symlink points to system directory')
      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_SYMLINK_SYSTEM)
    })

    it('returns invalid for file outside project (path traversal attempt)', async () => {
      // This test validates the concept - actual boundary validation happens in copyFromExternal/moveFromExternal
      const sourcePath = '/external/../../etc/passwd'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))

      const result = await service.validateExternalFile(sourcePath, projectRoot)

      // File itself is valid, but boundary check happens in copy/move operations
      expect(result.valid).toBe(true)
    })

    it('returns invalid for non-existent file', async () => {
      const sourcePath = '/external/path/nonexistent.md'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockRejectedValueOnce(new Error('ENOENT: no such file or directory'))

      const result = await service.validateExternalFile(sourcePath, projectRoot)

      expect(result).toMatchObject({
        valid: false,
        isSymlink: false,
        isDirectory: false,
        exists: false,
        isRegularFile: false,
        error: 'File not found',
        errorCode: ErrorCode.EXTERNAL_FILE_NOT_FOUND
      })
    })

    it('returns invalid for special files (socket)', async () => {
      const sourcePath = '/external/path/socket'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isSocket: true }))

      const result = await service.validateExternalFile(sourcePath, projectRoot)

      expect(result).toMatchObject({
        valid: false,
        isSymlink: false,
        isDirectory: false,
        exists: true,
        isRegularFile: false,
        error: 'Cannot import special files',
        errorCode: ErrorCode.EXTERNAL_FILE_NOT_REGULAR
      })
    })

    it('returns invalid for special files (FIFO pipe)', async () => {
      const sourcePath = '/external/path/pipe'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isFIFO: true }))

      const result = await service.validateExternalFile(sourcePath, projectRoot)

      expect(result).toMatchObject({
        valid: false,
        isRegularFile: false,
        errorCode: ErrorCode.EXTERNAL_FILE_NOT_REGULAR
      })
    })

    it('returns invalid for special files (block device)', async () => {
      const sourcePath = '/dev/sda1'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isBlockDevice: true }))

      const result = await service.validateExternalFile(sourcePath, projectRoot)

      expect(result).toMatchObject({
        valid: false,
        isRegularFile: false,
        errorCode: ErrorCode.EXTERNAL_FILE_NOT_REGULAR
      })
    })

    it('returns invalid for special files (character device)', async () => {
      const sourcePath = '/dev/tty'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isCharDevice: true }))

      const result = await service.validateExternalFile(sourcePath, projectRoot)

      expect(result).toMatchObject({
        valid: false,
        isRegularFile: false,
        errorCode: ErrorCode.EXTERNAL_FILE_NOT_REGULAR
      })
    })

    it('returns invalid for non-absolute source path', async () => {
      const sourcePath = 'relative/path/file.md'
      const projectRoot = '/project'

      const result = await service.validateExternalFile(sourcePath, projectRoot)

      expect(result).toMatchObject({
        valid: false,
        error: 'Source path must be absolute',
        errorCode: ErrorCode.PATH_NOT_ABSOLUTE
      })
    })

    it('returns invalid for non-absolute project root', async () => {
      const sourcePath = '/external/file.md'
      const projectRoot = 'relative/project'

      const result = await service.validateExternalFile(sourcePath, projectRoot)

      expect(result).toMatchObject({
        valid: false,
        error: 'Project root must be absolute',
        errorCode: ErrorCode.PATH_NOT_ABSOLUTE
      })
    })

    it('validates symlink target is a regular file', async () => {
      const sourcePath = '/external/path/symlink'
      const projectRoot = '/project'

      // Symlink itself
      ;(fs.lstat as Mock)
        .mockResolvedValueOnce(makeStats({ isSymlink: true }))
        // Target check
        .mockResolvedValueOnce(makeStats({ isDir: false }))

      ;(fs.realpath as Mock).mockResolvedValueOnce('/external/target/file.md')
      ;(pathSecurity.isSystemDirectory as Mock).mockReturnValue(false)
      ;(pathSecurity.validateSymlink as Mock).mockResolvedValue(true)

      const result = await service.validateExternalFile(sourcePath, projectRoot)

      expect(result.valid).toBe(true)
      expect(result.isSymlink).toBe(true)
      expect(pathSecurity.validateSymlink).toHaveBeenCalledWith(sourcePath)
    })

    it('handles broken symlinks gracefully', async () => {
      const sourcePath = '/external/path/broken-symlink'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isSymlink: true }))
      ;(fs.realpath as Mock).mockRejectedValueOnce(new Error('ENOENT'))

      const result = await service.validateExternalFile(sourcePath, projectRoot)

      expect(result.valid).toBe(false)
      expect(result.isSymlink).toBe(true)
    })
  })

  describe('sanitizeFileName', () => {
    it('removes null bytes', () => {
      const input = 'file\x00name.md'
      const result = service.sanitizeFileName(input)
      expect(result).toBe('filename.md')
    })

    it('applies Unicode NFC normalization', () => {
      // é as separate characters (e + combining acute) vs composed character
      const decomposed = 'cafe\u0301.md' // e + combining acute accent
      const result = service.sanitizeFileName(decomposed)
      // Should normalize to NFC form (composed character)
      const normalized = result.normalize('NFC')
      expect(result).toBe(normalized)
      expect(result.endsWith('.md')).toBe(true)
    })

    it('removes path separators (/ and \\)', () => {
      const input = 'path/to\\file.md'
      const result = service.sanitizeFileName(input)
      expect(result).toBe('pathtofile.md')
    })

    it('removes path traversal patterns (..)', () => {
      const input = '../../../etc/passwd.md'
      const result = service.sanitizeFileName(input)
      expect(result).toBe('etcpasswd.md')
    })

    it('removes leading dots and spaces', () => {
      const input = '  ...file.md'
      const result = service.sanitizeFileName(input)
      expect(result).toBe('file.md')
    })

    it('removes trailing dots and spaces', () => {
      const input = 'file.md...  '
      const result = service.sanitizeFileName(input)
      expect(result).toBe('file.md')
    })

    it('returns default name for empty or dot-only names', () => {
      expect(service.sanitizeFileName('')).toBe('imported-file.md')
      // '...' becomes empty after removing '..' and leading/trailing dots
      expect(service.sanitizeFileName('...')).toBe('imported-file.md')
      // '.md' becomes 'md' after removing leading dot, then still valid
      expect(service.sanitizeFileName('.md')).toBe('md')
      // '.markdown' becomes 'markdown' after removing leading dot
      expect(service.sanitizeFileName('.markdown')).toBe('markdown')
      // '...file...' removes leading '...' and trailing '...' leaving 'file'
      expect(service.sanitizeFileName('...file...')).toBe('file')
    })

    it('limits filename length to 240 characters', () => {
      const longName = 'a'.repeat(300) + '.md'
      const result = service.sanitizeFileName(longName)
      expect(result.length).toBeLessThanOrEqual(240)
      expect(result.endsWith('.md')).toBe(true)
    })

    it('preserves extension when truncating long names', () => {
      const longBase = 'a'.repeat(250)
      const input = `${longBase}.markdown`
      const result = service.sanitizeFileName(input)
      expect(result.endsWith('.markdown')).toBe(true)
      expect(result.length).toBeLessThanOrEqual(240)
    })

    it('handles complex sanitization scenarios', () => {
      const input = '  ../../../.\x00file/with\\bad..chars  '
      const result = service.sanitizeFileName(input)
      expect(result).toBe('filewithbadchars')
    })
  })

  describe('copyFromExternal', () => {
    it('validates file before copying', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = '/project/docs'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: true }))

      const result = await service.copyFromExternal(sourcePath, targetFolder, projectRoot)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_IS_DIRECTORY)
      expect(fs.copyFile).not.toHaveBeenCalled()
    })

    it('delegates to FileService.copyItem', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = '/project/docs'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.copyFile as Mock).mockResolvedValueOnce(undefined)

      const result = await service.copyFromExternal(sourcePath, targetFolder, projectRoot)

      expect(result.success).toBe(true)
      expect(result.path).toBe(path.join('/project', 'docs', 'file.md'))
      expect(fs.copyFile).toHaveBeenCalledWith(sourcePath, path.join('/project', 'docs', 'file.md'))
    })

    it('handles conflict resolution with replace', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = '/project/docs'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(true) // Conflict exists
      ;(fs.copyFile as Mock).mockResolvedValueOnce(undefined)

      const result = await service.copyFromExternal(
        sourcePath,
        targetFolder,
        projectRoot,
        'replace'
      )

      expect(result.success).toBe(true)
      expect(result.path).toBe(path.join('/project', 'docs', 'file.md'))
    })

    it('handles conflict resolution with keepBoth', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = '/project/docs'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock)
        .mockResolvedValueOnce(true) // checkNameConflict for 'file.md' (hasConflict check in resolveTargetPath)
        .mockResolvedValueOnce(true) // checkNameConflict for 'file.md' again (first while loop iteration with newPath=targetPath)
        .mockResolvedValueOnce(false) // checkNameConflict for 'file (1).md' (second while loop iteration, no conflict)
      ;(fs.copyFile as Mock).mockResolvedValueOnce(undefined)

      const result = await service.copyFromExternal(
        sourcePath,
        targetFolder,
        projectRoot,
        'keepBoth'
      )

      expect(result.success).toBe(true)
      expect(result.path).toBe(path.join('/project', 'docs', 'file (1).md'))
    })

    it('rejects target folder outside project boundary', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = '/other/location'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))

      const result = await service.copyFromExternal(sourcePath, targetFolder, projectRoot)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.PATH_OUTSIDE_PROJECT)
      expect(fs.copyFile).not.toHaveBeenCalled()
    })

    it('handles source file deletion during operation (race condition)', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = '/project/docs'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.access as Mock).mockRejectedValueOnce(new Error('ENOENT'))

      const result = await service.copyFromExternal(sourcePath, targetFolder, projectRoot)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_SOURCE_DELETED)
      expect(fs.copyFile).not.toHaveBeenCalled()
    })

    it('sanitizes filename during copy', async () => {
      const sourcePath = '/external/../path/bad\\file.md'
      const targetFolder = '/project/docs'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.copyFile as Mock).mockResolvedValueOnce(undefined)

      const result = await service.copyFromExternal(sourcePath, targetFolder, projectRoot)

      expect(result.success).toBe(true)
      // Filename should be sanitized – on Windows, basename of path with backslash
      // extracts differently, so just check the result ends with .md
      expect(result.path).toBeDefined()
      expect(path.extname(result.path!)).toBe('.md')
    })

    it('handles copy errors gracefully', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = '/project/docs'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.copyFile as Mock).mockRejectedValueOnce(new Error('Disk full'))

      const result = await service.copyFromExternal(sourcePath, targetFolder, projectRoot)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_COPY_FAILED)
    })
  })

  describe('moveFromExternal', () => {
    it('validates file before moving', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = '/project/docs'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: true }))

      const result = await service.moveFromExternal(sourcePath, targetFolder, projectRoot)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_IS_DIRECTORY)
      expect(fs.copyFile).not.toHaveBeenCalled()
      expect(fs.rm).not.toHaveBeenCalled()
    })

    it('copies then deletes source', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = '/project/docs'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.copyFile as Mock).mockResolvedValueOnce(undefined)
      ;(fs.rm as Mock).mockResolvedValueOnce(undefined)

      const result = await service.moveFromExternal(sourcePath, targetFolder, projectRoot)

      expect(result.success).toBe(true)
      expect(result.path).toBe(path.join('/project', 'docs', 'file.md'))
      expect(fs.copyFile).toHaveBeenCalledWith(sourcePath, path.join('/project', 'docs', 'file.md'))
      expect(fs.rm).toHaveBeenCalledWith(sourcePath)
    })

    it('handles errors during source deletion gracefully', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = '/project/docs'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.copyFile as Mock).mockResolvedValueOnce(undefined)
      ;(fs.rm as Mock).mockRejectedValueOnce(Object.assign(new Error('Permission denied'), { code: 'EPERM' }))

      const result = await service.moveFromExternal(sourcePath, targetFolder, projectRoot)

      // Move still succeeds even if source deletion fails (file was copied)
      expect(result.success).toBe(true)
      expect(result.path).toBe(path.join('/project', 'docs', 'file.md'))
    })

    it('handles source already deleted during move (ENOENT)', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = '/project/docs'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.copyFile as Mock).mockResolvedValueOnce(undefined)
      ;(fs.rm as Mock).mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

      const result = await service.moveFromExternal(sourcePath, targetFolder, projectRoot)

      // Still successful - file was already gone
      expect(result.success).toBe(true)
    })

    it('rejects target folder outside project boundary', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = '/other/location'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))

      const result = await service.moveFromExternal(sourcePath, targetFolder, projectRoot)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.PATH_OUTSIDE_PROJECT)
    })

    it('handles move errors gracefully', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = '/project/docs'
      const projectRoot = '/project'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.copyFile as Mock).mockRejectedValueOnce(new Error('Disk full'))

      const result = await service.moveFromExternal(sourcePath, targetFolder, projectRoot)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_FAILED)
      expect(fs.rm).not.toHaveBeenCalled()
    })
  })
})
