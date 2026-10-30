// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown file kind, rule by rule (spec 024 design `markdown-format.md`;
 * 024-FR-003, 024-FR-004, 024-FR-013, 024-FR-023): targets and paths,
 * locating a pick, the slot rules and their preconditions, other tools'
 * comments and generated regions, the `@data` anchor, the hint lines,
 * re-attachment and the render check.
 */
import { describe, expect, it } from 'vitest'
import { isKindRefusal } from '../comments/fileKind'
import { applySplice, planDelete, planSlotInsert, type SplicePlan } from '../comments/splice'
import { createThread } from '../comments/thread'
import { markdownKind, markdownKindWith, markdownOriginOf } from './markdownKind'
import { markdownSelection, selectableText } from './mdAnchor'
import { MARKDOWN_SELECTION_SEARCH_MAX_CHARS } from './markdownLimits'
import { MdIndex, type MdTarget } from './mdIndex'
import { findMarkdownTarget, markdownTextHash } from './mdLocate'
import { markdownSlots } from './mdSlots'
import { MARKDOWN_AGENT_NOTE_LINES } from '../comments/agentNotes'
import { htmlKind } from '../comments/htmlKind'
import {
  addComment,
  bomOf,
  changeThread,
  contextOf,
  MD_VIEW,
  mdOf,
  okBlock,
  parseMd,
  pickOf,
  targetBy,
  written
} from './__test-helpers__/mdHarness'

/** The line (1-based) a written block's `<!--` is on, and its indent. */
function placed(text: string, plan: SplicePlan): { line: number; indent: string } {
  const line = text.slice(0, plan.start).split(/\r\n|\r|\n/).length
  return { line, indent: /^ */.exec(plan.insert)![0] }
}

/** `text` with its last `from` replaced: the target, not the hint line that quotes it. */
function replaceLast(text: string, from: string, to: string): string {
  const at = text.lastIndexOf(from)
  return text.slice(0, at) + to + text.slice(at + from.length)
}

function add(text: string, kind: Parameters<typeof targetBy>[1], match = '', nth = 0) {
  const doc = parseMd(text)
  return addComment(text, pickOf(doc, targetBy(doc, kind, match, nth)))
}

