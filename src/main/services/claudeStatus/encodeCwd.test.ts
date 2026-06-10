/**
 * encodeProjectDir tests
 *
 * Verifies the `/` + `.` → `-` encoding rule for Claude Code transcript dirs.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see docs/designs/216-claude-status-bar.md §2
 */
import { describe, it, expect } from 'vitest'
import { encodeProjectDir } from './encodeCwd'

describe('encodeProjectDir', () => {
  it('encodes a normal project path', () => {
    expect(encodeProjectDir('/Users/x/Projects/erfana')).toBe('-Users-x-Projects-erfana')
  })

  it('encodes a dotted segment (double dash for /.)', () => {
    expect(encodeProjectDir('/Users/x/.claude')).toBe('-Users-x--claude')
  })

  it('encodes multiple dots within a segment', () => {
    expect(encodeProjectDir('/a/b.c.d/e')).toBe('-a-b-c-d-e')
  })

  it('encodes the filesystem root', () => {
    expect(encodeProjectDir('/')).toBe('-')
  })

  it('encodes a trailing slash as a trailing dash', () => {
    expect(encodeProjectDir('/Users/x/Projects/erfana/')).toBe('-Users-x-Projects-erfana-')
  })

  it('does not strip the leading slash specially', () => {
    expect(encodeProjectDir('/U')).toBe('-U')
  })

  describe('macOS/default branch (regression pin)', () => {
    it('darwin behaves like the default (dot + slash → dash)', () => {
      expect(encodeProjectDir('/Users/x/.claude', 'darwin')).toBe('-Users-x--claude')
    })

    it('darwin does not touch backslashes or colons', () => {
      expect(encodeProjectDir('/Users/x/Projects/erfana', 'darwin')).toBe(
        '-Users-x-Projects-erfana'
      )
    })
  })

  describe('Windows paths', () => {
    // Empirically verified against a live Windows host's ~/.claude/projects.
    it('encodes a normal Windows project path', () => {
      expect(encodeProjectDir('C:\\Users\\marcinobel\\Projects\\erfana', 'win32')).toBe(
        'C--Users-marcinobel-Projects-erfana'
      )
    })

    it('encodes a dotted folder (the \\. becomes --)', () => {
      expect(encodeProjectDir('C:\\Users\\marcinobel\\.claude', 'win32')).toBe(
        'C--Users-marcinobel--claude'
      )
    })

    it('encodes the drive root', () => {
      expect(encodeProjectDir('C:\\', 'win32')).toBe('C--')
    })

    it('encodes a forward-slash form', () => {
      expect(encodeProjectDir('C:/Users/x/Projects/app', 'win32')).toBe(
        'C--Users-x-Projects-app'
      )
    })

    it('encodes a dotted segment within the path', () => {
      expect(encodeProjectDir('C:\\a\\b.v2\\c', 'win32')).toBe('C--a-b-v2-c')
    })

    it('preserves drive-letter case as-is', () => {
      expect(encodeProjectDir('D:\\work', 'win32')).toBe('D--work')
    })
  })
})
