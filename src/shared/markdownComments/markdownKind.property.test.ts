// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * 024-AC-037: Markdown property tests (024-FR-012). A seeded generator
 * builds documents with containers nested 3 deep, every block kind, every
 * line-ending style, a BOM and tabs, with comment-shaped text in code; a
 * random commentable target gets a comment. Then, whenever the save is not
 * refused: the bytes outside the permitted range are equal, `delete(add)` is
 * the identity, add → reply → resolve → delete returns the original, the
 * preview's tree is unchanged (breaks on and off), the frozen v0.23.1 parser
 * reads every block `ok`, another block already in the file is unchanged,
 * and comment-shaped text in code is never a block. The seed is logged;
 * `FC_SEED` replays it.
 *
 * Agreement with cmark-gfm is not checked here: no JavaScript port of
 * cmark-gfm is a dependency, so it belongs to the corpus run (024-NFR-003).
 */
import fc from 'fast-check'
import type { Nodes as MdNode } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'
import { fcParams, NUM_RUNS, PROPERTY_TIMEOUT_MS } from '../comments/__fixtures__/arbitraries'
import { analyzeCommentDocument as frozenAnalyze } from '../comments/__fixtures__/frozen-v0.23.1/parse'
import { encodeText } from '../comments/encoding'
import { verifySpliceBytes } from '../comments/splice'
import { previewTree, splitFrontmatter } from '../markdown/previewPipeline'
import { renderSignature } from './mdRender'
import { addComment, changeThread, mdOf, parseMd, pickOf, written, type Written } from './__test-helpers__/mdHarness'

const SEED = process.env.FC_SEED ? Number(process.env.FC_SEED) : Math.floor(Math.random() * 2 ** 31)
console.info(`024-AC-037 Markdown property seed: ${SEED} (FC_SEED=${SEED} replays it)`)

/** Lines of one block, without line breaks; containers prefix their children's lines. */
type Lines = readonly string[]

const word = fc.constantFrom('alpha', 'beta', 'gamma', 'café', '😀 emoji', 'e\u0301te\u0301', 'tab\there', 'x--y', '*em*', '`code`')
const text = fc.array(word, { minLength: 1, maxLength: 4 }).map(ws => ws.join(' '))
const SHAPED = '<!-- erfana:comment v1 id=c-aaaaaaaaaaaaaaaa status: open -->'

const leaf: fc.Arbitrary<Lines> = fc.oneof(
  text.map(t => [t]),
  fc.tuple(text, text).map(([a, b]) => [a, b]),
  fc.tuple(fc.integer({ min: 1, max: 6 }), text).map(([n, t]) => [`${'#'.repeat(n)} ${t}`]),
  text.map(t => [t, '===']),
  fc.constant(['```js', 'run()', SHAPED, '```']),
  fc.constant(['```mermaid', 'graph TD; A-->B', '```']),
  fc.constant(['---']),
  fc.constant(['| a | b |', '|---|---|', '| 1 | 2 |']),
  fc.constant(['![alt](pic.png)']),
  fc.constant(['<details><summary>More</summary>', '', 'inner', '', '</details>']),
  fc.constant([`Use \`${SHAPED}\` here.`]),
  fc.constant(['<!-- prettier-ignore -->', '| a  |  b |', '|---|---|', '| 1 | 2 |'])
)

/** Join blocks with a blank line (loose) or none where that keeps them apart. */
function joinBlocks(blocks: readonly Lines[], tight: boolean): Lines {
  return blocks.flatMap((block, i) => (i === 0 || tight ? block : ['', ...block]))
}

function item(marker: string, blocks: readonly Lines[], tight: boolean): Lines {
  const pad = ' '.repeat(marker.replace('\t', '   ').length)
  const lines = joinBlocks(blocks, tight)
  return lines.map((line, i) => (i === 0 ? `${marker}${line}` : line === '' ? '' : `${pad}${line}`))
}

function blockArb(depth: number): fc.Arbitrary<Lines> {
  if (depth >= 3) return leaf
  const inner = blockArb(depth + 1)
  const list = fc
    .tuple(fc.constantFrom('- ', '* ', '1. ', '-\t'), fc.array(fc.array(inner, { minLength: 1, maxLength: 2 }), { minLength: 1, maxLength: 3 }), fc.boolean())
    .map(([marker, items, tight]) => {
      const lines = items.map((blocks, i) => item(marker === '1. ' ? `${i + 1}. ` : marker, blocks, tight))
      return joinBlocks(lines, tight)
    })
  const quote = fc.array(inner, { minLength: 1, maxLength: 2 }).map(blocks => joinBlocks(blocks, false).map(line => (line === '' ? '>' : `> ${line}`)))
  const indented = depth === 0 ? [fc.constant(['    indented code', '    ' + SHAPED])] : []
  return fc.oneof({ weight: 3, arbitrary: leaf }, { weight: 2, arbitrary: list }, { weight: 1, arbitrary: quote }, ...indented.map(arbitrary => ({ weight: 1, arbitrary })))
}

const EOLS = ['\n', '\r\n', '\r'] as const

/** A generated file: blocks, an optional frontmatter, a line-ending style, a BOM, a final line break. */
const documentArb = fc
  .record({
    blocks: fc.array(blockArb(0), { minLength: 1, maxLength: 4 }),
    eols: fc.oneof(fc.constantFrom(...EOLS).map(eol => [eol]), fc.array(fc.constantFrom(...EOLS), { minLength: 2, maxLength: 5 })),
    bom: fc.boolean(),
    frontmatter: fc.boolean(),
    finalBreak: fc.boolean()
  })
  .map(({ blocks, eols, bom, frontmatter, finalBreak }) => {
    const lines = [...(frontmatter ? ['---', 'title: x', '---'] : []), ...joinBlocks(blocks, false)]
    // Frontmatter is split on LF and CRLF only; a CR-only file would not have one.
    let out = bom ? '\uFEFF' : ''
    lines.forEach((line, i) => {
      const eol = eols[i % eols.length]
      out += line + (i < lines.length - 1 || finalBreak ? (frontmatter && eol === '\r' ? '\n' : eol) : '')
    })
    return out
  })

