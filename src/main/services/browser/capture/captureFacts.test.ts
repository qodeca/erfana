// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { PickReader } from '../pick/pickCdp'
import { PickFrames } from '../pick/pickFrames'
import { samplePage } from '../pick/__test-helpers__/samplePage'
import { MATCHED_RULES_MAX, parseMatchedRules, readElementFacts, type FactsContext } from './captureFacts'

const top = (id: number) => ({ sessionKey: '', backendNodeId: id, frameId: 'top' })

function setup() {
  let ctx: FactsContext | undefined
  const page = samplePage({
    beforeFrames: (p) => {
      const reader = new PickReader(p.cdp)
      ctx = { reader, frames: new PickFrames(p.cdp, reader), styleSheets: new Map(), serialise: (_k, task) => task() }
    }
  })
  return { page, ctx: ctx! }
}

const rule = (origin: string, i = 0) => ({ rule: { origin, styleSheetId: 's', selectorList: { text: `.r${i}` }, style: { cssText: ' a: b; ', range: { startLine: i } } } })

describe('parseMatchedRules', () => {
  it('keeps author rules only, with the stylesheet URL and a 1-based line', () => {
    const sheets = new Map([['s', { sourceURL: 'https://app.test/s.css', startLine: 4 }]])
    expect(parseMatchedRules({ matchedCSSRules: [rule('user-agent'), rule('regular', 2), 'junk', { rule: 'x' }] }, sheets)).toEqual([
      { stylesheetUrl: 'https://app.test/s.css', line: 7, text: '.r2 { a: b; }' }
    ])
    expect(parseMatchedRules(null, sheets)).toEqual([])
  })

  it('lists at most 30 rules', () => {
    const many = Array.from({ length: 40 }, (_v, i) => rule('regular', i))
    expect(parseMatchedRules({ matchedCSSRules: many }, new Map())).toHaveLength(MATCHED_RULES_MAX)
  })
})

