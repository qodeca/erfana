// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The worker's instrumentation pipeline (docs/designs/html-preview-comments.md
 * §6, §19 R3-12, R3-13): one shared parse feeds the tokens and the blocks, and
 * every block resolves to the token of the element it sits on in the bytes
 * actually served. U-090–U-094 here are the served-copy halves of the P1 unit
 * tests of the same ids (`src/shared/htmlComments/instrument.test.ts`,
 * `encoding.test.ts`); M-031 is the token → offset mapping.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  ELEMENT_TOKEN_ATTRIBUTE,
  ELEMENT_TOKEN_PATTERN,
  encodeText,
  indexHtml
} from '../../../../shared/htmlComments'
import { PREVIEW_LIMITS } from '../../../../shared/preview-limits'
import {
  addTo,
  fixedId,
  seededRandom
} from '../../../../shared/htmlComments/__fixtures__/commentTestData'
import {
  BASE_PAGE,
  commentOn,
  commentedPage,
  damagedBlock,
  expectInstrumented,
  insertBefore,
  newerBlock,
  tokenOf
} from './__test-helpers__/commentedPages'
import {
  NO_TARGET,
  TOKEN_CHARS,
  instrumentDocument,
  pooledRandom,
  tokenIndexAt
} from './commentParseCore'

const TOKEN_ATTRIBUTE = / data-erfana-el="[a-z2-7]{12}"/g
/** UTF-8 decode that keeps a BOM as U+FEFF, as `decodeLossless` does. */
const decode = (bytes: Uint8Array): string =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)

/** The element of the served copy carrying `token`, as the served copy's own parse sees it. */
function servedElement(html: string, token: string): { tag: string; id: string | undefined } {
  const served = indexHtml(html)
  const el = served.elements.find(e =>
    e.node.attrs.some(a => a.name === ELEMENT_TOKEN_ATTRIBUTE && a.value === token)
  )
  if (!el) throw new Error(`no element carries ${token}`)
  return { tag: el.tag, id: el.id }
}