describe('targets and paths (@data table, design § 5)', () => {
  const DOC = '# Next steps\n\nIntro.\n\n## Next steps\n\n- one\n- two\n\n> a\n>\n> b\n\n---\n\n<details><summary>More</summary>\n\n</details>\n\n<script>alert(1)</script>\n'

  it('024-AC-003 indexes every commentable block with its rendered path, heading ids as the preview gives them', () => {
    const index = mdOf(parseMd(DOC))
    expect(index.elements.map(t => `${t.kind} ${t.path}${t.id ? ` #${t.id}` : ''}`)).toEqual([
      'heading h1:nth-of-type(1) #next-steps',
      'paragraph p:nth-of-type(1)',
      'heading h2:nth-of-type(1) #next-steps-2',
      'list ul:nth-of-type(1)',
      'item ul:nth-of-type(1) > li:nth-of-type(1)',
      'item ul:nth-of-type(1) > li:nth-of-type(2)',
      'quote blockquote:nth-of-type(1)',
      'paragraph blockquote:nth-of-type(1) > p:nth-of-type(1)',
      'paragraph blockquote:nth-of-type(1) > p:nth-of-type(2)',
      'divider hr:nth-of-type(1)',
      'html details:nth-of-type(1)'
    ])
    expect(index.elementAt(index.elements[3].start)?.kind).toBe('list')
    expect(index.elementAtPath('ul:nth-of-type(1) > li:nth-of-type(2)')?.kind).toBe('item')
    expect(index.pathOfTarget(index.elements[0])).toBe('h1:nth-of-type(1)')
    expect(index.targetsAt(-5)).toEqual([])
  })

  it('024-AC-003 a raw HTML block the sanitizer removes, and a paragraph a tight list unwraps, are not targets', () => {
    const index = mdOf(parseMd('- tight item\n\n<script>x</script>\n'))
    expect(index.elements.map(t => t.kind)).toEqual(['list', 'item'])
  })

  it('024-AC-003 the readable target: line of each anchor matches the table', () => {
    const anchorOf = (text: string, kind: Parameters<typeof targetBy>[1], match = ''): unknown => {
      const doc = parseMd(text)
      const anchor = markdownKind.anchorOf(doc, targetBy(doc, kind, match))
      return { tag: anchor.tag, path: anchor.path, id: anchor.id, runtime: anchor.runtime && { path: anchor.runtime.path, tag: anchor.runtime.tag } }
    }
    expect(anchorOf('## Next steps\n', 'heading')).toEqual({ tag: 'h2', path: 'h2:nth-of-type(1)', id: 'next-steps', runtime: undefined })
    expect(anchorOf('- a\n- b\n', 'item', 'a')).toEqual({ tag: 'ul', path: 'ul:nth-of-type(1)', id: undefined, runtime: { path: 'li:nth-of-type(1)', tag: 'li' } })
    expect(anchorOf('- a\n- b\n', 'item', 'b')).toEqual({ tag: 'li', path: 'ul:nth-of-type(1) > li:nth-of-type(2)', id: undefined, runtime: undefined })
    expect(anchorOf('| a |\n|---|\n| 1 |\n| 2 |\n', 'row', '2')).toEqual({ tag: 'table', path: 'table:nth-of-type(1)', id: undefined, runtime: { path: 'tbody > tr:nth-of-type(2)', tag: 'tr' } })
    expect(anchorOf('| a |\n|---|\n| 1 |\n', 'cell', 'a')).toEqual({ tag: 'table', path: 'table:nth-of-type(1)', id: undefined, runtime: { path: 'thead > tr:nth-of-type(1) > th:nth-of-type(1)', tag: 'th' } })
    expect(anchorOf('> a\n>\n> b\n', 'paragraph', 'b')).toEqual({ tag: 'blockquote', path: 'blockquote:nth-of-type(1)', id: undefined, runtime: { path: 'p:nth-of-type(2)', tag: 'p' } })
    expect(anchorOf('[![i](p.png)](u)\n', 'image')).toEqual({ tag: 'p', path: 'p:nth-of-type(1)', id: undefined, runtime: { path: 'a:nth-of-type(1) > img:nth-of-type(1)', tag: 'img' } })
    expect(anchorOf('- - a\n  - b\n- c\n', 'item', 'a', )).toEqual({ tag: 'ul', path: 'ul:nth-of-type(1)', id: undefined, runtime: { path: 'li:nth-of-type(1)', tag: 'li' } })
  })

  it('024-AC-003 the nested item 1 of a list that is its parent item\'s first block names the parent item', () => {
    const doc = parseMd('- a\n- - b\n  - c\n')
    const inner = mdOf(doc).elementAtPath('ul:nth-of-type(1) > li:nth-of-type(2) > ul:nth-of-type(1) > li:nth-of-type(1)')!
    const anchor = markdownKind.anchorOf(doc, inner)
    expect(anchor.tag).toBe('li')
    expect(anchor.path).toBe('ul:nth-of-type(1) > li:nth-of-type(2)')
    expect(anchor.runtime?.path).toBe('ul:nth-of-type(1) > li:nth-of-type(1)')
    expect(anchor.cls).toBeUndefined()
    expect(anchor.quote?.exact).toBe('b c')
  })
})

describe('locate (C7, 024-FR-013)', () => {
  const DOC = '---\ntitle: x\n---\nAlpha.\n\nBeta.\n'

  it('024-AC-003 with the hash unchanged, the line, tag and ordinal name the target', () => {
    const doc = parseMd(DOC)
    const beta = targetBy(doc, 'paragraph', 'Beta')
    expect(markdownKind.locate(doc, pickOf(doc, beta))).toBe(beta)
    expect(markdownKind.locate(doc, pickOf(doc, beta, { ordinal: 2 }))).toEqual({ refused: 'not-found' })
  })

  it('024-AC-003 the frontmatter offers no comment', () => {
    const doc = parseMd(DOC)
    for (const line of [1, 2, 3]) {
      expect(markdownKind.locate(doc, { lineStart: line, lineEnd: line, tag: 'p', ordinal: 1, baseHash: markdownTextHash(DOC) })).toEqual({ refused: 'frontmatter' })
    }
    expect(mdOf(doc).elements.every(t => t.line > 3)).toBe(true)
  })

  it('024-AC-014 with the file changed, exactly one block with the pick\'s text moves the comment', () => {
    const doc = parseMd(DOC)
    const pick = pickOf(doc, targetBy(doc, 'paragraph', 'Beta'))
    const moved = parseMd(`${DOC}\nGamma.\n`.replace('Alpha.', 'Alpha.\n\nInserted.'))
    const found = markdownKind.locate(moved, pick)
    expect(isKindRefusal(found) ? found : (found as MdTarget).line).toBe(8)
    expect(markdownKind.locate(moved, { ...pick, quote: undefined })).toEqual({ refused: 'not-found' })
  })

  it('024-AC-014 (d) an identical block inserted above the target after the pick: refused as moved, nothing written', () => {
    const doc = parseMd(DOC)
    const pick = pickOf(doc, targetBy(doc, 'paragraph', 'Beta'))
    const changed = DOC.replace('Alpha.', 'Alpha.\n\nBeta.')
    const result = addComment(changed, pick)
    expect(result).toEqual({ refused: 'not-found' })
  })

  it('a BOM does not change the hash a pick carries', () => {
    expect(markdownTextHash(`\uFEFF${DOC}`)).toBe(markdownTextHash(DOC))
  })
})

