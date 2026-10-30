// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * 024-AC-036: Markdown work is bounded (024-NFR-008). A file past a limit is
 * read-only "too large" before any parse – the parser is never called – and
 * a save tries at most four slots.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MARKDOWN_COMMENT_MAX_BYTES,
  MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING,
  MARKDOWN_COMMENT_MAX_HTML_NESTING,
  MARKDOWN_COMMENT_MAX_LINES,
  MARKDOWN_COMMENT_MAX_NESTING,
  MARKDOWN_COMMENT_MAX_SLOTS,
  markdownLimitBreach
} from './markdownLimits'
import { markdownKind } from './markdownKind'
import { markdownSlots } from './mdSlots'
import { mdOf, parseMd, targetBy } from './__test-helpers__/mdHarness'

const parsed = vi.hoisted(() => ({ calls: 0 }))

vi.mock('./mdRender', async importOriginal => {
  const actual = await importOriginal<typeof import('./mdRender')>()
  return {
    ...actual,
    parseMarkdownBody: (body: string) => {
      parsed.calls += 1
      return actual.parseMarkdownBody(body)
    }
  }
})

const staircase = (depth: number): string => Array.from({ length: depth }, (_, i) => `${' '.repeat(2 * i)}- x`).join('\n') + '\n'

/** Generated hostile files, each one step past its limit. */
const BOMBS: ReadonlyArray<readonly [string, string, string]> = [
  ['oversized', 'x'.repeat(MARKDOWN_COMMENT_MAX_BYTES) + '\n', 'bytes'],
  ['oversized in UTF-8 only', 'é'.repeat(MARKDOWN_COMMENT_MAX_BYTES / 2 + 1), 'bytes'],
  ['too many lines', '\n'.repeat(MARKDOWN_COMMENT_MAX_LINES), 'lines'],
  ['block quote bomb', `${'>'.repeat(MARKDOWN_COMMENT_MAX_NESTING + 1)} x\n`, 'nesting'],
  ['list staircase bomb', staircase(MARKDOWN_COMMENT_MAX_NESTING + 1), 'nesting'],
  ['one-line list bomb', `${'- '.repeat(MARKDOWN_COMMENT_MAX_NESTING + 1)}x\n`, 'nesting'],
  ['raw HTML bomb', `${'<div>'.repeat(MARKDOWN_COMMENT_MAX_HTML_NESTING + 1)}x\n`, 'html-nesting'],
  ['emphasis bomb', `${'*a '.repeat(MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING + 1)}b\n`, 'emphasis-nesting']
]

beforeEach(() => {
  parsed.calls = 0
})

describe('024-AC-036 Markdown work is bounded', () => {
  it.each(BOMBS)('024-AC-036 %s: read-only "too large" before any parse', (_name, text, breach) => {
    expect(markdownLimitBreach(text)).toBe(breach)
    const doc = markdownKind.parse(text, 0)
    expect(doc.state).toEqual({ blocks: [], writable: false, readOnlyReason: 'too-large' })
    expect(doc.index.elements).toEqual([])
    expect(parsed.calls).toBe(0)
  })

  it('024-AC-036 files at the limits parse', () => {
    const atLimits = [
      staircase(MARKDOWN_COMMENT_MAX_NESTING),
      `${'>'.repeat(MARKDOWN_COMMENT_MAX_NESTING)} x\n`,
      `${'<div>'.repeat(MARKDOWN_COMMENT_MAX_HTML_NESTING)}x${'</div>'.repeat(MARKDOWN_COMMENT_MAX_HTML_NESTING)}\n`,
      `${'*a '.repeat(MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING)}b${' c*'.repeat(MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING)}\n`
    ]
    for (const text of atLimits) {
      expect(markdownLimitBreach(text)).toBeUndefined()
      expect(markdownKind.parse(text, 0).state.writable).toBe(true)
    }
    expect(parsed.calls).toBe(atLimits.length)
  })

  it('024-AC-036 fenced code is not counted as containers or emphasis, but a fence its container closed is', () => {
    const fenced = (inner: string): string => `\`\`\`\n${inner}\n\`\`\`\n`
    expect(markdownLimitBreach(fenced(`${'> '.repeat(40)}x\n${'*a '.repeat(80)}`))).toBeUndefined()
    expect(markdownLimitBreach(`~~~~\n${'*a '.repeat(80)}\n~~~\n~~~~\n`)).toBeUndefined()
    // A fence inside a quote ends with the quote: the bomb after it counts.
    expect(markdownLimitBreach(`> \`\`\`\nplain\n${'>'.repeat(40)} x\n`)).toBe('nesting')
    // A backtick fence whose info string holds a backtick is no fence (CommonMark): its lines count.
    expect(markdownLimitBreach(`\`\`\` a\`b\n${'>'.repeat(40)} x\n`)).toBe('nesting')
    // A dedented line leaves a fence that a list item held.
    expect(markdownLimitBreach(`- a\n  \`\`\`\n${'>'.repeat(40)} x\n`)).toBe('nesting')
  })

  it('024-AC-036 void and self-closing tags do not nest; emphasis resets at a blank line', () => {
    expect(markdownLimitBreach(`${'<br><img src=x><hr/>'.repeat(400)}\n`)).toBeUndefined()
    expect(markdownLimitBreach(`${'*a\n\n'.repeat(200)}`)).toBeUndefined()
    expect(markdownLimitBreach(`${'</div>'.repeat(300)}${'<p>x</p>'.repeat(300)}\n`)).toBeUndefined()
  })

  it('024-AC-036 a save offers at most four slots, however deep the list', () => {
    const deep = Array.from({ length: 8 }, (_, i) => `${' '.repeat(2 * i)}- level ${i}\n${' '.repeat(2 * i)}  more ${i}`).join('\n') + '\n'
    const doc = parseMd(deep)
    const slots = markdownSlots(mdOf(doc), targetBy(doc, 'item', 'level 7', 7))
    expect(slots.length).toBe(MARKDOWN_COMMENT_MAX_SLOTS)
  })

  it('024-AC-036 the limit constants are the recorded values', () => {
    expect({
      MARKDOWN_COMMENT_MAX_BYTES,
      MARKDOWN_COMMENT_MAX_LINES,
      MARKDOWN_COMMENT_MAX_NESTING,
      MARKDOWN_COMMENT_MAX_HTML_NESTING,
      MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING,
      MARKDOWN_COMMENT_MAX_SLOTS
    }).toEqual({
      MARKDOWN_COMMENT_MAX_BYTES: 2_097_152,
      MARKDOWN_COMMENT_MAX_LINES: 100_000,
      MARKDOWN_COMMENT_MAX_NESTING: 32,
      MARKDOWN_COMMENT_MAX_HTML_NESTING: 256,
      MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING: 64,
      MARKDOWN_COMMENT_MAX_SLOTS: 4
    })
  })
})
