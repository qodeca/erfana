import { describe, it, expect } from 'vitest'
import { sanitizeFilePath, isMarkdownFile, getBasename } from './fileUtils'

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

    it('returns the input when there is no separator', () => {
      expect(getBasename('erfana')).toBe('erfana')
    })

    it('returns empty string for empty input', () => {
      expect(getBasename('')).toBe('')
    })
  })
})

