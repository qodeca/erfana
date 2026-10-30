// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Other tools' comments in HTML files (spec 024 024-FR-023, 024-AC-031): a
 * new block goes before a directive run, never between a directive and its
 * element, never inside a generated START/END region; a target inside a
 * region is refused and nothing is written.
 */
import { describe, expect, it } from 'vitest'
import { fixedId, makeComment } from '../comments/__fixtures__/commentTestData'
import { htmlKind } from '../comments/htmlKind'
import { isKindRefusal } from '../comments/fileKind'
import { buildAnchor } from './anchor'
import { directiveRunStart, inHtmlGeneratedRegion } from './htmlForeign'
import type { IndexedElement } from './htmlIndex'
import { analyzeCommentDocument, type CommentDocument } from './parse'
import { applySplice, planInsert, verifyCommentSplice } from './splice'

const NEW_ID = fixedId('c-', 9_001)

const TABLE = '<main>\n  <!-- prettier-ignore -->\n  <table><tr><td>a</td></tr></table>\n</main>\n'
const PARA = '<main>\n  <p>Intro.</p>\n  <!-- markdownlint-disable-next-line -->\n  <p>A  line   with   spaces.</p>\n</main>\n'
const TOC =
  '<main>\n  <h1>Title</h1>\n' +
  '  <!-- START doctoc generated TOC please keep comment here to allow auto update -->\n' +
  '  <ul>\n    <li><a href="#one">One</a></li>\n    <li><a href="#two">Two</a></li>\n  </ul>\n' +
  '  <!-- END doctoc generated TOC please keep comment here to allow auto update -->\n' +
  '  <p>After the region.</p>\n</main>\n'

/** The `nth` eligible element of `tag` whose text holds `match`. */
function elementOf(doc: CommentDocument, tag: string, match = ''): IndexedElement {
  const el = doc.index.elements.find(
    candidate => candidate.tag === tag && doc.index.visibleText.slice(candidate.textStart, candidate.textEnd).includes(match)
  )
  if (el === undefined) throw new Error(`no <${tag}> holding "${match}"`)
  return el
}

/** Plan a block on `<tag>` (own lines, as a pick in a collapsing parent would) and apply it, checked. */
function add(text: string, tag: string, match = '') {
  const doc = analyzeCommentDocument(text)
  const el = elementOf(doc, tag, match)
  const data = makeComment({ id: NEW_ID, anchor: buildAnchor(doc.index, el) })
  const planned = planInsert(doc, { targetStart: el.start, data, ws: 'collapse' })
  if (!planned.ok) return { refused: planned.reason } as const
  const newText = applySplice(text, planned.plan)
  const verified = verifyCommentSplice(doc, newText, planned.plan)
  if (!verified.ok) throw new Error(`verifyCommentSplice: ${verified.reason}`)
  return { plan: planned.plan, text: newText, doc: verified.doc, el } as const
}

/** `text` with the block that `add` wrote removed again. */
function withoutBlock(text: string, start: number, insert: string): string {
  return text.slice(0, start) + text.slice(start + insert.length)
}

