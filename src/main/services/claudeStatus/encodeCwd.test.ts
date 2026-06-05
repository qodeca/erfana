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
})
