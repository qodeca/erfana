// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Security audit M-1, M-2: the pre-parse scan must treat a line as blank only
 * when CommonMark does (spaces and tabs). A line of Unicode spaces is paragraph
 * text to the parser, so it must not end a paragraph in the scan – otherwise a
 * crafted file hides raw HTML or deep emphasis from the limits.
 */
import { describe, expect, it } from 'vitest'
import {
  MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING,
  MARKDOWN_COMMENT_MAX_HTML_NODES,
  isBlankLine,
  markdownLimitBreach
} from './markdownLimits'

/** Characters `String.prototype.trim` strips that CommonMark does not treat as blank. */
const NOT_BLANK = [' ', '\f', '\v', ' ', '﻿']

describe('024-AC-036 the Markdown limit scan reads blank lines as CommonMark does (security audit M-1, M-2)', () => {
  it('024-AC-036 only spaces and tabs make a blank line', () => {
    expect(isBlankLine('')).toBe(true)
    expect(isBlankLine(' \t  ')).toBe(true)
    for (const ch of NOT_BLANK) expect(isBlankLine(ch), JSON.stringify(ch)).toBe(false)
  })

  it.each(NOT_BLANK)('024-AC-036 a %j line cannot hide raw HTML behind a fake comment opener', ch => {
    const tags = '<b>'.repeat(MARKDOWN_COMMENT_MAX_HTML_NODES + 10)
    const text = ['foo `', ch, '    <!-- erfana:comment v1 id=a', `    x\` ${tags}`, '    -->', ''].join('\n')
    expect(markdownLimitBreach(text)).toMatch(/^html-/)
  })

  it.each(NOT_BLANK)('024-AC-036 a %j line does not reset the emphasis depth inside one paragraph', ch => {
    const line = `${'*'.repeat(MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING - 4)}word`
    const text = [line, ch, line, ch, line, ''].join('\n')
    expect(markdownLimitBreach(text)).toBe('emphasis-nesting')
  })

  it('024-AC-036 a real blank line still ends the paragraph, so the same lines pass', () => {
    const line = `${'*'.repeat(MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING - 4)}word${'*'.repeat(MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING - 4)}`
    expect(markdownLimitBreach([line, '', line, '', line, ''].join('\n'))).toBeUndefined()
  })
})
