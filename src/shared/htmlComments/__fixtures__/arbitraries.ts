// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * fast-check generators for the htmlComments property tests
 * (docs/designs/html-preview-comments.md §17 "L1p property", P-001–P-007):
 * comment data full of hostile text, and HTML documents from a small grammar.
 *
 * Every character that is invisible or reorders text is built from its number,
 * never typed, so no tool can silently change it in this source.
 */
import fc from 'fast-check'
import { formatTimestamp, serializeBlock, type CommentData, type Eol } from '../format'
import {
  BOM,
  LINE_SEP,
  LONE_HIGH,
  LONE_LOW,
  LRI,
  NUL,
  PARA_SEP,
  PDI,
  RLO,
  ZWJ,
  ZWSP,
  ch,
  fixedId,
  makeComment,
  unit
} from './commentTestData'

/** Runs per property: 200 by default, `FC_NUM_RUNS` overrides (CI, local soak runs). */
export const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? '') || 200

const DEFAULT_RUNS = 200
const DEFAULT_TIMEOUT_MS = 20_000
/** 20 s per property at 200 runs, scaled up for longer soak runs. */
export const PROPERTY_TIMEOUT_MS = Math.max(
  DEFAULT_TIMEOUT_MS,
  Math.ceil((NUM_RUNS / DEFAULT_RUNS) * DEFAULT_TIMEOUT_MS)
)

/**
 * Parameters for `fc.assert`. `FC_SEED` replays a reported failure; fast-check
 * prints the seed and path of every failure in the assertion message.
 */
export function fcParams<T>(overrides: fc.Parameters<T> = {}): fc.Parameters<T> {
  const seed = process.env.FC_SEED ? Number(process.env.FC_SEED) : undefined
  return { numRuns: NUM_RUNS, ...(seed === undefined ? {} : { seed }), ...overrides }
}

/** Pieces that have broken comment writers before, or could: comment syntax, markers, controls. */
export const HOSTILE_PIECES: readonly string[] = [
  '--',
  '-->',
  '<!--',
  '--!>',
  '<!-',
  '-',
  '->',
  '>',
  '<',
  '&',
  '&amp;',
  '"',
  "'",
  '\\',
  '`',
  '<script>alert(1)</script>',
  '</div>',
  '@data ',
  '@data {"v":1}',
  'erfana:comment v1 id=c-aaaaaaaaaaaaaaaa',
  '<<<<<<< HEAD',
  '=======',
  '>>>>>>> theirs',
  '||||||| base',
  '-\\-',
  '\n',
  '\r\n',
  '\r',
  '\t',
  '  ',
  'status: open',
  BOM,
  RLO,
  LRI,
  PDI,
  ZWSP,
  ZWJ,
  LINE_SEP,
  PARA_SEP,
  NUL,
  LONE_HIGH,
  LONE_LOW,
  unit(0x85),
  unit(0x7f),
  unit(0x1b),
  unit(0x061c),
  unit(0x200e),
  ch(0x1f600),
  `e${unit(0x301)}`,
  `${ch(0x1f468)}${ZWJ}${ch(0x1f469)}`
]

const textUnit = fc.oneof(
  { arbitrary: fc.string({ unit: 'binary', minLength: 1, maxLength: 1 }), weight: 4 },
  { arbitrary: fc.constantFrom(...HOSTILE_PIECES), weight: 3 },
  { arbitrary: fc.integer({ min: 0xd800, max: 0xdfff }).map(unit), weight: 1 }
)

/**
 * Longest generated text, in code points. At most 120 UTF-16 units, under every
 * text limit of the schema, so the serializer never refuses generated data.
 */
const MAX_TEXT_CODE_POINTS = 60

/** Text of `minPieces`–`maxPieces` pieces, each a code point or a hostile piece. */
export function hostileText(
  minPieces: number,
  maxPieces: number,
  maxCodePoints = MAX_TEXT_CODE_POINTS
): fc.Arbitrary<string> {
  return fc
    .array(textUnit, { minLength: minPieces, maxLength: maxPieces })
    .map(parts => Array.from(parts.join('')).slice(0, maxCodePoints).join(''))
}

/** Hostile text with whitespace and the characters a tag or class may not hold removed (at most 80 units). */
function token(maxPieces: number, banned: RegExp): fc.Arbitrary<string> {
  return hostileText(1, maxPieces, 40)
    .map(text => text.replace(banned, ''))
    .filter(text => text.length > 0)
}

const tagName = token(8, /[\s/>]/g)
const timestamp = fc
  .date({
    min: new Date('2000-01-01T00:00:00Z'),
    max: new Date('2099-12-31T23:59:59Z'),
    noInvalidDate: true
  })
  .map(formatTimestamp)
/** A finite number with no `-0`, which JSON cannot keep. */
const finite = (min: number, max: number): fc.Arbitrary<number> =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true }).map(n => (n === 0 ? 0 : n))