describe('slots (design § 4.1–4.3)', () => {
  it('024-AC-003 list item 2 goes at item 1\'s content column on item 2\'s marker line; item 1 before the whole list', () => {
    const text = '- Freeze the API on Monday.\n- Run the load test against staging.\n'
    const two = written(add(text, 'item', 'Run'))
    expect(placed(text, two.plan)).toEqual({ line: 2, indent: '  ' })
    const one = written(add(text, 'item', 'Freeze'))
    expect(placed(text, one.plan)).toEqual({ line: 1, indent: '' })
    const ordered = '1. a\n2. b\n'
    expect(placed(ordered, written(add(ordered, 'item', 'b')).plan).indent).toBe('   ')
  })

  it('024-AC-003 a block quote target goes before the whole outermost quote, never with a > prefix', () => {
    const text = 'Intro.\n\n> outer\n>\n> > inner para\n'
    const result = written(add(text, 'paragraph', 'inner'))
    expect(placed(text, result.plan)).toEqual({ line: 3, indent: '' })
    expect(result.plan.insert).not.toMatch(/^\s*>/m)
    expect(result.data!.anchor.runtime?.path).toBe('blockquote:nth-of-type(1) > p:nth-of-type(1)')
  })

  it('024-AC-003 a later block of a list item goes at the item\'s content column', () => {
    const text = '- first\n\n  second para\n'
    expect(placed(text, written(add(text, 'paragraph', 'second')).plan)).toEqual({ line: 3, indent: '  ' })
  })

  it('024-AC-003 several comments on one target stack at the same slot, the new one last', () => {
    const text = '- a\n- b\n'
    const first = written(add(text, 'item', 'b'))
    const second = written(add(first.text, 'item', 'b'))
    const blocks = second.doc.state.blocks
    expect(blocks.map(b => b.kind === 'ok' && b.target.state)).toEqual(['attached', 'attached'])
    expect(blocks[1].nodeRange[0]).toBeGreaterThan(blocks[0].nodeRange[0])
    // Directly before item 2's marker line, so after the first block.
    expect(placed(first.text, second.plan).line).toBe(first.text.split('\n').length - 1)
  })

  it('design § 4.3: a slot after an unclosed fence, an open type-6 HTML block or a table row is skipped to the next slot', () => {
    const fence = '- one\n  ```\n  open fence\n- two\n'
    const html = '- one\n  <div>\n- two\n'
    for (const text of [fence, html]) {
      const doc = parseMd(text)
      const slots = markdownSlots(mdOf(doc), targetBy(doc, 'item', 'two'))
      expect(slots.map(s => s.carrier.kind)).toEqual(['list'])
      expect(placed(text, written(add(text, 'item', 'two')).plan)).toEqual({ line: 1, indent: '' })
    }
    const table = '| a |\n|---|\n| 1 |\n- after\n'
    const doc = parseMd(table)
    expect(markdownSlots(mdOf(doc), targetBy(doc, 'list'))).toEqual([])
    expect(add(table, 'list')).toEqual({ refused: 'no-slot' })
  })

  it('design § 4.5: a block inside a list item offers its own slot, then the whole list, then one level up', () => {
    const text = '- a\n  - b\n\n    later para\n'
    const doc = parseMd(text)
    const slots = markdownSlots(mdOf(doc), targetBy(doc, 'paragraph', 'later'))
    expect(slots.map(s => `${s.carrier.kind}@${s.carrier.line}+${s.indent.length}`)).toEqual(['paragraph@4+4', 'list@2+2', 'list@1+0'])
  })

  it('a target the kind does not know has no slot', () => {
    const doc = parseMd('a\n')
    expect(markdownKind.slots(doc, { tag: 'p', start: 0, id: undefined, textStart: 0, textEnd: 1 })).toEqual([])
    expect(() => markdownKind.anchorOf(doc, { tag: 'p', start: 0, id: undefined, textStart: 0, textEnd: 1 })).toThrow()
  })
})