function renderOf(text: string, breaks: boolean): string {
  const body = splitFrontmatter(text.startsWith('\uFEFF') ? text.slice(1) : text).body
  return renderSignature(previewTree(body, { breaks }))
}

/**
 * The file ranges of code – fenced and indented code, code spans – and of the
 * frontmatter, from an independent parse: where no comment may be found.
 */
function codeRanges(text: string): Array<readonly [number, number]> {
  const bom = text.startsWith('\uFEFF') ? 1 : 0
  const split = splitFrontmatter(text.slice(bom))
  const base = bom + split.bodyOffset
  const ranges: Array<readonly [number, number]> = [[0, base]]
  const visit = (node: MdNode): void => {
    if ((node.type === 'code' || node.type === 'inlineCode') && node.position) {
      ranges.push([base + node.position.start.offset!, base + node.position.end.offset!])
    }
    for (const child of 'children' in node ? node.children : []) visit(child)
  }
  visit(unified().use(remarkParse).use(remarkGfm).parse(split.body))
  return ranges
}

/** Every Erfana block of `text`, in v0.23.1's reading. */
const frozenKinds = (text: string): string[] => frozenAnalyze(text).state.blocks.map(b => b.kind)

/** The first comment on a random target of `text`, when the kind accepts one. */
function commentOn(text: string, pickAt: number): Written | undefined {
  const doc = parseMd(text)
  const targets = mdOf(doc).elements
  if (targets.length === 0) return undefined
  const result = addComment(text, pickOf(doc, targets[pickAt % targets.length]))
  if ('refused' in result) {
    // A refusal writes nothing; only these are the kind's to give.
    expect(['render-changed', 'no-slot', 'generated-region']).toContain(result.refused)
    return undefined
  }
  return result
}

/**
 * Each run parses its document several times with the full preview pipeline
 * (the add, its verifying re-parse, then each later step): about 50 ms a
 * run, 5–11 s a property – and two to three times that under coverage
 * instrumentation in a loaded run, hence three times the shared budget.
 */
const MARKDOWN_PROPERTY_TIMEOUT_MS = 3 * PROPERTY_TIMEOUT_MS

const property = (name: string, run: (text: string, pickAt: number) => void): void => {
  it(
    name,
    () => {
      fc.assert(fc.property(documentArb, fc.nat(), run), fcParams({ seed: SEED, numRuns: NUM_RUNS }))
    },
    MARKDOWN_PROPERTY_TIMEOUT_MS
  )
}

describe('024-AC-037 Markdown property tests', () => {
  property('024-AC-037 bytes outside the permitted range are equal, and delete(add) = id', (text, pickAt) => {
    const added = commentOn(text, pickAt)
    if (added === undefined) return
    expect(verifySpliceBytes(encodeText(text), encodeText(added.text), text, added.plan)).toBe(true)
    expect(written(changeThread(added.text, added.data!.id, 'delete')).text).toBe(text)
  })

  property('024-AC-037 add → reply → resolve → delete returns the original bytes', (text, pickAt) => {
    const added = commentOn(text, pickAt)
    if (added === undefined) return
    let now = added.text
    for (const op of ['reply', 'resolve', 'delete'] as const) now = written(changeThread(now, added.data!.id, op)).text
    expect(encodeText(now)).toEqual(encodeText(text))
  })

  property('024-AC-037 the rendered tree is unchanged in Erfana\'s pipeline, line breaks on and off', (text, pickAt) => {
    const added = commentOn(text, pickAt)
    if (added === undefined) return
    expect(renderOf(added.text, false)).toBe(renderOf(text, false))
    expect(renderOf(added.text, true)).toBe(renderOf(text, true))
  })

  property('024-AC-037 the frozen v0.23.1 parser reads every block ok; another block is unchanged', (text, pickAt) => {
    // v0.23.1 reads the file as HTML, so the generated comment-shaped text in code is a comment
    // to it (damaged); what is checked is that each written block adds one `ok` and nothing else.
    const okCount = (t: string): number => frozenKinds(t).filter(kind => kind === 'ok').length
    const first = commentOn(text, pickAt)
    if (first === undefined) return
    expect(okCount(first.text)).toBe(okCount(text) + 1)
    expect(frozenKinds(first.text).length).toBe(frozenKinds(text).length + 1)
    const second = commentOn(first.text, pickAt + 1)
    if (second === undefined) return
    expect(okCount(second.text)).toBe(okCount(text) + 2)
    const block = first.doc.state.blocks.find(b => b.kind === 'ok' && b.data.id === first.data!.id)!
    expect(second.text).toContain(first.text.slice(block.nodeRange[0], block.nodeRange[1]))
    expect(written(changeThread(second.text, second.data!.id, 'delete')).text).toBe(first.text)
  })

  property('024-AC-037 comment-shaped text in code is never found as a block', text => {
    const doc = parseMd(text)
    const code = codeRanges(text)
    for (const comment of mdOf(doc).comments) {
      expect(code.some(([start, end]) => start <= comment.start && comment.start < end)).toBe(false)
    }
    for (const block of doc.state.blocks) expect(mdOf(doc).comments.some(c => c.start === block.nodeRange[0])).toBe(true)
  })
})
