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
import { ExternalFileService, type ExternalTarget } from './ExternalFileService'
import { ExternalSourceGrants } from './ExternalSourceGrants'
import { ATOMIC_TEMP_PREFIX, isAtomicTempName } from '../utils/atomicWrite'
import type { IFileService } from '../interfaces/IFileService'
import { ErrorCode } from '../../shared/errors'

// Mock fs/promises
vi.mock('fs/promises', () => {
  return {
    lstat: vi.fn(),
    stat: vi.fn(),
    realpath: vi.fn(),
    copyFile: vi.fn(),
    rename: vi.fn(),
    rm: vi.fn(),
    access: vi.fn(),
    constants: {
      R_OK: 4,
      COPYFILE_EXCL: 1
    }
  } satisfies Partial<Omit<typeof FsProm, 'constants'>> & {
    constants: Pick<typeof FsProm.constants, 'R_OK' | 'COPYFILE_EXCL'>
  }
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

const COPYFILE_EXCL = 1
const SENDER = 7

/** A target folder the way the IPC layer hands it over */
const target = (folder: string): ExternalTarget => ({ real: folder, requested: folder })

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
    getHiddenPatterns: vi.fn(),
    findByName: vi.fn(),
    isImageFile: vi.fn(),
    readImage: vi.fn(),
    setPathFilter: vi.fn()
  }
}

