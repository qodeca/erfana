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

  // Edge cases from code review
  it('should handle extremely long paths', () => {
    const longSegment = 'a'.repeat(200)
    const longPath = `/path/${longSegment}/${longSegment}/${longSegment}/file.txt`
    const result = escapePathForShell(longPath)
    expect(result).toBe(`'${longPath}'`)
    expect(result.length).toBeGreaterThan(600)
  })

  it('should handle consecutive single quotes', () => {
    const result = escapePathForShell("/path/with'''triple/file.txt")
    expect(result).toBe("'/path/with'\\'''\\'''\\''triple/file.txt'")
  })

  it('should handle path with only special characters', () => {
    const result = escapePathForShell('$!@#%^&*()')
    expect(result).toBe("'$!@#%^&*()'")
  })

  it('should handle path starting with dash (option-like)', () => {
    const result = escapePathForShell('-rf')
    expect(result).toBe("'-rf'")
  })

  it('should handle path with tabs', () => {
    const result = escapePathForShell("/path/with\ttab/file.txt")
    expect(result).toBe("'/path/with\ttab/file.txt'")
  })

  it('should handle path with carriage return', () => {
    const result = escapePathForShell("/path/with\rcr/file.txt")
    expect(result).toBe("'/path/with\rcr/file.txt'")
  })

  it('should handle path with mixed whitespace', () => {
    const result = escapePathForShell("/path/with \t\n mixed/file.txt")
    expect(result).toBe("'/path/with \t\n mixed/file.txt'")
  })

  it('should handle path with exclamation marks (history expansion)', () => {
    const result = escapePathForShell('/path/with!bang!/file.txt')
    expect(result).toBe("'/path/with!bang!/file.txt'")
  })

  it('should handle path with semicolons (command separator)', () => {
    const result = escapePathForShell('/path;rm -rf /;/file.txt')
    expect(result).toBe("'/path;rm -rf /;/file.txt'")
  })

  it('should handle path with pipes (command chaining)', () => {
    const result = escapePathForShell('/path|cat /etc/passwd|/file.txt')
    expect(result).toBe("'/path|cat /etc/passwd|/file.txt'")
  })

  it('should handle path with ampersands (background/AND)', () => {
    const result = escapePathForShell('/path&&rm -rf /&/file.txt')
    expect(result).toBe("'/path&&rm -rf /&/file.txt'")
  })

  it('should handle path with parentheses (subshell)', () => {
    const result = escapePathForShell('/path/$(rm -rf /)/file.txt')
    expect(result).toBe("'/path/$(rm -rf /)/file.txt'")
  })

  it('should handle path with angle brackets (redirection)', () => {
    const result = escapePathForShell('/path/>/dev/null</etc/passwd/file.txt')
    expect(result).toBe("'/path/>/dev/null</etc/passwd/file.txt'")
  })

  it('should handle path with double quotes', () => {
    const result = escapePathForShell('/path/with"double"quotes/file.txt')
    expect(result).toBe("'/path/with\"double\"quotes/file.txt'")
  })

  it('should handle path with glob patterns', () => {
    const result = escapePathForShell('/path/with*/file?.txt')
    expect(result).toBe("'/path/with*/file?.txt'")
  })

  it('should handle path with square brackets (glob character class)', () => {
    const result = escapePathForShell('/path/with[abc]/file.txt')
    expect(result).toBe("'/path/with[abc]/file.txt'")
  })

  it('should handle path with curly braces (brace expansion)', () => {
    const result = escapePathForShell('/path/{a,b,c}/file.txt')
    expect(result).toBe("'/path/{a,b,c}/file.txt'")
  })

  it('should handle path with tilde (home expansion)', () => {
    const result = escapePathForShell('~/path/to/file.txt')
    expect(result).toBe("'~/path/to/file.txt'")
  })

  it('should handle multiple null bytes', () => {
    const result = escapePathForShell('/path\0with\0multiple\0nulls/file.txt')
    expect(result).toBe("'/pathwithmultiplenulls/file.txt'")
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
