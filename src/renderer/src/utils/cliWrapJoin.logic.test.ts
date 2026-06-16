// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { findCliWrapGroup, joinedPosToBuffer } from './cliWrapJoin.logic'
import type { JoinSegment } from './cliWrapJoin.logic'

/** Helper: create a getLine callback from an array of strings */
function makeGetLine(lines: string[]): (index: number) => string | null {
  return (index: number) => (index >= 0 && index < lines.length ? lines[index] : null)
}

describe('cliWrapJoin.logic', () => {
  // -----------------------------------------------------------------------
  // Pattern A – Tool output
  // -----------------------------------------------------------------------
  describe('Pattern A – Tool output', () => {
    it('returns null for a single-line tool call (no wrapping needed)', () => {
      const lines = ['Write(01-kb/emails/long-name.md)']
      const result = findCliWrapGroup(0, makeGetLine(lines))
      expect(result).toBeNull()
    })

    it('joins Write( split across two lines', () => {
      const lines = ['Write(01-kb/emails/long-na', '       me.md)']
      const result = findCliWrapGroup(0, makeGetLine(lines))

      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('Write(01-kb/emails/long-name.md)')
      expect(result!.groupStart).toBe(0)
      expect(result!.groupEnd).toBe(1)
      expect(result!.segments).toHaveLength(2)
    })

    it('joins Update( split across two lines', () => {
      const lines = ['Update(path/post-tr', '        ansition.md)']
      const result = findCliWrapGroup(0, makeGetLine(lines))

      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('Update(path/post-transition.md)')
    })

    it('joins a 3-line wrap: opener + 2 continuations', () => {
      const lines = [
        'Write(very/deep/nested/direc',
        '       tory/structure/fi',
        '       le.md)'
      ]
      const result = findCliWrapGroup(0, makeGetLine(lines))

      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe(
        'Write(very/deep/nested/directory/structure/file.md)'
      )
      expect(result!.segments).toHaveLength(3)
    })

    it('backward scan from continuation line finds opener', () => {
      const lines = ['Write(01-kb/emails/long-na', '       me.md)']
      // Request from line 1 (the continuation)
      const result = findCliWrapGroup(1, makeGetLine(lines))

      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('Write(01-kb/emails/long-name.md)')
      expect(result!.groupStart).toBe(0)
      expect(result!.groupEnd).toBe(1)
    })

    it('handles Read( pattern', () => {
      const lines = ['Read(src/renderer/src/compo', '      nents/Panel.tsx)']
      const result = findCliWrapGroup(0, makeGetLine(lines))

      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('Read(src/renderer/src/components/Panel.tsx)')
    })

    it('handles Edit( pattern', () => {
      const lines = ['Edit(src/very/long/pa', '      th/to/file.ts)']
      const result = findCliWrapGroup(0, makeGetLine(lines))

      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('Edit(src/very/long/path/to/file.ts)')
    })

    it('handles Grep( and Glob( patterns', () => {
      const grepLines = ['Grep(src/utils/longFil', '      eName.test.ts)']
      expect(findCliWrapGroup(0, makeGetLine(grepLines))!.joinedText).toBe(
        'Grep(src/utils/longFileName.test.ts)'
      )

      const globLines = ['Glob(src/**/deeplyNeste', '      d/pattern.ts)']
      expect(findCliWrapGroup(0, makeGetLine(globLines))!.joinedText).toBe(
        'Glob(src/**/deeplyNested/pattern.ts)'
      )
    })

    it('requires closing paren to form a group', () => {
      // No closing paren on continuation – should not form a group
      const lines = ['Write(some/partial/pa', '       th/without/close']
      const result = findCliWrapGroup(0, makeGetLine(lines))
      expect(result).toBeNull()
    })

    it('stops at new command lines', () => {
      const lines = [
        'Write(some/partial/pa',
        '⏺ Some new command',
        '       th.md)'
      ]
      const result = findCliWrapGroup(0, makeGetLine(lines))
      expect(result).toBeNull()
    })

    it('handles text before the tool call on the opener line', () => {
      const lines = ['⏺ Write(01-kb/emails/long-na', '         me.md)']
      const result = findCliWrapGroup(0, makeGetLine(lines))

      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('⏺ Write(01-kb/emails/long-name.md)')
    })
  })

  // -----------------------------------------------------------------------
  // Pattern B – "Saved to" / "Wrote to"
  // -----------------------------------------------------------------------
  describe('Pattern B – Saved to / Wrote to', () => {
    it('joins "Saved to" split across two lines', () => {
      const lines = ['Saved to path/long-na', '  me.md.']
      const result = findCliWrapGroup(0, makeGetLine(lines))

      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('Saved to path/long-name.md.')
    })

    it('joins "Wrote to" split across two lines', () => {
      const lines = ['Wrote to output/very-long-fil', '  ename.json']
      const result = findCliWrapGroup(0, makeGetLine(lines))

      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('Wrote to output/very-long-filename.json')
    })

    it('returns null for single-line "Saved to"', () => {
      const lines = ['Saved to path/file.md']
      const result = findCliWrapGroup(0, makeGetLine(lines))
      expect(result).toBeNull()
    })

    it('backward scan from continuation finds "Saved to" opener', () => {
      const lines = ['Saved to path/long-na', '  me.md.']
      const result = findCliWrapGroup(1, makeGetLine(lines))

      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('Saved to path/long-name.md.')
      expect(result!.groupStart).toBe(0)
    })

    it('stops at new command line', () => {
      const lines = ['Saved to path/long-na', '> some prompt', '  me.md']
      const result = findCliWrapGroup(0, makeGetLine(lines))
      expect(result).toBeNull()
    })

    it('joins 3-line "Wrote to" path', () => {
      const lines = [
        'Wrote to output/very/deep/pa',
        '  th/to/some/lon',
        '  g-file.json'
      ]
      const result = findCliWrapGroup(0, makeGetLine(lines))

      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('Wrote to output/very/deep/path/to/some/long-file.json')
      expect(result!.segments).toHaveLength(3)
    })
  })

  // -----------------------------------------------------------------------
  // Pattern C – @-prefix
  // -----------------------------------------------------------------------
  describe('Pattern C – @-prefix', () => {
    it('joins @-prefixed path split across two lines', () => {
      const lines = ['@01-kb/analysis/long-name', '.md']
      const result = findCliWrapGroup(0, makeGetLine(lines))

      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('@01-kb/analysis/long-name.md')
    })

    it('backward scan from .md finds the @-prefixed opener', () => {
      const lines = ['@01-kb/analysis/long-name', '.md']
      const result = findCliWrapGroup(1, makeGetLine(lines))

      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('@01-kb/analysis/long-name.md')
    })

    it('stops at new command line', () => {
      const lines = ['@01-kb/analysis/long-name', '$ some command']
      const result = findCliWrapGroup(0, makeGetLine(lines))
      expect(result).toBeNull()
    })

    it('joins 3-line @-prefixed path', () => {
      const lines = [
        '@01-kb/analysis/very-long',
        '-directory/sub-pa',
        'th/file.md'
      ]
      const result = findCliWrapGroup(0, makeGetLine(lines))

      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('@01-kb/analysis/very-long-directory/sub-path/file.md')
      expect(result!.segments).toHaveLength(3)
    })

    it('should detect @/ absolute path as opener (Pattern C)', () => {
      const lines = [
        '@/Users/user/project/src/',
        '  components/Button.tsx'
      ]
      const getLine = (i: number) => lines[i] ?? null
      const group = findCliWrapGroup(0, getLine)
      expect(group).not.toBeNull()
      expect(group!.joinedText).toBe('@/Users/user/project/src/components/Button.tsx')
    })

    it('should detect @/ path with :line-line as terminal (Pattern C)', () => {
      const lines = [
        '@/Users/user/project/src/',
        '  components/Button.tsx:22-24'
      ]
      const getLine = (i: number) => lines[i] ?? null
      const group = findCliWrapGroup(0, getLine)
      expect(group).not.toBeNull()
      expect(group!.joinedText).toBe('@/Users/user/project/src/components/Button.tsx:22-24')
    })

    it('backward scan from continuation of @/ absolute opener', () => {
      // When target is the continuation line (not opener), backward scan should still
      // find the @/ opener and reconstruct the group correctly
      const lines = [
        '@/Users/user/project/src/',
        '  components/Button.tsx'
      ]
      const getLine = (i: number) => lines[i] ?? null
      // Request from line 1 (continuation), not line 0 (opener)
      const group = findCliWrapGroup(1, getLine)
      expect(group).not.toBeNull()
      expect(group!.joinedText).toBe('@/Users/user/project/src/components/Button.tsx')
      expect(group!.groupStart).toBe(0)
      expect(group!.groupEnd).toBe(1)
    })

    it('single-line @types/node/index.d.ts does NOT form a group (no wrapping needed)', () => {
      // A complete @scope/package path on one line should not create a spurious group
      const lines = ['@types/node/index.d.ts']
      const getLine = (i: number) => lines[i] ?? null
      const group = findCliWrapGroup(0, getLine)
      // Pattern C opener requires path to end (no continuation), and since there is
      // no next line with path chars, result is null
      expect(group).toBeNull()
    })

    it('wraps @scope/package split across two lines', () => {
      // Verifies Pattern C handles npm-scoped packages that wrap just like @word/ paths
      const lines = ['@types/node/some-very-long-na', 'me.d.ts']
      const getLine = (i: number) => lines[i] ?? null
      const group = findCliWrapGroup(0, getLine)
      expect(group).not.toBeNull()
      expect(group!.joinedText).toBe('@types/node/some-very-long-name.d.ts')
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('returns null for normal line (no pattern)', () => {
      const lines = ['just a normal terminal line with no patterns']
      const result = findCliWrapGroup(0, makeGetLine(lines))
      expect(result).toBeNull()
    })

    it('returns null for empty line', () => {
      const lines = ['']
      const result = findCliWrapGroup(0, makeGetLine(lines))
      expect(result).toBeNull()
    })

    it('returns null for out-of-bounds index', () => {
      const lines = ['Write(test.md)']
      const result = findCliWrapGroup(5, makeGetLine(lines))
      expect(result).toBeNull()
    })

    it('respects maxLookahead limit', () => {
      const lines = [
        'Write(very/deep/path/that/goes/on/and',
        '       on/and/on/and/on/and',
        '       on/and/on/and/on/and',
        '       on/and/on/and/on/and',
        '       on/and/on/and/on/and',
        '       on/final.md)'
      ]
      // Default maxLookahead is 4, so we can't reach line 5
      const result = findCliWrapGroup(0, makeGetLine(lines))
      expect(result).toBeNull() // Can't find closing paren within 4 lines
    })

    it('handles group in the middle of a buffer', () => {
      const lines = [
        'some output before',
        'more output',
        'Write(src/components/MyLongCo',
        '       mponentName.tsx)',
        'some output after'
      ]
      const result = findCliWrapGroup(2, makeGetLine(lines))

      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('Write(src/components/MyLongComponentName.tsx)')
      expect(result!.groupStart).toBe(2)
      expect(result!.groupEnd).toBe(3)
    })

    it('backward scan from continuation in middle of buffer', () => {
      const lines = [
        'some output',
        'Write(src/components/MyLongCo',
        '       mponentName.tsx)',
        'more output'
      ]
      const result = findCliWrapGroup(2, makeGetLine(lines))

      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('Write(src/components/MyLongComponentName.tsx)')
    })

    it('does not match Bash( – intentionally excluded', () => {
      const lines = ['Bash(echo "hello wor', '      ld")']
      const result = findCliWrapGroup(0, makeGetLine(lines))
      expect(result).toBeNull()
    })

    it('stops continuation at empty line', () => {
      const lines = ['Write(path/to/fi', '', '       le.md)']
      const result = findCliWrapGroup(0, makeGetLine(lines))
      expect(result).toBeNull()
    })

    it('handles tab-indented continuation lines', () => {
      const lines = ['Write(src/components/Lo', '\tngName.tsx)']
      const result = findCliWrapGroup(0, makeGetLine(lines))

      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('Write(src/components/LongName.tsx)')
      expect(result!.segments[1].strippedPrefix).toBe(1) // tab stripped
    })

    it('custom maxLookback limits backward scan distance', () => {
      const lines = [
        'Write(src/components/Lo',
        '       ng/intermediate/li',
        '       ne.tsx)'
      ]
      // Backward from line 2 with maxLookback=1 – can only look back 1 line
      const result = findCliWrapGroup(2, makeGetLine(lines), 1, 4)
      // Should fail: line 1 isn't an opener, and we can't look back further
      expect(result).toBeNull()
    })

    it('custom maxLookahead limits forward scan distance', () => {
      const lines = [
        'Write(very/long/pa',
        '       th/continues/he',
        '       re.md)'
      ]
      // maxLookahead=1 means we can only scan 1 line after opener
      const result = findCliWrapGroup(0, makeGetLine(lines), 4, 1)
      // Should fail: closing paren is 2 lines away
      expect(result).toBeNull()
    })

    it('backward scan stops when intermediate line is not a continuation', () => {
      const lines = [
        'Write(src/path/to/fi',
        'not indented at all',
        '       le.md)'
      ]
      // Request from line 2 – backward scan hits non-continuation at line 1
      const result = findCliWrapGroup(2, makeGetLine(lines))
      expect(result).toBeNull()
    })

    it('backward scan: opener found but target outside group range', () => {
      // Opener at line 0, but only line 1 is a valid continuation (with close paren)
      // Line 2 is indented but beyond the group
      const lines = [
        'Write(src/file.ts)',
        '  some indented text',
        '  more indented text'
      ]
      // Line 0 is a complete tool call (has closing paren), not a multi-line opener
      // Lines 1-2 are indented but line 0 isn't an opener (paren is closed)
      const result = findCliWrapGroup(2, makeGetLine(lines))
      expect(result).toBeNull()
    })

    it('getLine returning null mid-forward-scan (near buffer end)', () => {
      // getLine returns null for index 1 (simulates buffer boundary)
      const getLine = (idx: number): string | null => {
        if (idx === 0) return 'Write(src/path/fi'
        return null
      }
      const result = findCliWrapGroup(0, getLine)
      expect(result).toBeNull()
    })

    it('does not join lines between two separate groups', () => {
      const lines = [
        'Write(src/file-a.ts)',
        'some output in between',
        'Write(src/file-b.ts)'
      ]
      // Line 1 should not be part of any group
      const result = findCliWrapGroup(1, makeGetLine(lines))
      expect(result).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Test gap coverage
  // -----------------------------------------------------------------------
  describe('test gap coverage', () => {
    // Item 6: Patterns B/C without terminal line
    it('saved-to returns partial group when no terminal line is found', () => {
      // Continuation is indented and starts with path-like chars, but has no extension
      const lines = ['Saved to path/long-na', '  me/subdir']
      const result = findCliWrapGroup(0, makeGetLine(lines))

      // saved-to does not require a terminal line – partial group is valid
      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('Saved to path/long-name/subdir')
      expect(result!.segments).toHaveLength(2)
    })

    it('at-prefix returns partial group when no terminal line is found', () => {
      const lines = ['@some-user/repo/src/compo', 'nents/deep/nested']
      const result = findCliWrapGroup(0, makeGetLine(lines))

      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('@some-user/repo/src/components/deep/nested')
      expect(result!.segments).toHaveLength(2)
    })

    // Item 7: scanBackward – opener found but forward scan returns null
    it('backward scan: opener found but forward scan returns null', () => {
      // Line 0 is a tool-output opener, but the only continuation (line 1) has
      // no closing paren and maxLookahead is limited, so scanForward returns null.
      // Line 2 is indented and looks like a continuation, but backward scan
      // from line 2 finds the opener at line 0, forward scan fails → break → null.
      const lines = [
        'Write(src/very/long/path/wi',
        '       thout-closing-paren-here',
        '       and-more-here'
      ]
      // From line 2, backward scan finds opener at line 0.
      // Forward scan from line 0 scans lines 1 and 2 – no closing paren → null
      // because tool-output requires terminal. The break after opener stops further lookback.
      const result = findCliWrapGroup(2, makeGetLine(lines))
      expect(result).toBeNull()
    })

    // Item 8: Negative index input
    it('returns null for negative index input', () => {
      const lines = ['Write(test.md)']
      const result = findCliWrapGroup(-1, makeGetLine(lines))
      expect(result).toBeNull()
    })

    // Item 10: Pattern A isTerminal with stray paren (before fix – now tightened)
    it('does not false-positive on stray paren in non-path context', () => {
      // A continuation line where ) appears but is NOT after path-like chars
      // and does NOT end the trimmed line – this is not a file path closing
      const lines = [
        'Write(src/components/Lo',
        '       ) invalid paren start'
      ]
      // The tightened isTerminal should still match because trimmed line
      // does not end with ) and the ) is not preceded by path-like chars
      // Actually, `) invalid paren start` – trimEnd → `) invalid paren start`,
      // does not end with ), and /[a-zA-Z0-9_./-]\)/ doesn't match because
      // `)` is at position 0 of trimmed text (preceded by nothing path-like).
      // However, the continuation IS valid (indented), so it would be included.
      // Without a terminal line, tool-output returns null.
      const result = findCliWrapGroup(0, makeGetLine(lines))
      expect(result).toBeNull()
    })

    it('correctly detects terminal paren after path characters', () => {
      const lines = [
        'Write(src/components/Lo',
        '       ngName.tsx)'
      ]
      const result = findCliWrapGroup(0, makeGetLine(lines))
      expect(result).not.toBeNull()
      expect(result!.joinedText).toBe('Write(src/components/LongName.tsx)')
    })
  })

  // -----------------------------------------------------------------------
  // Segment tracking and position mapping
  // -----------------------------------------------------------------------
  describe('segment tracking', () => {
    it('tracks strippedPrefix correctly for continuations', () => {
      const lines = ['Write(01-kb/emails/long-na', '       me.md)']
      const result = findCliWrapGroup(0, makeGetLine(lines))

      expect(result!.segments[0].strippedPrefix).toBe(0)
      expect(result!.segments[0].text).toBe('Write(01-kb/emails/long-na')
      expect(result!.segments[1].strippedPrefix).toBe(7)
      expect(result!.segments[1].text).toBe('me.md)')
    })

    it('records original line lengths', () => {
      const lines = ['Write(path/fi', '       le.md)']
      const result = findCliWrapGroup(0, makeGetLine(lines))

      expect(result!.segments[0].originalLength).toBe(13)
      expect(result!.segments[1].originalLength).toBe(13)
    })
  })

  // -----------------------------------------------------------------------
  // joinedPosToBuffer
  // -----------------------------------------------------------------------
  describe('joinedPosToBuffer', () => {
    const segments: JoinSegment[] = [
      { text: 'Write(path/', bufferIndex: 5, strippedPrefix: 0, originalLength: 11 },
      { text: 'file.md)', bufferIndex: 6, strippedPrefix: 7, originalLength: 15 }
    ]

    it('maps position in first segment', () => {
      const result = joinedPosToBuffer(6, segments) // 'p' in 'path/'
      expect(result.bufferIndex).toBe(5)
      expect(result.columnOffset).toBe(6) // No strippedPrefix on first segment
    })

    it('maps position in second segment with stripped prefix', () => {
      // Position 11 = start of 'file.md)' in joined text
      const result = joinedPosToBuffer(11, segments)
      expect(result.bufferIndex).toBe(6)
      expect(result.columnOffset).toBe(7) // 0 + 7 (strippedPrefix)
    })

    it('maps position in middle of second segment', () => {
      // Position 15 = '.md)' → offset 4 in second segment text
      const result = joinedPosToBuffer(15, segments)
      expect(result.bufferIndex).toBe(6)
      expect(result.columnOffset).toBe(4 + 7) // 4 + strippedPrefix
    })

    it('handles position past end', () => {
      const result = joinedPosToBuffer(100, segments)
      expect(result.bufferIndex).toBe(6) // Last segment
    })

    it('handles position 0', () => {
      const result = joinedPosToBuffer(0, segments)
      expect(result.bufferIndex).toBe(5)
      expect(result.columnOffset).toBe(0)
    })

    // Item 9: single-segment edge case
    it('handles single segment correctly', () => {
      const single: JoinSegment[] = [
        { text: 'Write(file.md)', bufferIndex: 3, strippedPrefix: 0, originalLength: 14 }
      ]

      const r1 = joinedPosToBuffer(6, single)
      expect(r1.bufferIndex).toBe(3)
      expect(r1.columnOffset).toBe(6)

      // Past end – falls back to end of last (only) segment
      const r2 = joinedPosToBuffer(100, single)
      expect(r2.bufferIndex).toBe(3)
      expect(r2.columnOffset).toBe(14) // text.length + strippedPrefix
    })

    it('maps positions correctly across 3 segments', () => {
      const threeSegments: JoinSegment[] = [
        { text: 'Write(deep/', bufferIndex: 10, strippedPrefix: 0, originalLength: 11 },
        { text: 'nested/', bufferIndex: 11, strippedPrefix: 7, originalLength: 14 },
        { text: 'file.md)', bufferIndex: 12, strippedPrefix: 7, originalLength: 15 }
      ]

      // Position in first segment
      const r1 = joinedPosToBuffer(3, threeSegments)
      expect(r1.bufferIndex).toBe(10)
      expect(r1.columnOffset).toBe(3)

      // Position at start of second segment (pos 11 = 'nested/')
      const r2 = joinedPosToBuffer(11, threeSegments)
      expect(r2.bufferIndex).toBe(11)
      expect(r2.columnOffset).toBe(0 + 7) // strippedPrefix

      // Position in third segment (pos 18 = 'file.md)')
      const r3 = joinedPosToBuffer(18, threeSegments)
      expect(r3.bufferIndex).toBe(12)
      expect(r3.columnOffset).toBe(0 + 7) // strippedPrefix

      // Position 21 = '.md)' in third segment → offset 3
      const r4 = joinedPosToBuffer(21, threeSegments)
      expect(r4.bufferIndex).toBe(12)
      expect(r4.columnOffset).toBe(3 + 7)
    })
  })
})
