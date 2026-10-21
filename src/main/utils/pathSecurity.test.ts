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
import { join, parse, posix, win32 } from 'path'
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
  assertAcceptableProjectRoot,
  isFilesystemRoot,
  isSystemDirectory,
  type SystemPathContext,
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

    describe('Volume roots', () => {
      it('should reject the root of the volume the tests run on', async () => {
        await expect(validateProjectPath(parse(process.cwd()).root)).rejects.toMatchObject({
          code: ErrorCode.PATH_SYSTEM_DIR
        })
      })

      it('should not reach the access check for a root', async () => {
        await validateProjectPath(parse(process.cwd()).root).catch(() => undefined)
        expect(mockedAccess).not.toHaveBeenCalled()
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

describe('isFilesystemRoot', () => {
  it.each([
    ['a POSIX root', posix, posix.sep, true],
    ['a folder under a POSIX root', posix, posix.join(posix.sep, 'a'), false],
    ['a drive root', win32, 'C:\\', true],
    ['a drive root without its separator', win32, 'C:', false],
    ['a folder on a drive', win32, 'C:\\a', false],
    ['a drive root spelled with a forward slash', win32, 'C:/', true],
    ['an extended-length drive root', win32, '\\\\?\\C:\\', true],
    ['an extended-length folder on a drive', win32, '\\\\?\\C:\\a', false],
    ['a share root without its separator', win32, '\\\\srv\\share', true],
    ['an extended-length share root', win32, '\\\\?\\UNC\\srv\\share\\', true],
    ['a share root', win32, '\\\\srv\\share\\', true],
    ['a folder on a share', win32, '\\\\srv\\share\\a', false]
  ])('%s', (_name, flavour, value, expected) => {
    expect(isFilesystemRoot(value, flavour)).toBe(expected)
  })
})

describe('assertAcceptableProjectRoot', () => {
  it('refuses the root of the volume the tests run on', () => {
    expect(() => assertAcceptableProjectRoot(parse(process.cwd()).root)).toThrowError(
      expect.objectContaining({ code: ErrorCode.PATH_SYSTEM_DIR })
    )
  })

  it('refuses a system folder', () => {
    expect(() => assertAcceptableProjectRoot(join(homedir(), '.ssh'))).toThrowError(
      expect.objectContaining({ code: ErrorCode.PATH_SYSTEM_DIR })
    )
  })

  it('accepts an ordinary folder', () => {
    expect(() => assertAcceptableProjectRoot(process.cwd())).not.toThrow()
  })
})

describe('isSystemDirectory – Windows rules on any host', () => {
  const win: SystemPathContext = {
    platform: 'win32',
    flavour: win32,
    home: 'C:\\Users\\me',
    env: {
      SystemRoot: 'D:\\WinNT',
      ProgramFiles: 'D:\\Programs',
      'ProgramFiles(x86)': 'D:\\Programs (x86)',
      ProgramW6432: 'D:\\Programs',
      ProgramData: 'D:\\Data'
    }
  }

  it.each([
    ['the system root from the environment', 'D:\\WinNT'],
    ['a folder below it', 'D:\\WinNT\\System32'],
    ['the same folder spelled in another case', 'd:\\winnt\\system32'],
    ['program files', 'D:\\Programs'],
    ['a folder in program files (x86)', 'D:\\Programs (x86)\\Vendor'],
    ['program data', 'D:\\Data\\Vendor'],
    ['the usual Windows folder, when the environment names another', 'C:\\Windows'],
    ['the usual Program Files folder', 'c:\\program files\\x'],
    ['a trailing separator', 'D:\\WinNT\\'],
    ['a forward-slash spelling', 'D:/WinNT/System32'],
    ['the ssh folder of the user', 'C:\\Users\\me\\.ssh'],
    ['a folder in it, in another case', 'c:\\users\\ME\\.SSH\\keys']
  ])('refuses %s', (_name, value) => {
    expect(isSystemDirectory(value, win)).toBe(true)
  })

  it.each([
    ['a folder of the user', 'C:\\Users\\me\\source'],
    ['the home folder', 'C:\\Users\\me'],
    ['a sibling that merely starts with a system name', 'D:\\WinNTX'],
    ['another drive', 'E:\\work'],
    ['a drive root', 'D:\\']
  ])('allows %s', (_name, value) => {
    expect(isSystemDirectory(value, win)).toBe(false)
  })

  it('ignores an environment value that is relative or a drive root', () => {
    const odd: SystemPathContext = {
      ...win,
      env: { SystemRoot: 'Windows', ProgramFiles: 'E:\\', ProgramData: '' }
    }
    expect(isSystemDirectory('E:\\work', odd)).toBe(false)
    expect(isSystemDirectory('E:\\', odd)).toBe(false)
    expect(isSystemDirectory('C:\\Windows\\x', odd)).toBe(true)
  })

  it('refuses a system folder in a POSIX list only on the platforms that have them', () => {
    expect(isSystemDirectory(posix.join(posix.sep, 'usr', 'local'), { ...win, platform: 'linux', flavour: posix })).toBe(true)
    expect(isSystemDirectory(win32.join('C:\\', 'usr'), win)).toBe(false)
  })
})
