// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * The inline-directive scan behind scripts/check-max-lines.mjs: a comment that
 * switches max-lines off is found wherever ESLint would read it, a block
 * comment spread over several lines included, and reported at its first line.
 */

import { describe, expect, it } from 'vitest'
import {
  findMaxLinesDirectives,
  MAX_DIRECTIVE_CHARS,
  touchesMaxLines
} from './lib/max-lines-directives.mjs'

describe('findMaxLinesDirectives', () => {
  it.each([
    '/* eslint-disable max-lines */',
    '/*eslint-disable max-lines*/',
    '// eslint-disable-next-line max-lines',
    'const a = 1 // eslint-disable-line no-console, max-lines -- why',
    '/* eslint max-lines: off */',
    '/* eslint "max-lines": ["error", 9000] */',
    '/* eslint-disable */',
    '// eslint-disable-next-line',
    '// eslint-disable-line -- a reason, but no rule',
    "const url = 'https://example.com' /* eslint-disable max-lines */",
    '/*\n  eslint-disable max-lines\n*/',
    '/* eslint-disable no-console,\n   max-lines */',
    '/* eslint-disable no-console,\r\n   max-lines */',
    '/* eslint\n   max-lines: off */',
    '/* eslint\n  "max-lines": ["error", 9000] */',
    '/*\n  eslint-disable\n*/',
    '/* eslint "max-lines": "off" */',
    // ESLint parses an inline config as JSON, so an escape spells max-lines unseen
    '/* eslint "max\\u002dlines": "off" */',
    '/* eslint "\\u006dax-lines": 0 */'
  ])('flags %j at the line the comment starts on', (comment) => {
    expect(findMaxLinesDirectives(`ok\n${comment}\nexport {}\n`)).toEqual([2])
  })

  // Padding pushes `max-lines` past any length the scan reads, so a directive
  // longer than MAX_DIRECTIVE_CHARS is reported unread
  it.each([
    ['2,000 spaces', `/* eslint-disable no-console,${' '.repeat(MAX_DIRECTIVE_CHARS)} max-lines */`],
    ['2,000 newlines', `/* eslint-disable no-console,${'\n'.repeat(MAX_DIRECTIVE_CHARS)} max-lines */`],
    ['150 rules', `/* eslint ${'no-console: 0, '.repeat(150)}max-lines: 0 */`],
    ['a padded line comment', `// eslint-disable-line no-console,${' '.repeat(MAX_DIRECTIVE_CHARS)} max-lines`],
    ['padding and no max-lines', `/* eslint-disable no-console${' '.repeat(MAX_DIRECTIVE_CHARS)} */`]
  ])('fails closed on a directive padded with %s', (_label, comment) => {
    expect(findMaxLinesDirectives(`ok\n${comment}\nexport {}\n`)).toEqual([2])
  })

  it.each([
    ['prose', `/* ${'a'.repeat(3 * MAX_DIRECTIVE_CHARS)} eslint-disable max-lines */`],
    ['eslint-env', `/* eslint-env node${' '.repeat(MAX_DIRECTIVE_CHARS)} */`],
    ['eslintrc', `/* eslintrc${' '.repeat(MAX_DIRECTIVE_CHARS)} */`]
  ])('leaves a long comment that is not a directive alone: %s', (_label, comment) => {
    expect(findMaxLinesDirectives(`${comment}\n`)).toEqual([])
  })

  it.each([
    '// eslint-disable-next-line no-console',
    '/* eslint-disable max-lines-per-function */',
    '// eslint-disable-next-line @typescript-eslint/no-explicit-any -- max-lines',
    '/* eslint-disable no-console --\n   max-lines is only named in the reason */',
    '/* eslint-enable max-lines */',
    '/* eslint-env node */',
    '/* eslint\n   no-console: off */',
    '// `eslint-disable`) is gone now that max-lines lands',
    '/// eslint-disable max-lines',
    '/**\n * eslint-disable max-lines\n */',
    '/* see the eslint docs */ const rule = "max-lines"',
    '// a comment\neslint-disable max-lines',
    'eslint.lintText(code) // max-lines',
    // A backslash only matters in a config: a disable's rule list is not unescaped
    '/* eslint-disable no-console -- see C:\\temp */'
  ])('leaves %j alone', (text) => {
    expect(findMaxLinesDirectives(`${text}\n`)).toEqual([])
  })

  it('reports each comment once, in line order', () => {
    const text = [
      '/* eslint-disable max-lines */ // eslint-disable-line max-lines',
      'export const a = 1',
      '/* eslint',
      '   max-lines: off */',
      '// eslint-disable-next-line'
    ].join('\n')
    expect(findMaxLinesDirectives(text)).toEqual([1, 3, 5])
  })

  it('stays linear on a file full of unclosed comment openers', () => {
    const plain = "export const s = '/* not a directive'\n"
    expect(findMaxLinesDirectives(`// eslint\n${plain.repeat(50_000)}`)).toEqual([])
    // An unclosed `/* eslint-disable` in a string runs to the end of the file,
    // past the cap, so it fails closed: every line is reported except the last
    // few dozen, whose rest of the file fits in the cap and is read
    const directive = "export const s = '/* eslint-disable no-console'\n"
    const lines = 50_000
    const found = findMaxLinesDirectives(directive.repeat(lines))
    expect(found.length).toBeGreaterThan(lines - 100)
    expect(found.length).toBeLessThan(lines)
    expect(findMaxLinesDirectives('// eslint-disable no-console '.repeat(lines))).toEqual([1])
  })
})

describe('touchesMaxLines', () => {
  it('reads a comment as one piece: an `eslint` config whose rules start on the next line', () => {
    expect(touchesMaxLines(' eslint\n   max-lines: off ')).toBe(true)
    expect(touchesMaxLines('eslint\r\n  "max-lines": ["error", 9000]')).toBe(true)
    expect(touchesMaxLines('eslint\n  no-console: off')).toBe(false)
  })

  it('matches the directive keyword, not a longer word', () => {
    expect(touchesMaxLines('eslint max-lines: 2')).toBe(true)
    expect(touchesMaxLines('eslintx max-lines')).toBe(false)
    expect(touchesMaxLines('eslint-disablex max-lines')).toBe(false)
  })
})
