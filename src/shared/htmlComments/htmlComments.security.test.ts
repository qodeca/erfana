// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Security gates of the comment format (docs/designs/html-preview-comments.md
 * §17; SEC-12, SEC-13, SEC-15, SEC-16).
 *
 * - SEC-12: hostile text in every field a block carries round-trips through
 *   `planInsert` → `applySplice` → `parseCommentBlocks`, and parse5 sees the
 *   page's elements exactly as before – the block can never end its comment
 *   early or open markup of its own.
 * - SEC-13: no block is ever placed inside raw text, RCDATA, template content,
 *   an attribute or before the BOM.
 * - SEC-15: hostile `@data` is damaged (or dropped key by key) in bounded time,
 *   and never reaches `Object.prototype`.
 * - SEC-16: inputs shaped to make a scanner backtrack parse in bounded time,
 *   and a file never yields more than the block cap.
 *
 * Time gates are relative (`expectBoundedParse`): the design's 200 ms is the
 * floor, but a 4 MB file takes about 300 ms to parse on the emulated Windows
 * box and over a second in a coverage run, almost all of it parse5 itself.
 *
 * Every hostile character is built at run time (`commentTestData`), never typed.
 */
import fc from 'fast-check'
import { performance } from 'node:perf_hooks'
import { describe, expect, it, vi } from 'vitest'
import { PREVIEW_LIMITS } from '../preview-limits'
import { PROPERTY_TIMEOUT_MS, commentDataArb, fcParams } from './__fixtures__/arbitraries'
import {
  BOM,
  LONE_HIGH,
  LONE_LOW,
  NUL,
  VIEW,
  addTo,
  domSignature,
  fixedId,
  makeComment,
  pageWith,
  uEsc
} from './__fixtures__/commentTestData'
import { encodeText } from './encoding'
import { CommentDataSchema, serializeBlock, type CommentData } from './format'
import { indexHtml } from './htmlIndex'
import {
  analyzeCommentDocument,
  parseCommentBlocks,
  parseCommentFile,
  type FileCommentState
} from './parse'
import { planInsert, spliceBytes } from './splice'

const BACKSLASH = String.fromCharCode(0x5c)
const MB = 1024 * 1024
/** SEC-16: the design's parse budget for a hostile file – the floor of every time gate. */
const REDOS_BUDGET_MS = 200
/**
 * How much slower than an ordinary page of the same size a hostile one may
 * parse. Linear code stays within about 2×; a backtracking scan is slower by
 * orders of magnitude at these sizes.
 */
const SLOWDOWN_LIMIT = 4
/** A timed test parses megabytes several times; a coverage run is several times slower. */
const TIMED_TEST_TIMEOUT_MS = 120_000

/** The page every SEC-12 block is added to: a button after a paragraph. */
const PAGE = pageWith('')

/** The SEC-12 corpus: comment syntax, raw-text closers, escapes, NUL and lone surrogates. */
const HOSTILE = [
  '-->',
  '--!>',
  '<!--',
  '--->',
  '<!-->',
  '<!---->',
  '</script>',
  '<script>',
  ']]>',
  '-',
  '--',
  BACKSLASH,
  `${BACKSLASH}-`,
  uEsc(0x2d) + uEsc(0x2d) + uEsc(0x3e),
  NUL,
  LONE_HIGH,
  LONE_LOW,
  LONE_LOW + LONE_HIGH
]

/** Every token, every ordered pair with a letter between, the whole corpus, and a dash sandwich. */
function corpus(): string[] {
  const pairs = HOSTILE.flatMap(a => HOSTILE.map(b => `${a}x${b}`))
  return [...HOSTILE, ...pairs, HOSTILE.join(''), ...HOSTILE.map(s => `-${s}-`)]
}