const futureKey = fc.stringMatching(/^z[a-z]{1,6}$/)
const futurePrimitive = fc.oneof(
  hostileText(0, 6),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  finite(-1e9, 1e9)
)
/** Fields a later format version might add: at most two levels deep, so `@data` stays within its depth limit. */
const futureFields = fc.dictionary(
  futureKey,
  fc.oneof(
    futurePrimitive,
    fc.array(futurePrimitive, { maxLength: 3 }),
    fc.dictionary(futureKey, futurePrimitive, { maxKeys: 3 })
  ),
  { maxKeys: 2 }
)

/** `obj` without its `undefined` properties, as JSON would give it back. */
function defined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as T
}

const author = fc
  .record({
    name: hostileText(1, 12),
    email: fc.option(hostileText(1, 12), { nil: undefined }),
    role: fc.constantFrom('human' as const, 'agent' as const)
  })
  .map(defined)

const quote = fc.record({
  exact: hostileText(1, 12),
  prefix: hostileText(0, 6),
  suffix: hostileText(0, 6)
})

const runtime = fc
  .record({
    path: hostileText(0, 20),
    tag: tagName,
    quote: fc.option(quote, { nil: undefined }),
    snapshot: fc.option(hostileText(0, 40), { nil: undefined }),
    truncated: fc.option(fc.constant(true as const), { nil: undefined }),
    snapshotSource: fc.constant('page' as const)
  })
  .map(defined)

const anchor = fc
  .record({
    tag: tagName,
    id: fc.option(hostileText(1, 12), { nil: undefined }),
    cls: fc.option(fc.array(token(6, /\s/g), { minLength: 1, maxLength: 8 }), { nil: undefined }),
    path: hostileText(0, 20),
    quote: fc.option(quote, { nil: undefined }),
    runtime: fc.option(runtime, { nil: undefined })
  })
  .map(defined)

const view = fc
  .record({
    w: fc.integer({ min: 0, max: 1_000_000 }),
    h: fc.integer({ min: 0, max: 1_000_000 }),
    dpr: fc.constantFrom(0.5, 1, 1.25, 1.5, 2, 3, 16),
    x: finite(-1_000_000, 1_000_000),
    y: finite(-1_000_000, 1_000_000),
    hash: fc.option(hostileText(0, 12), { nil: undefined })
  })
  .map(defined)

const message = fc
  .record({
    by: author,
    at: timestamp,
    text: hostileText(1, 24),
    edited: fc.option(timestamp, { nil: undefined })
  })
  .map(defined)

/** Any valid v1 comment: hostile text everywhere text may go, and unknown future fields. */
export const commentDataArb: fc.Arbitrary<CommentData> = fc
  .record({
    idSeed: fc.nat(),
    resolvedBy: fc.option(fc.record({ by: author, at: timestamp }), { nil: undefined }),
    anchor,
    view,
    msgs: fc.array(message, { minLength: 1, maxLength: 4 }),
    future: futureFields
  })
  .map(({ idSeed, resolvedBy, anchor: a, view: v, msgs, future }) => ({
    ...future,
    v: 1 as const,
    id: fixedId('c-', idSeed),
    status: resolvedBy ? ('resolved' as const) : ('open' as const),
    ...(resolvedBy ? { resolved: resolvedBy } : {}),
    anchor: a,
    view: v,
    msgs: msgs.map((msg, i) => ({ ...msg, id: fixedId('m-', idSeed + i) }))
  }))

/** A block layout: the target line's indent and line break. */
export const layoutArb = fc.record({
  indent: fc.constantFrom('', '  ', '\t', '    \t'),
  eol: fc.constantFrom<Eol>('\n', '\r\n', '\r')
})

// ---------------------------------------------------------------------------
// HTML documents
// ---------------------------------------------------------------------------

/** Placeholders the grammar emits; {@link documentArb} turns them into blocks. */
const OK_BLOCK = '@@ok-block@@'
const DAMAGED_BLOCK = '@@damaged-block@@'

const CONTAINER_TAGS = [
  'p',
  'div',
  'span',
  'li',
  'ul',
  'table',
  'tr',
  'td',
  'pre',
  'b',
  'i',
  'em',
  'a',
  'section',
  'svg',
  'select',
  'option',
  'h1',
  'button',
  'dl',
  'dd',
  'code',
  'main',
  'listing'
] as const
const VOID_TAGS = [
  '<br>',
  '<br/>',
  '<img alt="x">',
  '<input value="-->">',
  '<hr>',
  '<wbr>'
] as const
const RAW_TEXT_TAGS = ['script', 'style', 'textarea', 'title', 'xmp', 'noscript', 'iframe'] as const
const FAKE_CONTENT = [
  '<!-- erfana:comment v1 id=c-aaaaaaaaaaaaaaaa\n  @data {} -->',
  '<p>not a tag</p>',
  'x < y && y > z',
  '"<!--"',
  '</scrip>',
  '-->'
] as const
const EXISTING_COMMENTS = [
  '<!-- note -->',
  '<!---->',
  '<!--x--!>',
  '<!-- a - b -->',
  '<!x>',
  '<?pi?>',
  '<!-- erfana:comment v2 id=c-later -->',
  '<!-- erfana:comment -->'
] as const
const TEXTS = [
  'Hello',
  'some words here',
  '&lt;b&gt;',
  'a < b',
  '1 > 0',
  '&amp;',
  ' ',
  'trailing -',
  'x--y'
] as const
const SEPARATORS = ['', ' ', '\n', '\n  ', '\n\t', '\n\n    '] as const
const ATTR_VALUES = [
  'x',
  '<b>',
  '-->',
  '<!--',
  'a>b',
  '',
  'erfana:comment v1',
  '&amp;',
  'two\nlines'
] as const