describe('024-AC-031 other tools\' comments and generated regions', () => {
  const TABLE = '<!-- prettier-ignore -->\n| a  |  b |\n|---|---|\n| 1 | 2 |\n'
  const PARA = 'Intro.\n\n<!-- markdownlint-disable-next-line -->\nA  line   with   spaces.\n'
  const TOC = '# Title\n\n<!-- START doctoc generated TOC please keep comment here to allow auto update -->\n- [One](#one)\n- [Two](#two)\n<!-- END doctoc generated TOC please keep comment here to allow auto update -->\nAfter the region.\n'

  it('024-AC-031 prettier-ignore before a table: the block lands before the whole directive run', () => {
    const result = written(add(TABLE, 'table'))
    expect(placed(TABLE, result.plan)).toEqual({ line: 1, indent: '' })
    expect(result.text.indexOf('<!-- prettier-ignore -->')).toBeGreaterThan(result.text.indexOf('erfana:comment'))
    expect(result.text.slice(result.text.indexOf('<!-- prettier-ignore -->'))).toBe(TABLE)
  })

  it('024-AC-031 markdownlint-disable-next-line before a paragraph: before the run', () => {
    const result = written(add(PARA, 'paragraph', 'spaces'))
    expect(placed(PARA, result.plan)).toEqual({ line: 3, indent: '' })
  })

  it('024-AC-031 a paragraph right after the region\'s END goes after the END comment', () => {
    const result = written(add(TOC, 'paragraph', 'After'))
    expect(placed(TOC, result.plan).line).toBe(7)
    expect(result.text.indexOf('END doctoc')).toBeLessThan(result.text.indexOf('erfana:comment'))
  })

  it('024-AC-031 a list item inside the region is refused with its reason, and nothing is written', () => {
    expect(add(TOC, 'item', 'Two')).toEqual({ refused: 'generated-region' })
    expect(add(TOC, 'list')).toEqual({ refused: 'generated-region' })
  })

  it('024-AC-031 a new block stays after Erfana blocks at the head of a run, and before the first foreign member', () => {
    const first = written(add(TABLE, 'table'))
    const second = written(add(first.text, 'table'))
    const at = (needle: string): number => second.text.indexOf(needle)
    expect(at(first.data!.id)).toBeLessThan(at(second.data!.id))
    expect(at(second.data!.id)).toBeLessThan(at('prettier-ignore'))
  })

  it('024-AC-031 a directive run that starts on a list marker line cannot be stepped before inside the item: the slot moves up', () => {
    const text = '- <!-- prettier-ignore -->\n  | a  |  b |\n  |---|---|\n  | 1 | 2 |\n'
    const doc = parseMd(text)
    const slots = markdownSlots(mdOf(doc), targetBy(doc, 'table'))
    expect(slots.map(s => `${s.carrier.kind}@${s.carrier.line}`)).toEqual(['list@1'])
    expect(placed(text, written(add(text, 'table')).plan)).toEqual({ line: 1, indent: '' })
  })

  it('024-AC-031 the render check passes with every other comment in its place', () => {
    const cases = [[TABLE, 'table', ''], [PARA, 'paragraph', 'spaces'], [TOC, 'paragraph', 'After']] as const
    for (const [text, kind, match] of cases) {
      const doc = parseMd(text)
      const result = written(add(text, kind, match))
      const before = mdOf(doc).comments.map(c => text.slice(c.start, c.end))
      const after = mdOf(result.doc).comments.map(c => result.text.slice(c.start, c.end)).filter(c => !c.includes('erfana:comment'))
      expect(after).toEqual(before)
    }
  })
})