describe('instrumentDocument – the served copy', () => {
  it('U-090 (served) one token per eligible start tag; head, template and script content get none', () => {
    const doc = expectInstrumented(instrumentDocument(encodeText(BASE_PAGE)))
    const html = decode(doc.html)
    const original = indexHtml(BASE_PAGE)

    expect(doc.offsets.length).toBe(original.elements.length)
    expect(html.match(TOKEN_ATTRIBUTE)).toHaveLength(original.elements.length)
    // `<template>` itself is eligible; its content and the head are not.
    expect(html).toContain('<template data-erfana-el=')
    expect(html).toContain('<p id="in-template">later</p>')
    expect(html).toContain('<title>-HPC-P3-</title><meta charset="utf-8">')
    expect(html).toContain('const fake = "<p data-x=1>not a tag</p>"')
  })

  it('U-092 (served) the copy minus its attributes is the original, byte for byte', () => {
    const page = commentedPage().text
    const bytes = encodeText(page)
    const doc = expectInstrumented(instrumentDocument(bytes))
    expect(encodeText(decode(doc.html).replace(TOKEN_ATTRIBUTE, ''))).toEqual(bytes)
  })

  it('U-092 (served) a BOM and CRLF line ends survive instrumentation', () => {
    const page = `${String.fromCharCode(0xfeff)}${BASE_PAGE.replace(/\n/g, '\r\n')}`
    const bytes = encodeText(page)
    const doc = expectInstrumented(instrumentDocument(bytes))
    expect([...doc.html.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(encodeText(decode(doc.html).replace(TOKEN_ATTRIBUTE, ''))).toEqual(bytes)
  })

  it('U-091 (served) a source that already carries data-erfana-el is refused (collision)', () => {
    const page = BASE_PAGE.replace(
      '<h1 id="title">',
      '<h1 id="title" data-erfana-el="aaaaaaaaaaaa">'
    )
    expect(instrumentDocument(encodeText(page))).toEqual({
      kind: 'unavailable',
      reason: 'collision'
    })
  })

  it('U-093 (served) tokens come from a crypto source: 12 base32 characters, new on every load', () => {
    const bytes = encodeText(BASE_PAGE)
    const first = expectInstrumented(instrumentDocument(bytes))
    const second = expectInstrumented(instrumentDocument(bytes))
    const all = (doc: typeof first): string[] =>
      Array.from({ length: doc.offsets.length }, (_, i) => tokenOf(doc, i))

    for (const token of all(first)) expect(token).toMatch(ELEMENT_TOKEN_PATTERN)
    expect(new Set(all(first)).size).toBe(first.offsets.length)
    // Same file, two loads: no token of the first load is reused.
    const firstSet = new Set(all(first))
    expect(all(second).some(token => firstSet.has(token))).toBe(false)
  })

  it('U-093 (served) a repeating random source never yields two equal tokens in one load', () => {
    // A source that repeats every token twice: the minter must re-draw.
    const random = seededRandom(3)
    let last: Uint8Array | undefined
    let calls = 0
    const repeating = (length: number): Uint8Array => {
      calls += 1
      if (calls % 2 === 0 && last) return last
      last = random(length)
      return last
    }
    const doc = expectInstrumented(instrumentDocument(encodeText(BASE_PAGE), { random: repeating }))
    const tokens = Array.from({ length: doc.offsets.length }, (_, i) => tokenOf(doc, i))
    expect(new Set(tokens).size).toBe(tokens.length)
  })

  it.each([
    ['UTF-16 LE', Uint8Array.from([0xff, 0xfe, 0x3c, 0x00, 0x70, 0x00])],
    ['invalid UTF-8', Uint8Array.from([0x3c, 0x70, 0x3e, 0xc0, 0xaf, 0x3c])],
    ['a legacy charset', encodeText('<meta charset="windows-1252"><p>erfana:comment</p>')],
    ['NUL bytes', Uint8Array.from([0x3c, 0x70, 0x3e, 0x00])]
  ])('U-094 (served) %s is refused with the reason encoding', (_name, bytes) => {
    expect(instrumentDocument(bytes)).toEqual({ kind: 'unavailable', reason: 'encoding' })
  })

  it('R3-13 more elements than the token cap → too-many-elements', () => {
    expect(instrumentDocument(encodeText('<p>a</p><p>b</p><p>c</p>'), { maxTokens: 2 })).toEqual({
      kind: 'unavailable',
      reason: 'too-many-elements'
    })
  })

  it('a file over the 4 MB comment limit is refused before it is decoded', () => {
    const bytes = new Uint8Array(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES + 1).fill(0x20)
    expect(instrumentDocument(bytes)).toEqual({ kind: 'unavailable', reason: 'too-large' })
  })

  it('hashes the ORIGINAL bytes, not the served copy', () => {
    const bytes = encodeText(BASE_PAGE)
    const doc = expectInstrumented(instrumentDocument(bytes))
    expect(doc.fileHash).toBe(createHash('sha256').update(bytes).digest('hex'))
  })
})

describe('instrumentDocument – the token table', () => {
  it('M-031 every token maps to its start tag in the ORIGINAL text, with its tag', () => {
    const page = commentedPage().text
    const doc = expectInstrumented(instrumentDocument(encodeText(page)))
    const original = indexHtml(page)
    const html = decode(doc.html)

    expect(doc.tokens.length).toBe(doc.offsets.length * TOKEN_CHARS)
    expect(doc.tagCodes.length).toBe(doc.offsets.length)
    for (let i = 0; i < doc.offsets.length; i += 1) {
      const offset = doc.offsets[i]
      const tag = doc.tagNames[doc.tagCodes[i]]
      if (i > 0) expect(offset).toBeGreaterThan(doc.offsets[i - 1])
      expect(page[offset]).toBe('<')
      expect(original.elementAt(offset)?.tag).toBe(tag)
      // The same element in the served copy carries exactly this token.
      expect(servedElement(html, tokenOf(doc, i)).tag).toBe(tag)
    }
  })

  it('interns tag names: one code per token, each name once', () => {
    const doc = expectInstrumented(instrumentDocument(encodeText('<p>a</p><p>b</p><i>c</i>')))
    // The implied `<body>` has no start tag, so it gets no token.
    expect(doc.tagNames).toEqual(['p', 'i'])
    expect([...doc.tagCodes]).toEqual([0, 0, 1])
  })
})

describe('instrumentDocument – blocks resolved to tokens (§6 "On every load")', () => {
  it('every ok block names the token of its element in the served copy', () => {
    const { text, targets } = commentedPage()
    const doc = expectInstrumented(instrumentDocument(encodeText(text)))
    const html = decode(doc.html)

    expect(doc.blocks.map(b => b.kind)).toEqual(['ok', 'ok', 'ok'])
    for (const block of doc.blocks) {
      expect(block.target).not.toBe(NO_TARGET)
      const element = servedElement(html, tokenOf(doc, block.target))
      expect(element.id).toBe(targets.get(block.id!))
    }
    const byId = new Map(doc.blocks.map(b => [b.id, b]))
    expect(byId.get(fixedId('c-', 3))?.status).toBe('resolved')
    expect(byId.get(fixedId('c-', 1))?.status).toBe('open')
  })

  it('an orphaned block has no target', () => {
    const block = commentOn(BASE_PAGE, 'button', 0, {
      id: fixedId('c-', 9),
      anchor: { tag: 'section', path: 'html > body > section:nth-of-type(7)' }
    })
    const text = addTo(BASE_PAGE, 'h1', block).text
    const doc = expectInstrumented(instrumentDocument(encodeText(text)))
    expect(doc.blocks).toEqual([
      { kind: 'ok', id: fixedId('c-', 9), status: 'open', target: NO_TARGET }
    ])
  })

  it('damaged and newer blocks point at the next start tag by source position', () => {
    let text = insertBefore(BASE_PAGE, '<p id="para">', damagedBlock(fixedId('c-', 5)))
    text = insertBefore(text, '<button', `${newerBlock(fixedId('c-', 6))}\n    `)
    const doc = expectInstrumented(instrumentDocument(encodeText(text)))
    const html = decode(doc.html)

    const [damaged, newer] = doc.blocks
    expect(damaged).toMatchObject({ kind: 'damaged', id: fixedId('c-', 5) })
    expect(servedElement(html, tokenOf(doc, damaged.target)).id).toBe('para')
    expect(newer.kind).toBe('newer')
    expect(newer).not.toHaveProperty('id')
    expect(servedElement(html, tokenOf(doc, newer.target)).id).toBe('cta')
  })

  it('a damaged block with nothing eligible after it has no target', () => {
    const doc = expectInstrumented(instrumentDocument(encodeText(`<p>x</p>${damagedBlock('c-x')}`)))
    expect(doc.blocks).toEqual([{ kind: 'damaged', id: 'c-x', target: NO_TARGET }])
  })

  it('a block before an app root keeps its runtime path for the preload (§5.6, R3-11)', () => {
    const data = commentOn(BASE_PAGE, 'main', 0, { id: fixedId('c-', 7) })
    const runtime = {
      path: 'div:nth-of-type(2) > a:nth-of-type(1)',
      tag: 'a',
      snapshotSource: 'page' as const
    }
    const text = addTo(
      BASE_PAGE,
      'main',
      { ...data, anchor: { ...data.anchor, runtime } },
      { ws: 'collapse' }
    ).text
    const doc = expectInstrumented(instrumentDocument(encodeText(text)))
    expect(doc.blocks[0]).toMatchObject({ kind: 'ok', runtime: { path: runtime.path, tag: 'a' } })
    expect(servedElement(decode(doc.html), tokenOf(doc, doc.blocks[0].target)).id).toBe('main')
  })
})

describe('helpers', () => {
  it('tokenIndexAt finds an offset by binary search, or NO_TARGET', () => {
    const offsets = Int32Array.from([3, 10, 42, 99])
    expect([3, 10, 42, 99].map(o => tokenIndexAt(offsets, o))).toEqual([0, 1, 2, 3])
    expect([0, 11, 100].map(o => tokenIndexAt(offsets, o))).toEqual([
      NO_TARGET,
      NO_TARGET,
      NO_TARGET
    ])
    expect(tokenIndexAt(new Int32Array(0), 0)).toBe(NO_TARGET)
  })

  it('pooledRandom hands out fresh bytes across pool refills and for oversized requests', () => {
    const random = pooledRandom()
    const seen = new Set<string>()
    for (let i = 0; i < 6_000; i += 1) seen.add(Buffer.from(random(12)).toString('hex'))
    expect(seen.size).toBe(6_000)
    expect(random(70_000)).toHaveLength(70_000)
  })
})
