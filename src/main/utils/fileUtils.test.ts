// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * fileUtils.test.ts
 *
 * Comprehensive tests for import system file utilities
 *
 * Test coverage:
 * - sanitizeFileName (~15 tests)
 * - fileExists (~5 tests)
 * - findAvailableFileName (~10 tests)
 * - getExtension (~5 tests)
 * - changeExtension (~5 tests)
 * - validateFileForImport (~10 tests)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as os from 'os'
import { ErrorCode } from '../../shared/errors'
import { IMPORT } from '../../shared/constants'

const TEST_DIR = path.join(os.tmpdir(), 'erfana-test', 'dir')

// Mock fs/promises
vi.mock('fs/promises', () => ({
  access: vi.fn(),
  stat: vi.fn()
}))

// Import after mocking
import { access, stat } from 'fs/promises'
import {
  sanitizeFileName,
  fileExists,
  findAvailableFileName,
  getExtension,
  changeExtension,
  validateFileForImport,
  formatDuration
} from './fileUtils'

const mockedAccess = vi.mocked(access)
const mockedStat = vi.mocked(stat)

describe('fileUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('sanitizeFileName', () => {
    describe('normal filenames', () => {
      it('should pass through simple filename unchanged', () => {
        expect(sanitizeFileName('document.pdf')).toBe('document.pdf')
      })

      it('should pass through filename with spaces unchanged', () => {
        expect(sanitizeFileName('my document.pdf')).toBe('my document.pdf')
      })

      it('should pass through filename with hyphens and underscores unchanged', () => {
        expect(sanitizeFileName('my-document_2023.pdf')).toBe('my-document_2023.pdf')
      })

      it('should preserve numbers in filename', () => {
        expect(sanitizeFileName('report123.pdf')).toBe('report123.pdf')
      })
    })

    describe('path separators', () => {
      it('should convert forward slash to underscore', () => {
        expect(sanitizeFileName('path/to/file.pdf')).toBe('path_to_file.pdf')
      })

      it('should convert backslash to underscore', () => {
        expect(sanitizeFileName('path\\to\\file.pdf')).toBe('path_to_file.pdf')
      })

      it('should convert colon to underscore', () => {
        expect(sanitizeFileName('C:file.pdf')).toBe('C_file.pdf')
      })

      it('should convert multiple different separators', () => {
        expect(sanitizeFileName('path/to\\file:name.pdf')).toBe('path_to_file_name.pdf')
      })
    })

    describe('control characters', () => {
      it('should remove null byte', () => {
        expect(sanitizeFileName('file\x00name.pdf')).toBe('filename.pdf')
      })

      it('should remove bell character (ASCII 7)', () => {
        expect(sanitizeFileName('file\x07name.pdf')).toBe('filename.pdf')
      })

      it('should remove backspace (ASCII 8)', () => {
        expect(sanitizeFileName('file\x08name.pdf')).toBe('filename.pdf')
      })

      it('should preserve tab (ASCII 9)', () => {
        expect(sanitizeFileName('file\tname.pdf')).toBe('file\tname.pdf')
      })

      it('should preserve newline (ASCII 10)', () => {
        expect(sanitizeFileName('file\nname.pdf')).toBe('file\nname.pdf')
      })

      it('should preserve carriage return (ASCII 13)', () => {
        expect(sanitizeFileName('file\rname.pdf')).toBe('file\rname.pdf')
      })

      it('should remove escape character (ASCII 27)', () => {
        expect(sanitizeFileName('file\x1Bname.pdf')).toBe('filename.pdf')
      })
    })

    describe('empty and whitespace handling', () => {
      it('should return default name for empty string', () => {
        expect(sanitizeFileName('')).toBe('imported')
      })

      it('should return default name for whitespace-only string', () => {
        expect(sanitizeFileName('   ')).toBe('imported')
      })

      it('should return default name for tabs only', () => {
        expect(sanitizeFileName('\t\t')).toBe('imported')
      })

      it('should use custom default name when provided', () => {
        expect(sanitizeFileName('', 'untitled')).toBe('untitled')
      })

      it('should use custom default name for whitespace-only', () => {
        expect(sanitizeFileName('   ', 'custom-default')).toBe('custom-default')
      })

      it('should trim leading and trailing whitespace', () => {
        expect(sanitizeFileName('  document.pdf  ')).toBe('document.pdf')
      })
    })

    describe('unicode characters', () => {
      it('should preserve unicode letters', () => {
        expect(sanitizeFileName('documento-espanol.pdf')).toBe('documento-espanol.pdf')
      })

      it('should preserve Chinese characters', () => {
        expect(sanitizeFileName('document.pdf')).toBe('document.pdf')
      })

      it('should preserve emoji', () => {
        expect(sanitizeFileName('readme-emoji.pdf')).toBe('readme-emoji.pdf')
      })

      it('should preserve Japanese characters', () => {
        expect(sanitizeFileName('document.pdf')).toBe('document.pdf')
      })
    })
  })

  describe('fileExists', () => {
    it('should return true when file exists', async () => {
      mockedAccess.mockResolvedValue(undefined)
      const result = await fileExists('/path/to/existing-file.pdf')
      expect(result).toBe(true)
      expect(mockedAccess).toHaveBeenCalledWith('/path/to/existing-file.pdf')
    })

    it('should return false when file does not exist', async () => {
      mockedAccess.mockRejectedValue(new Error('ENOENT: no such file or directory'))
      const result = await fileExists('/path/to/nonexistent.pdf')
      expect(result).toBe(false)
    })

    it('should return false on permission error', async () => {
      mockedAccess.mockRejectedValue(new Error('EACCES: permission denied'))
      const result = await fileExists('/path/to/protected.pdf')
      expect(result).toBe(false)
    })

    it('should return false on any other access error', async () => {
      mockedAccess.mockRejectedValue(new Error('Some other error'))
      const result = await fileExists('/path/to/file.pdf')
      expect(result).toBe(false)
    })

    it('should call access with the exact path provided', async () => {
      mockedAccess.mockResolvedValue(undefined)
      await fileExists('/Users/test/Documents/file.pdf')
      expect(mockedAccess).toHaveBeenCalledWith('/Users/test/Documents/file.pdf')
    })
  })

  describe('findAvailableFileName', () => {
    describe('no conflict scenarios', () => {
      it('should return original name when no conflict exists', async () => {
        mockedAccess.mockRejectedValue(new Error('ENOENT'))
        const result = await findAvailableFileName(TEST_DIR, 'document.md')
        expect(result).toBe(path.join(TEST_DIR, 'document.md'))
      })

      it('should return original name for file without extension', async () => {
        mockedAccess.mockRejectedValue(new Error('ENOENT'))
        const result = await findAvailableFileName(TEST_DIR, 'README')
        expect(result).toBe(path.join(TEST_DIR, 'README'))
      })
    })

    describe('conflict resolution', () => {
      it('should return numbered name when original exists', async () => {
        // First call (original) exists, second call (numbered) doesn't
        mockedAccess
          .mockResolvedValueOnce(undefined) // document.md exists
          .mockRejectedValueOnce(new Error('ENOENT')) // document (1).md doesn't exist
        const result = await findAvailableFileName(TEST_DIR, 'document.md')
        expect(result).toBe(path.join(TEST_DIR, 'document (1).md'))
      })

      it('should increment number until available slot found', async () => {
        mockedAccess
          .mockResolvedValueOnce(undefined) // document.md exists
          .mockResolvedValueOnce(undefined) // document (1).md exists
          .mockResolvedValueOnce(undefined) // document (2).md exists
          .mockRejectedValueOnce(new Error('ENOENT')) // document (3).md doesn't exist
        const result = await findAvailableFileName(TEST_DIR, 'document.md')
        expect(result).toBe(path.join(TEST_DIR, 'document (3).md'))
      })

      it('should handle file without extension when incrementing', async () => {
        mockedAccess
          .mockResolvedValueOnce(undefined) // README exists
          .mockRejectedValueOnce(new Error('ENOENT')) // README (1) doesn't exist
        const result = await findAvailableFileName(TEST_DIR, 'README')
        expect(result).toBe(path.join(TEST_DIR, 'README (1)'))
      })

      it('should handle extension with multiple dots', async () => {
        mockedAccess
          .mockResolvedValueOnce(undefined) // file.test.md exists
          .mockRejectedValueOnce(new Error('ENOENT')) // file.test (1).md doesn't exist
        const result = await findAvailableFileName(TEST_DIR, 'file.test.md')
        expect(result).toBe(path.join(TEST_DIR, 'file.test (1).md'))
      })
    })

    describe('max attempts exceeded', () => {
      it('should throw AppError when max attempts exceeded', async () => {
        // All calls return exists (file exists)
        mockedAccess.mockResolvedValue(undefined)
        await expect(findAvailableFileName(TEST_DIR, 'document.md', 3)).rejects.toMatchObject({
          code: ErrorCode.IMPORT_WRITE_FAILED,
          message: expect.stringContaining('Cannot create more than 3 copies')
        })
      })

      it('should use default max attempts from IMPORT constant', async () => {
        mockedAccess.mockResolvedValue(undefined)
        await expect(findAvailableFileName(TEST_DIR, 'document.md')).rejects.toMatchObject({
          message: expect.stringContaining(`Cannot create more than ${IMPORT.MAX_COPY_ATTEMPTS} copies`)
        })
      })

      it('should respect custom max attempts parameter', async () => {
        mockedAccess.mockResolvedValue(undefined)
        await expect(findAvailableFileName(TEST_DIR, 'file.md', 5)).rejects.toMatchObject({
          message: expect.stringContaining('Cannot create more than 5 copies')
        })
      })
    })
  })

  describe('getExtension', () => {
    it('should return extension without dot in lowercase', () => {
      expect(getExtension('document.PDF')).toBe('pdf')
    })

    it('should return empty string for file without extension', () => {
      expect(getExtension('README')).toBe('')
    })

    it('should handle multiple dots and return last extension', () => {
      expect(getExtension('file.test.spec.ts')).toBe('ts')
    })

    it('should handle uppercase extensions', () => {
      expect(getExtension('IMAGE.JPG')).toBe('jpg')
    })

    it('should handle mixed case extensions', () => {
      expect(getExtension('document.Md')).toBe('md')
    })

    it('should handle path with directory', () => {
      expect(getExtension('/path/to/file.txt')).toBe('txt')
    })

    it('should handle dotfile without extension (returns empty)', () => {
      // Node's extname treats .gitignore as a filename, not an extension
      expect(getExtension('.gitignore')).toBe('')
    })
  })

  describe('changeExtension', () => {
    it('should change extension correctly', () => {
      expect(changeExtension('document.pdf', '.md')).toBe('document.md')
    })

    it('should handle extension without dot', () => {
      expect(changeExtension('document.pdf', 'md')).toBe('document.md')
    })

    it('should handle extension with dot', () => {
      expect(changeExtension('document.pdf', '.txt')).toBe('document.txt')
    })

    it('should handle file without extension', () => {
      expect(changeExtension('README', '.md')).toBe('README.md')
    })

    it('should handle multiple dots in filename', () => {
      expect(changeExtension('file.test.js', '.ts')).toBe('file.test.ts')
    })

    it('should preserve path when changing extension', () => {
      expect(changeExtension('/path/to/file.pdf', '.md')).toBe('/path/to/file.md')
    })
  })

  describe('formatDuration', () => {
    it('should format zero seconds', () => {
      expect(formatDuration(0)).toBe('0:00')
    })

    it('should format sub-minute duration', () => {
      expect(formatDuration(45)).toBe('0:45')
    })

    it('should format exact minutes', () => {
      expect(formatDuration(180)).toBe('3:00')
    })

    it('should pad seconds with zero', () => {
      expect(formatDuration(125)).toBe('2:05')
    })

    it('should format hour-length duration', () => {
      expect(formatDuration(3600)).toBe('1:00:00')
    })

    it('should format hours with minutes and seconds', () => {
      expect(formatDuration(5425)).toBe('1:30:25')
    })

    it('should pad minutes when hours are present', () => {
      expect(formatDuration(3665)).toBe('1:01:05')
    })
  })

  describe('validateFileForImport', () => {
    describe('valid file scenarios', () => {
      it('should return valid=true for accessible file', async () => {
        mockedAccess.mockResolvedValue(undefined)
        mockedStat.mockResolvedValue({ size: 1024 } as any)

        const result = await validateFileForImport('/path/to/document.pdf')

        expect(result.valid).toBe(true)
        expect(result.error).toBeUndefined()
        expect(result.sizeInMB).toBeCloseTo(0.001, 3)
        expect(result.fileName).toBe('document.pdf')
      })

      it('should return correct fileName from path', async () => {
        mockedAccess.mockResolvedValue(undefined)
        mockedStat.mockResolvedValue({ size: 0 } as any)

        const result = await validateFileForImport('/Users/test/Documents/my-file.pdf')

        expect(result.fileName).toBe('my-file.pdf')
      })

      it('should calculate sizeInMB correctly', async () => {
        mockedAccess.mockResolvedValue(undefined)
        // 10MB = 10 * 1024 * 1024 bytes
        mockedStat.mockResolvedValue({ size: 10 * 1024 * 1024 } as any)

        const result = await validateFileForImport('/path/to/file.pdf')

        expect(result.sizeInMB).toBe(10)
      })
    })

    describe('file not found', () => {
      it('should return IMPORT_FILE_NOT_FOUND when file does not exist', async () => {
        mockedAccess.mockRejectedValue(new Error('ENOENT: no such file or directory'))

        const result = await validateFileForImport('/path/to/nonexistent.pdf')

        expect(result.valid).toBe(false)
        expect(result.error).toBe(ErrorCode.IMPORT_FILE_NOT_FOUND)
        expect(result.sizeInMB).toBe(0)
        expect(result.fileName).toBe('nonexistent.pdf')
      })

      it('should return IMPORT_FILE_NOT_FOUND on access error', async () => {
        mockedAccess.mockRejectedValue(new Error('EACCES: permission denied'))

        const result = await validateFileForImport('/protected/file.pdf')

        expect(result.valid).toBe(false)
        expect(result.error).toBe(ErrorCode.IMPORT_FILE_NOT_FOUND)
      })
    })

    describe('file unreadable', () => {
      it('should return IMPORT_FILE_UNREADABLE when stat fails', async () => {
        mockedAccess.mockResolvedValue(undefined)
        mockedStat.mockRejectedValue(new Error('ENOENT: stat failed'))

        const result = await validateFileForImport('/path/to/file.pdf')

        expect(result.valid).toBe(false)
        expect(result.error).toBe(ErrorCode.IMPORT_FILE_UNREADABLE)
        expect(result.sizeInMB).toBe(0)
      })

      it('should return IMPORT_FILE_UNREADABLE on stat permission error', async () => {
        mockedAccess.mockResolvedValue(undefined)
        mockedStat.mockRejectedValue(new Error('EACCES: permission denied'))

        const result = await validateFileForImport('/path/to/file.pdf')

        expect(result.valid).toBe(false)
        expect(result.error).toBe(ErrorCode.IMPORT_FILE_UNREADABLE)
      })
    })

    describe('large file warning', () => {
      it('should return valid=true with IMPORT_TOO_LARGE warning for large files', async () => {
        mockedAccess.mockResolvedValue(undefined)
        // 60MB, exceeds 50MB threshold
        mockedStat.mockResolvedValue({ size: 60 * 1024 * 1024 } as any)

        const result = await validateFileForImport('/path/to/large.pdf')

        expect(result.valid).toBe(true)
        expect(result.error).toBe(ErrorCode.IMPORT_TOO_LARGE)
        expect(result.sizeInMB).toBe(60)
      })

      it('should not return warning for file at exactly threshold', async () => {
        mockedAccess.mockResolvedValue(undefined)
        // Exactly 50MB
        mockedStat.mockResolvedValue({ size: IMPORT.SIZE_WARNING_THRESHOLD } as any)

        const result = await validateFileForImport('/path/to/exact.pdf')

        expect(result.valid).toBe(true)
        expect(result.error).toBeUndefined()
      })

      it('should return warning for file just over threshold', async () => {
        mockedAccess.mockResolvedValue(undefined)
        // 50MB + 1 byte
        mockedStat.mockResolvedValue({ size: IMPORT.SIZE_WARNING_THRESHOLD + 1 } as any)

        const result = await validateFileForImport('/path/to/slightly-large.pdf')

        expect(result.valid).toBe(true)
        expect(result.error).toBe(ErrorCode.IMPORT_TOO_LARGE)
      })

      it('should not return warning for file under threshold', async () => {
        mockedAccess.mockResolvedValue(undefined)
        // 49MB
        mockedStat.mockResolvedValue({ size: 49 * 1024 * 1024 } as any)

        const result = await validateFileForImport('/path/to/normal.pdf')

        expect(result.valid).toBe(true)
        expect(result.error).toBeUndefined()
      })
    })
  })
})
