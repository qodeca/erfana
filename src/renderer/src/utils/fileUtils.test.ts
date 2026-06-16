// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import {
  sanitizeFilePath,
  isMarkdownFile,
  getBasename,
  getDirname,
  getDisplayRelativePath,
  isPathInside,
  isStrictDescendant
} from './fileUtils'

describe('fileUtils', () => {
  it('sanitizes file paths into safe ids', () => {
    expect(sanitizeFilePath('/Users/Name/docs/Notes.md')).toBe('users-name-docs-notes-md')
    expect(sanitizeFilePath('C:/Projects/Test File (1).md')).toBe('c--projects-test-file--1--md')
    expect(sanitizeFilePath('relative/path/file.MARKDOWN')).toBe('relative-path-file-markdown')
  })

  it('detects markdown files by extension', () => {
    expect(isMarkdownFile('readme.md')).toBe(true)
    expect(isMarkdownFile('README.MARKDOWN')).toBe(true)
    expect(isMarkdownFile('notes.txt')).toBe(false)
  })

  describe('getBasename', () => {
    it('extracts the final segment from a POSIX path', () => {
      expect(getBasename('/Users/marcin/Projects/erfana')).toBe('erfana')
    })

    it('extracts the final segment from a Windows backslash path', () => {
      expect(getBasename('C:\\Users\\marcin\\Projects\\erfana')).toBe('erfana')
    })

    it('ignores trailing separators', () => {
      expect(getBasename('/Users/marcin/erfana/')).toBe('erfana')
      expect(getBasename('C:\\Users\\marcin\\erfana\\')).toBe('erfana')
    })

    it('extracts the final segment from a UNC path', () => {
      expect(getBasename('\\\\server\\share\\f.md')).toBe('f.md')
    })

    it('returns the input when there is no separator', () => {
      expect(getBasename('erfana')).toBe('erfana')
    })

    it('returns empty string for empty input', () => {
      expect(getBasename('')).toBe('')
    })
  })

  describe('getDirname', () => {
    it('extracts the parent from a POSIX path', () => {
      expect(getDirname('/a/b/c.md')).toBe('/a/b')
    })

    it('extracts the parent from a Windows backslash path', () => {
      expect(getDirname('C:\\a\\b\\c.md')).toBe('C:\\a\\b')
    })

    it('ignores trailing separators', () => {
      expect(getDirname('/a/b/')).toBe('/a')
      expect(getDirname('C:\\a\\b\\')).toBe('C:\\a')
    })

    it('returns empty string when there is no separator', () => {
      expect(getDirname('c.md')).toBe('')
    })

    it('returns empty string for a bare root', () => {
      expect(getDirname('/')).toBe('')
      expect(getDirname('C:\\')).toBe('')
    })

    it('handles mixed separators', () => {
      expect(getDirname('C:/a\\b')).toBe('C:/a')
    })

    it('extracts the parent from a UNC path', () => {
      expect(getDirname('\\\\server\\share\\f.md')).toBe('\\\\server\\share')
    })

    it('returns a bare backslash for a UNC host with no share', () => {
      // bare UNC host is never an IPC-delivered path; display-only — pinning current behavior
      expect(getDirname('\\\\server')).toBe('\\')
    })
  })

  describe('getDisplayRelativePath', () => {
    it('returns the relative tail for a POSIX path inside the base', () => {
      expect(getDisplayRelativePath('/proj/sub/f.md', '/proj')).toBe('sub/f.md')
    })

    it('returns a /-separated tail for a Windows path inside the base', () => {
      expect(getDisplayRelativePath('C:\\proj\\sub\\f.md', 'C:\\proj')).toBe('sub/f.md')
    })

    it('handles a base path with a trailing separator', () => {
      expect(getDisplayRelativePath('/a/b/sub/x', '/a/b/')).toBe('sub/x')
    })

    it('returns the basename when the file equals the base', () => {
      expect(getDisplayRelativePath('/proj', '/proj')).toBe('proj')
    })

    it('returns the basename for a file outside the base', () => {
      expect(getDisplayRelativePath('/other/f.md', '/proj')).toBe('f.md')
    })

    it('returns the basename when there is no base path', () => {
      expect(getDisplayRelativePath('/proj/sub/f.md', null)).toBe('f.md')
    })

    it('returns a /-separated tail for a UNC path inside the base', () => {
      expect(getDisplayRelativePath('\\\\server\\share\\sub\\f.md', '\\\\server\\share')).toBe('sub/f.md')
    })
  })

  describe('isPathInside', () => {
    it('returns true for equal paths', () => {
      expect(isPathInside('/proj', '/proj')).toBe(true)
    })

    it('returns true for a descendant regardless of separator', () => {
      expect(isPathInside('/proj', '/proj/sub/f.md')).toBe(true)
      expect(isPathInside('C:\\proj', 'C:\\proj\\sub\\f.md')).toBe(true)
    })

    it('returns false for a sibling', () => {
      expect(isPathInside('/proj', '/other/f.md')).toBe(false)
    })

    it('returns false for a partial prefix match', () => {
      expect(isPathInside('/proj', '/projector/x')).toBe(false)
    })

    it('handles a parent path with a trailing slash', () => {
      expect(isPathInside('/proj/', '/proj/sub')).toBe(true)
    })

    it('returns true for a UNC descendant', () => {
      expect(isPathInside('\\\\server\\share', '\\\\server\\share\\sub')).toBe(true)
    })

    it('returns false for an empty parent', () => {
      expect(isPathInside('', '/proj/sub')).toBe(false)
    })
  })

  describe('isStrictDescendant', () => {
    it('returns false for equal paths', () => {
      expect(isStrictDescendant('/proj', '/proj')).toBe(false)
    })

    it('returns true for a descendant', () => {
      expect(isStrictDescendant('/proj', '/proj/sub/f.md')).toBe(true)
    })

    it('returns false for a partial prefix match', () => {
      expect(isStrictDescendant('/proj', '/projector/x')).toBe(false)
    })

    it('returns true for a Windows descendant', () => {
      expect(isStrictDescendant('C:\\proj', 'C:\\proj\\sub')).toBe(true)
    })

    it('returns false for equal Windows paths', () => {
      expect(isStrictDescendant('C:\\proj', 'C:\\proj')).toBe(false)
    })

    it('returns false for a Windows partial prefix match', () => {
      expect(isStrictDescendant('C:\\proj', 'C:\\projector\\x')).toBe(false)
    })
  })
})