describe('hints (design § 6)', () => {
  const hintOf = (text: string, kind: Parameters<typeof targetBy>[1], match = '', nth = 0): string => {
    const result = written(add(text, kind, match, nth))
    return result.plan.insert.split(/\r\n|\r|\n/).find(line => line.includes('target in Markdown'))!.trim()
  }

  it.each([
    ['## Next steps\n', 'heading', '', 'H2 heading starting "## Next steps"'],
    ['- a\n- b\n', 'item', 'a', 'item 1 of the list starting "- a"'],
    ['| a |\n|---|\n| 1 |\n', 'row', 'a', 'header row of the table starting "| a |"'],
    ['| a |\n|---|\n| 1 |\n| 2 |\n', 'row', '2', 'row 2 of the table starting "| 2 |"'],
    ['| a | b |\n|---|---|\n| 1 | 2 |\n', 'cell', '2', 'row 1, column 2 of the table starting "| 1 | 2 |"'],
    ['| a | b |\n|---|---|\n| 1 | 2 |\n', 'cell', 'b', 'header row, column 2 of the table starting "| a | b |"'],
    ['> x\n>\n> y\n', 'paragraph', 'y', 'paragraph 2 inside the block quote starting "> y"'],
    ['```js\nconst a = 1\n```\n', 'code', '', 'code block starting "const a = 1"'],
    ['```mermaid\n```\n', 'diagram', '', 'diagram starting "```mermaid"'],
    ['    indented\n', 'code', '', 'code block starting "indented"'],
    ['Title\n===\n', 'heading', '', 'H1 heading starting "Title"'],
    ['![a](b.png)\n', 'image', '', 'image starting "![a](b.png)"'],
    ['<details><summary>S</summary>\n\n</details>\n', 'html', '', 'HTML block starting "<details><summary>S</summary>"']
  ] as const)('024-AC-003 %j %s → %s', (text, kind, match, hint) => {
    expect(hintOf(text, kind, match)).toBe(`target in Markdown (when commented): ${hint}`)
  })

  it('024-AC-003 a reply rebuilds the target hint from the file; a target no longer found drops it', () => {
    const text = 'Keep this paragraph.\n'
    const added = written(add(text, 'paragraph'))
    const replied = written(changeThread(added.text, added.data!.id, 'reply'))
    expect(replied.text).toContain('target in Markdown (when commented): paragraph starting "Keep this paragraph."')
    const edited = replaceLast(replied.text, 'Keep this paragraph.', 'Other words now.')
    const again = written(changeThread(edited, added.data!.id, 'resolve'))
    expect(again.text).not.toContain('target in Markdown (when commented)')
    expect(okBlock(again.doc, added.data!.id).data.status).toBe('resolved')
  })

  it('the hints of another kind\'s document, or none, are the words hint alone', () => {
    const data = createThread({ anchor: { tag: 'p', path: '', sel: { exact: 'x', prefix: '', suffix: '' } }, view: MD_VIEW, text: 'm', context: contextOf() })
    expect(markdownKind.hints(data)).toEqual(['comment is about the words (when commented): "x"'])
    expect(markdownKind.agentNote).toBe(MARKDOWN_AGENT_NOTE_LINES)
    expect(markdownKind.extensions).toEqual(['.md', '.markdown'])
  })
})

