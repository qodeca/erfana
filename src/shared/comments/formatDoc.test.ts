// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The format document covers both file types (spec 024 024-FR-011,
 * 024-AC-012; design `markdown-format.md`; architecture note 001 § 6
 * commit 16).
 *
 * Each part FR-011 names is read out of `docs/html-comments/format-v1.md`
 * and checked against what the code writes, not against a second copy of
 * the words: the `target:` lines of the Markdown `@data` table against the
 * locked placement goldens, the Markdown limits against `markdownLimits.ts`,
 * the slot count against the save's cap, the lock line against the gate
 * lock. The example blocks are checked byte for byte by
 * `spec024.golden.test.ts`.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MARKDOWN_COMMENT_MAX_BYTES,
  MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING,
  MARKDOWN_COMMENT_MAX_HTML_NESTING,
  MARKDOWN_COMMENT_MAX_HTML_NODES,
  MARKDOWN_COMMENT_MAX_LINES,
  MARKDOWN_COMMENT_MAX_NESTING,
  MARKDOWN_COMMENT_MAX_SLOTS,
  MARKDOWN_SELECTION_SEARCH_MAX_CHARS
} from '../markdownComments/markdownLimits'
import { MARKDOWN_AGENT_NOTE_LINES } from './agentNotes'
import { decodeLossless } from './encoding'

const ROOT = join(__dirname, '..', '..', '..')
const DOC = readFileSync(join(ROOT, 'docs', 'html-comments', 'format-v1.md'), 'utf8').replace(/\r\n/g, '\n')
const MD_FIXTURES = join(__dirname, '..', 'markdownComments', '__fixtures__')
const GOLDENS = join(MD_FIXTURES, 'goldens')

/** The text from `heading` to the next heading of the same or a higher level. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n${heading}\n`)
  if (start === -1) throw new Error(`no section "${heading}"`)
  const level = /^#+/.exec(heading)![0].length
  const rest = text.slice(start + heading.length + 2)
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'))
  return next === -1 ? rest : rest.slice(0, next)
}

/** The body rows of the first table in `text`, each row's cells trimmed. */
function tableRows(text: string): string[][] {
  const lines = text.split('\n')
  const first = lines.findIndex(line => line.startsWith('|'))
  if (first === -1) throw new Error('no table')
  const rows: string[][] = []
  for (const line of lines.slice(first + 2)) {
    if (!line.startsWith('|')) break
    rows.push(line.slice(1, -1).split('|').map(cell => cell.trim()))
  }
  return rows
}

/** The row whose first cell is `name`. */
function rowNamed(rows: readonly string[][], name: string): string[] {
  const row = rows.find(cells => cells[0] === name)
  if (row === undefined) throw new Error(`no row "${name}"`)
  return row
}

const unquote = (cell: string): string => cell.replace(/^`|`$/g, '')

/** The `target:` line a locked placement golden writes, without its indent. */
function goldenTargetLine(name: string): string {
  const decoded = decodeLossless(new Uint8Array(readFileSync(join(GOLDENS, `${name}.md`))))
  if (!decoded.ok) throw new Error(decoded.reason)
  const line = /^[ ]*(target: .*)$/m.exec(decoded.text)
  if (line === null) throw new Error(`${name}: no target line`)
  return line[1]
}

const MARKDOWN = section(DOC, '## In Markdown files')

