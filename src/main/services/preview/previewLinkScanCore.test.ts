// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The scan of one document as the link scan worker runs it (issue #124 audit,
 * follow-up): the extractor's own links and frames (`linkExtract.test.ts`,
 * `linkExtract.parity.test.ts` and `linkExtract.bounds.test.ts` pin those),
 * read from bytes decoded the way main used to decode them, kept to what a walk
 * can use, and never a throw – an error is a name.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as extractor from './linkExtract'
import { extractFrameSources, extractStaticLinks } from './linkExtract'
import { decodeHtml, errorNameOf, scanLinkDocument, transferablesOf } from './previewLinkScanCore'
import { MAX_LINKS_PER_DOCUMENT, MAX_SRCDOC_PER_DOCUMENT } from './previewLinkScanProtocol'

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

const FRAMED =
  '<link rel="stylesheet" href="a.css"><iframe src="f.html"></iframe>' +
  '<iframe srcdoc="&lt;img src=&quot;inner.png&quot;&gt;"></iframe>'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('scanLinkDocument', () => {
  it('finds what the extractor finds, from bytes or from text', () => {
    const expected = {
      kind: 'ok',
      links: extractStaticLinks(FRAMED),
      frames: { src: ['f.html'], srcdoc: [encode('<img src="inner.png">')] },
      limits: []
    }
    expect(scanLinkDocument(encode(FRAMED), true)).toEqual(expected)
    expect(scanLinkDocument(FRAMED, true)).toEqual(expected)
  })

  it('lists no frames when not asked, or when the markup holds no <iframe', () => {
    expect(scanLinkDocument(FRAMED, false)).toMatchObject({ kind: 'ok', frames: null })
    expect(scanLinkDocument('<img src="a.png"><frame src="x.html">', true)).toEqual({
      kind: 'ok',
      links: ['a.png'],
      frames: null,
      limits: []
    })
  })

  it('reads a frame tag in any case', () => {
    expect(scanLinkDocument('<IFRAME SRC="f.html"></IFRAME>', true)).toMatchObject({
      frames: { src: ['f.html'], srcdoc: [] }
    })
  })

  it(`keeps the first ${MAX_LINKS_PER_DOCUMENT} links and frames, and reports the bound once`, () => {
    const count = MAX_LINKS_PER_DOCUMENT + 3
    const images = Array.from({ length: count }, (_, n) => `<img src="${n}.png">`).join('')
    const frames = Array.from({ length: count }, (_, n) => `<iframe src="${n}.html"></iframe>`).join('')

    const scanned = scanLinkDocument(images + frames, true)

    if (scanned.kind !== 'ok' || scanned.frames === null) throw new Error('expected frames')
    expect(scanned.links).toHaveLength(MAX_LINKS_PER_DOCUMENT)
    expect(scanned.links[0]).toBe('0.png')
    expect(scanned.links.at(-1)).toBe(`${MAX_LINKS_PER_DOCUMENT - 1}.png`)
    expect(scanned.frames.src).toHaveLength(MAX_LINKS_PER_DOCUMENT)
    expect(scanned.frames.src.at(-1)).toBe(`${MAX_LINKS_PER_DOCUMENT - 1}.html`)
    expect(scanned.limits).toEqual(['links-per-document'])
  })

  it(`hands back at most ${MAX_SRCDOC_PER_DOCUMENT} srcdoc frames, which a walk could not pass, unreported`, () => {
    const srcdocs = Array.from({ length: MAX_SRCDOC_PER_DOCUMENT + 5 }, (_, n) => `<iframe srcdoc="${n}"></iframe>`)

    const scanned = scanLinkDocument(srcdocs.join(''), true)

    if (scanned.kind !== 'ok' || scanned.frames === null) throw new Error('expected frames')
    expect(scanned.frames.srcdoc.map(decode)).toEqual(
      Array.from({ length: MAX_SRCDOC_PER_DOCUMENT }, (_, n) => String(n))
    )
    expect(scanned.limits).toEqual([])
  })

  it('answers a throw while reading the links with its error name only, and no links', () => {
    vi.spyOn(extractor, 'extractStaticLinks').mockImplementation(() => {
      throw new RangeError('Maximum call stack size exceeded in C:\\proj\\a.html')
    })
    expect(scanLinkDocument(FRAMED, true)).toEqual({ kind: 'error', error: 'RangeError' })
  })

  it('keeps the links when listing the frames throws, and names the error', () => {
    vi.spyOn(extractor, 'extractFrameSources').mockImplementation(() => {
      throw new TypeError('C:\\proj\\f.html')
    })
    expect(scanLinkDocument(FRAMED, true)).toEqual({
      kind: 'ok',
      links: extractStaticLinks(FRAMED),
      frames: null,
      framesError: 'TypeError',
      limits: []
    })
  })

  it("passes on the extractor's own bounds, once each", () => {
    let tag = '<iframe src="f.html"'
    for (let n = 0; n <= 1024; n += 1) tag += ` a${n}`
    expect(scanLinkDocument(`${tag}></iframe>`, true)).toMatchObject({
      frames: { src: ['f.html'] },
      limits: ['attributes-per-tag']
    })
  })
})

