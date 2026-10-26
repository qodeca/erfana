// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Per-load token tables (docs/designs/html-preview-comments.md §4.2
 * "ElementTokenTable", §6, §19 R3-12): M-032 generations, M-033 forged and
 * unknown tokens, M-059 one file shown as page and frame.
 */
import { describe, expect, it } from 'vitest'
import { encodeText } from '../../../../shared/htmlComments'
import { commentedPage, expectInstrumented, tokenOf } from './__test-helpers__/commentedPages'
import { NO_TARGET, instrumentDocument, type CommentLoadBlock } from './commentParseCore'
import {
  ElementTokenTable,
  MAX_LOADS,
  MAX_TOKENS,
  TOKEN_TABLE_GENERATIONS,
  alignedTokenIndex,
  type CommentLoadInput,
  type CommentLoadScope
} from './ElementTokenTable'

const PAGE = '/project/site/index.html'
const OTHER = '/project/site/other.html'

/** A load of `count` tokens built by hand: token `i` is `prefix` + base32 of `i`, offset `10·i`. */
function load(
  realPath: string,
  scope: CommentLoadScope,
  options: { count?: number; prefix?: string; blocks?: CommentLoadBlock[] } = {}
): CommentLoadInput {
  const count = options.count ?? 3
  const prefix = options.prefix ?? 'aaaaaaa'
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  const tokens = Array.from({ length: count }, (_, i) => {
    let digits = ''
    for (let rest = i; digits.length < 12 - prefix.length; rest = Math.floor(rest / 32)) {
      digits = alphabet[rest % 32] + digits
    }
    return prefix + digits
  })
  return {
    realPath,
    scope,
    fileHash: `hash-of-${realPath}`,
    tokens: tokens.join(''),
    offsets: Int32Array.from(tokens, (_, i) => i * 10),
    tagCodes: Uint32Array.from(tokens, (_, i) => i % 2),
    tagNames: ['div', 'p'],
    blocks: options.blocks ?? []
  }
}

/** Token `i` of a hand-built load. */
function nth(input: CommentLoadInput, i: number): string {
  return input.tokens.slice(i * 12, (i + 1) * 12)
}

describe('ElementTokenTable lookups', () => {
  it('names the element a token marks: path, load, hash, start offset and tag', () => {
    const table = new ElementTokenTable()
    const input = load(PAGE, 'page')
    const id = table.register(input)

    expect(table.lookup(id, nth(input, 2))).toEqual({
      realPath: PAGE,
      loadId: id,
      fileHash: `hash-of-${PAGE}`,
      startOffset: 20,
      tagName: 'div'
    })
    expect(table.lookup(id, nth(input, 1))?.tagName).toBe('p')
  })

  it('works on a real worker table: every token resolves to its own offset', () => {
    const doc = expectInstrumented(instrumentDocument(encodeText(commentedPage().text)))
    const table = new ElementTokenTable()
    const id = table.register({ realPath: PAGE, scope: 'page', ...doc })
    for (let i = 0; i < doc.offsets.length; i += 1) {
      expect(table.lookup(id, tokenOf(doc, i))?.startOffset).toBe(doc.offsets[i])
    }
  })

  it('M-033 a forged, malformed, foreign or misaligned token names nothing', () => {
    const table = new ElementTokenTable()
    const page = load(PAGE, 'page', { prefix: 'bbbbbbb' })
    const other = load(OTHER, 'frame', { prefix: 'ccccccc' })
    const pageId = table.register(page)
    table.register(other)

    // Well-formed but never minted.
    expect(table.lookup(pageId, 'zzzzzzzzzzzz')).toBeUndefined()
    // Malformed: wrong length, wrong alphabet, a fragment of a real token.
    for (const bad of [
      '',
      'bbbbbbbaaaa1',
      'BBBBBBBAAAAA',
      nth(page, 0).slice(0, 11),
      `${nth(page, 0)}a`
    ]) {
      expect(table.lookup(pageId, bad)).toBeUndefined()
    }
    // A token of another load is foreign to this one.
    expect(table.lookup(pageId, nth(other, 0))).toBeUndefined()
    // An unknown load id.
    expect(table.lookup('load-999', nth(page, 0))).toBeUndefined()
    // Spanning two tokens: found by indexOf, refused because it is not aligned.
    const spanning = page.tokens.slice(6, 18)
    expect(spanning).toMatch(/^[a-z2-7]{12}$/)
    expect(table.lookup(pageId, spanning)).toBeUndefined()
  })

  it('alignedTokenIndex skips a misaligned hit and finds the aligned one after it', () => {
    // Twelve a's occur misaligned at 1 to 11 (straddling the two tokens) and aligned at 12.
    const twelve = 'a'.repeat(12)
    const tokens = `b${'a'.repeat(11)}${twelve}`
    expect(tokens.indexOf(twelve)).toBe(1)
    expect(alignedTokenIndex(tokens, twelve)).toBe(1)
    expect(alignedTokenIndex(tokens, `${'a'.repeat(11)}b`)).toBe(-1)
  })

  it('loadOfToken finds the newest load holding a token', () => {
    const table = new ElementTokenTable()
    const frameA = load(OTHER, 'frame', { prefix: 'ddddddd' })
    const idA = table.register(frameA)
    const idB = table.register(load(OTHER, 'frame', { prefix: 'ddddddd' }))
    expect(table.loadOfToken(nth(frameA, 1))).toBe(idB)
    table.evictFrame('nobody')
    expect(idA).not.toBe(idB)
    expect(table.loadOfToken('zzzzzzzzzzzz')).toBeUndefined()
  })
})

