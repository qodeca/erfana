// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * pathSecurity.test.ts
 *
 * todo001: Comprehensive test coverage for path security validation
 *
 * Test groups:
 * - Input validation (5+ tests)
 * - Absolute path requirement (5+ tests)
 * - System directory protection (10+ tests)
 * - Sensitive user directory protection (5+ tests)
 * - Access permissions (5+ tests)
 * - Symlink validation (15+ tests)
 * - isSystemDirectory (5+ tests)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { homedir } from 'os'
import { ErrorCode } from '../../shared/errors'

// Mock fs/promises
vi.mock('fs/promises', () => ({
  lstat: vi.fn(),
  readlink: vi.fn(),
  access: vi.fn(),
  constants: { R_OK: 4, X_OK: 1 }
}))

// Import after mocking
import { lstat, readlink, access } from 'fs/promises'
import {
  isSystemDirectory,
  validateProjectPath,
  validateSymlink,
  validatePath,
  PathSecurityError
} from './pathSecurity'

const mockedLstat = vi.mocked(lstat)
const mockedReadlink = vi.mocked(readlink)
const mockedAccess = vi.mocked(access)

describe('pathSecurity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: access succeeds
    mockedAccess.mockResolvedValue(undefined)
    // Default: not a symlink
    mockedLstat.mockResolvedValue({ isSymbolicLink: () => false } as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe.skipIf(process.platform === 'win32')('isSystemDirectory', () => {
    it('should return true for /System', () => {
      expect(isSystemDirectory('/System')).toBe(true)
    })

    it('should return true for /System subdirectory', () => {
      expect(isSystemDirectory('/System/Library')).toBe(true)
    })

    it('should return true for /usr', () => {
      expect(isSystemDirectory('/usr')).toBe(true)
    })

    it('should return true for /usr/local', () => {
      expect(isSystemDirectory('/usr/local')).toBe(true)
    })

    it('should return true for /etc', () => {
      expect(isSystemDirectory('/etc')).toBe(true)
    })

    it('should return true for /Library', () => {
      expect(isSystemDirectory('/Library')).toBe(true)
    })

    it('should return true for /bin', () => {
      expect(isSystemDirectory('/bin')).toBe(true)
    })

    it('should return true for /sbin', () => {
      expect(isSystemDirectory('/sbin')).toBe(true)
    })

    it('should return true for /var', () => {
      expect(isSystemDirectory('/var')).toBe(true)
    })

    it('should return true for /tmp', () => {
      expect(isSystemDirectory('/tmp')).toBe(true)
    })

    it('should return true for /private', () => {
      expect(isSystemDirectory('/private')).toBe(true)
    })

    it('should return true for /dev', () => {
      expect(isSystemDirectory('/dev')).toBe(true)
    })

    it('should return true for /proc', () => {
      expect(isSystemDirectory('/proc')).toBe(true)
    })

    it('should return true for ~/.ssh', () => {
      const home = homedir()
      expect(isSystemDirectory(`${home}/.ssh`)).toBe(true)
    })

    it('should return true for ~/.gnupg', () => {
      const home = homedir()
      expect(isSystemDirectory(`${home}/.gnupg`)).toBe(true)
    })

    it('should return true for ~/.aws', () => {
      const home = homedir()
      expect(isSystemDirectory(`${home}/.aws`)).toBe(true)
    })

    it('should return true for ~/.config/gcloud', () => {
      const home = homedir()
      expect(isSystemDirectory(`${home}/.config/gcloud`)).toBe(true)
    })

    it('should return true for subdirectory of sensitive directory', () => {
      const home = homedir()
      expect(isSystemDirectory(`${home}/.ssh/keys`)).toBe(true)
    })

    it('should return false for valid user directory', () => {
      const home = homedir()
      expect(isSystemDirectory(`${home}/Projects`)).toBe(false)
    })

    it('should return false for valid project path', () => {
      expect(isSystemDirectory('/Users/john/myproject')).toBe(false)
    })

    it('should handle trailing slashes via normalization', () => {
      expect(isSystemDirectory('/etc/')).toBe(true)
    })

    it('should handle paths with .. segments via normalization', () => {
      // After normalization, /usr/../etc becomes /etc
      expect(isSystemDirectory('/usr/../etc')).toBe(true)
    })

    it('should return false for path that starts with system dir name but is different', () => {
      // /etcetera should NOT match /etc
      expect(isSystemDirectory('/etcetera')).toBe(false)
    })

    it('should return false for path containing system dir as substring', () => {
      // /Users/john/my-usr-project should NOT match /usr
      expect(isSystemDirectory('/Users/john/my-usr-project')).toBe(false)
    })
  })

  // These suites exercise Unix-absolute paths and Unix system directories.
  // The production validator in `pathSecurity.ts` only lists Unix system
  // directories (/etc, /usr, etc.), and on Windows Unix-style paths like
  // `/Users/john/...` are not absolute and fail an earlier isAbsolute check.
  // Skip on Windows – see issue #157.
  describe.skipIf(process.platform === 'win32')('validateProjectPath', () => {
    describe('Input validation', () => {
      it('should reject empty string', async () => {
        await expect(validateProjectPath('')).rejects.toMatchObject({
          code: ErrorCode.PATH_INVALID
        })
      })

      it('should reject null', async () => {
        await expect(validateProjectPath(null as any)).rejects.toMatchObject({
          code: ErrorCode.PATH_INVALID
        })
      })

      it('should reject undefined', async () => {
        await expect(validateProjectPath(undefined as any)).rejects.toMatchObject({
          code: ErrorCode.PATH_INVALID
        })
      })

      it('should reject number', async () => {
        await expect(validateProjectPath(123 as any)).rejects.toMatchObject({
          code: ErrorCode.PATH_INVALID
        })
      })

      it('should reject object', async () => {
        await expect(validateProjectPath({} as any)).rejects.toMatchObject({
          code: ErrorCode.PATH_INVALID
        })
      })

      it('should reject array', async () => {
        await expect(validateProjectPath(['/path'] as any)).rejects.toMatchObject({
          code: ErrorCode.PATH_INVALID
        })
      })
    })

    describe('Absolute path requirement', () => {
      it('should reject relative path ./foo', async () => {
        await expect(validateProjectPath('./foo')).rejects.toMatchObject({
          code: ErrorCode.PATH_NOT_ABSOLUTE
        })
      })

      it('should reject relative path ../foo', async () => {
        await expect(validateProjectPath('../foo')).rejects.toMatchObject({
          code: ErrorCode.PATH_NOT_ABSOLUTE
        })
      })

      it('should reject relative path foo/bar', async () => {
        await expect(validateProjectPath('foo/bar')).rejects.toMatchObject({
          code: ErrorCode.PATH_NOT_ABSOLUTE
        })
      })

      it('should reject relative path starting with name', async () => {
        await expect(validateProjectPath('myproject')).rejects.toMatchObject({
          code: ErrorCode.PATH_NOT_ABSOLUTE
        })
      })

      it('should accept absolute path starting with /', async () => {
        await expect(validateProjectPath('/Users/john/myproject')).resolves.toBeUndefined()
      })

      it('should accept root path', async () => {
        // Note: root itself is blocked as system dir, but we test absolute check first
        mockedAccess.mockRejectedValue(new Error('Permission denied'))
        await expect(validateProjectPath('/Users')).rejects.toMatchObject({
          code: ErrorCode.PATH_NOT_ACCESSIBLE
        })
      })
    })

    describe('System directory protection', () => {
      it('should reject /System', async () => {
        await expect(validateProjectPath('/System')).rejects.toMatchObject({
          code: ErrorCode.PATH_SYSTEM_DIR
        })
      })

      it('should reject /System/Library', async () => {
        await expect(validateProjectPath('/System/Library')).rejects.toMatchObject({
          code: ErrorCode.PATH_SYSTEM_DIR
        })
      })

      it('should reject /usr', async () => {
        await expect(validateProjectPath('/usr')).rejects.toMatchObject({
          code: ErrorCode.PATH_SYSTEM_DIR
        })
      })

      it('should reject /usr/local', async () => {
        await expect(validateProjectPath('/usr/local')).rejects.toMatchObject({
          code: ErrorCode.PATH_SYSTEM_DIR
        })
      })

      it('should reject /etc', async () => {
        await expect(validateProjectPath('/etc')).rejects.toMatchObject({
          code: ErrorCode.PATH_SYSTEM_DIR
        })
      })

      it('should reject /var', async () => {
        await expect(validateProjectPath('/var')).rejects.toMatchObject({
          code: ErrorCode.PATH_SYSTEM_DIR
        })
      })

      it('should reject /tmp', async () => {
        await expect(validateProjectPath('/tmp')).rejects.toMatchObject({
          code: ErrorCode.PATH_SYSTEM_DIR
        })
      })

      it('should reject path with traversal to system dir', async () => {
        // /Users/john/../../etc normalizes to /etc
        await expect(validateProjectPath('/Users/john/../../etc')).rejects.toMatchObject({
          code: ErrorCode.PATH_SYSTEM_DIR
        })
      })

      it('should reject path with multiple traversals to system dir', async () => {
        await expect(validateProjectPath('/Users/john/../../../System')).rejects.toMatchObject({
          code: ErrorCode.PATH_SYSTEM_DIR
        })
      })

      it('should allow path that contains system dir name as substring', async () => {
        // /Users/john/my-etc-project should be allowed
        await expect(validateProjectPath('/Users/john/my-etc-project')).resolves.toBeUndefined()
      })
    })

    describe('Sensitive user directory protection', () => {
      const home = homedir()

      it('should reject ~/.ssh', async () => {
        await expect(validateProjectPath(`${home}/.ssh`)).rejects.toMatchObject({
          code: ErrorCode.PATH_SYSTEM_DIR
        })
      })

      it('should reject ~/.ssh/keys', async () => {
        await expect(validateProjectPath(`${home}/.ssh/keys`)).rejects.toMatchObject({
          code: ErrorCode.PATH_SYSTEM_DIR
        })
      })

      it('should reject ~/.gnupg', async () => {
        await expect(validateProjectPath(`${home}/.gnupg`)).rejects.toMatchObject({
          code: ErrorCode.PATH_SYSTEM_DIR
        })
      })

      it('should reject ~/.aws', async () => {
        await expect(validateProjectPath(`${home}/.aws`)).rejects.toMatchObject({
          code: ErrorCode.PATH_SYSTEM_DIR
        })
      })

      it('should reject ~/.config/gcloud', async () => {
        await expect(validateProjectPath(`${home}/.config/gcloud`)).rejects.toMatchObject({
          code: ErrorCode.PATH_SYSTEM_DIR
        })
      })

      it('should allow ~/.config (not gcloud)', async () => {
        await expect(validateProjectPath(`${home}/.config`)).resolves.toBeUndefined()
      })

      it('should allow regular home subdirectory', async () => {
        await expect(validateProjectPath(`${home}/Projects`)).resolves.toBeUndefined()
      })
    })

    describe('Access permissions', () => {
      it('should reject non-existent path', async () => {
        mockedAccess.mockRejectedValue(new Error('ENOENT: no such file or directory'))
        await expect(validateProjectPath('/Users/john/nonexistent')).rejects.toMatchObject({
          code: ErrorCode.PATH_NOT_ACCESSIBLE
        })
      })

      it('should reject path without read permission', async () => {
        mockedAccess.mockRejectedValue(new Error('EACCES: permission denied'))
        await expect(validateProjectPath('/Users/john/private')).rejects.toMatchObject({
          code: ErrorCode.PATH_NOT_ACCESSIBLE
        })
      })

      it('should include original error message', async () => {
        mockedAccess.mockRejectedValue(new Error('ENOENT: no such file or directory'))
        await expect(validateProjectPath('/Users/john/missing')).rejects.toMatchObject({
          message: expect.stringContaining('ENOENT')
        })
      })

      it('should preserve original error', async () => {
        const originalError = new Error('Original error')
        mockedAccess.mockRejectedValue(originalError)
        await expect(validateProjectPath('/Users/john/test')).rejects.toMatchObject({
          originalError
        })
      })

      it('should accept accessible path', async () => {
        mockedAccess.mockResolvedValue(undefined)
        await expect(validateProjectPath('/Users/john/myproject')).resolves.toBeUndefined()
      })
    })
  })

  describe.skipIf(process.platform === 'win32')('validateSymlink', () => {
    describe('Non-symlink paths', () => {
      it('should return false for regular directory', async () => {
        mockedLstat.mockResolvedValue({ isSymbolicLink: () => false } as any)
        const result = await validateSymlink('/Users/john/myproject')
        expect(result).toBe(false)
      })

      it('should return false for regular file', async () => {
        mockedLstat.mockResolvedValue({ isSymbolicLink: () => false } as any)
        const result = await validateSymlink('/Users/john/file.txt')
        expect(result).toBe(false)
      })

      it('should return false when lstat fails (path does not exist)', async () => {
        mockedLstat.mockRejectedValue(new Error('ENOENT'))
        const result = await validateSymlink('/nonexistent')
        expect(result).toBe(false)
      })
    })

    describe('Valid symlinks', () => {
      it('should return true for valid symlink with absolute target', async () => {
        mockedLstat.mockResolvedValue({ isSymbolicLink: () => true } as any)
        mockedReadlink.mockResolvedValue('/Users/john/real-project')
        mockedAccess.mockResolvedValue(undefined)

        const result = await validateSymlink('/Users/john/symlink-project')
        expect(result).toBe(true)
      })

      it('should return true for valid symlink with relative target', async () => {
        mockedLstat.mockResolvedValue({ isSymbolicLink: () => true } as any)
        mockedReadlink.mockResolvedValue('../real-project') // Relative target
        mockedAccess.mockResolvedValue(undefined)

        const result = await validateSymlink('/Users/john/links/symlink-project')
        expect(result).toBe(true)
      })

      it('should resolve relative symlink target correctly', async () => {
        mockedLstat.mockResolvedValue({ isSymbolicLink: () => true } as any)
        mockedReadlink.mockResolvedValue('./subdir')
        mockedAccess.mockResolvedValue(undefined)

        const result = await validateSymlink('/Users/john/myproject')
        expect(result).toBe(true)
        // Should have checked access on resolved path
        expect(mockedAccess).toHaveBeenCalled()
      })
    })

    describe('Dangerous symlinks - system directory targets', () => {
      it('should reject symlink to /etc', async () => {
        mockedLstat.mockResolvedValue({ isSymbolicLink: () => true } as any)
        mockedReadlink.mockResolvedValue('/etc')

        await expect(validateSymlink('/Users/john/my-symlink')).rejects.toMatchObject({
          code: ErrorCode.SYMLINK_ATTACK
        })
      })

      it('should reject symlink to /System', async () => {
        mockedLstat.mockResolvedValue({ isSymbolicLink: () => true } as any)
        mockedReadlink.mockResolvedValue('/System')

        await expect(validateSymlink('/Users/john/my-symlink')).rejects.toMatchObject({
          code: ErrorCode.SYMLINK_ATTACK
        })
      })

      it('should reject symlink to ~/.ssh', async () => {
        const home = homedir()
        mockedLstat.mockResolvedValue({ isSymbolicLink: () => true } as any)
        mockedReadlink.mockResolvedValue(`${home}/.ssh`)

        await expect(validateSymlink('/Users/john/my-symlink')).rejects.toMatchObject({
          code: ErrorCode.SYMLINK_ATTACK
        })
      })

      it('should reject relative symlink resolving to system dir', async () => {
        mockedLstat.mockResolvedValue({ isSymbolicLink: () => true } as any)
        mockedReadlink.mockResolvedValue('../../etc') // Relative, resolves to system dir

        // Symlink at /Users/john/links/symlink resolving ../../etc = /Users/etc (not system)
        // But let's test /etc directly
        mockedReadlink.mockResolvedValue('../../../etc')
        // From /Users/john/test, ../../../etc = /etc

        await expect(validateSymlink('/Users/john/test')).rejects.toMatchObject({
          code: ErrorCode.SYMLINK_ATTACK
        })
      })
    })

    describe('Inaccessible symlink targets', () => {
      it('should reject symlink with inaccessible target', async () => {
        mockedLstat.mockResolvedValue({ isSymbolicLink: () => true } as any)
        mockedReadlink.mockResolvedValue('/Users/john/private-dir')
        mockedAccess.mockRejectedValue(new Error('EACCES: permission denied'))

        await expect(validateSymlink('/Users/john/my-symlink')).rejects.toMatchObject({
          code: ErrorCode.PATH_NOT_ACCESSIBLE
        })
      })

      it('should include error message for inaccessible target', async () => {
        mockedLstat.mockResolvedValue({ isSymbolicLink: () => true } as any)
        mockedReadlink.mockResolvedValue('/Users/john/missing')
        mockedAccess.mockRejectedValue(new Error('ENOENT: no such file or directory'))

        await expect(validateSymlink('/Users/john/broken-link')).rejects.toMatchObject({
          message: expect.stringContaining('ENOENT')
        })
      })
    })

    describe('Broken symlinks', () => {
      it('should reject broken symlink (readlink fails)', async () => {
        mockedLstat.mockResolvedValue({ isSymbolicLink: () => true } as any)
        mockedReadlink.mockRejectedValue(new Error('ENOENT: broken symlink'))

        await expect(validateSymlink('/Users/john/broken-link')).rejects.toMatchObject({
          code: ErrorCode.SYMLINK_ATTACK
        })
      })

      it('should include original error for broken symlink', async () => {
        mockedLstat.mockResolvedValue({ isSymbolicLink: () => true } as any)
        const originalError = new Error('Symlink error')
        mockedReadlink.mockRejectedValue(originalError)

        await expect(validateSymlink('/Users/john/bad-link')).rejects.toMatchObject({
          originalError
        })
      })
    })
  })

  describe.skipIf(process.platform === 'win32')('validatePath (main entry point)', () => {
    it('should call validateProjectPath first', async () => {
      // Invalid path should fail at validateProjectPath
      await expect(validatePath('')).rejects.toMatchObject({
        code: ErrorCode.PATH_INVALID
      })
    })

    it('should call validateSymlink after validateProjectPath succeeds', async () => {
      mockedAccess.mockResolvedValue(undefined)
      mockedLstat.mockResolvedValue({ isSymbolicLink: () => true } as any)
      mockedReadlink.mockResolvedValue('/etc') // Dangerous target

      await expect(validatePath('/Users/john/symlink')).rejects.toMatchObject({
        code: ErrorCode.SYMLINK_ATTACK
      })
    })

    it('should succeed for valid non-symlink path', async () => {
      mockedAccess.mockResolvedValue(undefined)
      mockedLstat.mockResolvedValue({ isSymbolicLink: () => false } as any)

      await expect(validatePath('/Users/john/myproject')).resolves.toBeUndefined()
    })

    it('should succeed for valid symlink path', async () => {
      mockedAccess.mockResolvedValue(undefined)
      mockedLstat.mockResolvedValue({ isSymbolicLink: () => true } as any)
      mockedReadlink.mockResolvedValue('/Users/john/real-project')

      await expect(validatePath('/Users/john/symlink')).resolves.toBeUndefined()
    })

    it('should fail early if path is system directory (before symlink check)', async () => {
      await expect(validatePath('/etc')).rejects.toMatchObject({
        code: ErrorCode.PATH_SYSTEM_DIR
      })
      // lstat should not be called since validateProjectPath fails first
      expect(mockedLstat).not.toHaveBeenCalled()
    })
  })

  describe('PathSecurityError export', () => {
    it('should be exported for backwards compatibility', () => {
      expect(PathSecurityError).toBeDefined()
    })

    it('should be AppError class', async () => {
      try {
        await validateProjectPath('')
      } catch (error) {
        expect(error).toBeInstanceOf(PathSecurityError)
      }
    })
  })
})
