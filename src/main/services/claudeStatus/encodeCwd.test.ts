// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * encodeProjectDir tests
 *
 * Verifies the `/` + `.` → `-` encoding rule for Claude Code transcript dirs.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see docs/designs/216-claude-status-bar.md §2
 */
import { describe, it, expect } from 'vitest'
import { encodeProjectDir, candidateProjectDirs } from './encodeCwd'

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

    // The win32 rule is lossy/non-injective (finding #3); these pin the EXACT
    // (documented) behavior for edge forms so a regression in the rule is caught.
    it.each([
      ['UNC path', '\\\\server\\share\\project', '--server-share-project'],
      ['consecutive separators', 'C:\\a\\\\b', 'C--a--b'],
      ['trailing separator', 'C:\\a\\', 'C--a-'],
      ['forward-slash trailing', 'C:/a/', 'C--a-']
    ])('encodes a %s', (_label, input, expected) => {
      expect(encodeProjectDir(input, 'win32')).toBe(expected)
    })
  })

  describe('candidateProjectDirs', () => {
    it('yields a single candidate when the path has no trailing separator', () => {
      expect(candidateProjectDirs('C:\\Users\\x\\proj', 'win32')).toEqual([
        'C--Users-x-proj'
      ])
    })

    it('adds a trailing-separator-stripped alternate (finding #3 fallback)', () => {
      // Primary keeps the trailing dash; the alternate drops it so a cwd that
      // carries a trailing `\` still resolves the real (un-trailing) dir.
      expect(candidateProjectDirs('C:\\Users\\x\\proj\\', 'win32')).toEqual([
        'C--Users-x-proj-',
        'C--Users-x-proj'
      ])
    })

    it('de-duplicates so a bare drive root yields one candidate', () => {
      // `C:\` strips to `C:` → both encode to `C--`, so only one candidate remains.
      expect(candidateProjectDirs('C:\\', 'win32')).toEqual(['C--'])
    })

    it('works on POSIX with a trailing slash', () => {
      expect(candidateProjectDirs('/Users/x/proj/', 'darwin')).toEqual([
        '-Users-x-proj-',
        '-Users-x-proj'
      ])
    })
  })
})