describe('ElementTokenTable generations and eviction', () => {
  it(`M-032 the page keeps ${TOKEN_TABLE_GENERATIONS} generations; the oldest load is evicted`, () => {
    const table = new ElementTokenTable()
    const first = load(PAGE, 'page', { prefix: 'eeeeeee' })
    const second = load(PAGE, 'page', { prefix: 'fffffff' })
    const third = load(PAGE, 'page', { prefix: 'ggggggg' })
    const ids = [first, second, third].map(input => table.register(input))

    expect(table.lookup(ids[0], nth(first, 0))).toBeUndefined()
    expect(table.lookup(ids[1], nth(second, 0))).toBeDefined()
    expect(table.lookup(ids[2], nth(third, 0))).toBeDefined()
    expect(table.size).toBe(2)
  })

  it('M-032 a frame keeps two generations too, counted per frame once bound', () => {
    const table = new ElementTokenTable()
    const ids = [1, 2, 3].map(() => table.register(load(OTHER, 'frame')))
    const sibling = table.register(load(OTHER, 'frame'))
    // Unbound frame loads are not generations of anything yet.
    expect(table.size).toBe(4)

    for (const id of ids) expect(table.bind(id, 'frame-7')).toBe('bound')
    expect(table.bind(sibling, 'frame-8')).toBe('bound')
    expect(table.view(ids[0])).toBeUndefined()
    expect(table.view(ids[1])).toBeDefined()
    expect(table.view(ids[2])).toBeDefined()
    // Another frame's load is not one of frame-7's generations.
    expect(table.view(sibling)?.frameKey).toBe('frame-8')
  })

  it('M-059 one file shown as page and frame keeps two live tables; navigating the frame evicts only its own', () => {
    const table = new ElementTokenTable()
    const asPage = load(PAGE, 'page', { prefix: 'hhhhhhh' })
    const asFrame = load(PAGE, 'frame', { prefix: 'iiiiiii' })
    const pageId = table.register(asPage)
    const frameId = table.register(asFrame)
    expect(table.bind(pageId, 'main-frame')).toBe('bound')
    expect(table.bind(frameId, 'frame-3')).toBe('bound')

    expect(table.lookup(pageId, nth(asPage, 1))?.realPath).toBe(PAGE)
    expect(table.lookup(frameId, nth(asFrame, 1))?.realPath).toBe(PAGE)

    table.evictFrame('frame-3')
    expect(table.lookup(frameId, nth(asFrame, 1))).toBeUndefined()
    expect(table.lookup(pageId, nth(asPage, 1))).toBeDefined()
    expect(table.views().map(v => v.loadId)).toEqual([pageId])
  })

  it('a load binds to exactly one frame: the first hello wins', () => {
    const table = new ElementTokenTable()
    const id = table.register(load(PAGE, 'frame'))
    expect(table.bind(id, 'frame-1')).toBe('bound')
    expect(table.bind(id, 'frame-2')).toBe('already-bound')
    expect(table.bind('load-404', 'frame-1')).toBe('unknown')
    expect(table.view(id)?.frameKey).toBe('frame-1')
  })

  it(`holds at most ${MAX_LOADS} loads, evicting the oldest`, () => {
    const table = new ElementTokenTable()
    const ids = Array.from({ length: MAX_LOADS + 3 }, () =>
      table.register(load(OTHER, 'frame', { count: 1 }))
    )
    expect(table.size).toBe(MAX_LOADS)
    expect(table.view(ids[0])).toBeUndefined()
    expect(table.view(ids[2])).toBeUndefined()
    expect(table.view(ids[3])).toBeDefined()
  })

  it(`holds at most ${MAX_TOKENS} tokens, evicting the oldest load first`, () => {
    const table = new ElementTokenTable()
    const big = Math.floor(MAX_TOKENS / 3) + 1
    const ids = [1, 2, 3].map(() => table.register(load(OTHER, 'frame', { count: big })))
    expect(table.view(ids[0])).toBeUndefined()
    expect(table.view(ids[1])?.tokenCount).toBe(big)
    expect(table.view(ids[2])?.tokenCount).toBe(big)
  })

  it('never evicts the load it just registered, even past the token budget', () => {
    const table = new ElementTokenTable()
    const id = table.register(load(OTHER, 'frame', { count: MAX_TOKENS + 1 }))
    expect(table.view(id)?.tokenCount).toBe(MAX_TOKENS + 1)
  })

  it('clear drops every load', () => {
    const table = new ElementTokenTable()
    const id = table.register(load(PAGE, 'page'))
    table.clear()
    expect(table.size).toBe(0)
    expect(table.lookup(id, 'aaaaaaaaaaaa')).toBeUndefined()
    // The token budget restarts too.
    table.register(load(OTHER, 'frame', { count: MAX_TOKENS }))
    expect(table.size).toBe(1)
  })
})