const attribute = fc
  .tuple(
    fc.constantFrom('class', 'id', 'title', 'data-x', 'href', 'style'),
    fc.constantFrom(...ATTR_VALUES),
    fc.constantFrom('"', "'", '')
  )
  .map(([name, value, q]) => {
    if (q === '') return /^[^\s"'=<>`]+$/.test(value) ? ` ${name}=${value}` : ` ${name}`
    return ` ${name}=${q}${value}${q}`
  })

const leaf = fc.oneof(
  { arbitrary: fc.constantFrom(...TEXTS), weight: 4 },
  { arbitrary: fc.constantFrom(...VOID_TAGS), weight: 2 },
  { arbitrary: fc.constantFrom(...EXISTING_COMMENTS), weight: 1 },
  { arbitrary: fc.constantFrom(OK_BLOCK, OK_BLOCK, DAMAGED_BLOCK), weight: 2 },
  {
    arbitrary: fc
      .tuple(fc.constantFrom(...RAW_TEXT_TAGS), fc.constantFrom(...FAKE_CONTENT))
      .map(([tag, content]) => `<${tag}>${content}</${tag}>`),
    weight: 1
  }
)

const tree = fc.letrec<{ node: string; nodes: string; element: string }>(tie => ({
  node: fc.oneof({ depthSize: 'small' }, leaf, tie('element')),
  nodes: fc
    .array(fc.tuple(fc.constantFrom(...SEPARATORS), tie('node')), { maxLength: 5 })
    .map(parts => parts.flat().join('')),
  element: fc
    .tuple(
      fc.constantFrom(...CONTAINER_TAGS),
      fc.array(attribute, { maxLength: 3 }),
      tie('nodes'),
      fc.constantFrom(...SEPARATORS),
      fc.integer({ min: 0, max: 9 })
    )
    .map(
      ([tag, attrs, inner, sep, closeRoll]) =>
        `<${tag}${attrs.join('')}>${inner}${sep}${closeRoll < 8 ? `</${tag}>` : ''}`
    )
}))

/** A generated document and how it was made. */
export interface GeneratedDocument {
  readonly text: string
  readonly eol: Eol
  readonly bom: boolean
}

/** Damage that leaves a comment node in place and the file writable. */
const DAMAGES: ReadonlyArray<(block: string) => string> = [
  block => block.replace('status: open', 'status: closed'),
  block => block.replace(/(\n[ \t]*@data [^\n]{30})[^\n]*/, '$1'),
  block => block.replace('\n  status', '\n=======\n  status'),
  block => block.replace(/\n {2}@data [^\n]*/, '')
]

function poolBlock(n: number): string {
  const data = makeComment({
    id: fixedId('c-', 500 + n),
    anchor: { tag: 'p', path: '', quote: { exact: 'Hello', prefix: '', suffix: '' } }
  })
  const result = serializeBlock(data, { indent: '  ', eol: '\n' })
  if (!result.ok) throw new Error(`pool block ${n}: ${result.reason}`)
  return result.block
}

/** Replace the placeholders with blocks of distinct ids, and use one line-break style throughout. */
function finishDocument(raw: string, eol: Eol): string {
  let n = 0
  const withBlocks = raw.replace(new RegExp(`${OK_BLOCK}|${DAMAGED_BLOCK}`, 'g'), placeholder => {
    n += 1
    const block = poolBlock(n)
    return placeholder === OK_BLOCK ? block : DAMAGES[n % DAMAGES.length](block)
  })
  return withBlocks.replace(/\r\n|\r|\n/g, eol)
}

/** A writable HTML document from the grammar: optional BOM, doctype and html/head/body wrapper. */
export const documentArb: fc.Arbitrary<GeneratedDocument> = fc
  .record({
    bom: fc.boolean(),
    doctype: fc.boolean(),
    wrap: fc.boolean(),
    eol: fc.constantFrom<Eol>('\n', '\r\n', '\r'),
    body: tree.nodes
  })
  .map(({ bom, doctype, wrap, eol, body }) => {
    const page = wrap
      ? `<html>\n<head><title>T</title></head>\n<body>\n${body}\n</body>\n</html>\n`
      : body
    const text = `${bom ? BOM : ''}${finishDocument(`${doctype ? '<!doctype html>\n' : ''}${page}`, eol)}`
    return { text, eol, bom }
  })
