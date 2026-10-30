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
  MARKDOWN_COMMENT_MAX_HTML_NODES,
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

/** `count` raw-HTML tags (`count` even) as `<b>x</b>` pairs inline in one paragraph. */
const inlineTags = (count: number): string => 'a <b>x</b> '.repeat(count / 2)

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
  ['emphasis bomb', `${'*a '.repeat(MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING + 1)}b\n`, 'emphasis-nesting'],
  // Security audit of 8a4e442e, M1 (a): four spaces after a list marker, or after `>`, still nest.
  ['wide-gap list bomb', `${'-    '.repeat(1000)}x\n`, 'nesting'],
  ['wide-gap block quote bomb', `${'>    '.repeat(MARKDOWN_COMMENT_MAX_NESTING + 1)}x\n`, 'nesting'],
  // M1 (b): a tab after `>` is as wide as its absolute column says, so it still nests.
  ['tabbed block quote bomb', `${'>\t'.repeat(MARKDOWN_COMMENT_MAX_NESTING + 1)}x\n`, 'nesting'],
  // M1 (c): every delimiter of a run counts, and punctuation-flanked runs open.
  ['one-run emphasis bomb', `${'*'.repeat(6000)}x${'*'.repeat(6000)}\n`, 'emphasis-nesting'],
  ['punctuation emphasis bomb', `${'*('.repeat(20_000)}x${')*'.repeat(20_000)}\n`, 'emphasis-nesting'],
  // M1 (d): a tag split over lines is still a tag.
  ['split-tag HTML bomb', `${'<div\n>'.repeat(MARKDOWN_COMMENT_MAX_HTML_NESTING + 1)}x\n`, 'html-nesting'],
  ['split-attribute HTML bomb', `${'<div\nclass="a">'.repeat(2000)}x\n`, 'html-nesting'],
  // One construct past the cap, in the shape the parse handles worst: inline tags in one paragraph.
  ['too many inline HTML tags', `${inlineTags(MARKDOWN_COMMENT_MAX_HTML_NODES)}<br>\n`, 'html-nodes'],
  ['too many HTML comments', '<!-- x -->\n'.repeat(MARKDOWN_COMMENT_MAX_HTML_NODES + 1), 'html-nodes']
]

/** The comment parse worker's answer budget before its per-MB share (`CommentParseWorkerAdapter`). */
const WORKER_BUDGET_BASE_MS = 10_000

/** The longest a limit check may take on any fixture: well under a second, on the slowest CI host. */
const LIMIT_CHECK_MAX_MS = 500

/** `markdownLimitBreach(text)` and how long it took. */
function timedBreach(text: string): { readonly breach: string | undefined; readonly ms: number } {
  const started = performance.now()
  const breach = markdownLimitBreach(text)
  return { breach, ms: performance.now() - started }
}

beforeEach(() => {
  parsed.calls = 0
})

describe('024-AC-036 Markdown work is bounded', () => {
  it.each(BOMBS)('024-AC-036 %s: read-only "too large" before any parse', (_name, text, breach) => {
    const checked = timedBreach(text)
    expect(checked.breach).toBe(breach)
    expect(checked.ms).toBeLessThan(LIMIT_CHECK_MAX_MS)
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

  it('024-AC-036 a file at the HTML cap, in the worst shape measured, parses well inside the worker budget', () => {
    const text = `Target paragraph.\n\n${inlineTags(MARKDOWN_COMMENT_MAX_HTML_NODES)}\n`
    expect(markdownLimitBreach(text)).toBeUndefined()
    const started = performance.now()
    const doc = markdownKind.parse(text, 0)
    const ms = performance.now() - started
    expect(doc.state.writable).toBe(true)
    expect(parsed.calls).toBe(1)
    // About 0.5 s here; the worker's budget is 10 s plus 1 s per MB. Generous on purpose: a load guard, not a benchmark.
    expect(ms).toBeLessThan(WORKER_BUDGET_BASE_MS)
  }, 30_000)

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
    // A self-closing tag split over lines, and one whose end is never written, are told apart.
    expect(markdownLimitBreach(`${'<x\n/>'.repeat(300)}\n`)).toBeUndefined()
    expect(markdownLimitBreach(`${'<x\n'.repeat(300)}\n`)).toBe('html-nesting')
  })

  it('024-AC-036 ordinary emphasis, intraword stars and lists stay well inside the limits', () => {
    const prose = [
      '**Bold** and __strong__ and *em* and _em_, (*parenthesised*) and "*quoted*".',
      'Math like 2*3*4*5 and snake_case_names_here do not open anything.',
      '* a list item',
      '- [ ] a task',
      '***',
      '> > a nested quote',
      '1. one',
      '   2. two'
    ].join('\n')
    expect(markdownLimitBreach(`${prose}\n`.repeat(200))).toBeUndefined()
  })

  it('024-AC-036 M1 (b): tab stops are counted from the line\'s start, not from after the `>` markers', () => {
    // The fence sits 3 columns in after one `>`. On the next line a tab after `>>>` reaches only
    // column 4 – 1 column of indentation, less than the fence's – so the line leaves the fence
    // and its list markers count. Counted from the slice it looked 4 wide and stayed fenced.
    expect(markdownLimitBreach(`>   \`\`\`\n>>>\t${'- '.repeat(40)}x\n`)).toBe('nesting')
    // Indented as far as the fence, by spaces, it stays fenced.
    expect(markdownLimitBreach(`>   \`\`\`\n>   ${'- '.repeat(40)}x\n`)).toBeUndefined()
  })

  it('024-AC-036 M2: a tag that never ends costs one pass', () => {
    const long = `<${'a'.repeat(1024 * 1024)}`
    for (const text of [long, `${long}!`, `${'<a '.repeat(300_000)}`]) {
      const checked = timedBreach(text)
      expect(checked.ms).toBeLessThan(LIMIT_CHECK_MAX_MS)
    }
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
      MARKDOWN_COMMENT_MAX_HTML_NODES,
      MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING,
      MARKDOWN_COMMENT_MAX_SLOTS
    }).toEqual({
      MARKDOWN_COMMENT_MAX_BYTES: 2_097_152,
      MARKDOWN_COMMENT_MAX_LINES: 100_000,
      MARKDOWN_COMMENT_MAX_NESTING: 32,
      MARKDOWN_COMMENT_MAX_HTML_NESTING: 256,
      MARKDOWN_COMMENT_MAX_HTML_NODES: 5_000,
      MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING: 64,
      MARKDOWN_COMMENT_MAX_SLOTS: 4
    })
  })
})