describe('readElementFacts (025-FR-033, 025-FR-035)', () => {
  it('reads every field of a top-document element', async () => {
    const { page, ctx } = setup()
    page.matchedStyles = { matchedCSSRules: [rule('regular', 1)] }
    const facts = await readElementFacts(ctx, top(4))
    expect(facts).toMatchObject({
      selectors: ['button#save'],
      closedShadow: false,
      frameOrigins: ['https://app.test'],
      outerHtml: '<button></button>',
      styles: [['display', 'block'], ['color', 'rgb(0, 0, 0)']],
      layout: [{ tag: 'div', display: 'flex' }],
      matchedRules: [{ stylesheetUrl: '', line: 2, text: '.r1 { a: b; }' }],
      coveredBy: null,
      boxInView: { x: 20, y: 20, width: 100, height: 30 },
      boxInFrame: { x: 20, y: 20, width: 100, height: 30 },
      connected: true
    })
    expect(page.cdp.calls('DOM.querySelectorAll')[0].params).toEqual({ nodeId: 1000, selector: 'button#save' })
  })

  it('names nothing as covering when the centre hits the element, an ancestor or a descendant', async () => {
    const { ctx } = setup()
    expect((await readElementFacts(ctx, top(5))).coveredBy).toBeNull()
    expect((await readElementFacts(ctx, top(3))).coveredBy).toBeNull()
  })

  it('names an unrelated element over the centre (an overlay)', async () => {
    const { page, ctx } = setup()
    // A small sibling of the page body over the label's centre (50, 35).
    page.add({ id: 9, tag: 'aside', parent: 2, box: [45, 30, 10, 10] })
    expect((await readElementFacts(ctx, top(5))).coveredBy).toBe('aside')
  })

  it('025-AC-035 names an overlay that lets clicks through (pointer-events: none) as covering, by the topmost hit test (ADR 0007 decision 4, amended 2026-11-05)', async () => {
    const { page, ctx } = setup()
    page.add({ id: 9, tag: 'div', parent: 2, attrs: { id: 'overlay' }, box: [45, 30, 10, 10], pointerEventsNone: true })
    expect((await readElementFacts(ctx, top(5))).coveredBy).toBe('div')
    const asked = page.cdp.calls('DOM.getNodeForLocation').at(-1)?.params
    expect(asked).toMatchObject({ x: 50, y: 35, ignorePointerEventsNone: true })
  })

  it('025-AC-035 does not name the element under a picked element that lets clicks through: on top, it covers nothing', async () => {
    const { page, ctx } = setup()
    // The fake stacks the smaller box on top: the <b> lies over the <aside>, and a click goes through it to the aside.
    page.add({ id: 9, tag: 'aside', parent: 2, box: [45, 30, 10, 10] })
    page.add({ id: 10, tag: 'b', parent: 2, box: [48, 33, 4, 4], pointerEventsNone: true })
    expect((await readElementFacts(ctx, top(10))).coveredBy).toBeNull()
  })

  it("reads matched rules in a cross-site frame's own document; none in a shadow root or when the selector finds no single node", async () => {
    const { page, ctx } = setup()
    page.matchedStyles = { matchedCSSRules: [rule('regular')] }
    expect((await readElementFacts(ctx, { sessionKey: 'S1', backendNodeId: 102, frameId: 'F1' })).matchedRules).toHaveLength(1)
    expect(page.cdp.calls('DOM.querySelectorAll').at(-1)).toMatchObject({ sessionKey: 'S1', params: { nodeId: 2000, selector: 'button#inner' } })
    page.cdp.handle('DOM.querySelectorAll', () => ({ nodeIds: [1, 2] }))
    expect((await readElementFacts(ctx, top(4))).matchedRules).toBeNull()
    page.cdp.handle('DOM.getDocument', () => ({}))
    expect((await readElementFacts(ctx, top(4))).matchedRules).toBeNull()
    page.add({ id: 10, tag: 'b', parent: 4, shadow: 'closed', box: [21, 21, 5, 5] })
    expect((await readElementFacts(ctx, top(10))).matchedRules).toBeNull()
  })

  it('gives an empty list, not null, when the CSS domain answers with user-agent rules only; null when it answers without a rule list', async () => {
    const { page, ctx } = setup()
    page.matchedStyles = { matchedCSSRules: [rule('user-agent')] }
    expect((await readElementFacts(ctx, top(4))).matchedRules).toEqual([])
    page.matchedStyles = { matchedCSSRules: [] }
    expect((await readElementFacts(ctx, top(4))).matchedRules).toEqual([])
    page.matchedStyles = {}
    expect((await readElementFacts(ctx, top(4))).matchedRules).toBeNull()
  })

  it('gives no matched rules for an element in a same-process child frame', async () => {
    const { page, ctx } = setup()
    page.addFrame({ frameId: 'child', parentId: 'top', session: '', origin: 'https://app.test' })
    page.add({ id: 11, tag: 'p', frameId: 'child', box: [0, 300, 10, 10] })
    page.matchedStyles = { matchedCSSRules: [rule('regular')] }
    expect((await readElementFacts(ctx, { sessionKey: '', backendNodeId: 11, frameId: 'child' })).matchedRules).toBeNull()
  })

  it('leaves a part that cannot be read empty and reads the rest', async () => {
    const { page, ctx } = setup()
    page.cdp.handle('Runtime.callFunctionOn', (p) => {
      if (String(p.functionDeclaration).includes('outerHTML') || String(p.functionDeclaration).includes('getComputedStyle')) throw new Error('page')
      return page.cdp.calls('x').length === 0 ? { result: { value: { chain: [{ tag: 'button', id: 'save', x: 20, y: 20, w: 100, h: 30, attrs: [] }], selectors: ['button#save'], connected: true } } } : {}
    })
    const facts = await readElementFacts(ctx, top(4), {
      entries: [{ name: { tagName: 'button' }, attrs: [], shadow: null, boxInFrame: { x: 20, y: 20, width: 100, height: 30 }, boxInView: null, node: top(4) }],
      selectors: ['button#save'],
      closedShadow: false,
      frameOrigins: ['https://app.test'],
      connected: true
    })
    expect(facts.outerHtml).toBe('')
    expect(facts.styles).toEqual([])
    expect(facts.layout).toEqual([])
    expect(facts.boxInView).toEqual({ x: 20, y: 20, width: 100, height: 30 })
  })

  it('reads no covering element for an element with no box', async () => {
    const { page, ctx } = setup()
    page.add({ id: 12, tag: 'span', parent: 3 })
    const facts = await readElementFacts(ctx, top(12))
    expect(facts.boxInView).toBeNull()
    expect(facts.coveredBy).toBeNull()
  })
})
