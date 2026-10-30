// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The HTML file kind wraps the shipped HTML modules without changing them
 * (spec 024 architecture note 001 § 1, § 3): every answer is the one the
 * HTML module gives directly.
 */
import { describe, expect, it } from 'vitest'
import { buildAnchor } from '../htmlComments/anchor'
import { analyzeCommentDocument } from '../htmlComments/parse'
import { htmlGrowthCheck, planInsert, spliceOriginOf } from '../htmlComments/splice'
import { fixedId, makeComment } from './__fixtures__/commentTestData'
import { lineDocument } from './__fixtures__/lineIndex'
import { isKindRefusal, type PickedTarget } from './fileKind'
import { AGENT_NOTE_LINES } from './format'
import { htmlKind } from './htmlKind'
import { findAnchorTarget } from './reattach'
import { applySplice, planSlotInsert } from './splice'

const PAGE = [
  '<!doctype html><main>',
  '  <p id="intro">Hello</p>',
  '  <ul><li>One</li><li id="two">Two</li></ul>',
  '  <pre>  <b>kept</b></pre>',
  '</main>'
].join('\n')

const doc = htmlKind.parse(PAGE, 0)
const html = analyzeCommentDocument(PAGE)
const byTag = (tag: string, n = 0) => html.index.elements.filter(el => el.tag === tag)[n]

function pick(over: Partial<PickedTarget>): PickedTarget {
  return { lineStart: 1, lineEnd: 1, tag: 'p', ordinal: 1, ...over }
}

describe('htmlKind', () => {
  it('is the shipped HTML: id, extensions and agent note', () => {
    expect(htmlKind.id).toBe('html')
    expect(htmlKind.extensions).toEqual(['.html', '.htm'])
    expect(htmlKind.agentNote).toBe(AGENT_NOTE_LINES)
    // C10: the meta-charset refusal is the HTML kind's own growth check.
    expect(htmlKind.refuseGrowth).toBe(htmlGrowthCheck)
  })

  it('parses as analyzeCommentDocument does', () => {
    expect(doc.state).toEqual(html.state)
    expect(doc.text).toBe(PAGE)
  })

  it('locates a pick by path, else by a unique id; the tag must match', () => {
    const p = byTag('p')
    const path = html.index.pathOf(p.node)
    expect(htmlKind.locate(doc, pick({ path }))).toMatchObject({ start: p.start })
    expect(htmlKind.locate(doc, pick({ path, tag: 'li', id: 'two' }))).toMatchObject({ start: byTag('li', 1).start })
    expect(htmlKind.locate(doc, pick({ id: 'intro' }))).toMatchObject({ start: p.start })
    const misses = [pick({ path, tag: 'b' }), pick({ id: 'intro', tag: 'li' }), pick({})]
    for (const missed of misses) expect(isKindRefusal(htmlKind.locate(doc, missed))).toBe(true)
  })

  it('offers one before-target slot, own lines only with ws = collapse at a line start (R3-8)', () => {
    const p = byTag('p')
    expect(htmlKind.slots(doc, p, pick({ ws: 'collapse' }))).toEqual([
      { offset: p.start, shape: 'before-target', indent: '  ', placement: 'own-lines' }
    ])
    expect(htmlKind.slots(doc, p)).toEqual([
      { offset: p.start, shape: 'before-target', indent: '  ', placement: 'mid-line' }
    ])
    expect(htmlKind.slots(doc, byTag('li'), pick({ ws: 'collapse' }))[0]).toMatchObject({ placement: 'mid-line' })
    expect(htmlKind.slots(doc, byTag('b'), pick({ ws: 'collapse' }))[0]).toMatchObject({ placement: 'mid-line' })
    expect(htmlKind.slots(doc, { ...p, start: p.start + 1 })).toEqual([])
  })

  it('a slot plans the same bytes as planInsert', () => {
    const data = makeComment({ id: fixedId('c-', 3) })
    for (const ws of ['collapse', undefined]) {
      const p = byTag('p')
      const viaKind = planSlotInsert(html, htmlKind.slots(doc, p, pick({ ws }))[0], data)
      const shipped = planInsert(html, { targetStart: p.start, data, ws })
      if (!viaKind.ok || !shipped.ok) throw new Error('plan')
      expect(applySplice(PAGE, viaKind.plan)).toBe(applySplice(PAGE, shipped.plan))
    }
  })

  it('anchors, hints, re-attaches and verifies as the HTML modules do', () => {
    const li = byTag('li', 1)
    const anchor = htmlKind.anchorOf(doc, li)
    expect(anchor).toEqual(buildAnchor(html.index, li))
    expect(htmlKind.hints(makeComment(), li)).toEqual([])
    expect(htmlKind.reattach(doc, anchor)).toEqual(findAnchorTarget(html.index, anchor))
    const origin = htmlKind.originOf(doc)
    expect(origin).toEqual(spliceOriginOf(html))
    const plan = { op: 'replace' as const, start: 0, end: 0, insert: '' }
    expect(htmlKind.verify(origin, doc, plan)).toEqual({ ok: true })
    expect(htmlKind.verify(origin, htmlKind.parse(`${PAGE}<p>more</p>`, 0), plan)).toEqual({ ok: false, reason: 'elements' })
  })

  it('throws on another kind\'s document, origin or target – a wiring bug, never a guess', () => {
    const foreign = lineDocument('a\n')
    expect(() => htmlKind.reattach(foreign, { tag: 'p', path: '' })).toThrow(/another kind/)
    expect(() => htmlKind.verify({ text: '', blockCount: 0, commentCount: 0 }, doc, { op: 'delete', start: 0, end: 0, insert: '' })).toThrow(/origin/)
    expect(() => htmlKind.anchorOf(doc, { ...byTag('p'), start: 1 })).toThrow(/outside/)
  })
})
