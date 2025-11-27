/**
 * Pure Logic Tests for File Path Links in Terminal Output
 *
 * Tests for pure functions in filePathLinks.logic.ts:
 * - detectFilePaths(): Pattern matching for various file path formats
 * - parseLineColumn(): Extracting line/column from path strings
 * - resolvePath(): Resolving relative paths to absolute paths
 * - createPathCache(): LRU cache with TTL for path validation
 * - normalizePath(): Path normalization (backslash to forward slash)
 * - stripAnsi(): Removing ANSI escape sequences
 * - isWindows(): Platform detection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  detectFilePaths,
  parseLineColumn,
  resolvePath,
  createPathCache,
  normalizePath,
  stripAnsi,
  isWindows,
  type PathCache,
  type PathCacheEntry
} from './filePathLinks.logic'

describe('filePathLinks.logic', () => {
  describe('stripAnsi()', () => {
    it('removes ANSI color codes', () => {
      const text = '\x1b[31mRed Text\x1b[0m'
      expect(stripAnsi(text)).toBe('Red Text')
    })

    it('removes multiple ANSI codes', () => {
      const text = '\x1b[31m\x1b[1mBold Red\x1b[0m\x1b[32mGreen\x1b[0m'
      expect(stripAnsi(text)).toBe('Bold RedGreen')
    })

    it('removes CSI sequences with parameters', () => {
      const text = '\x1b[38;5;196mCustom Color\x1b[0m'
      expect(stripAnsi(text)).toBe('Custom Color')
    })

    it('preserves text without ANSI codes', () => {
      const text = 'Plain text without codes'
      expect(stripAnsi(text)).toBe('Plain text without codes')
    })

    it('handles empty string', () => {
      expect(stripAnsi('')).toBe('')
    })

    it('handles only ANSI codes', () => {
      const text = '\x1b[31m\x1b[0m'
      expect(stripAnsi(text)).toBe('')
    })

    it('removes ANSI codes from file path output', () => {
      const text = '\x1b[31merror\x1b[0m in \x1b[36m/path/to/file.ts\x1b[0m:42'
      expect(stripAnsi(text)).toBe('error in /path/to/file.ts:42')
    })
  })

  describe('isWindows()', () => {
    let originalPlatform: string

    beforeEach(() => {
      originalPlatform = process.platform
    })

    afterEach(() => {
      // Restore original platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        writable: true,
        configurable: true
      })
    })

    it('returns true for win32', () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true
      })
      expect(isWindows()).toBe(true)
    })

    it('returns false for darwin', () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
        configurable: true
      })
      expect(isWindows()).toBe(false)
    })

    it('returns false for linux', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true
      })
      expect(isWindows()).toBe(false)
    })
  })

  describe('normalizePath()', () => {
    it('converts backslashes to forward slashes', () => {
      expect(normalizePath('C:\\path\\to\\file.ts')).toBe('C:/path/to/file.ts')
    })

    it('handles mixed separators', () => {
      expect(normalizePath('C:\\path/to\\file.ts')).toBe('C:/path/to/file.ts')
    })

    it('preserves POSIX paths', () => {
      expect(normalizePath('/path/to/file.ts')).toBe('/path/to/file.ts')
    })

    it('handles paths with no separators', () => {
      expect(normalizePath('file.ts')).toBe('file.ts')
    })

    it('handles empty string', () => {
      expect(normalizePath('')).toBe('')
    })

    it('handles UNC paths', () => {
      expect(normalizePath('\\\\server\\share\\file.ts')).toBe('//server/share/file.ts')
    })

    it('handles relative paths with backslashes', () => {
      expect(normalizePath('.\\src\\file.ts')).toBe('./src/file.ts')
    })
  })

  describe('parseLineColumn()', () => {
    describe('path only', () => {
      it('returns path without position info', () => {
        expect(parseLineColumn('file.ts')).toEqual({ path: 'file.ts' })
      })

      it('returns absolute path without position', () => {
        expect(parseLineColumn('/path/to/file.ts')).toEqual({ path: '/path/to/file.ts' })
      })

      it('returns Windows path without position', () => {
        expect(parseLineColumn('C:/path/to/file.ts')).toEqual({ path: 'C:/path/to/file.ts' })
      })
    })

    describe('colon format - line only', () => {
      it('parses path with line number', () => {
        expect(parseLineColumn('file.ts:42')).toEqual({ path: 'file.ts', line: 42 })
      })

      it('parses absolute path with line number', () => {
        expect(parseLineColumn('/path/to/file.ts:42')).toEqual({
          path: '/path/to/file.ts',
          line: 42
        })
      })

      it('parses Windows path with line number', () => {
        expect(parseLineColumn('C:/path/to/file.ts:42')).toEqual({
          path: 'C:/path/to/file.ts',
          line: 42
        })
      })
    })

    describe('colon format - line and column', () => {
      it('parses path with line and column', () => {
        expect(parseLineColumn('file.ts:42:10')).toEqual({
          path: 'file.ts',
          line: 42,
          column: 10
        })
      })

      it('parses absolute path with line and column', () => {
        expect(parseLineColumn('/path/to/file.ts:100:25')).toEqual({
          path: '/path/to/file.ts',
          line: 100,
          column: 25
        })
      })

      it('parses Windows path with line and column', () => {
        expect(parseLineColumn('C:/path/to/file.ts:42:10')).toEqual({
          path: 'C:/path/to/file.ts',
          line: 42,
          column: 10
        })
      })
    })

    describe('grep format - trailing colon', () => {
      it('parses grep format with trailing colon', () => {
        expect(parseLineColumn('file.ts:42:')).toEqual({ path: 'file.ts', line: 42 })
      })

      it('parses grep format with line and column and trailing colon', () => {
        expect(parseLineColumn('file.ts:42:10:')).toEqual({
          path: 'file.ts',
          line: 42,
          column: 10
        })
      })
    })

    describe('TypeScript error format - parens', () => {
      it('parses TypeScript format file.ts(15,3)', () => {
        expect(parseLineColumn('file.ts(15,3)')).toEqual({
          path: 'file.ts',
          line: 15,
          column: 3
        })
      })

      it('parses absolute path in TypeScript format', () => {
        expect(parseLineColumn('/path/to/file.ts(100,25)')).toEqual({
          path: '/path/to/file.ts',
          line: 100,
          column: 25
        })
      })

      it('parses Windows path in TypeScript format', () => {
        expect(parseLineColumn('C:/path/to/file.ts(42,10)')).toEqual({
          path: 'C:/path/to/file.ts',
          line: 42,
          column: 10
        })
      })
    })

    describe('edge cases', () => {
      it('handles large line numbers', () => {
        expect(parseLineColumn('file.ts:999999')).toEqual({ path: 'file.ts', line: 999999 })
      })

      it('handles large column numbers', () => {
        expect(parseLineColumn('file.ts:42:999999')).toEqual({
          path: 'file.ts',
          line: 42,
          column: 999999
        })
      })

      it('handles line number 0', () => {
        expect(parseLineColumn('file.ts:0')).toEqual({ path: 'file.ts', line: 0 })
      })

      it('handles column number 0', () => {
        expect(parseLineColumn('file.ts:42:0')).toEqual({
          path: 'file.ts',
          line: 42,
          column: 0
        })
      })

      it('does not parse invalid format with letters', () => {
        expect(parseLineColumn('file.ts:abc')).toEqual({ path: 'file.ts:abc' })
      })

      it('does not parse format with non-numeric line', () => {
        expect(parseLineColumn('file.ts:42:abc')).toEqual({ path: 'file.ts:42:abc' })
      })
    })
  })

  describe('resolvePath()', () => {
    describe('absolute paths', () => {
      it('returns absolute POSIX path unchanged', () => {
        expect(resolvePath('/path/to/file.ts', '/cwd', '/project')).toBe('/path/to/file.ts')
      })

      it('returns absolute Windows path unchanged', () => {
        expect(resolvePath('C:/path/to/file.ts', '/cwd', '/project')).toBe('C:/path/to/file.ts')
      })

      it('returns absolute path with backslashes normalized', () => {
        expect(resolvePath('C:\\path\\to\\file.ts', '/cwd', '/project')).toBe('C:/path/to/file.ts')
      })

      it('handles absolute path with different drive letter', () => {
        expect(resolvePath('D:/data/file.ts', '/cwd', '/project')).toBe('D:/data/file.ts')
      })
    })

    describe('relative paths - CWD priority', () => {
      it('resolves ./ relative to CWD', () => {
        expect(resolvePath('./src/file.ts', '/home/user/project', '/project')).toBe(
          '/home/user/project/./src/file.ts'
        )
      })

      it('resolves ../ relative to CWD', () => {
        expect(resolvePath('../utils/helper.ts', '/home/user/project/src', '/project')).toBe(
          '/home/user/project/src/../utils/helper.ts'
        )
      })

      it('resolves multiple ../ relative to CWD', () => {
        expect(resolvePath('../../file.ts', '/home/user/project/src/main', '/project')).toBe(
          '/home/user/project/src/main/../../file.ts'
        )
      })
    })

    describe('project-relative paths', () => {
      it('resolves to project root when no CWD', () => {
        expect(resolvePath('src/main/index.ts', '', '/home/user/project')).toBe(
          '/home/user/project/src/main/index.ts'
        )
      })

      it('resolves simple path to project root', () => {
        expect(resolvePath('package.json', '', '/home/user/project')).toBe(
          '/home/user/project/package.json'
        )
      })
    })

    describe('CWD vs projectRoot priority', () => {
      it('prefers CWD over projectRoot for relative paths', () => {
        expect(resolvePath('src/file.ts', '/home/user/project/build', '/home/user/project')).toBe(
          '/home/user/project/build/src/file.ts'
        )
      })

      it('uses projectRoot when CWD is empty', () => {
        expect(resolvePath('src/file.ts', '', '/home/user/project')).toBe(
          '/home/user/project/src/file.ts'
        )
      })
    })

    describe('Windows paths', () => {
      it('resolves Windows relative path with CWD', () => {
        expect(resolvePath('.\\src\\file.ts', 'C:/Users/name/project', 'C:/project')).toBe(
          'C:/Users/name/project/./src/file.ts'
        )
      })

      it('resolves Windows path to project root', () => {
        expect(resolvePath('src\\main\\index.ts', '', 'C:/project')).toBe(
          'C:/project/src/main/index.ts'
        )
      })
    })

    describe('edge cases', () => {
      it('returns path as-is when both CWD and projectRoot are empty', () => {
        expect(resolvePath('src/file.ts', '', '')).toBe('src/file.ts')
      })

      it('handles empty path', () => {
        expect(resolvePath('', '/cwd', '/project')).toBe('/cwd/')
      })

      it('handles path with trailing slash', () => {
        expect(resolvePath('./src/', '/cwd', '/project')).toBe('/cwd/./src/')
      })
    })
  })

  describe('detectFilePaths()', () => {
    describe('absolute POSIX paths', () => {
      it('detects simple absolute path', () => {
        const matches = detectFilePaths('Error in /path/to/file.ts')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: '/path/to/file.ts',
          path: '/path/to/file.ts',
          line: undefined,
          column: undefined
        })
      })

      it('detects absolute path with line number', () => {
        const matches = detectFilePaths('Error at /path/to/file.ts:42')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: '/path/to/file.ts:42',
          path: '/path/to/file.ts',
          line: 42,
          column: undefined
        })
      })

      it('detects absolute path with line and column', () => {
        const matches = detectFilePaths('Error at /path/to/file.ts:42:10')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: '/path/to/file.ts:42:10',
          path: '/path/to/file.ts',
          line: 42,
          column: 10
        })
      })

      it('detects path with multiple directory levels', () => {
        const matches = detectFilePaths('Error in /home/user/project/src/main/index.ts:100')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: '/home/user/project/src/main/index.ts:100',
          path: '/home/user/project/src/main/index.ts',
          line: 100
        })
      })

      it('detects path at start of line', () => {
        const matches = detectFilePaths('/path/to/file.ts:42 - error message')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: '/path/to/file.ts',
          line: 42
        })
      })

      it('detects path at end of line', () => {
        const matches = detectFilePaths('error message in /path/to/file.ts:42')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: '/path/to/file.ts',
          line: 42
        })
      })
    })

    describe('absolute Windows paths', () => {
      it('detects Windows path with backslashes', () => {
        const matches = detectFilePaths('Error in C:\\path\\to\\file.ts')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: 'C:\\path\\to\\file.ts',
          path: 'C:\\path\\to\\file.ts'
        })
      })

      it('detects Windows path with forward slashes', () => {
        const matches = detectFilePaths('Error in C:/path/to/file.ts')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: 'C:/path/to/file.ts',
          path: 'C:/path/to/file.ts'
        })
      })

      it('detects Windows path with line number', () => {
        const matches = detectFilePaths('Error at C:/path/to/file.ts:42')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: 'C:/path/to/file.ts:42',
          path: 'C:/path/to/file.ts',
          line: 42
        })
      })

      it('detects Windows path with line and column', () => {
        const matches = detectFilePaths('Error at C:/path/to/file.ts:42:10')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: 'C:/path/to/file.ts:42:10',
          path: 'C:/path/to/file.ts',
          line: 42,
          column: 10
        })
      })

      it('detects Windows path with different drive letters', () => {
        const matches = detectFilePaths('Files: D:/data/file.ts and E:/backup/file.ts')
        expect(matches).toHaveLength(2)
        expect(matches[0].path).toBe('D:/data/file.ts')
        expect(matches[1].path).toBe('E:/backup/file.ts')
      })
    })

    describe('relative paths', () => {
      it('detects ./ relative path', () => {
        const matches = detectFilePaths('Error in ./src/file.ts')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: './src/file.ts',
          path: './src/file.ts'
        })
      })

      it('detects ../ relative path', () => {
        const matches = detectFilePaths('Error in ../utils/helper.ts')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: '../utils/helper.ts',
          path: '../utils/helper.ts'
        })
      })

      it('detects relative path with line number', () => {
        const matches = detectFilePaths('Error at ./src/file.ts:42')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: './src/file.ts:42',
          path: './src/file.ts',
          line: 42
        })
      })

      it('detects relative path with line and column', () => {
        const matches = detectFilePaths('Error at ../utils/helper.ts:100:25')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: '../utils/helper.ts:100:25',
          path: '../utils/helper.ts',
          line: 100,
          column: 25
        })
      })
    })

    describe('project-relative paths', () => {
      it('detects project-relative path', () => {
        const matches = detectFilePaths('Error in src/main/index.ts')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: 'src/main/index.ts',
          path: 'src/main/index.ts'
        })
      })

      it('detects project-relative path with line number', () => {
        const matches = detectFilePaths('Error at src/main/index.ts:100')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: 'src/main/index.ts:100',
          path: 'src/main/index.ts',
          line: 100
        })
      })

      it('detects project-relative path with line and column', () => {
        const matches = detectFilePaths('Error at src/main/index.ts:100:25')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: 'src/main/index.ts:100:25',
          path: 'src/main/index.ts',
          line: 100,
          column: 25
        })
      })
    })

    describe('TypeScript error format', () => {
      it('detects TypeScript format with project-relative path', () => {
        const matches = detectFilePaths('Error in src/file.ts(15,3)')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: 'src/file.ts(15,3)',
          path: 'src/file.ts',
          line: 15,
          column: 3
        })
      })

      it('detects TypeScript format with absolute path', () => {
        const matches = detectFilePaths('Error in /path/to/file.ts(100,25)')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: '/path/to/file.ts(100,25)',
          path: '/path/to/file.ts',
          line: 100,
          column: 25
        })
      })

      it('detects TypeScript format with Windows path', () => {
        const matches = detectFilePaths('Error in C:/path/to/file.ts(42,10)')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: 'C:/path/to/file.ts(42,10)',
          path: 'C:/path/to/file.ts',
          line: 42,
          column: 10
        })
      })
    })

    describe('grep output format', () => {
      it('detects grep format with trailing colon', () => {
        const matches = detectFilePaths('src/main/index.ts:42: const foo = bar')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: 'src/main/index.ts:42:',
          path: 'src/main/index.ts',
          line: 42
        })
      })

      it('detects grep format with line and column and trailing colon', () => {
        const matches = detectFilePaths('src/main/index.ts:42:10: const foo = bar')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: 'src/main/index.ts:42:10:',
          path: 'src/main/index.ts',
          line: 42,
          column: 10
        })
      })
    })

    describe('multiple paths in one line', () => {
      it('detects two paths in same line', () => {
        const matches = detectFilePaths('Move /path/to/source.ts to /path/to/dest.ts')
        expect(matches).toHaveLength(2)
        expect(matches[0].path).toBe('/path/to/source.ts')
        expect(matches[1].path).toBe('/path/to/dest.ts')
      })

      it('detects multiple paths with different formats', () => {
        const matches = detectFilePaths('Error: ./src/file.ts:42 imported by /lib/main.ts:100')
        expect(matches).toHaveLength(2)
        expect(matches[0]).toMatchObject({
          path: './src/file.ts',
          line: 42
        })
        expect(matches[1]).toMatchObject({
          path: '/lib/main.ts',
          line: 100
        })
      })

      it('detects paths in complex error message', () => {
        const matches = detectFilePaths(
          'TypeError: Cannot read property of undefined at src/utils/helper.ts:25:10 (from src/index.ts:42)'
        )
        expect(matches).toHaveLength(2)
        expect(matches[0]).toMatchObject({
          path: 'src/utils/helper.ts',
          line: 25,
          column: 10
        })
        expect(matches[1]).toMatchObject({
          path: 'src/index.ts',
          line: 42
        })
      })
    })

    describe('ANSI escape sequences', () => {
      it('detects path in ANSI-colored output', () => {
        const matches = detectFilePaths('\x1b[31mError\x1b[0m in \x1b[36m/path/to/file.ts\x1b[0m:42')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: '/path/to/file.ts',
          line: 42
        })
      })

      it('detects path with ANSI codes around line numbers', () => {
        const matches = detectFilePaths('Error in /path/to/file.ts\x1b[33m:42:10\x1b[0m')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: '/path/to/file.ts',
          line: 42,
          column: 10
        })
      })

      it('detects multiple paths with complex ANSI formatting', () => {
        const matches = detectFilePaths(
          '\x1b[31m\x1b[1mError:\x1b[0m \x1b[36m./src/file.ts:42\x1b[0m → \x1b[32m/lib/main.ts:100\x1b[0m'
        )
        expect(matches).toHaveLength(2)
      })
    })

    describe('false positive prevention', () => {
      it('skips HTTP URLs', () => {
        const matches = detectFilePaths('See https://example.com/path/to/file.ts for details')
        expect(matches).toHaveLength(0)
      })

      it('skips HTTPS URLs', () => {
        const matches = detectFilePaths('Download from https://cdn.example.com/file.js')
        expect(matches).toHaveLength(0)
      })

      it('skips email addresses', () => {
        const matches = detectFilePaths('Contact user@example.com for help')
        expect(matches).toHaveLength(0)
      })

      it('skips other protocol URLs', () => {
        const matches = detectFilePaths('Open ftp://server.com/file.txt')
        expect(matches).toHaveLength(0)
      })

      it('skips paths without file extensions (unless known dirs)', () => {
        const matches = detectFilePaths('Run command in /usr/local/mycommand')
        expect(matches).toHaveLength(0)
      })

      it('detects known directory patterns', () => {
        const matches = detectFilePaths('Directory /path/to/src is missing')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('/path/to/src')
      })

      it('detects paths in parentheses', () => {
        const matches = detectFilePaths('Error (/path/to/file.ts:42)')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: '/path/to/file.ts',
          line: 42
        })
      })

      it('detects paths in brackets', () => {
        const matches = detectFilePaths('Stack: [./src/file.ts:42]')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: './src/file.ts',
          line: 42
        })
      })

      it('detects paths in quotes', () => {
        const matches = detectFilePaths('File "src/main/index.ts:100" has errors')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: 'src/main/index.ts',
          line: 100
        })
      })
    })

    describe('edge cases', () => {
      it('returns empty array for empty string', () => {
        expect(detectFilePaths('')).toEqual([])
      })

      it('returns empty array for line with no paths', () => {
        expect(detectFilePaths('This is just a regular line of text')).toEqual([])
      })

      it('handles very long paths', () => {
        const longPath = '/very/' + 'long/'.repeat(50) + 'file.ts'
        const matches = detectFilePaths(`Error in ${longPath}:42`)
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe(longPath)
      })

      it('handles paths with numbers in directory names', () => {
        const matches = detectFilePaths('Error in src/v2/file.ts:42')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('src/v2/file.ts')
      })

      it('handles paths with hyphens', () => {
        const matches = detectFilePaths('Error in src/my-component.tsx:42')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('src/my-component.tsx')
      })

      it('handles paths with underscores', () => {
        const matches = detectFilePaths('Error in src/my_module.ts:42')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('src/my_module.ts')
      })

      it('handles paths with dots in directory names', () => {
        const matches = detectFilePaths('Error in src/.config/settings.json:42')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('src/.config/settings.json')
      })

      it('tracks start and end indices within line bounds', () => {
        const line = 'Error at /path/to/file.ts:42'
        const matches = detectFilePaths(line)
        expect(matches).toHaveLength(1)
        // Verify indices are within line bounds
        expect(matches[0].startIndex).toBeGreaterThanOrEqual(0)
        expect(matches[0].endIndex).toBeLessThanOrEqual(line.length)
        // Verify the extracted substring contains the fullMatch
        const extracted = line.substring(matches[0].startIndex, matches[0].endIndex)
        expect(extracted).toContain(matches[0].fullMatch.split(':')[0]) // Contains the path part
      })

      it('handles multiple file extensions', () => {
        const extensions = ['ts', 'tsx', 'js', 'jsx', 'json', 'md', 'css', 'scss', 'html', 'vue']
        extensions.forEach(ext => {
          const matches = detectFilePaths(`Error in src/file.${ext}:42`)
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe(`src/file.${ext}`)
        })
      })
    })

    describe('real-world examples', () => {
      it('detects path in TypeScript error', () => {
        const matches = detectFilePaths(
          "src/main/index.ts(15,3) error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'."
        )
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: 'src/main/index.ts',
          line: 15,
          column: 3
        })
      })

      it('detects path in ESLint output', () => {
        const matches = detectFilePaths(
          '/home/user/project/src/main/index.ts:42:10 - error no-unused-vars: "foo" is defined but never used.'
        )
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: '/home/user/project/src/main/index.ts',
          line: 42,
          column: 10
        })
      })

      it('detects path in Jest error', () => {
        const matches = detectFilePaths('  at Object.<anonymous> (src/utils/helper.test.ts:25:10)')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: 'src/utils/helper.test.ts',
          line: 25,
          column: 10
        })
      })

      it('detects path in webpack output', () => {
        const matches = detectFilePaths(
          'ERROR in ./src/main/index.ts:42:10\nModule not found: Error: Cannot resolve module'
        )
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: './src/main/index.ts',
          line: 42,
          column: 10
        })
      })

      it('detects path in git output', () => {
        const matches = detectFilePaths('modified:   src/main/index.ts')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('src/main/index.ts')
      })

      it('detects path in grep output', () => {
        const matches = detectFilePaths('src/utils/helper.ts:42:10: function calculateTotal() {')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: 'src/utils/helper.ts',
          line: 42,
          column: 10
        })
      })
    })
  })

  describe('createPathCache()', () => {
    let cache: PathCache
    let mockTimestamp: number

    beforeEach(() => {
      mockTimestamp = Date.now()
      vi.useFakeTimers()
      vi.setSystemTime(mockTimestamp)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    describe('basic operations', () => {
      beforeEach(() => {
        cache = createPathCache(100, 30000)
      })

      it('stores and retrieves cache entry', () => {
        const entry: PathCacheEntry = {
          exists: true,
          absolutePath: '/path/to/file.ts',
          timestamp: mockTimestamp
        }
        cache.set('key1', entry)
        expect(cache.get('key1')).toEqual(entry)
      })

      it('returns undefined for non-existent key', () => {
        expect(cache.get('nonexistent')).toBeUndefined()
      })

      it('has() returns true for existing key', () => {
        const entry: PathCacheEntry = {
          exists: true,
          absolutePath: '/path/to/file.ts',
          timestamp: mockTimestamp
        }
        cache.set('key1', entry)
        expect(cache.has('key1')).toBe(true)
      })

      it('has() returns false for non-existent key', () => {
        expect(cache.has('nonexistent')).toBe(false)
      })

      it('delete() removes entry', () => {
        const entry: PathCacheEntry = {
          exists: true,
          absolutePath: '/path/to/file.ts',
          timestamp: mockTimestamp
        }
        cache.set('key1', entry)
        expect(cache.delete('key1')).toBe(true)
        expect(cache.has('key1')).toBe(false)
      })

      it('delete() returns false for non-existent key', () => {
        expect(cache.delete('nonexistent')).toBe(false)
      })

      it('clear() removes all entries', () => {
        cache.set('key1', {
          exists: true,
          absolutePath: '/path1.ts',
          timestamp: mockTimestamp
        })
        cache.set('key2', {
          exists: true,
          absolutePath: '/path2.ts',
          timestamp: mockTimestamp
        })
        expect(cache.size).toBe(2)
        cache.clear()
        expect(cache.size).toBe(0)
        expect(cache.has('key1')).toBe(false)
        expect(cache.has('key2')).toBe(false)
      })

      it('tracks cache size', () => {
        expect(cache.size).toBe(0)
        cache.set('key1', {
          exists: true,
          absolutePath: '/path1.ts',
          timestamp: mockTimestamp
        })
        expect(cache.size).toBe(1)
        cache.set('key2', {
          exists: true,
          absolutePath: '/path2.ts',
          timestamp: mockTimestamp
        })
        expect(cache.size).toBe(2)
      })
    })

    describe('LRU eviction', () => {
      beforeEach(() => {
        cache = createPathCache(3, 30000) // Max 3 entries
      })

      it('evicts least recently used entry when at capacity', () => {
        cache.set('key1', {
          exists: true,
          absolutePath: '/path1.ts',
          timestamp: mockTimestamp
        })
        cache.set('key2', {
          exists: true,
          absolutePath: '/path2.ts',
          timestamp: mockTimestamp
        })
        cache.set('key3', {
          exists: true,
          absolutePath: '/path3.ts',
          timestamp: mockTimestamp
        })
        expect(cache.size).toBe(3)

        // Add 4th entry, should evict key1 (oldest)
        cache.set('key4', {
          exists: true,
          absolutePath: '/path4.ts',
          timestamp: mockTimestamp
        })
        expect(cache.size).toBe(3)
        expect(cache.has('key1')).toBe(false)
        expect(cache.has('key2')).toBe(true)
        expect(cache.has('key3')).toBe(true)
        expect(cache.has('key4')).toBe(true)
      })

      it('moves accessed entry to end (most recently used)', () => {
        cache.set('key1', {
          exists: true,
          absolutePath: '/path1.ts',
          timestamp: mockTimestamp
        })
        cache.set('key2', {
          exists: true,
          absolutePath: '/path2.ts',
          timestamp: mockTimestamp
        })
        cache.set('key3', {
          exists: true,
          absolutePath: '/path3.ts',
          timestamp: mockTimestamp
        })

        // Access key1, making it most recently used
        cache.get('key1')

        // Add 4th entry, should evict key2 (now oldest)
        cache.set('key4', {
          exists: true,
          absolutePath: '/path4.ts',
          timestamp: mockTimestamp
        })
        expect(cache.size).toBe(3)
        expect(cache.has('key1')).toBe(true)
        expect(cache.has('key2')).toBe(false)
        expect(cache.has('key3')).toBe(true)
        expect(cache.has('key4')).toBe(true)
      })

      it('updating existing entry moves it to end', () => {
        cache.set('key1', {
          exists: true,
          absolutePath: '/path1.ts',
          timestamp: mockTimestamp
        })
        cache.set('key2', {
          exists: true,
          absolutePath: '/path2.ts',
          timestamp: mockTimestamp
        })
        cache.set('key3', {
          exists: true,
          absolutePath: '/path3.ts',
          timestamp: mockTimestamp
        })

        // Update key1, making it most recently used
        cache.set('key1', {
          exists: true,
          absolutePath: '/path1-updated.ts',
          timestamp: mockTimestamp
        })

        // Add 4th entry, should evict key2 (now oldest)
        cache.set('key4', {
          exists: true,
          absolutePath: '/path4.ts',
          timestamp: mockTimestamp
        })
        expect(cache.size).toBe(3)
        expect(cache.has('key1')).toBe(true)
        expect(cache.has('key2')).toBe(false)
        expect(cache.has('key3')).toBe(true)
        expect(cache.has('key4')).toBe(true)
      })
    })

    describe('TTL expiration', () => {
      beforeEach(() => {
        cache = createPathCache(100, 30000) // 30 second TTL
      })

      it('expires entry after TTL', () => {
        const entry: PathCacheEntry = {
          exists: true,
          absolutePath: '/path/to/file.ts',
          timestamp: mockTimestamp
        }
        cache.set('key1', entry)

        // Advance time by 31 seconds
        vi.advanceTimersByTime(31000)

        expect(cache.get('key1')).toBeUndefined()
        expect(cache.has('key1')).toBe(false)
      })

      it('does not expire entry before TTL', () => {
        const entry: PathCacheEntry = {
          exists: true,
          absolutePath: '/path/to/file.ts',
          timestamp: mockTimestamp
        }
        cache.set('key1', entry)

        // Advance time by 29 seconds (within TTL)
        vi.advanceTimersByTime(29000)

        expect(cache.get('key1')).toBeDefined()
        expect(cache.has('key1')).toBe(true)
      })

      it('removes expired entry from cache on access', () => {
        const entry: PathCacheEntry = {
          exists: true,
          absolutePath: '/path/to/file.ts',
          timestamp: mockTimestamp
        }
        cache.set('key1', entry)
        expect(cache.size).toBe(1)

        // Advance time to expire entry
        vi.advanceTimersByTime(31000)

        // Access should remove it
        cache.get('key1')
        expect(cache.size).toBe(0)
      })

      it('has() removes expired entry', () => {
        const entry: PathCacheEntry = {
          exists: true,
          absolutePath: '/path/to/file.ts',
          timestamp: mockTimestamp
        }
        cache.set('key1', entry)
        expect(cache.size).toBe(1)

        // Advance time to expire entry
        vi.advanceTimersByTime(31000)

        // has() should remove it
        expect(cache.has('key1')).toBe(false)
        expect(cache.size).toBe(0)
      })
    })

    describe('default parameters', () => {
      it('uses default max size of 100', () => {
        cache = createPathCache()
        for (let i = 0; i < 101; i++) {
          cache.set(`key${i}`, {
            exists: true,
            absolutePath: `/path${i}.ts`,
            timestamp: mockTimestamp
          })
        }
        expect(cache.size).toBe(100)
        expect(cache.has('key0')).toBe(false) // First entry evicted
        expect(cache.has('key100')).toBe(true) // Last entry still there
      })

      it('uses default TTL of 30 seconds', () => {
        cache = createPathCache()
        const entry: PathCacheEntry = {
          exists: true,
          absolutePath: '/path/to/file.ts',
          timestamp: mockTimestamp
        }
        cache.set('key1', entry)

        vi.advanceTimersByTime(31000)
        expect(cache.get('key1')).toBeUndefined()
      })
    })

    describe('custom parameters', () => {
      it('respects custom max size', () => {
        cache = createPathCache(5, 30000)
        for (let i = 0; i < 6; i++) {
          cache.set(`key${i}`, {
            exists: true,
            absolutePath: `/path${i}.ts`,
            timestamp: mockTimestamp
          })
        }
        expect(cache.size).toBe(5)
        expect(cache.has('key0')).toBe(false)
        expect(cache.has('key5')).toBe(true)
      })

      it('respects custom TTL', () => {
        cache = createPathCache(100, 60000) // 60 second TTL
        const entry: PathCacheEntry = {
          exists: true,
          absolutePath: '/path/to/file.ts',
          timestamp: mockTimestamp
        }
        cache.set('key1', entry)

        vi.advanceTimersByTime(59000)
        expect(cache.get('key1')).toBeDefined()

        vi.advanceTimersByTime(2000)
        expect(cache.get('key1')).toBeUndefined()
      })
    })

    describe('cache entry values', () => {
      beforeEach(() => {
        cache = createPathCache(100, 30000)
      })

      it('stores entries with exists: true', () => {
        const entry: PathCacheEntry = {
          exists: true,
          absolutePath: '/path/to/file.ts',
          timestamp: mockTimestamp
        }
        cache.set('key1', entry)
        expect(cache.get('key1')).toEqual(entry)
      })

      it('stores entries with exists: false', () => {
        const entry: PathCacheEntry = {
          exists: false,
          absolutePath: null,
          timestamp: mockTimestamp
        }
        cache.set('key1', entry)
        expect(cache.get('key1')).toEqual(entry)
      })

      it('preserves all entry properties', () => {
        const entry: PathCacheEntry = {
          exists: true,
          absolutePath: '/very/long/path/to/some/deeply/nested/file.ts',
          timestamp: mockTimestamp
        }
        cache.set('complex-key-with-slashes/and/dots.ts:42:10', entry)
        const retrieved = cache.get('complex-key-with-slashes/and/dots.ts:42:10')
        expect(retrieved).toEqual(entry)
        expect(retrieved?.absolutePath).toBe(entry.absolutePath)
        expect(retrieved?.timestamp).toBe(entry.timestamp)
      })
    })
  })
})