describe('024-AC-012 the format document covers HTML and Markdown files', () => {
  it('024-AC-012 is titled for both file types and has the section "In Markdown files" with every part', () => {
    expect(DOC.split('\n', 1)[0]).toBe('# Erfana comments – format v1 (HTML and Markdown)')
    for (const part of [
      '### For coding agents, in Markdown',
      '### Example',
      '### What counts as a block',
      '### Where a block goes',
      '### The Markdown `@data` table',
      '### File rules per file type',
      '### Read-only Markdown files',
      '### Markdown limits',
      '### Known difference'
    ]) {
      expect(MARKDOWN, part).toContain(`\n${part}\n`)
    }
  })

  it('024-AC-012 describes every optional field, and says Markdown blocks keep them', () => {
    const data = section(DOC, '## `@data` – the single source of truth')
    for (const field of ['"id"?', '"cls"?', '"quote"?', '"runtime"?', '"sel"?', '"hash"?', '"edited"?', '"resolved"?']) {
      expect(data, field).toContain(field)
    }
    expect(data).toContain('| `anchor.sel` | Optional:')
    for (const field of ['`anchor.runtime`', '`anchor.sel`', '`edited`', '`resolved`']) expect(MARKDOWN, field).toContain(field)
    expect(MARKDOWN).toContain('All fields keep the v1 schema; nothing new is required.')
  })

  it.each([
    ['Paragraph', 'g-m01-paragraph'],
    ['H1 to H6 heading', 'g-m02-heading-atx'],
    ['List item, item 2 onward', 'g-m05-list-item-2'],
    ['List item, item 1', 'g-m04-list-item-1'],
    ['Nested item 1, its list the first block of the parent item', 'g-m07-nested-item-1-first-block'],
    ['Table', 'g-m10-table'],
    ['Table row', 'g-m11-table-row'],
    ['Table cell', 'g-m12-table-cell'],
    ['Block quote', 'g-m13-block-quote'],
    ['Block inside a block quote', 'g-m14-quote-inner'],
    ['Code block', 'g-m15-code-fenced'],
    ['Image (alone in its paragraph)', 'g-m18-image'],
    ['Divider', 'g-m20-divider'],
    ['HTML block', 'g-m21-html-block']
  ])('024-AC-012 the Markdown @data table row "%s" shows the target: line its locked golden %s writes', (kind, golden) => {
    const row = rowNamed(tableRows(section(MARKDOWN, '### The Markdown `@data` table')), kind)
    expect(row).toHaveLength(6)
    expect(unquote(row[5])).toBe(goldenTargetLine(golden))
  })

  it('024-AC-012 the Markdown @data table lists every commentable kind, words and frontmatter', () => {
    const kinds = tableRows(section(MARKDOWN, '### The Markdown `@data` table')).map(row => row[0])
    for (const kind of ['Whole list', 'Diagram (Mermaid fence)', 'Any of the above, on selected words', 'Frontmatter']) {
      expect(kinds, kind).toContain(kind)
    }
    expect(MARKDOWN).toContain('`anchor.cls` is never written for Markdown')
    expect(MARKDOWN).toContain('"snapshotSource": "page"')
  })

  it('024-AC-012 states the placement rules: one line-start shape, the slot carrier, a slot per kind, preconditions, other tools, regions and the render check', () => {
    const rules = section(MARKDOWN, '### Where a block goes')
    expect(rules).toContain('**One insert shape, `line-start`.** An add inserts exactly `indent + block + eol` at a line start')
    expect(rules).toContain('never a tab, never 4 or more columns past the container column')
    expect(rules).toContain('never a `> ` prefix')
    expect(rules).toContain('Delete removes `indent + block + eol`')
    expect(rules).toContain('**No blank line is added**')
    // The six carrier rules, in order.
    const carrier = rules.slice(rules.indexOf('**The slot carrier.**'), rules.indexOf('**Slot per kind.**'))
    expect([...carrier.matchAll(/^(\d)\. /gm)].map(m => m[1])).toEqual(['1', '2', '3', '4', '5', '6'])
    const slots = tableRows(rules.slice(rules.indexOf('**Slot per kind.**'))).map(row => row[0])
    for (const kind of ['List item 1', 'List item 2 or later', 'Nested list item', 'Table row or cell', 'Any block inside a block quote, at any depth', 'Image alone in its paragraph', 'Frontmatter']) {
      expect(slots, kind).toContain(kind)
    }
    expect(rules).toContain('**When a slot is tried.**')
    expect(rules).toContain('`<!-- prettier-ignore -->`')
    expect(rules).toContain('**Generated regions.**')
    expect(rules).toContain('"This part is generated by a tool"')
    expect(rules).toContain('`COMMENT_RENDER_CHANGED`')
    expect(rules).toContain(`tried in order, at most ${MARKDOWN_COMMENT_MAX_SLOTS}:`)
    expect(rules).toContain('a Markdown comment needs a text (quote) match')
  })

  it('024-AC-012 shows the Markdown agent note as Erfana writes it, and the Markdown section says what it asks', () => {
    const note = section(DOC, '## The note to agents and hint lines')
    const shown = MARKDOWN_AGENT_NOTE_LINES.map((line, i) => (i === 0 ? line : `  ${line}`)).join('\n')
    expect(note).toContain('In a Markdown file:\n\n```text\n' + shown + '\n```')
    const agents = section(MARKDOWN, '### For coding agents, in Markdown')
    expect(MARKDOWN_AGENT_NOTE_LINES[0]).toContain('Change the Markdown after this block (in a list, the next item)')
    expect(agents).toContain('`Change the Markdown after this block (in a list, the next item)`')
    expect(agents).toContain('target in Markdown (when commented):')
    // FR-011: an agent checks anchor.sel when the words hint is missing.
    expect(agents).toContain('When it is missing, check `anchor.sel` in `@data`')
  })

  it('024-AC-012 the Markdown limits table holds the limits the Markdown kind enforces', () => {
    const rows = tableRows(section(MARKDOWN, '### Markdown limits'))
    const n = (value: number): string => value.toLocaleString('en-US')
    const expected: ReadonlyArray<readonly [string, string]> = [
      ['File size', `2 MB (${n(MARKDOWN_COMMENT_MAX_BYTES)} bytes of UTF-8)`],
      ['Lines', `${n(MARKDOWN_COMMENT_MAX_LINES)} `],
      ['Container nesting (block quotes and list items together, on any line)', n(MARKDOWN_COMMENT_MAX_NESTING)],
      ['Raw-HTML element nesting', n(MARKDOWN_COMMENT_MAX_HTML_NESTING)],
      ['Raw-HTML constructs (tags, comments, declarations)', n(MARKDOWN_COMMENT_MAX_HTML_NODES)],
      ['Emphasis delimiters open at once in one paragraph', n(MARKDOWN_COMMENT_MAX_EMPHASIS_NESTING)],
      ['Slots one save tries', n(MARKDOWN_COMMENT_MAX_SLOTS)],
      ['Rendered text a selection is searched in', `${n(MARKDOWN_SELECTION_SEARCH_MAX_CHARS)} characters`]
    ]
    expect(MARKDOWN_COMMENT_MAX_BYTES).toBe(2 * 1024 * 1024)
    expect(rows.map(row => row[0])).toEqual(expected.map(([label]) => label))
    for (const [label, value] of expected) expect(rowNamed(rows, label)[1], label).toContain(value)
  })

  it('024-AC-012 states per file type which file rules apply: the charset prescan is HTML-only; size limits, links and conflict hunks apply to both', () => {
    const rows = tableRows(section(MARKDOWN, '### File rules per file type'))
    const both = (row: string[]): [string, string] => [row[1], row[2]]
    const startsWith = (prefix: string): string[] => {
      const row = rows.find(cells => cells[0].startsWith(prefix))
      if (row === undefined) throw new Error(`no row "${prefix}"`)
      return row
    }
    expect(both(startsWith('`<meta charset>` prescan'))).toEqual(['Yes', 'No'])
    expect(both(startsWith('Links:'))).toEqual(['Yes', 'Yes'])
    expect(both(startsWith('A complete git conflict hunk'))).toEqual(['Yes', 'Yes'])
    expect(both(startsWith('Size limits'))).toEqual(['[Limits](#limits) above', '[Markdown limits](#markdown-limits) below'])
    expect(section(MARKDOWN, '### Read-only Markdown files')).toContain('`--!>` included')
  })

  it('024-AC-012 lists the comment before a first heading as a known difference for tools that read the first line', () => {
    const known = section(MARKDOWN, '### Known difference')
    expect(known).toContain('usually its first heading')
    expect(known).toContain("reads a Markdown file's first line as its title")
  })

  it('024-AC-012 the rules are marked locked on the lock date, naming the gate report, its round, Claude Code version and model', () => {
    const lock = JSON.parse(readFileSync(join(MD_FIXTURES, 'markdownFormat.lock.json'), 'utf8')) as {
      lockedOn: string
      gate: { report: string; round: number; claudeCode: string; model: string }
    }
    const first = MARKDOWN.trim().split('\n', 1)[0]
    expect(first.startsWith(`**Locked on ${lock.lockedOn}.**`)).toBe(true)
    expect(first).toContain(`round ${lock.gate.round}`)
    expect(first).toContain(`Claude Code \`${lock.gate.claudeCode}\``)
    expect(first).toContain(`model \`${lock.gate.model}\``)
    expect(first).toContain(`(../../${lock.gate.report})`)
  })

  it('024-AC-012 every Markdown example in the section is a locked placement golden, and there is more than one', () => {
    const examples = [...MARKDOWN.matchAll(/^```markdown\n([\s\S]*?)^```/gm)].map(match => match[1])
    expect(examples.length).toBeGreaterThanOrEqual(2)
    const goldens = readdirSync(GOLDENS).map(file => {
      const decoded = decodeLossless(new Uint8Array(readFileSync(join(GOLDENS, file))))
      if (!decoded.ok) throw new Error(decoded.reason)
      return decoded.text
    })
    for (const example of examples) expect(goldens.includes(example), example.slice(0, 80)).toBe(true)
  })
})