describe('024-AC-031 other tools\' comments and generated regions (HTML)', () => {
  it('024-AC-031 prettier-ignore before a table: the block lands before the whole directive run', () => {
    const result = add(TABLE, 'table')
    if ('refused' in result) throw new Error(result.refused)
    expect(result.plan.start).toBe(TABLE.indexOf('<!-- prettier-ignore -->'))
    expect(result.plan.placement).toBe('own-lines')
    expect(result.text.indexOf('erfana:comment')).toBeLessThan(result.text.indexOf('prettier-ignore'))
    // The directive and its table are untouched and still adjacent.
    expect(result.text).toContain('<!-- prettier-ignore -->\n  <table>')
    expect(withoutBlock(result.text, result.plan.start, result.plan.insert)).toBe(TABLE)
  })

  it('024-AC-031 markdownlint-disable-next-line before a paragraph: before the run', () => {
    const result = add(PARA, 'p', 'spaces')
    if ('refused' in result) throw new Error(result.refused)
    expect(result.plan.start).toBe(PARA.indexOf('<!-- markdownlint-disable-next-line -->'))
    expect(result.text).toContain('<!-- markdownlint-disable-next-line -->\n  <p>A  line')
  })

  it('024-AC-031 the new block still finds its element, through its stored anchor (the position rule skips only blocks, U-081)', () => {
    for (const [text, tag, match] of [[TABLE, 'table', ''], [PARA, 'p', 'spaces']] as const) {
      const result = add(text, tag, match)
      if ('refused' in result) throw new Error(result.refused)
      const block = result.doc.state.blocks.find(b => b.kind === 'ok' && b.data.id === NEW_ID)
      const shift = result.plan.insert.length
      expect(block).toMatchObject({ kind: 'ok', target: { state: 'attached', startOffset: result.el.start + shift } })
    }
  })

  it('024-AC-031 a paragraph right after the region\'s END goes after the END comment', () => {
    const result = add(TOC, 'p', 'After')
    if ('refused' in result) throw new Error(result.refused)
    expect(result.plan.start).toBe(TOC.indexOf('<p>After'))
    expect(result.text.indexOf('END doctoc')).toBeLessThan(result.text.indexOf('erfana:comment'))
  })

  it('024-AC-031 a list item inside the region is refused with its reason, and nothing is written', () => {
    expect(add(TOC, 'li', 'Two')).toEqual({ refused: 'generated-region' })
    expect(add(TOC, 'ul')).toEqual({ refused: 'generated-region' })
    expect(add(TOC, 'a', 'One')).toEqual({ refused: 'generated-region' })
  })

  it('024-AC-031 the HTML kind refuses a pick inside the region the same way', () => {
    const doc = analyzeCommentDocument(TOC)
    const li = elementOf(doc, 'li', 'Two')
    const found = htmlKind.locate(doc, { tag: 'li', path: buildAnchor(doc.index, li).path, lineStart: 1, lineEnd: 1, ordinal: 1 })
    expect(isKindRefusal(found) && found.refused).toBe('generated-region')
    const after = elementOf(doc, 'p', 'After')
    const ok = htmlKind.locate(doc, { tag: 'p', path: buildAnchor(doc.index, after).path, lineStart: 1, lineEnd: 1, ordinal: 1 })
    expect(isKindRefusal(ok)).toBe(false)
  })

  it('024-AC-031 a new block stays after Erfana blocks at the head of a run, and before the first foreign member', () => {
    const first = add(TABLE, 'table')
    if ('refused' in first) throw new Error(first.refused)
    const doc = analyzeCommentDocument(first.text)
    const el = elementOf(doc, 'table')
    const secondId = fixedId('c-', 9_002)
    const planned = planInsert(doc, {
      targetStart: el.start,
      data: makeComment({ id: secondId, anchor: buildAnchor(doc.index, el) }),
      ws: 'collapse'
    })
    if (!planned.ok) throw new Error(planned.reason)
    const text = applySplice(first.text, planned.plan)
    expect(text.indexOf(NEW_ID)).toBeLessThan(text.indexOf(secondId))
    expect(text.indexOf(secondId)).toBeLessThan(text.indexOf('prettier-ignore'))
  })

  it('024-AC-031 the render check passes with every other comment in its place', () => {
    for (const [text, tag, match] of [[TABLE, 'table', ''], [PARA, 'p', 'spaces'], [TOC, 'p', 'After']] as const) {
      const result = add(text, tag, match)
      if ('refused' in result) throw new Error(result.refused)
      const commentsOf = (doc: CommentDocument): string[] =>
        doc.index.comments.map(c => doc.text.slice(c.start, c.end)).filter(c => !c.includes('erfana:comment'))
      expect(commentsOf(result.doc)).toEqual(commentsOf(analyzeCommentDocument(text)))
    }
  })

  it('024-AC-031 with no other tool\'s comment before the element, the slot is its start tag, as before', () => {
    const plain = '<main>\n  <!-- erfana is not here -->\n  <h1>T</h1>\n  <p>Body.</p>\n</main>\n'
    const doc = analyzeCommentDocument(plain)
    const p = elementOf(doc, 'p')
    expect(directiveRunStart(doc.index, p)).toBeUndefined()
    const result = add(plain, 'p')
    if ('refused' in result) throw new Error(result.refused)
    expect(result.plan.start).toBe(p.start)
  })

  it('024-AC-031 a mid-line directive keeps the mid-line form and stays next to its element', () => {
    const inline = '<p>Text <!-- prettier-ignore --><b>bold</b></p>\n'
    const result = add(inline, 'b')
    if ('refused' in result) throw new Error(result.refused)
    expect(result.plan.placement).toBe('mid-line')
    expect(result.text).toMatch(/Text <!-- erfana:comment[\s\S]*--><!-- prettier-ignore --><b>bold<\/b>/)
  })

  it('024-AC-031 regions pair only among siblings, and an unpaired START or a bogus comment opens nothing', () => {
    const nested = '<div><!-- START x --></div><p>Outside.</p><div><!-- END x --></div>\n'
    const doc = analyzeCommentDocument(nested)
    expect(inHtmlGeneratedRegion(doc.index, elementOf(doc, 'p'))).toBe(false)
    const unpaired = analyzeCommentDocument('<!-- START doctoc --><p>No end.</p>\n')
    expect(inHtmlGeneratedRegion(unpaired.index, elementOf(unpaired, 'p'))).toBe(false)
    const bogus = '<main><?prettier-ignore?><p>Bogus.</p></main>\n'
    const bogusDoc = analyzeCommentDocument(bogus)
    expect(directiveRunStart(bogusDoc.index, elementOf(bogusDoc, 'p'))).toBeUndefined()
  })
})