/** A valid comment carrying `s` in every free-text field, the snapshot included. */
function hostileComment(s: string): CommentData {
  const first = makeComment().msgs[0]
  return makeComment({
    anchor: {
      tag: 'button',
      id: s,
      cls: [s],
      path: 'html > body > main:nth-of-type(1) > button:nth-of-type(1)',
      quote: { exact: s, prefix: s, suffix: s },
      runtime: {
        path: s,
        tag: 'div',
        quote: { exact: s, prefix: '', suffix: '' },
        snapshot: `<div title="${s}">${s}</div><!--${s}--><script>${s}</script>`,
        snapshotSource: 'page'
      }
    },
    view: { ...VIEW, hash: s },
    msgs: [{ ...first, by: { name: s, email: s, role: 'human' }, text: `${s}\n${s} and ${s}` }]
  })
}

/**
 * Add `data` before the button of `page`, then read the file back from text
 * and from bytes. Returns the one block read back.
 */
function roundTrip(page: string, data: CommentData, ws?: string): FileCommentState['blocks'][number] {
  const { plan, text } = addTo(page, 'button', data, { ws })
  // The block is well-formed UTF-16: writing it as UTF-8 loses nothing.
  expect(new TextDecoder('utf-8', { fatal: true }).decode(encodeText(plan.insert))).toBe(plan.insert)
  const state = parseCommentBlocks(text)
  expect(state.writable).toBe(true)
  expect(state.blocks).toHaveLength(1)
  expect(state.blocks[0]).toMatchObject({ kind: 'ok', data })
  expect(state.blocks[0].nodeRange[0]).toBe(plan.start)
  // parse5 sees one comment more and nothing else.
  expect(domSignature(text)).toEqual(domSignature(page))
  expect(indexHtml(text).comments).toHaveLength(indexHtml(page).comments.length + 1)
  const file = parseCommentFile(spliceBytes(encodeText(page), page, plan))
  expect(file.ok && file.doc.state.blocks[0]).toMatchObject({ kind: 'ok', data })
  return state.blocks[0]
}

describe('SEC-12 hostile text and snapshots', () => {
  it('SEC-12 the corpus in every field round-trips and parse5 sees no new elements', () => {
    for (const s of corpus()) {
      const data = hostileComment(s)
      expect(CommentDataSchema.safeParse(data).success, `schema rejects ${JSON.stringify(s)}`).toBe(true)
      expect(roundTrip(PAGE, data)).toMatchObject({ target: { state: 'attached' } })
    }
  })

  it('SEC-12 the corpus round-trips before a target inside <pre> and on its own line', () => {
    const pre = '<!doctype html><pre>Pricing\n<button>x</button></pre>'
    const ownLine = '<!doctype html><main>\n  <button class="cta">Buy now</button>\n</main>'
    for (const s of HOSTILE) {
      roundTrip(pre, hostileComment(s))
      roundTrip(ownLine, hostileComment(s), 'collapse')
    }
  })

  it(
    "SEC-12 any valid comment, hostile text everywhere, leaves the page's elements as they were",
    () => {
      fc.assert(
        fc.property(commentDataArb, data => {
          roundTrip(PAGE, data)
        }),
        fcParams()
      )
    },
    PROPERTY_TIMEOUT_MS
  )
})

/** Markup that looks like an element but sits where no block may go, with the context it sits in. */
const FAKE = '<button class="cta">fake</button>'
const CLOSED_CONTEXTS: ReadonlyArray<readonly [string, string]> = [
  ['script', `<script>const markup = '${FAKE}'</script>`],
  ['style', `<style>/* ${FAKE} */</style>`],
  ['textarea', `<textarea>${FAKE}</textarea>`],
  ['title', `<title>${FAKE}</title>`],
  ['template', `<template>${FAKE}</template>`],
  ['noscript', `<noscript>${FAKE}</noscript>`],
  ['iframe', `<iframe>${FAKE}</iframe>`],
  ['an attribute value', `<a title='${FAKE}' data-x="${FAKE}">link</a>`]
]