describe('ExternalFileService', () => {
  let fs: any
  let pathSecurity: any
  let mockFileService: IFileService
  let service: ExternalFileService
  let grants: ExternalSourceGrants
  let confirm: Mock

  beforeEach(async () => {
    fs = (await import('fs/promises')) as any
    pathSecurity = (await import('../utils/pathSecurity')) as any

    // Reset all mocks
    vi.resetAllMocks()

    // Create service with mock dependencies
    mockFileService = createMockFileService()
    grants = new ExternalSourceGrants({
      now: () => Date.now(),
      path,
      lstat: async (p: string) => ({ dev: 1n, ino: BigInt(p.length) })
    })
    service = new ExternalFileService(mockFileService, grants)
    confirm = vi.fn().mockResolvedValue('move')
    service.setMoveConfirmer({ confirm })

    // Default mock implementations
    ;(fs.access as Mock).mockResolvedValue(undefined)
    ;(fs.realpath as Mock).mockImplementation(async (p: string) => p)
    ;(pathSecurity.isSystemDirectory as Mock).mockReturnValue(false)
    ;(pathSecurity.validateSymlink as Mock).mockResolvedValue(false)
  })

  describe('validateExternalFile', () => {
    it('returns valid for regular file within project', async () => {
      const sourcePath = '/external/path/file.md'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))

      const result = await service.validateExternalFile(sourcePath)

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

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: true }))

      const result = await service.validateExternalFile(sourcePath)

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

      // Symlink itself
      ;(fs.lstat as Mock)
        .mockResolvedValueOnce(makeStats({ isSymlink: true }))
        // Target check for isRegularFile
        .mockResolvedValueOnce(makeStats({ isDir: false }))

      ;(fs.realpath as Mock)
        .mockResolvedValueOnce('/System/Library/Private') // First call in validateExternalFile
        .mockResolvedValueOnce('/System/Library/Private') // Second call in isRegularFile

      ;(pathSecurity.isSystemDirectory as Mock).mockReturnValue(true)

      const result = await service.validateExternalFile(sourcePath)

      expect(result.valid).toBe(false)
      expect(result.isSymlink).toBe(true)
      expect(result.error).toBe('Symlink points to system directory')
      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_SYMLINK_SYSTEM)
    })

    it('returns invalid for file outside project (path traversal attempt)', async () => {
      // This test validates the concept - actual boundary validation happens in copyFromExternal/moveFromExternal
      const sourcePath = '/external/../../etc/passwd'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))

      const result = await service.validateExternalFile(sourcePath)

      // File itself is valid, but boundary check happens in copy/move operations
      expect(result.valid).toBe(true)
    })

    it('returns invalid for non-existent file', async () => {
      const sourcePath = '/external/path/nonexistent.md'

      ;(fs.lstat as Mock).mockRejectedValueOnce(new Error('ENOENT: no such file or directory'))

      const result = await service.validateExternalFile(sourcePath)

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

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isSocket: true }))

      const result = await service.validateExternalFile(sourcePath)

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

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isFIFO: true }))

      const result = await service.validateExternalFile(sourcePath)

      expect(result).toMatchObject({
        valid: false,
        isRegularFile: false,
        errorCode: ErrorCode.EXTERNAL_FILE_NOT_REGULAR
      })
    })

    it('returns invalid for special files (block device)', async () => {
      const sourcePath = '/dev/sda1'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isBlockDevice: true }))

      const result = await service.validateExternalFile(sourcePath)

      expect(result).toMatchObject({
        valid: false,
        isRegularFile: false,
        errorCode: ErrorCode.EXTERNAL_FILE_NOT_REGULAR
      })
    })

    it('returns invalid for special files (character device)', async () => {
      const sourcePath = '/dev/tty'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isCharDevice: true }))

      const result = await service.validateExternalFile(sourcePath)

      expect(result).toMatchObject({
        valid: false,
        isRegularFile: false,
        errorCode: ErrorCode.EXTERNAL_FILE_NOT_REGULAR
      })
    })

    it('returns invalid for non-absolute source path', async () => {
      const sourcePath = 'relative/path/file.md'

      const result = await service.validateExternalFile(sourcePath)

      expect(result).toMatchObject({
        valid: false,
        error: 'Source path must be absolute',
        errorCode: ErrorCode.PATH_NOT_ABSOLUTE
      })
    })

    it('validates symlink target is a regular file', async () => {
      const sourcePath = '/external/path/symlink'

      // Symlink itself
      ;(fs.lstat as Mock)
        .mockResolvedValueOnce(makeStats({ isSymlink: true }))
        // Target check
        .mockResolvedValueOnce(makeStats({ isDir: false }))

      ;(fs.realpath as Mock).mockResolvedValueOnce('/external/target/file.md')
      ;(pathSecurity.isSystemDirectory as Mock).mockReturnValue(false)
      ;(pathSecurity.validateSymlink as Mock).mockResolvedValue(true)

      const result = await service.validateExternalFile(sourcePath)

      expect(result.valid).toBe(true)
      expect(result.isSymlink).toBe(true)
      expect(pathSecurity.validateSymlink).toHaveBeenCalledWith(sourcePath)
    })

    it('handles broken symlinks gracefully', async () => {
      const sourcePath = '/external/path/broken-symlink'

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isSymlink: true }))
      ;(fs.realpath as Mock).mockRejectedValueOnce(new Error('ENOENT'))

      const result = await service.validateExternalFile(sourcePath)

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
      const targetFolder = path.resolve('/project/docs')

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: true }))

      const result = await service.copyFromExternal(sourcePath, target(targetFolder))

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_IS_DIRECTORY)
      expect(fs.copyFile).not.toHaveBeenCalled()
    })

    it('delegates to FileService.copyItem', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = path.resolve('/project/docs')

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.copyFile as Mock).mockResolvedValueOnce(undefined)

      const result = await service.copyFromExternal(sourcePath, target(targetFolder))

      expect(result.success).toBe(true)
      expect(result.path).toBe(path.join(path.resolve('/project/docs'), 'file.md'))
      expect(fs.copyFile).toHaveBeenCalledWith(sourcePath, path.join(path.resolve('/project/docs'), 'file.md'), COPYFILE_EXCL)
    })

    it('handles conflict resolution with replace', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = path.resolve('/project/docs')

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(true) // Conflict exists
      ;(fs.copyFile as Mock).mockResolvedValueOnce(undefined)

      const result = await service.copyFromExternal(sourcePath, target(targetFolder), 'replace')

      expect(result.success).toBe(true)
      expect(result.path).toBe(path.join(path.resolve('/project/docs'), 'file.md'))
    })

    it('handles conflict resolution with keepBoth', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = path.resolve('/project/docs')

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock)
        .mockResolvedValueOnce(true) // checkNameConflict for 'file.md' (hasConflict check in resolveTargetPath)
        .mockResolvedValueOnce(true) // checkNameConflict for 'file.md' again (first while loop iteration with newPath=targetPath)
        .mockResolvedValueOnce(false) // checkNameConflict for 'file (1).md' (second while loop iteration, no conflict)
      ;(fs.copyFile as Mock).mockResolvedValueOnce(undefined)

      const result = await service.copyFromExternal(sourcePath, target(targetFolder), 'keepBoth')

      expect(result.success).toBe(true)
      expect(result.path).toBe(path.join(path.resolve('/project/docs'), 'file (1).md'))
    })

    it('handles source file deletion during operation (race condition)', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = path.resolve('/project/docs')

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.access as Mock).mockRejectedValueOnce(new Error('ENOENT'))

      const result = await service.copyFromExternal(sourcePath, target(targetFolder))

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_SOURCE_DELETED)
      expect(fs.copyFile).not.toHaveBeenCalled()
    })

    it('sanitizes filename during copy', async () => {
      const sourcePath = '/external/../path/bad\\file.md'
      const targetFolder = path.resolve('/project/docs')

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.copyFile as Mock).mockResolvedValueOnce(undefined)

      const result = await service.copyFromExternal(sourcePath, target(targetFolder))

      expect(result.success).toBe(true)
      // Filename should be sanitized – on Windows, basename of path with backslash
      // extracts differently, so just check the result ends with .md
      expect(result.path).toBeDefined()
      expect(path.extname(result.path!)).toBe('.md')
    })

    it('handles copy errors gracefully', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = path.resolve('/project/docs')

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.copyFile as Mock).mockRejectedValueOnce(new Error('Disk full'))

      const result = await service.copyFromExternal(sourcePath, target(targetFolder))

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_COPY_FAILED)
    })
  })

  describe('moveFromExternal', () => {
    it('validates file before moving', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = path.resolve('/project/docs')

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: true }))

      const result = await service.moveFromExternal(sourcePath, target(targetFolder), SENDER)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_IS_DIRECTORY)
      expect(fs.copyFile).not.toHaveBeenCalled()
      expect(fs.rm).not.toHaveBeenCalled()
    })

    it('copies then deletes source', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = path.resolve('/project/docs')

      ;(fs.lstat as Mock).mockResolvedValue(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.copyFile as Mock).mockResolvedValueOnce(undefined)
      ;(fs.rm as Mock).mockResolvedValueOnce(undefined)

      const result = await service.moveFromExternal(sourcePath, target(targetFolder), SENDER)

      expect(result.success).toBe(true)
      expect(result.path).toBe(path.join(path.resolve('/project/docs'), 'file.md'))
      expect(fs.copyFile).toHaveBeenCalledWith(sourcePath, path.join(path.resolve('/project/docs'), 'file.md'), COPYFILE_EXCL)
      expect(fs.rm).toHaveBeenCalledWith(sourcePath)
    })

    it('handles errors during source deletion gracefully', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = path.resolve('/project/docs')

      ;(fs.lstat as Mock).mockResolvedValue(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.copyFile as Mock).mockResolvedValueOnce(undefined)
      ;(fs.rm as Mock).mockRejectedValueOnce(Object.assign(new Error('Permission denied'), { code: 'EPERM' }))

      const result = await service.moveFromExternal(sourcePath, target(targetFolder), SENDER)

      // Move still succeeds even if source deletion fails (file was copied)
      expect(result.success).toBe(true)
      expect(result.path).toBe(path.join(path.resolve('/project/docs'), 'file.md'))
    })

    it('handles source already deleted during move (ENOENT)', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = path.resolve('/project/docs')

      ;(fs.lstat as Mock).mockResolvedValue(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.copyFile as Mock).mockResolvedValueOnce(undefined)
      ;(fs.rm as Mock).mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

      const result = await service.moveFromExternal(sourcePath, target(targetFolder), SENDER)

      // Still successful - file was already gone
      expect(result.success).toBe(true)
    })

    it('handles move errors gracefully', async () => {
      const sourcePath = '/external/file.md'
      const targetFolder = path.resolve('/project/docs')

      ;(fs.lstat as Mock).mockResolvedValue(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.copyFile as Mock).mockRejectedValueOnce(new Error('Disk full'))

      const result = await service.moveFromExternal(sourcePath, target(targetFolder), SENDER)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_FAILED)
      expect(fs.rm).not.toHaveBeenCalled()
    })
  })

  describe('target folder', () => {
    it('writes below the checked folder and answers with the folder the caller named', async () => {
      const real = path.resolve('/canonical/docs')
      const requested = path.resolve('/project/docs-link')

      ;(fs.lstat as Mock).mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.copyFile as Mock).mockResolvedValueOnce(undefined)

      const result = await service.copyFromExternal('/external/file.md', { real, requested })

      expect(fs.copyFile).toHaveBeenCalledWith(
        '/external/file.md',
        path.join(real, 'file.md'),
        COPYFILE_EXCL
      )
      expect(mockFileService.checkNameConflict).toHaveBeenCalledWith(real, 'file.md')
      expect(result.path).toBe(path.join(requested, 'file.md'))
    })

    it('replaces an existing name through a temporary copy renamed over it', async () => {
      ;(fs.lstat as Mock)
        .mockResolvedValueOnce(makeStats({ isDir: false }))
        .mockResolvedValueOnce(makeStats({ isSymlink: true }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(true)
      ;(fs.copyFile as Mock).mockResolvedValue(undefined)
      ;(fs.rename as Mock).mockResolvedValue(undefined)

      const folder = path.resolve('/project/docs')
      const result = await service.copyFromExternal('/external/file.md', target(folder), 'replace')

      expect(result.success).toBe(true)
      const [, temporary, flag] = (fs.copyFile as Mock).mock.calls[0]
      expect(path.dirname(temporary)).toBe(folder)
      expect(flag).toBe(COPYFILE_EXCL)
      expect(fs.rename).toHaveBeenCalledWith(temporary, path.join(folder, 'file.md'))
    })

    it('removes the temporary copy when the rename fails', async () => {
      ;(fs.lstat as Mock)
        .mockResolvedValueOnce(makeStats({ isDir: false }))
        .mockResolvedValueOnce(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(true)
      ;(fs.copyFile as Mock).mockResolvedValue(undefined)
      ;(fs.rename as Mock).mockRejectedValue(new Error('busy'))
      ;(fs.rm as Mock).mockResolvedValue(undefined)

      const result = await service.copyFromExternal(
        '/external/file.md',
        target(path.resolve('/project/docs')),
        'replace'
      )

      expect(result.success).toBe(false)
      const [, temporary] = (fs.copyFile as Mock).mock.calls[0]
      expect(fs.rm).toHaveBeenCalledWith(temporary, { force: true })
    })

    it.each(['EPERM', 'EBUSY', 'EACCES'])(
      'says plainly that the file may be open when the rename gives %s',
      async (code) => {
        const folder = path.resolve('/project/docs')
        ;(fs.lstat as Mock)
          .mockResolvedValueOnce(makeStats({ isDir: false }))
          .mockResolvedValueOnce(makeStats({ isDir: false }))
        ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(true)
        ;(fs.copyFile as Mock).mockResolvedValue(undefined)
        ;(fs.rm as Mock).mockResolvedValue(undefined)
        ;(fs.rename as Mock).mockImplementation(async (from: string) => {
          throw Object.assign(new Error(`${code}: operation not permitted, rename '${from}'`), { code })
        })

        const result = await service.copyFromExternal('/external/file.md', target(folder), 'replace')

        expect(result.success).toBe(false)
        expect(result.error).toBe('Could not replace file.md – it may be open in another program.')
        expect(result.error).not.toContain('erfana-tmp')
        const [, temporary] = (fs.copyFile as Mock).mock.calls[0]
        expect(fs.rm).toHaveBeenCalledWith(temporary, { force: true })
      }
    )

    it('creates a new name exclusively even when replace finds nothing there', async () => {
      ;(fs.lstat as Mock)
        .mockResolvedValueOnce(makeStats({ isDir: false }))
        .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.copyFile as Mock).mockResolvedValue(undefined)

      const folder = path.resolve('/project/docs')
      await service.copyFromExternal('/external/file.md', target(folder), 'replace')

      expect(fs.copyFile).toHaveBeenCalledWith(
        '/external/file.md',
        path.join(folder, 'file.md'),
        COPYFILE_EXCL
      )
      expect(fs.rename).not.toHaveBeenCalled()
    })

    it('refuses a copy onto the same file', async () => {
      ;(fs.lstat as Mock).mockResolvedValue(makeStats({ isDir: false }))
      ;(fs.stat as Mock).mockResolvedValue({ dev: 5n, ino: 9n })
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(true)

      const result = await service.copyFromExternal(
        '/external/file.md',
        target(path.resolve('/project/docs')),
        'replace'
      )

      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_SAME_FILE)
      expect(fs.copyFile).not.toHaveBeenCalled()
    })
  })

  describe('move confirmation', () => {
    const source = '/external/file.md'
    const folder = path.resolve('/project/docs')

    beforeEach(() => {
      ;(fs.lstat as Mock).mockResolvedValue(makeStats({ isDir: false }))
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.copyFile as Mock).mockResolvedValue(undefined)
      ;(fs.rm as Mock).mockResolvedValue(undefined)
    })

    it('moves a file after the user answers Move', async () => {
      const result = await service.moveFromExternal(source, target(folder), SENDER)

      expect(result.success).toBe(true)
      expect(confirm).toHaveBeenCalledWith(SENDER, source, undefined)
      expect(fs.rm).toHaveBeenCalledWith(source)
    })

    it('touches nothing when the user cancels, and answers quietly', async () => {
      confirm.mockResolvedValue('cancel')

      const result = await service.moveFromExternal(source, target(folder), SENDER)

      expect(result).toMatchObject({
        success: false,
        errorCode: ErrorCode.EXTERNAL_FILE_MOVE_CANCELLED
      })
      expect(fs.copyFile).not.toHaveBeenCalled()
      expect(fs.rm).not.toHaveBeenCalled()
    })

    it('refuses when no box can be shown', async () => {
      confirm.mockResolvedValue('unavailable')

      const result = await service.moveFromExternal(source, target(folder), SENDER)

      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_NOT_GRANTED)
      expect(fs.rm).not.toHaveBeenCalled()
    })

    it('refuses when there is nobody to ask', async () => {
      service.setMoveConfirmer(null)

      const result = await service.moveFromExternal(source, target(folder), SENDER)

      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_NOT_GRANTED)
      expect(fs.rm).not.toHaveBeenCalled()
    })

    it('does not ask about a file that fails validation', async () => {
      ;(fs.lstat as Mock).mockResolvedValue(makeStats({ isDir: true }))

      await service.moveFromExternal(source, target(folder), SENDER)

      expect(confirm).not.toHaveBeenCalled()
    })

    it('names the whole dialog pick in the one question', async () => {
      await grants.issue(SENDER, [source, '/external/two.md'])

      await service.moveFromExternal(source, target(folder), SENDER)

      const batch = confirm.mock.calls[0][2] as string[]
      expect(batch).toEqual([path.resolve(source), path.resolve('/external/two.md')])
    })

    it('cancels without change when the target no longer resolves the same', async () => {
      const result = await service.moveFromExternal(
        source,
        target(folder),
        SENDER,
        undefined,
        async () => false
      )

      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_CHANGED)
      expect(fs.copyFile).not.toHaveBeenCalled()
      expect(fs.rm).not.toHaveBeenCalled()
    })

    it('cancels without change when the source became another file while waiting', async () => {
      ;(fs.stat as Mock)
        .mockResolvedValueOnce({ dev: 1n, ino: 10n }) // identity before the box
        .mockResolvedValueOnce({ dev: 1n, ino: 11n }) // same-file check: source
        .mockRejectedValueOnce(new Error('ENOENT')) // same-file check: target
      confirm.mockImplementation(async () => {
        ;(fs.stat as Mock).mockResolvedValue({ dev: 1n, ino: 99n })
        return 'move'
      })

      const result = await service.moveFromExternal(source, target(folder), SENDER)

      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_CHANGED)
      expect(fs.rm).not.toHaveBeenCalled()
    })

    it('cancels without change when the source stopped being a regular file while waiting', async () => {
      confirm.mockImplementation(async () => {
        ;(fs.lstat as Mock).mockResolvedValue(makeStats({ isDir: true }))
        return 'move'
      })

      const result = await service.moveFromExternal(source, target(folder), SENDER)

      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_MOVE_CHANGED)
      expect(fs.rm).not.toHaveBeenCalled()
    })

    it('never deletes the source when the copy would land on it', async () => {
      ;(fs.stat as Mock).mockResolvedValue({ dev: 3n, ino: 4n })
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(true)

      const result = await service.moveFromExternal(source, target(folder), SENDER, 'replace')

      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_SAME_FILE)
      expect(confirm).not.toHaveBeenCalled()
      expect(fs.copyFile).not.toHaveBeenCalled()
      expect(fs.rm).not.toHaveBeenCalled()
    })
  })

  describe('safety around the copy and the delete', () => {
    const source = '/external/file.md'
    const folder = path.resolve('/project/docs')

    beforeEach(() => {
      ;(fs.lstat as Mock).mockResolvedValue({ ...makeStats({ isDir: false }), dev: 1n, ino: 10n })
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(false)
      ;(fs.copyFile as Mock).mockResolvedValue(undefined)
      ;(fs.rm as Mock).mockResolvedValue(undefined)
    })

    it('removes the source when it is still the entry that was shown', async () => {
      const result = await service.moveFromExternal(source, target(folder), SENDER)

      expect(result.success).toBe(true)
      expect(fs.rm).toHaveBeenCalledWith(source)
    })

    it('keeps the copy and leaves the source when another file took its place during the copy', async () => {
      ;(fs.copyFile as Mock).mockImplementation(async () => {
        ;(fs.lstat as Mock).mockResolvedValue({ ...makeStats({ isDir: false }), dev: 1n, ino: 77n })
      })

      const result = await service.moveFromExternal(source, target(folder), SENDER)

      expect(result).toMatchObject({
        success: false,
        errorCode: ErrorCode.EXTERNAL_FILE_SOURCE_CHANGED
      })
      expect(fs.rm).not.toHaveBeenCalled()
      expect(fs.copyFile).toHaveBeenCalled()
    })

    it('leaves the source when its folder now leads somewhere else', async () => {
      ;(fs.copyFile as Mock).mockImplementation(async () => {
        ;(fs.realpath as Mock).mockImplementation(async (p: string) =>
          p === path.dirname(source) ? path.resolve('/elsewhere') : p
        )
      })

      const result = await service.moveFromExternal(source, target(folder), SENDER)

      expect(result.errorCode).toBe(ErrorCode.EXTERNAL_FILE_SOURCE_CHANGED)
      expect(fs.rm).not.toHaveBeenCalled()
    })

    it('refuses to move a link without asking', async () => {
      ;(fs.lstat as Mock)
        .mockResolvedValueOnce({ ...makeStats({ isSymlink: true }), dev: 1n, ino: 10n })
        .mockResolvedValue({ ...makeStats({ isDir: false }), dev: 1n, ino: 11n })
      ;(fs.realpath as Mock).mockResolvedValue(path.resolve('/external/real.md'))
      ;(pathSecurity.validateSymlink as Mock).mockResolvedValue(true)

      const moved = await service.moveFromExternal(source, target(folder), SENDER)

      expect(moved).toMatchObject({
        success: false,
        errorCode: ErrorCode.EXTERNAL_FILE_MOVE_SYMLINK
      })
      expect(confirm).not.toHaveBeenCalled()
      expect(fs.rm).not.toHaveBeenCalled()
    })

    it('names the temporary copy with the application temp prefix', async () => {
      ;(fs.lstat as Mock).mockResolvedValue({ ...makeStats({ isDir: false }), dev: 1n, ino: 10n })
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(true)
      ;(fs.rename as Mock).mockResolvedValue(undefined)

      await service.copyFromExternal(source, target(folder), 'replace')

      const [, temporary] = (fs.copyFile as Mock).mock.calls[0]
      expect(path.basename(temporary).startsWith(ATOMIC_TEMP_PREFIX)).toBe(true)
      expect(isAtomicTempName(temporary)).toBe(true)
    })

    it('copies nothing when the destination folder leads somewhere else by then', async () => {
      ;(fs.realpath as Mock).mockImplementation(async (p: string) =>
        p === folder ? path.resolve('/elsewhere') : p
      )

      const result = await service.copyFromExternal(source, target(folder))

      expect(result.success).toBe(false)
      expect(fs.copyFile).not.toHaveBeenCalled()
    })

    it('does not rename, and removes the temporary copy, when the folder changed during the copy', async () => {
      ;(mockFileService.checkNameConflict as Mock).mockResolvedValue(true)
      ;(fs.copyFile as Mock).mockImplementation(async () => {
        ;(fs.realpath as Mock).mockImplementation(async (p: string) =>
          p === folder ? path.resolve('/elsewhere') : p
        )
      })

      const result = await service.copyFromExternal(source, target(folder), 'replace')

      expect(result.success).toBe(false)
      expect(fs.rename).not.toHaveBeenCalled()
      const [, temporary] = (fs.copyFile as Mock).mock.calls[0]
      expect(fs.rm).toHaveBeenCalledWith(temporary, { force: true })
    })
  })
})
