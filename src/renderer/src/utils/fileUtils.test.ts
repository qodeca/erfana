import { describe, it, expect } from 'vitest'
import { sanitizeFilePath, isMarkdownFile } from './fileUtils'

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
})