describe('SEC-13 insertion contexts', () => {
  it.each(CLOSED_CONTEXTS)('SEC-13 no offset inside %s is an insertion point', (_name, context) => {
    const html = `<!doctype html><main>${context}<button class="cta">real</button></main>`
    const doc = analyzeCommentDocument(html)
    const from = html.indexOf(context)
    const data = makeComment()
    for (let offset = from + 1; offset < from + context.length; offset += 1) {
      expect(doc.index.elementAt(offset)).toBeUndefined()
      expect(planInsert(doc, { targetStart: offset, data })).toEqual({ ok: false, reason: 'not-eligible' })
    }
    // The real element after it still takes a block.
    const real = html.lastIndexOf('<button')
    expect(planInsert(doc, { targetStart: real, data })).toMatchObject({ ok: true, plan: { start: real } })
  })

  it('SEC-13 nothing goes before the BOM: offset 0 is refused and a block lands after it', () => {
    const html = `${BOM}<p>first</p>`
    const doc = analyzeCommentDocument(html)
    expect(planInsert(doc, { targetStart: 0, data: makeComment() })).toEqual({ ok: false, reason: 'not-eligible' })
    const { plan, text } = addTo(html, 'p', makeComment({ anchor: { tag: 'p', path: '' } }))
    expect(plan.start).toBe(1)
    expect(text.startsWith(`${BOM}<!--`)).toBe(true)
  })
})

/** A serialized block of `data`, LF, no indent. */
function blockOf(data: CommentData = makeComment()): string {
  const result = serializeBlock(data, { indent: '', eol: '\n' })
  if (!result.ok) throw new Error(result.reason)
  return result.block
}

/** A block whose `@data` is `json` and nothing else (no readable part). */
const rawBlock = (json: string): string => `<!-- erfana:comment v1 id=${makeComment().id}\n@data ${json}\n-->`

/** Median milliseconds of three calls of `run`, after one warm-up call. */
function medianMs(run: () => unknown): number {
  run()
  const times = [0, 1, 2].map(() => {
    const start = performance.now()
    run()
    return performance.now() - start
  })
  return times.sort((a, b) => a - b)[1]
}

/** An ordinary, element-dense page of whole megabytes: the yardstick for "linear". */
const benignMs = new Map<number, number>()
function benignParseMs(length: number): number {
  const megabytes = Math.max(1, Math.ceil(length / MB))
  let ms = benignMs.get(megabytes)
  if (ms === undefined) {
    const row = '<p>Small-batch beans, roasted <b>every</b> Monday.</p>\n'
    const page = `<main>${row.repeat(Math.ceil((megabytes * MB - 64) / row.length))}</main>`
    ms = medianMs(() => parseCommentBlocks(page))
    benignMs.set(megabytes, ms)
  }
  return ms
}

/**
 * The time gate of SEC-15 and SEC-16: `parseCommentBlocks(text)` takes less
 * than the design's 200 ms, or at most `SLOWDOWN_LIMIT` times an ordinary page
 * of the same size parsed on the same machine under the same instrumentation –
 * so it holds on the emulated Windows box and in a coverage run alike.
 */
function expectBoundedParse(text: string): void {
  const hostile = medianMs(() => parseCommentBlocks(text))
  if (hostile < REDOS_BUDGET_MS) return
  expect(hostile).toBeLessThan(SLOWDOWN_LIMIT * benignParseMs(text.length))
}

function expectNoPollution(): void {
  for (const proto of [Object.prototype, Array.prototype, Function.prototype]) {
    expect(Object.prototype.hasOwnProperty.call(proto, 'polluted')).toBe(false)
  }
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
}