describe('selection (024-FR-004)', () => {
  const TEXT = 'The release ships when every check is green and every check passes.\n'

  it('024-AC-003 keeps the words with the file\'s own context, widened on a tie', () => {
    const doc = parseMd(TEXT)
    const p = targetBy(doc, 'paragraph')
    const sel = markdownSelection(mdOf(doc), p, { exact: 'every check', prefix: 'is green and ', suffix: ' passes.' })
    const before = TEXT.slice(0, TEXT.lastIndexOf('every check'))
    expect(sel).toEqual({ exact: 'every check', prefix: before.slice(-32), suffix: ' passes.' })
    // No context from the pick: the first place, with its own context.
    expect(markdownSelection(mdOf(doc), p, { exact: 'every check', prefix: 'elsewhere', suffix: '' })).toEqual({
      exact: 'every check',
      prefix: 'The release ships when ',
      suffix: ' is green and every check passes'
    })
  })

  it('024-AC-003 drops words not in the file, a whole-block selection, a blank one and an invalid one', () => {
    const doc = parseMd(TEXT)
    const p = targetBy(doc, 'paragraph')
    const index = mdOf(doc)
    expect(markdownSelection(index, p, { exact: 'not here', prefix: '', suffix: '' })).toBeUndefined()
    expect(markdownSelection(index, p, { exact: TEXT.trim(), prefix: '', suffix: '' })).toBeUndefined()
    expect(markdownSelection(index, p, { exact: ' ', prefix: '', suffix: '' })).toBeUndefined()
    expect(markdownSelection(index, p, { exact: 'two  spaces', prefix: '', suffix: '' })).toBeUndefined()
    expect(markdownSelection(index, p, undefined)).toBeUndefined()
  })

  it('024-AC-003 drops words that two places share exactly, context included', () => {
    const doc = parseMd('ab ab\n')
    expect(markdownSelection(mdOf(doc), targetBy(doc, 'paragraph'), { exact: 'ab', prefix: '', suffix: '' })).toBeDefined()
    const twin = parseMd('xx\n')
    expect(markdownSelection(mdOf(twin), targetBy(twin, 'paragraph'), { exact: 'x', prefix: '', suffix: '' })).toBeDefined()
    const run = 'a'.repeat(40)
    const same = parseMd(`${run}Q${run}Q${run}\n`)
    expect(markdownSelection(mdOf(same), targetBy(same, 'paragraph'), { exact: 'Q', prefix: '', suffix: '' })).toBeUndefined()
  })

  it('024-AC-036 a target whose rendered text is past the search limit is not searched: the words are dropped', () => {
    const words = (n: number): string => 'word '.repeat(Math.ceil(n / 5)).slice(0, n - 1) + '.'
    const at = parseMd(`${words(MARKDOWN_SELECTION_SEARCH_MAX_CHARS)} tail\n`)
    const over = targetBy(at, 'paragraph')
    expect(over.textEnd - over.textStart).toBeGreaterThan(MARKDOWN_SELECTION_SEARCH_MAX_CHARS)
    expect(selectableText(mdOf(at), over)).toBeUndefined()
    expect(markdownSelection(mdOf(at), over, { exact: 'tail', prefix: '', suffix: '' })).toBeUndefined()
    const within = parseMd(`${words(MARKDOWN_SELECTION_SEARCH_MAX_CHARS - 10)} tail\n`)
    const under = targetBy(within, 'paragraph')
    expect(under.textEnd - under.textStart).toBeLessThanOrEqual(MARKDOWN_SELECTION_SEARCH_MAX_CHARS)
    expect(markdownSelection(mdOf(within), under, { exact: 'tail', prefix: '', suffix: '' })).toMatchObject({ exact: 'tail', suffix: '' })
  })

  it('024-AC-003 a valid selection is stored as anchor.sel with its words hint', () => {
    const doc = parseMd(TEXT)
    const result = written(addComment(TEXT, pickOf(doc, targetBy(doc, 'paragraph')), 'Name them.', { sel: { exact: 'green', prefix: '', suffix: '' } }))
    expect(result.data!.anchor.sel).toMatchObject({ exact: 'green' })
    expect(result.text).toContain('comment is about the words (when commented): "green"')
  })
})

describe('re-attachment (C7)', () => {
  it('024-AC-003 position needs the text: an edited target is Not found, a moved one is found by its text', () => {
    const added = written(add('Alpha.\n\nBeta.\n', 'paragraph', 'Beta'))
    expect(okBlock(added.doc, added.data!.id).target).toMatchObject({ state: 'attached', via: 'position' })
    const edited = parseMd(replaceLast(added.text, 'Beta.', 'Gamma.'))
    expect(okBlock(edited, added.data!.id).target).toEqual({ state: 'orphaned' })
    const moved = parseMd(`${replaceLast(added.text, 'Beta.\n', 'Other.\n')}\nBeta.\n`)
    expect(okBlock(moved, added.data!.id).target).toMatchObject({ state: 'attached', via: 'quote' })
  })

  it('024-AC-003 position skips blank lines and other tools\' comments; a textless target is corroborated by its path', () => {
    const added = written(add('Text.\n\n---\n', 'divider'))
    const spaced = parseMd(added.text.replace('-->\n---', '-->\n\n<!-- prettier-ignore -->\n\n---'))
    expect(okBlock(spaced, added.data!.id).target).toMatchObject({ state: 'attached', via: 'position' })
    const index = mdOf(spaced)
    const anchor = okBlock(spaced, added.data!.id).data.anchor
    expect(findMarkdownTarget(index, anchor)).toMatchObject({ state: 'attached', via: 'path' })
    expect(findMarkdownTarget(index, { ...anchor, path: '' })).toEqual({ state: 'orphaned' })
    expect(markdownKind.reattach(spaced, { tag: 'p', path: '', quote: { exact: 'Text.', prefix: '', suffix: '' } })).toMatchObject({ state: 'attached', via: 'quote' })
  })
})