describe('decodeHtml', () => {
  it('decodes as Buffer#toString did: a BOM kept, a bad sequence replaced', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x3c, 0x70, 0x3e, 0xff, 0xc3, 0xa9])
    expect(decodeHtml(bytes)).toBe(Buffer.from(bytes).toString('utf8'))
    expect(decodeHtml(bytes)).toBe('\uFEFF<p>\uFFFDé')
  })

  it('reads only the view it is given', () => {
    const backing = encode('xx<img src="a.png">yy')
    expect(decodeHtml(backing.subarray(2, backing.length - 2))).toBe('<img src="a.png">')
  })

  it('returns text as it is', () => {
    expect(decodeHtml('<p>')).toBe('<p>')
  })
})

describe('errorNameOf', () => {
  it("names an error by its name, anything else by its type, and an odd name as 'Error'", () => {
    expect(errorNameOf(new RangeError('at C:\\proj\\a.html'))).toBe('RangeError')
    expect(errorNameOf('C:\\proj\\a.html')).toBe('string')
    expect(errorNameOf(undefined)).toBe('undefined')
    const odd = new Error('x')
    odd.name = 'Not an identifier'
    expect(errorNameOf(odd)).toBe('Error')
  })
})

describe('transferablesOf', () => {
  it("moves each srcdoc's own buffer, and nothing for any other outcome", () => {
    const scanned = scanLinkDocument('<iframe srcdoc="a"></iframe><iframe srcdoc="b"></iframe>', true)
    if (scanned.kind !== 'ok' || scanned.frames === null) throw new Error('expected frames')

    const moved = transferablesOf(scanned)

    expect(moved).toEqual(scanned.frames.srcdoc.map(markup => markup.buffer))
    expect(new Set(moved).size).toBe(2)
    for (const markup of scanned.frames.srcdoc) expect(markup.byteLength).toBe(markup.buffer.byteLength)
    expect(transferablesOf(scanLinkDocument('<p>', true))).toEqual([])
    expect(transferablesOf({ kind: 'error', error: 'RangeError' })).toEqual([])
  })
})

describe('extractFrameSources and the scan agree on srcdoc markup', () => {
  it('encodes each srcdoc as UTF-8 that decodes back to the same markup', () => {
    const html = '<iframe srcdoc="&lt;p&gt;Zażółć 漢字 &#x1F600;&lt;/p&gt;"></iframe>'
    const scanned = scanLinkDocument(html, true)
    if (scanned.kind !== 'ok' || scanned.frames === null) throw new Error('expected frames')
    expect(scanned.frames.srcdoc.map(decode)).toEqual(extractFrameSources(html).srcdocHtml)
  })
})