describe('SEC-15 hostile @data', () => {
  const hook = '{"polluted":true}'
  const escapedProto = `${uEsc(0x5f)}_proto__`

  it('SEC-15 __proto__, constructor.prototype and an escaped __proto__ at every level never reach a prototype', () => {
    const hostile = blockOf()
      .replace('@data {"v":1,', `@data {"__proto__":${hook},"v":1,`)
      .replace('"anchor":{', `"anchor":{"constructor":{"prototype":${hook}},"${escapedProto}":${hook},`)
      .replace('"by":{', `"by":{"prototype":${hook},"__proto__":${hook},`)
    expect(hostile).toContain('"anchor":{"constructor"')
    expect(hostile).toContain('"by":{"prototype"')
    const [parsed] = parseCommentBlocks(pageWith(hostile)).blocks
    expectNoPollution()
    expect(parsed).toMatchObject({ kind: 'ok', data: makeComment() })
    if (parsed.kind !== 'ok') return
    for (const value of [parsed.data, parsed.data.anchor, parsed.data.msgs[0].by]) {
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
      expect(Object.keys(value)).not.toContain('__proto__')
      expect(Object.keys(value)).not.toContain('constructor')
      expect(Object.keys(value)).not.toContain('prototype')
    }
  })

  it('SEC-15 a plain and an escaped __proto__ in one object are a repeated key: damaged, nothing polluted', () => {
    const hostile = blockOf().replace('@data {"v":1,', `@data {"__proto__":${hook},"${escapedProto}":${hook},"v":1,`)
    expect(parseCommentBlocks(pageWith(hostile)).blocks[0]).toMatchObject({ kind: 'damaged', reason: 'bad-json' })
    expectNoPollution()
  })

  it(
    'SEC-15 nesting 10,000 deep, as arrays or as objects, is damaged without a deep parse',
    () => {
      const parseSpy = vi.spyOn(JSON, 'parse')
      const arrays = `{"v":1,"deep":${'['.repeat(10_000)}${']'.repeat(10_000)}}`
      const objects = `{"v":1,"deep":${'{"a":'.repeat(10_000)}0${'}'.repeat(10_000)}}`
      for (const json of [arrays, objects]) {
        const page = pageWith(rawBlock(json))
        expect(parseCommentBlocks(page).blocks[0]).toMatchObject({ kind: 'damaged', reason: 'limits' })
        expectBoundedParse(page)
      }
      expect(parseSpy.mock.calls.every(([arg]) => String(arg).length < 64)).toBe(true)
      parseSpy.mockRestore()
      expectNoPollution()
    },
    TIMED_TEST_TIMEOUT_MS
  )

  it(
    'SEC-15 @data past the 25 MB file limit leaves the file read-only unparsed; a block past 2 MB is damaged before JSON.parse',
    () => {
      const parseSpy = vi.spyOn(JSON, 'parse')
      const pastLimit = pageWith(rawBlock(`{"v":1,"pad":"${'x'.repeat(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES)}"}`))
      const tooLarge = { blocks: [], writable: false, readOnlyReason: 'too-large' }
      expect(parseCommentBlocks(pastLimit)).toEqual(tooLarge)
      expect(parseCommentFile(encodeText(pastLimit))).toMatchObject({ ok: false, reason: 'too-large', state: tooLarge })
      expectBoundedParse(pastLimit)
      // Within the file limit, the block limit holds on its own.
      const threeMb = pageWith(rawBlock(`{"v":1,"pad":"${'x'.repeat(3 * MB)}"}`))
      expect(parseCommentBlocks(threeMb).blocks[0]).toMatchObject({ kind: 'damaged', reason: 'limits' })
      expectBoundedParse(threeMb)
      expect(parseSpy).not.toHaveBeenCalled()
      parseSpy.mockRestore()
    },
    TIMED_TEST_TIMEOUT_MS
  )

  it(
    'SEC-15 100,000 replies are damaged: empty ones by the schema, real ones by the size limits',
    () => {
      const data = makeComment()
      const REPLIES = 100_000
      const reply = (n: number) => ({ ...data.msgs[0], id: fixedId('m-', n) })
      const empty = pageWith(rawBlock(JSON.stringify({ ...data, msgs: [data.msgs[0], ...Array.from({ length: REPLIES }, () => ({}))] })))
      expect(parseCommentBlocks(empty).blocks[0]).toMatchObject({ kind: 'damaged', reason: 'schema' })
      expectBoundedParse(empty)
      // As many real replies as fit in one block: still far past the reply cap.
      const fit = Math.floor(PREVIEW_LIMITS.COMMENT_BLOCK_MAX_BYTES / (JSON.stringify(reply(0)).length + 1)) - 100
      const many = pageWith(rawBlock(JSON.stringify({ ...data, msgs: Array.from({ length: fit }, (_, n) => reply(n)) })))
      expect(parseCommentBlocks(many).blocks[0]).toMatchObject({ kind: 'damaged', reason: 'schema' })
      expectBoundedParse(many)
      // As many real replies as push the file past its limit (25 MB, §19 Rev 4): read-only, unparsed.
      const pastLimit = Math.max(REPLIES, Math.ceil(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES / JSON.stringify(reply(0)).length))
      const real = pageWith(rawBlock(JSON.stringify({ ...data, msgs: Array.from({ length: pastLimit }, (_, n) => reply(n)) })))
      expect(parseCommentBlocks(real)).toMatchObject({ blocks: [], readOnlyReason: 'too-large' })
      expectBoundedParse(real)
      expectNoPollution()
    },
    TIMED_TEST_TIMEOUT_MS
  )
})