describe('ElementTokenTable views', () => {
  it('resolves each block target to its token and drops the index', () => {
    const table = new ElementTokenTable()
    const input = load(PAGE, 'page', {
      blocks: [
        { kind: 'ok', id: 'c-aaaaaaaaaaaaaaaa', status: 'open', target: 1 },
        { kind: 'ok', id: 'c-baaaaaaaaaaaaaaa', status: 'open', target: NO_TARGET },
        { kind: 'damaged', id: 'c-caaaaaaaaaaaaaaa', target: 7 },
        { kind: 'newer', target: 0, runtime: { path: 'a', tag: 'a' } }
      ]
    })
    const id = table.register(input)
    expect(table.view(id)).toEqual({
      loadId: id,
      realPath: PAGE,
      scope: 'page',
      fileHash: `hash-of-${PAGE}`,
      tokenCount: 3,
      blocks: [
        { kind: 'ok', id: 'c-aaaaaaaaaaaaaaaa', status: 'open', token: nth(input, 1) },
        { kind: 'ok', id: 'c-baaaaaaaaaaaaaaa', status: 'open' },
        // A target past the table (malformed input) is dropped, not read out of range.
        { kind: 'damaged', id: 'c-caaaaaaaaaaaaaaa' },
        { kind: 'newer', runtime: { path: 'a', tag: 'a' }, token: nth(input, 0) }
      ]
    })
    expect(table.view('load-0')).toBeUndefined()
  })

  it('lists loads oldest first, with the frame each is bound to', () => {
    const table = new ElementTokenTable()
    const a = table.register(load(PAGE, 'page'))
    const b = table.register(load(OTHER, 'frame'))
    table.bind(b, 'frame-2')
    expect(table.views().map(v => [v.loadId, v.frameKey])).toEqual([
      [a, undefined],
      [b, 'frame-2']
    ])
  })
})
