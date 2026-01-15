/**
 * Tests for shellPathEscape.ts - Shell path escaping utilities
 *
 * @see shellPathEscape.ts
 */

import { describe, it, expect } from 'vitest'
import { escapePathForShell, formatPathsForTerminal } from './shellPathEscape'

describe('escapePathForShell', () => {
  it('should wrap simple path in single quotes', () => {
    const result = escapePathForShell('/path/to/file.txt')
    expect(result).toBe("'/path/to/file.txt'")
  })

  it('should handle path with spaces', () => {
    const result = escapePathForShell('/path/with spaces/file.txt')
    expect(result).toBe("'/path/with spaces/file.txt'")
  })

  it('should escape internal single quotes', () => {
    const result = escapePathForShell("/path/with'quote/file.txt")
    expect(result).toBe("'/path/with'\\''quote/file.txt'")
  })

  it('should handle multiple single quotes', () => {
    const result = escapePathForShell("/it's/a'test'path")
    expect(result).toBe("'/it'\\''s/a'\\''test'\\''path'")
  })

  it('should handle shell metacharacters safely', () => {
    // These chars are safe inside single quotes
    const result = escapePathForShell('/path/$HOME/`cmd`/file.txt')
    expect(result).toBe("'/path/$HOME/`cmd`/file.txt'")
  })

  it('should handle empty path', () => {
    const result = escapePathForShell('')
    expect(result).toBe("''")
  })

  it('should handle path with backslash', () => {
    const result = escapePathForShell('/path/with\\backslash')
    expect(result).toBe("'/path/with\\backslash'")
  })

  it('should handle unicode characters', () => {
    const result = escapePathForShell('/path/to/ファイル.txt')
    expect(result).toBe("'/path/to/ファイル.txt'")
  })

  it('should handle newlines in path', () => {
    const result = escapePathForShell("/path/with\nnewline/file.txt")
    expect(result).toBe("'/path/with\nnewline/file.txt'")
  })

  it('should strip null bytes for defense-in-depth', () => {
    const result = escapePathForShell('/path/with\0null/file.txt')
    expect(result).toBe("'/path/withnull/file.txt'")
  })
})

describe('formatPathsForTerminal', () => {
  it('should format single path', () => {
    const result = formatPathsForTerminal(['/path/to/file.txt'])
    expect(result).toBe("'/path/to/file.txt'")
  })

  it('should format multiple paths with newlines', () => {
    const result = formatPathsForTerminal([
      '/path/to/file1.txt',
      '/path/to/file2.txt'
    ])
    expect(result).toBe("'/path/to/file1.txt'\n'/path/to/file2.txt'")
  })

  it('should handle empty array', () => {
    const result = formatPathsForTerminal([])
    expect(result).toBe('')
  })

  it('should escape each path individually', () => {
    const result = formatPathsForTerminal([
      "/path/with'quote/file.txt",
      '/path/with spaces/file.txt'
    ])
    expect(result).toBe("'/path/with'\\''quote/file.txt'\n'/path/with spaces/file.txt'")
  })

  it('should handle many paths', () => {
    const paths = Array.from({ length: 5 }, (_, i) => `/path/file${i}.txt`)
    const result = formatPathsForTerminal(paths)
    const lines = result.split('\n')
    expect(lines).toHaveLength(5)
    lines.forEach((line, i) => {
      expect(line).toBe(`'/path/file${i}.txt'`)
    })
  })
})