/** Header and id of the SEC-16 blocks. */
const HEADER = `erfana:comment v1 id=${makeComment().id}`

/**
 * As many real blocks as fit in just under 4 MB – far more than the cap. Kept
 * at the old 4 MB file limit when the limit rose to 25 MB (§19 Rev 4): the cap
 * holds the same at any size, and the timed gate parses the file five times.
 */
function fourMbOfBlocks(): string {
  const item = (n: number): string => `${blockOf(makeComment({ id: fixedId('c-', n) }))}<i>x</i>\n`
  // Every fixed id has the same length, so every item does too.
  const count = Math.floor((4 * MB - 64) / item(0).length)
  return `<main>${Array.from({ length: count }, (_, n) => item(n)).join('')}</main>`
}

/** Inputs shaped to make a scanner backtrack, each under the file limit. */
const REDOS_CORPUS: ReadonlyArray<readonly [string, () => string]> = [
  ['a 1 MB run of dashes in a comment', () => `<p>a</p><!--${'-'.repeat(MB)}--><p>b</p>`],
  ['a header followed by a 1 MB dash run', () => `<p>a</p><!-- ${HEADER}\n${'-'.repeat(MB)}\n--><p>b</p>`],
  ['an unterminated header and 1 MB of dashes', () => `<p>a</p><!-- ${HEADER}${'-'.repeat(MB)}`],
  ['250,000 nested <!--', () => `<p>a</p><!-- ${HEADER}\n${'<!--'.repeat(250_000)}\n--><p>b</p>`],
  ['1 MB of blanks between the header words', () => `<!-- erfana:comment${' '.repeat(MB / 2)}v1${' '.repeat(MB / 2)}x -->`],
  ['1 MB of blanks after the version', () => `<!-- erfana:comment v1${' '.repeat(MB)}id\n@data {}\n-->`],
  ['a 1 MB id', () => `<!-- erfana:comment v1 id=${'c'.repeat(MB)} x\n@data {}\n-->`],
  ['a block of a million empty lines', () => `<!-- ${HEADER}\n${'\n'.repeat(MB)}@data {"v":1}\n-->`],
  ['200,000 half conflict markers', () => `<p>${'<<<<<<< a\n=======\n'.repeat(100_000)}</p>`],
  ['4 MB of real blocks', fourMbOfBlocks]
]

describe('SEC-16 ReDoS corpus', () => {
  it.each(REDOS_CORPUS)(
    'SEC-16 %s parses in bounded time',
    (_name, build) => {
      const text = build()
      expect(encodeText(text).length).toBeLessThanOrEqual(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES)
      expect(parseCommentBlocks(text).blocks.length).toBeLessThanOrEqual(PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE)
      // The whole parse: parse5, then every regex and line pass of the format.
      expectBoundedParse(text)
    },
    TIMED_TEST_TIMEOUT_MS
  )

  it('SEC-16 more than 500 blocks are capped at 500 and the file is read-only', () => {
    const doc = analyzeCommentDocument(fourMbOfBlocks())
    expect(doc.state.blocks).toHaveLength(PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE)
    expect(doc.state).toMatchObject({ writable: false, readOnlyReason: 'too-many-blocks' })
    const target = doc.index.elements.find(el => el.tag === 'i')!
    expect(planInsert(doc, { targetStart: target.start, data: makeComment() })).toEqual({ ok: false, reason: 'read-only' })
  })
})
