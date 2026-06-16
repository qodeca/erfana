// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
 *
 * Platform detection (isWindows) moved to utils/platform.ts and is tested there.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  detectFilePaths,
  parseLineColumn,
  resolvePath,
  createPathCache,
  normalizePath,
  stripAnsi,
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

    describe(':line-line range notation', () => {
      it('should parse :line-line range notation', () => {
        expect(parseLineColumn('file.ts:22-24')).toEqual({
          path: 'file.ts',
          line: 22,
          column: undefined,
        })
      })

      it('should parse :line-line:column notation', () => {
        expect(parseLineColumn('file.ts:22-24:10')).toEqual({
          path: 'file.ts',
          line: 22,
          column: 10,
        })
      })

      it('should parse :line-line with trailing colon', () => {
        expect(parseLineColumn('file.ts:22-24:')).toEqual({
          path: 'file.ts',
          line: 22,
          column: undefined,
        })
      })

      it('should parse :line-line:column with trailing colon (range+col+trailing)', () => {
        // Regex ends with :? so an extra trailing colon after the column is consumed
        expect(parseLineColumn('file.ts:22-24:10:')).toEqual({
          path: 'file.ts',
          line: 22,
          column: 10,
        })
      })

      it('should parse :0-0 zero-line range (boundary behavior)', () => {
        expect(parseLineColumn('file.ts:0-0')).toEqual({
          path: 'file.ts',
          line: 0,
          column: undefined,
        })
      })

      it('should parse :999999-999999 large range (max digits)', () => {
        expect(parseLineColumn('file.ts:999999-999999')).toEqual({
          path: 'file.ts',
          line: 999999,
          column: undefined,
        })
      })

      it('should not parse :22- (invalid – missing end line number)', () => {
        // The range suffix (?:-\d+)? requires at least one digit after the dash.
        // ":22-" falls through to no match so the whole string is treated as path.
        expect(parseLineColumn('file.ts:22-')).toEqual({ path: 'file.ts:22-' })
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

    describe('bare filenames', () => {
      it('detects simple filename with extension', () => {
        const matches = detectFilePaths('README.md')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: 'README.md',
          path: 'README.md'
        })
      })

      it('detects TypeScript filename', () => {
        const matches = detectFilePaths('file.ts')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: 'file.ts',
          path: 'file.ts'
        })
      })

      it('detects filename in ls output', () => {
        const matches = detectFilePaths('classes_report.md       home.png')
        expect(matches).toHaveLength(2)
        expect(matches[0].path).toBe('classes_report.md')
        expect(matches[1].path).toBe('home.png')
      })

      it('detects filename with line number', () => {
        const matches = detectFilePaths('error in file.ts:42')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: 'file.ts:42',
          path: 'file.ts',
          line: 42
        })
      })

      it('detects filename with line and column', () => {
        const matches = detectFilePaths('error in file.tsx:42:10')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: 'file.tsx:42:10',
          path: 'file.tsx',
          line: 42,
          column: 10
        })
      })

      it('detects filename in TypeScript error format', () => {
        const matches = detectFilePaths('file.ts(15,3)')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: 'file.ts(15,3)',
          path: 'file.ts',
          line: 15,
          column: 3
        })
      })

      it('detects multiple bare filenames', () => {
        const matches = detectFilePaths('package.json tsconfig.json README.md')
        expect(matches).toHaveLength(3)
        expect(matches[0].path).toBe('package.json')
        expect(matches[1].path).toBe('tsconfig.json')
        expect(matches[2].path).toBe('README.md')
      })

      it('detects filename with hyphen', () => {
        const matches = detectFilePaths('my-component.tsx')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('my-component.tsx')
      })

      it('detects filename with underscore', () => {
        const matches = detectFilePaths('my_module.ts')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('my_module.ts')
      })

      it('detects filename with dots', () => {
        const matches = detectFilePaths('component.test.ts')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('component.test.ts')
      })

      it('skips domain-like patterns', () => {
        const matches = detectFilePaths('google.com example.org')
        expect(matches).toHaveLength(0)
      })
    })

    describe('unquoted paths with spaces', () => {
      it('detects absolute path with space in directory name', () => {
        const matches = detectFilePaths('/Users/test/my project/file.ts')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: '/Users/test/my project/file.ts'
        })
      })

      it('detects path with multiple spaces', () => {
        const matches = detectFilePaths('/Users/test/my project/sub folder/file.md')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('/Users/test/my project/sub folder/file.md')
      })

      it('detects path with space and line number', () => {
        const matches = detectFilePaths('/path/to my file.ts:42')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: '/path/to my file.ts',
          line: 42
        })
      })

      it('detects path with space and line:column', () => {
        const matches = detectFilePaths('/path/to my file.ts:42:10')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: '/path/to my file.ts',
          line: 42,
          column: 10
        })
      })

      it('detects real-world path with space (README.md)', () => {
        const matches = detectFilePaths('/Users/marcinobel/Projects/test project/basic/README.md')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('/Users/marcinobel/Projects/test project/basic/README.md')
      })

      it('detects python file with space', () => {
        const matches = detectFilePaths('/Users/test/my project/filter_urls.py')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('/Users/test/my project/filter_urls.py')
      })

      it('detects json file with space in .claude folder', () => {
        const matches = detectFilePaths('/Users/test/my project/.claude/settings.local.json')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('/Users/test/my project/.claude/settings.local.json')
      })

      it('detects path with dash before it', () => {
        const matches = detectFilePaths('- /Users/test/my project/file.md')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('/Users/test/my project/file.md')
      })
    })

    describe('quoted paths with spaces', () => {
      it('detects double-quoted path with space', () => {
        const matches = detectFilePaths('Error in "/Users/test/my project/file.ts"')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: '/Users/test/my project/file.ts',
          path: '/Users/test/my project/file.ts'
        })
      })

      it('detects single-quoted path with space', () => {
        const matches = detectFilePaths("Error in '/Users/test/my project/file.ts'")
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: '/Users/test/my project/file.ts',
          path: '/Users/test/my project/file.ts'
        })
      })

      it('detects quoted path with line number', () => {
        const matches = detectFilePaths('Error at "/path/to file.ts:42"')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: '/path/to file.ts',
          line: 42
        })
      })

      it('detects quoted path with line and column', () => {
        const matches = detectFilePaths('"/path/to file.ts:42:10"')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: '/path/to file.ts',
          line: 42,
          column: 10
        })
      })

      it('detects multiple quoted paths with spaces', () => {
        const matches = detectFilePaths('Move "/path/my file.ts" to "/other/new file.ts"')
        expect(matches).toHaveLength(2)
        expect(matches[0].path).toBe('/path/my file.ts')
        expect(matches[1].path).toBe('/other/new file.ts')
      })

      it('handles real-world path with spaces', () => {
        const matches = detectFilePaths('"/Users/marcinobel/Projects/test project/basic/README.md"')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('/Users/marcinobel/Projects/test project/basic/README.md')
      })
    })

    describe('dotfiles', () => {
      it('detects .gitignore', () => {
        const matches = detectFilePaths('.gitignore')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: '.gitignore',
          path: '.gitignore'
        })
      })

      it('detects .env', () => {
        const matches = detectFilePaths('.env')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          fullMatch: '.env',
          path: '.env'
        })
      })

      it('detects .eslintrc', () => {
        const matches = detectFilePaths('.eslintrc')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('.eslintrc')
      })

      it('detects multiple dotfiles', () => {
        const matches = detectFilePaths('.gitignore .env .prettierrc')
        expect(matches).toHaveLength(3)
        expect(matches[0].path).toBe('.gitignore')
        expect(matches[1].path).toBe('.env')
        expect(matches[2].path).toBe('.prettierrc')
      })

      it('detects dotfile with extension', () => {
        const matches = detectFilePaths('.eslintrc.js')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('.eslintrc.js')
      })

      it('detects dotfile in ls output with regular files', () => {
        const matches = detectFilePaths('.gitignore README.md package.json')
        expect(matches).toHaveLength(3)
        expect(matches[0].path).toBe('.gitignore')
        expect(matches[1].path).toBe('README.md')
        expect(matches[2].path).toBe('package.json')
      })
    })

    describe('fallback matchers (VS Code style)', () => {
      // These test the VS Code-inspired fallback matchers for paths with spaces
      // See: https://github.com/microsoft/vscode/issues/97941

      describe('Python error format', () => {
        it('detects Python error with path containing spaces', () => {
          const matches = detectFilePaths('  File "/Users/test/my project/main.py", line 42')
          expect(matches).toHaveLength(1)
          expect(matches[0]).toMatchObject({
            path: '/Users/test/my project/main.py',
            line: 42
          })
        })

        it('detects Python error with single quotes', () => {
          const matches = detectFilePaths("  File '/path/to my file.py', line 10")
          expect(matches).toHaveLength(1)
          expect(matches[0]).toMatchObject({
            path: '/path/to my file.py',
            line: 10
          })
        })

        it('detects Python error without line number', () => {
          const matches = detectFilePaths('File "/path/with spaces/script.py"')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('/path/with spaces/script.py')
        })

        it('handles Python error with line:col notation inside quotes', () => {
          const matches = detectFilePaths('File "/path/my script.py:42:10"')
          expect(matches).toHaveLength(1)
          expect(matches[0]).toMatchObject({
            path: '/path/my script.py',
            line: 42,
            column: 10
          })
        })

        it('has correct startIndex for Python error format', () => {
          const line = '  File "/Users/test/my project/main.py", line 42'
          const matches = detectFilePaths(line)
          expect(matches).toHaveLength(1)
          // Fallback matchers: startIndex/endIndex span the raw path (not the reconstructed fullMatch)
          expect(matches[0].path).toBe('/Users/test/my project/main.py')
          expect(matches[0].startIndex).toBe(line.indexOf('/Users/test'))
        })
      })

      describe('standalone paths on own line', () => {
        it('detects path with space on own line', () => {
          const matches = detectFilePaths('/Users/john/My Documents/report.pdf')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('/Users/john/My Documents/report.pdf')
        })

        it('detects path with spaces and line number', () => {
          const matches = detectFilePaths('/home/user/Project Files/src/main.js:42')
          expect(matches).toHaveLength(1)
          expect(matches[0]).toMatchObject({
            path: '/home/user/Project Files/src/main.js',
            line: 42
          })
        })

        it('detects path with spaces and line:column', () => {
          const matches = detectFilePaths('/home/user/My Project/index.ts:100:5')
          expect(matches).toHaveLength(1)
          expect(matches[0]).toMatchObject({
            path: '/home/user/My Project/index.ts',
            line: 100,
            column: 5
          })
        })

        it('detects path with leading dash', () => {
          const matches = detectFilePaths('- /Users/test/my project/file.ts')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('/Users/test/my project/file.ts')
        })

        it('detects path with leading spaces', () => {
          const matches = detectFilePaths('   /path/to my file/script.py')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('/path/to my file/script.py')
        })

        it('detects path with tab prefix', () => {
          const matches = detectFilePaths('\t/Users/test/some path/file.md')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('/Users/test/some path/file.md')
        })

        it('handles path with multiple spaces', () => {
          const matches = detectFilePaths('/Users/john doe/My Documents/My Report.pdf')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('/Users/john doe/My Documents/My Report.pdf')
        })
      })

      describe('Claude Code output format', () => {
        // Real-world test cases from Claude Code terminal output
        it('detects path from Claude Code suggestion', () => {
          const matches = detectFilePaths('/Users/john/My Documents/report.pdf')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('/Users/john/My Documents/report.pdf')
        })

        it('detects JavaScript path with spaces', () => {
          const matches = detectFilePaths('/home/user/Project Files/src/main.js')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('/home/user/Project Files/src/main.js')
        })

        it('detects Windows path with spaces', () => {
          const matches = detectFilePaths('C:\\Program Files\\My Application\\app.exe')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('C:\\Program Files\\My Application\\app.exe')
        })

        it('detects Windows path with line number', () => {
          const matches = detectFilePaths('C:\\Users\\test\\my project\\file.ts:42')
          expect(matches).toHaveLength(1)
          expect(matches[0]).toMatchObject({
            path: 'C:\\Users\\test\\my project\\file.ts',
            line: 42
          })
        })

        it('detects Windows path with line:column', () => {
          const matches = detectFilePaths('C:\\Users\\test\\src\\main.ts:100:15')
          expect(matches).toHaveLength(1)
          expect(matches[0]).toMatchObject({
            path: 'C:\\Users\\test\\src\\main.ts',
            line: 100,
            column: 15
          })
        })

        it('handles bullet point list item', () => {
          const matches = detectFilePaths('- /path/to my/project/config.json')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('/path/to my/project/config.json')
        })
      })

      describe('edge cases', () => {
        it('does NOT match full path with spaces in middle of sentence (no clear boundary)', () => {
          // Without clear anchors (start/end of line), we can't reliably detect where the path with spaces ends
          // However, the main pattern WILL detect the bare filename "file.ts" at the end
          const matches = detectFilePaths('Error in /Users/test/my project/file.ts somewhere else')
          // Main pattern detects bare filenames
          expect(matches.length).toBeGreaterThanOrEqual(1)
          // The path with spaces is NOT matched as a complete path
          expect(matches.some(m => m.path.includes('my project'))).toBe(false)
        })

        it('handles path with trailing whitespace', () => {
          const matches = detectFilePaths('/Users/test/my project/file.ts   ')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('/Users/test/my project/file.ts')
        })

        it('handles empty line', () => {
          const matches = detectFilePaths('')
          expect(matches).toHaveLength(0)
        })

        it('does not match non-path text with spaces', () => {
          const matches = detectFilePaths('Hello world this is a test')
          expect(matches).toHaveLength(0)
        })
      })

      describe('Claude Code tool output format', () => {
        it('detects Read(path) format', () => {
          const matches = detectFilePaths('Read(04-deliverables/recommendations/critical-recommendations.md)')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('04-deliverables/recommendations/critical-recommendations.md')
        })

        it('detects Update(path) format', () => {
          const matches = detectFilePaths('Update(04-deliverables/recommendations/critical-recommendations.md)')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('04-deliverables/recommendations/critical-recommendations.md')
        })

        it('detects Write(path) format', () => {
          const matches = detectFilePaths('Write(src/main/services/FileService.ts)')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('src/main/services/FileService.ts')
        })

        it('detects Edit(path) format', () => {
          const matches = detectFilePaths('Edit(src/renderer/src/components/App.tsx)')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('src/renderer/src/components/App.tsx')
        })

        it('detects path with spaces in tool output', () => {
          const matches = detectFilePaths('Read(path/to my project/file.md)')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('path/to my project/file.md')
        })

        it('detects Glob(path) format', () => {
          const matches = detectFilePaths('Glob(src/**/*.tsx)')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('src/**/*.tsx')
        })

        it('detects Grep(path) format', () => {
          const matches = detectFilePaths('Grep(src/renderer/src/utils/helper.ts)')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('src/renderer/src/utils/helper.ts')
        })

        it('detects tool with absolute path', () => {
          const matches = detectFilePaths('Read(/Users/test/project/src/index.ts)')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('/Users/test/project/src/index.ts')
        })

        it('detects tool with nested path and special chars', () => {
          const matches = detectFilePaths('Edit(src/components/UI/Button.test.tsx)')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('src/components/UI/Button.test.tsx')
        })
      })

      describe('File: label format', () => {
        it('detects File: label with path', () => {
          const matches = detectFilePaths('File: 03-analysis/03.01-customer-issues/20251125-issues.md')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('03-analysis/03.01-customer-issues/20251125-issues.md')
        })

        it('detects File: label with leading spaces', () => {
          const matches = detectFilePaths('  File: path/to/document.md')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('path/to/document.md')
        })

        it('detects File: label with path containing spaces', () => {
          const matches = detectFilePaths('File: path/to my/document.md')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('path/to my/document.md')
        })
      })

      describe('Git status format', () => {
        it('detects M (modified) status', () => {
          const matches = detectFilePaths('M 04-deliverables/recommendations/critical-recommendations.md')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('04-deliverables/recommendations/critical-recommendations.md')
        })

        it('detects A (added) status', () => {
          const matches = detectFilePaths('A src/main/services/NewService.ts')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('src/main/services/NewService.ts')
        })

        it('detects ?? (untracked) status', () => {
          const matches = detectFilePaths('?? new-file.ts')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('new-file.ts')
        })

        it('detects status with leading spaces', () => {
          const matches = detectFilePaths('  M path/to/file.md')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('path/to/file.md')
        })

        it('detects D (deleted) status', () => {
          const matches = detectFilePaths('D src/old-file.ts')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('src/old-file.ts')
        })

        it('detects R (renamed) status', () => {
          const matches = detectFilePaths('R src/renamed-file.ts')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('src/renamed-file.ts')
        })

        it('detects path with spaces in git status', () => {
          const matches = detectFilePaths('M path/to my project/file.md')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('path/to my project/file.md')
        })

        it('detects !! (ignored) status', () => {
          const matches = detectFilePaths('!! node_modules/package/index.js')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('node_modules/package/index.js')
        })

        it('has correct startIndex for git status format', () => {
          const line = 'M src/main/services/NewService.ts'
          const matches = detectFilePaths(line)
          expect(matches).toHaveLength(1)
          expect(matches[0].startIndex).toBe(line.indexOf('src/main'))
        })
      })

      describe('Markdown link format', () => {
        it('detects markdown link path', () => {
          const matches = detectFilePaths('[RSK-0066](../../03-analysis/03.04-risks/scoring/categories/reputation.md)')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('../../03-analysis/03.04-risks/scoring/categories/reputation.md')
        })

        it('detects markdown link with anchor', () => {
          const matches = detectFilePaths('[text](path/to/file.md#section-anchor)')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('path/to/file.md')
        })

        it('detects multiple markdown links', () => {
          const matches = detectFilePaths('[link1](file1.md) and [link2](file2.md)')
          expect(matches).toHaveLength(2)
          expect(matches[0].path).toBe('file1.md')
          expect(matches[1].path).toBe('file2.md')
        })

        it('detects markdown link with spaces in path', () => {
          const matches = detectFilePaths('[doc](path/to my/document.md)')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('path/to my/document.md')
        })

        it('detects markdown link with complex anchor', () => {
          const matches = detectFilePaths('[link](docs/api.md#section-1-introduction)')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('docs/api.md')
        })

        it('detects inline markdown image', () => {
          const matches = detectFilePaths('![alt](images/screenshot.png)')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('images/screenshot.png')
        })
      })

      describe('Git diff stat format', () => {
        it('detects truncated path in diff stat', () => {
          const matches = detectFilePaths('.../recommendations/critical-recommendations.md    | 32 ++++++++++++----------')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('.../recommendations/critical-recommendations.md')
        })

        it('detects path with spaces in diff stat', () => {
          const matches = detectFilePaths(' .../to my project/file.md | 5 ++')
          expect(matches).toHaveLength(1)
          expect(matches[0].path).toBe('.../to my project/file.md')
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

    describe(':line-line range notation', () => {
      it('should detect path with :line-line range', () => {
        const matches = detectFilePaths('src/utils/helper.ts:22-24')
        expect(matches.length).toBe(1)
        expect(matches[0].path).toBe('src/utils/helper.ts')
        expect(matches[0].line).toBe(22)
        expect(matches[0].column).toBeUndefined()
      })

      it('should detect path with :line-line:column', () => {
        const matches = detectFilePaths('src/utils/helper.ts:22-24:10')
        expect(matches.length).toBe(1)
        expect(matches[0].path).toBe('src/utils/helper.ts')
        expect(matches[0].line).toBe(22)
        expect(matches[0].column).toBe(10)
      })

      it('should detect absolute path with :line-line', () => {
        const matches = detectFilePaths('/Users/user/project/file.md:5-10')
        expect(matches.length).toBe(1)
        expect(matches[0].path).toBe('/Users/user/project/file.md')
        expect(matches[0].line).toBe(5)
      })

      it('should detect relative ./ path with :line-line range', () => {
        const matches = detectFilePaths('./src/file.ts:22-24')
        expect(matches.length).toBe(1)
        expect(matches[0].path).toBe('./src/file.ts')
        expect(matches[0].line).toBe(22)
        expect(matches[0].column).toBeUndefined()
      })

      it('should detect path with same-start-end range :1-1', () => {
        const matches = detectFilePaths('src/file.ts:1-1')
        expect(matches.length).toBe(1)
        expect(matches[0].path).toBe('src/file.ts')
        expect(matches[0].line).toBe(1)
      })

      it('should detect path with large :line-line range', () => {
        const matches = detectFilePaths('src/file.ts:1-100000')
        expect(matches.length).toBe(1)
        expect(matches[0].path).toBe('src/file.ts')
        expect(matches[0].line).toBe(1)
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
        expect(matches[0]).toMatchObject({ path: './src/file.ts', line: 42 })
        expect(matches[1]).toMatchObject({ path: '/lib/main.ts', line: 100 })
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

      it('matches version-like strings as paths (pre-existing behavior)', () => {
        // v1.2.3 has extension .3 which isn't filtered – acceptable false positive
        expect(detectFilePaths('v1.2.3')).toHaveLength(1)
      })

      it('skips domain names like socket.io', () => {
        expect(detectFilePaths('socket.io')).toHaveLength(0)
      })

      it('skips domain names like npm.io', () => {
        expect(detectFilePaths('npm.io')).toHaveLength(0)
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
        // Verify the extracted substring exactly equals the fullMatch
        const extracted = line.substring(matches[0].startIndex, matches[0].endIndex)
        expect(extracted).toBe(matches[0].fullMatch)
      })

      it('startIndex points to path, not the boundary character', () => {
        const line = 'error in src/main/index.ts:42'
        const matches = detectFilePaths(line)
        expect(matches).toHaveLength(1)
        expect(matches[0].startIndex).toBe(line.indexOf('src/main/index.ts'))
        expect(line.substring(matches[0].startIndex, matches[0].endIndex)).toBe('src/main/index.ts:42')
      })

      it('startIndex is correct for paths after brackets', () => {
        const line = '(src/file.ts:10:5)'
        const matches = detectFilePaths(line)
        expect(matches).toHaveLength(1)
        expect(matches[0].startIndex).toBe(1)
        expect(line.substring(matches[0].startIndex, matches[0].endIndex)).toBe('src/file.ts:10:5')
      })

      it('startIndex is correct at start of line', () => {
        const line = 'src/file.ts:42'
        const matches = detectFilePaths(line)
        expect(matches).toHaveLength(1)
        expect(matches[0].startIndex).toBe(0)
        expect(line.substring(matches[0].startIndex, matches[0].endIndex)).toBe('src/file.ts:42')
      })

      it('startIndex is correct for paths after square bracket', () => {
        const line = '[src/file.ts:10]'
        const matches = detectFilePaths(line)
        expect(matches).toHaveLength(1)
        expect(matches[0].startIndex).toBe(1)
      })

      it('startIndex is correct for paths after curly brace', () => {
        const line = '{src/file.ts}'
        const matches = detectFilePaths(line)
        expect(matches).toHaveLength(1)
        expect(matches[0].startIndex).toBe(1)
      })

      it('startIndex is correct for paths after single quote', () => {
        const line = "'src/file.ts'"
        const matches = detectFilePaths(line)
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('src/file.ts')
      })

      it('startIndex is correct for paths after multiple spaces', () => {
        const line = '   src/file.ts:42'
        const matches = detectFilePaths(line)
        expect(matches).toHaveLength(1)
        expect(matches[0].startIndex).toBe(3)
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

    describe('end boundary characters (bug fix: colon, comma, semicolon)', () => {
      it('detects path followed by colon and error message', () => {
        const matches = detectFilePaths('src/main/index.ts: error message here')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('src/main/index.ts')
      })

      it('detects path followed by comma', () => {
        const matches = detectFilePaths('src/file.ts, src/other.ts')
        expect(matches).toHaveLength(2)
        expect(matches[0].path).toBe('src/file.ts')
        expect(matches[1].path).toBe('src/other.ts')
      })

      it('detects path followed by semicolon', () => {
        const matches = detectFilePaths('src/file.ts; echo done')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('src/file.ts')
      })

      it('preserves colon-digit parsing for line:col notation', () => {
        const matches = detectFilePaths('src/file.ts:42:10')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: 'src/file.ts',
          line: 42,
          column: 10
        })
      })

      it('handles compiler output: path: error message', () => {
        const matches = detectFilePaths('/home/user/src/app.ts: Cannot find module')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('/home/user/src/app.ts')
      })

      it('detects path with line number followed by comma', () => {
        const matches = detectFilePaths('src/file.ts:42, src/other.ts')
        expect(matches).toHaveLength(2)
        expect(matches[0]).toMatchObject({ path: 'src/file.ts', line: 42 })
        expect(matches[1].path).toBe('src/other.ts')
      })

      it('verifies substring matches fullMatch for comma-terminated path', () => {
        const line = 'src/file.ts, src/other.ts'
        const matches = detectFilePaths(line)
        expect(matches).toHaveLength(2)
        expect(line.substring(matches[0].startIndex, matches[0].endIndex)).toBe(matches[0].fullMatch)
      })

      it('detects paths in parentheses separated by comma', () => {
        const matches = detectFilePaths('(src/file.ts, src/other.ts)')
        expect(matches).toHaveLength(2)
        expect(matches[0].path).toBe('src/file.ts')
        expect(matches[1].path).toBe('src/other.ts')
      })

      it('detects path followed by shell redirect >', () => {
        const matches = detectFilePaths('src/file.ts > output.log')
        expect(matches).toHaveLength(2)
        expect(matches[0].path).toBe('src/file.ts')
        expect(matches[1].path).toBe('output.log')
      })

      it('detects path followed by shell pipe |', () => {
        const matches = detectFilePaths('src/file.ts | grep error')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('src/file.ts')
      })
    })

    describe('domain false positive prevention (bug fix: TLD-like extensions)', () => {
      it('detects files with .app extension', () => {
        const matches = detectFilePaths('src/style.app')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('src/style.app')
      })

      it('detects files with .io extension', () => {
        const matches = detectFilePaths('src/utils.io')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('src/utils.io')
      })

      it('detects files with .dev extension', () => {
        const matches = detectFilePaths('src/module.dev')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('src/module.dev')
      })

      it('detects bare filename with .app extension', () => {
        const matches = detectFilePaths('style.app')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('style.app')
      })

      it('rejects bare filename with .dev as domain-like', () => {
        // .dev is in COMMON_TLDS but NOT in COMMON_EXTENSIONS_SET
        expect(detectFilePaths('module.dev')).toHaveLength(0)
      })

      it('rejects bare filename with .io not in COMMON_EXTENSIONS_SET', () => {
        expect(detectFilePaths('socket.io')).toHaveLength(0)
      })

      it('rejects npm.io as domain-like', () => {
        expect(detectFilePaths('npm.io')).toHaveLength(0)
      })

      it('rejects example.org as domain-like', () => {
        expect(detectFilePaths('example.org')).toHaveLength(0)
      })

      it('still rejects actual domain names', () => {
        const matches = detectFilePaths('google.com')
        expect(matches).toHaveLength(0)
      })

      it('detects paths with TLD-like extensions containing separators', () => {
        const matches = detectFilePaths('/home/user/project/build.app')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('/home/user/project/build.app')
      })
    })

    describe('quoted relative paths (bug fix: non-absolute quoted paths)', () => {
      it('detects relative quoted path with ./', () => {
        const matches = detectFilePaths('"./src/file.ts"')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('./src/file.ts')
      })

      it('detects project-relative quoted path', () => {
        const matches = detectFilePaths('"src/file.ts"')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('src/file.ts')
      })

      it('detects quoted path with ../', () => {
        const matches = detectFilePaths('"../utils/helper.ts"')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('../utils/helper.ts')
      })

      it('detects quoted path with line:col', () => {
        const matches = detectFilePaths('"./src/file.ts:42:10"')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: './src/file.ts',
          line: 42,
          column: 10
        })
      })

      it('still detects absolute quoted paths', () => {
        const matches = detectFilePaths('"/usr/local/bin/file.sh"')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('/usr/local/bin/file.sh')
      })

      it('detects quoted path with underscore prefix', () => {
        const matches = detectFilePaths('"_internal/config.ts"')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('_internal/config.ts')
      })

      it('detects quoted @-scoped path', () => {
        const matches = detectFilePaths('"@types/node/index.d.ts"')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('@types/node/index.d.ts')
      })

      it('has correct startIndex/endIndex for quoted path', () => {
        const line = '"./src/file.ts"'
        const matches = detectFilePaths(line)
        expect(matches).toHaveLength(1)
        expect(matches[0].startIndex).toBe(1)
        expect(matches[0].endIndex).toBe(14)
      })

      it('rejects mismatched quotes', () => {
        const matches = detectFilePaths("'src/file.ts\"")
        // Mismatched quotes should not match via quoted stage
        // (may still match via unquoted stage if the path is valid)
        const quotedMatches = matches.filter(m => m.fullMatch.startsWith("'") || m.fullMatch.startsWith('"'))
        expect(quotedMatches).toHaveLength(0)
      })
    })

    describe('dot-directory paths (bug fix: .github, .config, etc.)', () => {
      it('detects .github/workflows path', () => {
        const matches = detectFilePaths('.github/workflows/ci.yml')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('.github/workflows/ci.yml')
      })

      it('detects .config directory path', () => {
        const matches = detectFilePaths('.config/settings.json')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('.config/settings.json')
      })

      it('detects .vscode directory path', () => {
        const matches = detectFilePaths('.vscode/launch.json')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('.vscode/launch.json')
      })

      it('detects .github/workflows path with line number', () => {
        const matches = detectFilePaths('.github/workflows/ci.yml:42')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: '.github/workflows/ci.yml',
          line: 42
        })
      })

      it('detects multi-level dot-directory path', () => {
        const matches = detectFilePaths('.config/app/nested/settings.json')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('.config/app/nested/settings.json')
      })

      it('startIndex is 0 for dot-directory at line start', () => {
        const line = '.github/workflows/ci.yml'
        const matches = detectFilePaths(line)
        expect(matches).toHaveLength(1)
        expect(matches[0].startIndex).toBe(0)
      })
    })

    describe('@-prefixed paths (bug fix: scoped packages)', () => {
      it('detects @types/node path', () => {
        const matches = detectFilePaths('@types/node/index.d.ts')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('@types/node/index.d.ts')
      })

      it('detects @scope/package path', () => {
        const matches = detectFilePaths('@angular/core/src/component.ts')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('@angular/core/src/component.ts')
      })

      it('detects @-scoped path with hyphens', () => {
        const matches = detectFilePaths('@my-org/my-pkg/src/index.ts')
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('@my-org/my-pkg/src/index.ts')
      })

      it('detects @types path with line number', () => {
        const matches = detectFilePaths('@types/node/index.d.ts:42')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({
          path: '@types/node/index.d.ts',
          line: 42
        })
      })

      it('rejects standalone @username without path', () => {
        expect(detectFilePaths('@username')).toHaveLength(0)
      })

      it('rejects @mention in text', () => {
        expect(detectFilePaths('@mention some text')).toHaveLength(0)
      })
    })

    describe('@-prefixed file references', () => {
      it('should detect @/absolute paths', () => {
        const matches = detectFilePaths('@/Users/user/project/file.md')
        expect(matches.length).toBe(1)
        expect(matches[0].path).toBe('@/Users/user/project/file.md')
      })

      it('should detect @/absolute paths with :line-line', () => {
        const matches = detectFilePaths('@/Users/user/project/file.md:22-24')
        expect(matches.length).toBe(1)
        expect(matches[0].path).toBe('@/Users/user/project/file.md')
        expect(matches[0].line).toBe(22)
      })

      it('should detect @src/relative paths', () => {
        const matches = detectFilePaths('@src/utils/helper.ts')
        expect(matches.length).toBe(1)
        expect(matches[0].path).toBe('@src/utils/helper.ts')
      })

      it('should detect @src/relative paths with :line-line', () => {
        const matches = detectFilePaths('@src/utils/helper.ts:10-15')
        expect(matches.length).toBe(1)
        expect(matches[0].path).toBe('@src/utils/helper.ts')
        expect(matches[0].line).toBe(10)
      })

      it('should still detect @scope/package paths (regression)', () => {
        const matches = detectFilePaths('@types/node/index.d.ts')
        expect(matches.length).toBe(1)
        expect(matches[0].path).toBe('@types/node/index.d.ts')
      })

      it('should still detect @angular/core paths (regression)', () => {
        const matches = detectFilePaths('@angular/core/src/component.ts')
        expect(matches.length).toBe(1)
        expect(matches[0].path).toBe('@angular/core/src/component.ts')
      })

      it('should detect @./relative paths (dot-relative @-prefix)', () => {
        // @./ is matched by pattern 4 since . is in [a-zA-Z0-9_.@-]
        const matches = detectFilePaths('@./src/file.ts')
        expect(matches.length).toBe(1)
        expect(matches[0].path).toBe('@./src/file.ts')
      })

      it('should detect @../parent paths (parent-relative @-prefix)', () => {
        // @../ is also matched by pattern 4 – . and - are valid first-segment chars
        const matches = detectFilePaths('@../parent/file.ts')
        expect(matches.length).toBe(1)
        expect(matches[0].path).toBe('@../parent/file.ts')
      })

      it('should detect @src/file.ts with leading spaces (embedded context)', () => {
        // Whitespace before @-path should not prevent detection (boundary is \s)
        const matches = detectFilePaths('  @src/file.ts')
        expect(matches.length).toBe(1)
        expect(matches[0].path).toBe('@src/file.ts')
        // startIndex should point past the leading spaces
        expect(matches[0].startIndex).toBe(2)
      })

      it('should detect @src/file.ts with :line-line after leading spaces', () => {
        const matches = detectFilePaths('  @src/utils/helper.ts:22-24')
        expect(matches.length).toBe(1)
        expect(matches[0].path).toBe('@src/utils/helper.ts')
        expect(matches[0].line).toBe(22)
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

      it('detects path starting with digits', () => {
        const line = '  01-knowledge-base/emails/20260311-draft-reply.md'
        const matches = detectFilePaths(line)
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('01-knowledge-base/emails/20260311-draft-reply.md')
      })

      it('detects path with trailing sentence period', () => {
        const line = '  01-knowledge-base/emails/20260311-draft-reply.md.'
        const matches = detectFilePaths(line)
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('01-knowledge-base/emails/20260311-draft-reply.md')
      })

      it('detects path followed by sentence period and more text', () => {
        const line = '  01-knowledge-base/emails/20260311-draft-reply.md. Edit it there.'
        const matches = detectFilePaths(line)
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('01-knowledge-base/emails/20260311-draft-reply.md')
      })

      it('detects path in "Saved to <path>." sentence', () => {
        const line = 'Saved to src/file.ts.'
        const matches = detectFilePaths(line)
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('src/file.ts')
      })

      it('does not strip dots from multi-dot extensions like .d.ts', () => {
        const line = 'Error in index.d.ts'
        const matches = detectFilePaths(line)
        expect(matches).toHaveLength(1)
        expect(matches[0].path).toBe('index.d.ts')
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

    describe('validation', () => {
      it('throws error if maxSize is 0', () => {
        expect(() => createPathCache(0, 30000)).toThrow('PathCache maxSize must be at least 1')
      })

      it('throws error if maxSize is negative', () => {
        expect(() => createPathCache(-1, 30000)).toThrow('PathCache maxSize must be at least 1')
      })

      it('accepts maxSize of 1', () => {
        expect(() => createPathCache(1, 30000)).not.toThrow()
      })
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