describe('blocks (024-FR-003, C3)', () => {
  it('024-AC-003 a block that relies on --!> is unterminated in Markdown: the file is read-only', () => {
    const ok = written(add('a\n\nb\n', 'paragraph', 'b'))
    const broken = ok.text.replace(/-->(\r?\n)b/, '--!>$1b')
    const doc = parseMd(broken)
    expect(doc.state).toMatchObject({ writable: false, readOnlyReason: 'unterminated-block' })
    expect(doc.state.blocks.map(b => b.kind === 'damaged' && b.reason)).toEqual(['unterminated'])
    const conflicted = parseMd(`<<<<<<< ours\nx\n=======\ny\n>>>>>>> theirs\n${broken}`)
    expect(conflicted.state.readOnlyReason).toBe('conflict-markers')
  })

  it('024-AC-003 a block written by hand inside a block quote reads Damaged; Delete removes it', () => {
    const ok = written(add('a\n', 'paragraph'))
    const quoted = ok.text.split('\n').map(line => (line === '' ? line : `> ${line}`)).join('\n')
    const doc = parseMd(quoted)
    const [block] = doc.state.blocks
    expect(block.kind).toBe('damaged')
    const removed = planDelete(doc, { block: { start: block.nodeRange[0] }, rawHash: block.rawHash })
    if (!removed.ok) throw new Error(removed.reason)
    expect(applySplice(quoted, removed.plan)).toBe('> \n> a\n')
  })
})

describe('the render check (design § 4.5)', () => {
  it('024-AC-037 refuses a splice that turns a tight list loose, and one that changes another comment', () => {
    const text = '- a\n<!-- keep -->\n- b\n'.replace('<!-- keep -->\n', '')
    const doc = parseMd(text)
    const target = targetBy(doc, 'item', 'b')
    const [slot] = markdownKind.slots(doc, target)
    const data = createThread({ anchor: markdownKind.anchorOf(doc, target), view: MD_VIEW, text: 'm', context: contextOf() })
    const planned = planSlotInsert(doc, slot, data, undefined, markdownKind)
    if (!planned.ok) throw new Error(planned.reason)
    const loose = { ...planned.plan, insert: `${planned.plan.insert}\n` }
    const looseText = applySplice(text, loose)
    expect(markdownKind.verify(markdownKind.originOf(doc), parseMd(looseText), loose)).toEqual({ ok: false, reason: 'render-changed' })
    expect(markdownKind.verify(markdownKind.originOf(doc), parseMd(applySplice(text, planned.plan)), planned.plan)).toEqual({ ok: true })

    const withOther = '<!-- other -->\npara\n'
    const otherDoc = parseMd(withOther)
    const cut: SplicePlan = { op: 'insert', start: 6, end: 6, insert: 'x' }
    expect(markdownKind.verify(markdownKind.originOf(otherDoc), parseMd(applySplice(withOther, cut)), cut)).toEqual({ ok: false, reason: 'render-changed' })
  })

  it('024-AC-037 renders with the user\'s line-break setting, once per save', () => {
    const text = 'a\nb\n'
    const doc = parseMd(text)
    const on = markdownOriginOf(doc, { breaks: true })
    const off = markdownOriginOf(doc, { breaks: false })
    expect(on.signature).not.toBe(off.signature)
    expect(off.signature).toBe(mdOf(doc).signature)
    const kindOn = markdownKindWith({ breaks: true })
    expect(kindOn.originOf(doc)).toEqual(on)
    const added = written(addComment(text, pickOf(doc, targetBy(doc, 'paragraph')), 'm', { kind: kindOn }))
    expect(added.doc.state.blocks).toHaveLength(1)
  })

  it('throws on another kind\'s document or origin (a wiring bug)', () => {
    const html = htmlKind.parse('<p>x</p>', 0)
    expect(() => markdownKind.locate(html, { lineStart: 1, lineEnd: 1, tag: 'p', ordinal: 1 })).toThrow()
    const doc = parseMd('a\n')
    expect(() => markdownKind.verify(htmlKind.originOf(html), doc, { op: 'delete', start: 0, end: 0, insert: '' })).toThrow()
    expect(doc.index).toBeInstanceOf(MdIndex)
    expect(bomOf('\uFEFFx')).toBe(1)
  })
})
