// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The v1 block format: serializer, escaping, schema and limits
 * (docs/designs/html-preview-comments.md §5.1–§5.4, §5.8; U-001–U-023).
 *
 * Escaping is the critical part (threat S13): no text a reviewer types or a
 * page supplies may end the HTML comment, and `@data` must give back exactly
 * what was written.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PREVIEW_LIMITS } from '../preview-limits'
import { PREVIEW } from '../constants'
import { GOLDEN_CASES } from './__fixtures__/v1/cases'
import {
  ADA,
  BOM,
  FIXED_NOW,
  GRACE,
  LINE_SEP,
  LONE_HIGH,
  LONE_LOW,
  NUL,
  PARA_SEP,
  RLO,
  ZWJ,
  ZWSP,
  ch,
  fixedId,
  makeComment,
  makeReply,
  pageWith,
  seededRandom,
  uEsc
} from './__fixtures__/commentTestData'
import {
  AGENT_NOTE_LINES,
  AGENT_NOTE_PREFIX,
  CommentDataSchema,
  COMMENT_ID_PATTERN,
  MESSAGE_ID_PATTERN,
  assertSafeCommentText,
  codePointLength,
  cryptoRandomBytes,
  escapeJsonForComment,
  escapeReadableInline,
  escapeReadableLine,
  formatTimestamp,
  isLimitIssue,
  mintCommentId,
  mintMessageId,
  randomBase32,
  renderAgentNote,
  renderReadable,
  renderReadableLines,
  serializeBlock,
  type CommentData
} from './format'
import { parseCommentBlocks, type ParsedBlock } from './parse'
import { prepareSnapshot } from './anchor'
import { addReply, createThread } from './thread'
import { analyzeCommentDocument } from './parse'
import { planReplace } from './splice'

type ChildNode = DefaultTreeAdapterMap['childNode']

const LF = { indent: '', eol: '\n' } as const
const V1_DIR = join(__dirname, '__fixtures__', 'v1')

function serialize(
  data: CommentData,
  layout: { indent: string; eol: '\n' | '\r\n' | '\r' } = LF
): string {
  const result = serializeBlock(data, layout)
  if (!result.ok) throw new Error(`serialize failed: ${result.reason}`)
  return result.block
}

function parseOne(block: string): ParsedBlock {
  const state = parseCommentBlocks(pageWith(block))
  expect(state.blocks).toHaveLength(1)
  return state.blocks[0]
}

function okData(block: string): CommentData {
  const parsed = parseOne(block)
  if (parsed.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(parsed)}`)
  return parsed.data
}

function withText(text: string): CommentData {
  return makeComment({ msgs: [{ ...makeComment().msgs[0], text }] })
}

/** Every comment node parse5 finds in `html`. */
function commentNodes(html: string): string[] {
  const found: string[] = []
  const pending: ChildNode[] = [...parse(html).childNodes]
  for (let node = pending.pop(); node; node = pending.pop()) {
    if (node.nodeName === '#comment' && 'data' in node) found.push(node.data)
    if ('childNodes' in node) pending.push(...(node.childNodes as ChildNode[]))
  }
  return found
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('serializeBlock – canonical output', () => {
  it('U-001 minimal comment → exact golden bytes', () => {
    const golden = readFileSync(join(V1_DIR, '01-minimal.block.txt'), 'utf8')
    expect(serialize(makeComment())).toBe(golden)
    expect(golden.split('\n')).toEqual([
      '<!-- erfana:comment v1 id=c-k3j7q2m6x7p4d2za',
      AGENT_NOTE_LINES[0],
      `  ${AGENT_NOTE_LINES[1]}`,
      `  ${AGENT_NOTE_LINES[2]}`,
      'status: open',
      'target: <button class="cta">',
      'comment by Ada Lovelace <ada@example.com> at 2026-10-25T14:03:00Z:',
      '  Make this button blue and bigger.',
      `@data ${escapeJsonForComment(JSON.stringify(makeComment()))}`,
      '-->'
    ])
  })

  it('U-002 thread with replies, resolved, author without email', () => {
    const data = GOLDEN_CASES[1].data
    const lines = serialize(data, { indent: '    ', eol: '\n' }).split('\n')
    expect(lines.slice(0, 12)).toEqual([
      '<!-- erfana:comment v1 id=c-k3j7q2m6x7p4d2za',
      `    ${AGENT_NOTE_LINES[0]}`,
      `      ${AGENT_NOTE_LINES[1]}`,
      `      ${AGENT_NOTE_LINES[2]}`,
      '    status: resolved by Grace Hopper at 2026-10-27T08:00:00Z',
      '    target: <button class="cta">',
      '    comment by Ada Lovelace <ada@example.com> at 2026-10-25T14:03:00Z:',
      '      Make this button blue and bigger.',
      '    reply by Grace Hopper at 2026-10-26T09:12:00Z:',
      '      Agreed, and fix the padding too.',
      '    reply by Ada Lovelace <ada@example.com> at 2026-10-26T09:12:00Z:',
      '      Done in the stylesheet.'
    ])
    expect(lines[12].startsWith('    @data {')).toBe(true)
    expect(lines[13]).toBe('    -->')
    expect(serialize(data, { indent: '    ', eol: '\n' })).toBe(
      readFileSync(join(V1_DIR, '02-thread-resolved.block.txt'), 'utf8')
    )
  })

  it('U-003 parse(serialize(x)) deep-equals x', () => {
    const data = makeComment({
      msgs: [makeComment().msgs[0], makeReply(1, 'Second'), makeReply(2, 'Third', ADA)]
    })
    expect(okData(serialize(data))).toEqual(data)
  })

  it('names a script-built target and a target below its in-file element', () => {
    const built = makeComment({
      anchor: {
        tag: 'div',
        path: 'html > body > div:nth-of-type(1)',
        runtime: {
          path: 'ul:nth-of-type(1) > li:nth-of-type(2)',
          tag: 'li',
          snapshot: '<li>x</li>',
          snapshotSource: 'page'
        }
      }
    })
    expect(renderReadableLines(built)[1]).toBe(
      'target: <div> (built by script: <li> at ul:nth-of-type(1) > li:nth-of-type(2) inside this element; snapshot captured from the page)'
    )
    const below = makeComment({
      anchor: {
        tag: 'table',
        path: '',
        runtime: { path: '', tag: 'tbody', snapshotSource: 'page' }
      }
    })
    expect(renderReadableLines(below)[1]).toBe(
      'target: <table> (comment is about <tbody> inside this element)'
    )
  })

  it('renders the readable part with the layout indent and line break', () => {
    expect(renderReadable(makeComment(), { indent: '\t', eol: '\r\n' })).toBe(
      [
        '\tstatus: open',
        '\ttarget: <button class="cta">',
        '\tcomment by Ada Lovelace <ada@example.com> at 2026-10-25T14:03:00Z:',
        '\t  Make this button blue and bigger.'
      ].join('\r\n')
    )
  })
})

describe('agent note (X-001)', () => {
  it('U-022 every block carries the fixed note right after its header, at the block indent', () => {
    for (const layout of [
      LF,
      { indent: '    ', eol: '\r\n' },
      { indent: '\t', eol: '\r' }
    ] as const) {
      const lines = serialize(makeComment(), layout).split(layout.eol)
      expect(lines.slice(1, 1 + AGENT_NOTE_LINES.length)).toEqual(
        AGENT_NOTE_LINES.map((line, i) => `${layout.indent}${i === 0 ? '' : '  '}${line}`)
      )
      expect(lines[1 + AGENT_NOTE_LINES.length]).toBe(`${layout.indent}status: open`)
      expect(renderAgentNote(layout)).toBe(
        lines.slice(1, 1 + AGENT_NOTE_LINES.length).join(layout.eol)
      )
    }
    const resolved = serialize(GOLDEN_CASES[1].data)
    expect(resolved).toContain(renderAgentNote(LF))
  })

  it('U-023 the note needs no escaping and cannot be taken for data, a marker or the end of the comment', () => {
    expect(AGENT_NOTE_LINES[0].startsWith(AGENT_NOTE_PREFIX)).toBe(true)
    for (const line of AGENT_NOTE_LINES) {
      expect(line).toMatch(/^[\x20-\x7e]+$/)
      expect(line).not.toContain('--')
      expect(line).not.toMatch(/@data\s/)
      expect(line).not.toMatch(/^[@\\<=>|]/)
      expect(escapeReadableLine(line)).toBe(line)
      expect(escapeReadableInline(line)).toBe(line)
    }
  })
})

describe('versions', () => {
  it('U-004 a header without v1 is not a block; v2 is newer and never rewritten', () => {
    const v1 = serialize(makeComment())
    const noVersion = v1.replace('erfana:comment v1', 'erfana:comment')
    expect(parseCommentBlocks(pageWith(noVersion)).blocks).toEqual([])
    const v2 = v1.replace('erfana:comment v1', 'erfana:comment v2')
    const doc = analyzeCommentDocument(pageWith(v2))
    expect(doc.state.blocks[0]).toMatchObject({ kind: 'newer', version: 2 })
    expect(
      planReplace(doc, {
        id: makeComment().id,
        rawHash: doc.state.blocks[0].rawHash,
        data: makeComment()
      })
    ).toEqual({
      ok: false,
      reason: 'not-found'
    })
    expect(parseOne(v1.replace('erfana:comment v1', 'erfana:comment v0'))).toMatchObject({
      kind: 'damaged',
      reason: 'schema'
    })
  })
})

describe('escaping', () => {
  it('U-005 every WHATWG comment-text rule is escaped', () => {
    const texts = [
      'a --> b',
      'a --!> b',
      'a <!-- b',
      '> starts',
      '-> starts',
      'ends <!-',
      'ends -',
      '----'
    ]
    for (const text of texts) {
      const block = serialize(withText(text))
      assertSafeCommentText(block)
      const inner = block.slice(4, -3)
      expect(inner).not.toContain('--')
      expect(commentNodes(`<div>${block}</div>`)).toHaveLength(1)
      expect(okData(block).msgs[0].text).toBe(text)
    }
  })

  it('U-006 the escape sequences themselves round-trip', () => {
    const text = `literal ${uEsc(0x2d)} and -\\- and \\\\ and ${uEsc(0x3c)}!${uEsc(0x2d)}`
    const block = serialize(withText(text))
    expect(okData(block).msgs[0].text).toBe(text)
  })

  it('U-007 emoji, ZWJ, combining marks, CJK, RTL and bidi controls round-trip; readable shows bidi escaped', () => {
    const text = `${ch(0x1f469)}${ZWJ}${ch(0x1f469)} e${ch(0x301)} ${ch(0x6f22)} ${ch(0x645)}${ch(0x631)} ${RLO}x${ch(0x202c)}${ZWSP}`
    const block = serialize(withText(text))
    expect(okData(block).msgs[0].text).toBe(text)
    const readable = block.split('\n')[1 + AGENT_NOTE_LINES.length + 3]
    expect(readable).toContain(uEsc(0x202e))
    expect(readable).toContain(uEsc(0x200b))
    expect(readable).toContain(`${ch(0x1f469)}${ZWJ}${ch(0x1f469)}`)
    expect(block).not.toContain(RLO)
    expect(block).not.toContain(ZWSP)
  })

  it('U-008 NUL, C0 controls and lone surrogates round-trip and never reach the file raw', () => {
    const text = `nul${NUL} bel${String.fromCharCode(7)} esc${String.fromCharCode(0x1b)} hi${LONE_HIGH} lo${LONE_LOW} sep${LINE_SEP}${PARA_SEP} bom${BOM}`
    const block = serialize(withText(text))
    expect(okData(block).msgs[0].text).toBe(text)
    expect(new TextDecoder().decode(new TextEncoder().encode(block))).toBe(block)
    for (const raw of [
      NUL,
      LONE_HIGH,
      LONE_LOW,
      LINE_SEP,
      PARA_SEP,
      BOM,
      String.fromCharCode(0x1b)
    ]) {
      expect(block).not.toContain(raw)
    }
    expect(block).toContain(uEsc(0xd83d))
  })

  it('U-007 tag characters, joiners, fillers, selectors and private use never reach the file raw; ZWNJ, ZWJ, VS15 and VS16 stay as typed', () => {
    // Security review F5: tag characters (U+E0000–E007F) can carry text no reader sees
    const hidden = [
      0xe0072, 0xe006d, 0xe0001, 0xe007f, 0x2060, 0x2064, 0x2065, 0xad, 0x180e, 0x3164, 0x115f,
      0x34f, 0xfe00, 0xe0100, 0xe000, 0xf0000, 0xfff9
    ].map(ch)
    const kept = [0x200c, 0x200d, 0xfe0e, 0xfe0f].map(ch)
    const text = `a${hidden.join('b')}c ${kept.join('d')} e`

    const block = serialize(withText(text))

    expect(okData(block).msgs[0].text).toBe(text)
    for (const raw of hidden) expect(block).not.toContain(raw)
    for (const raw of kept) expect(escapeReadableLine(raw)).toBe(raw)
    // A character past U+FFFF is shown as both of its code units
    expect(escapeReadableLine(`x${ch(0xe0072)}`)).toBe(`x${uEsc(0xdb40)}${uEsc(0xdc72)}`)
    expect(escapeReadableInline(ch(0xe0072))).toBe(`${uEsc(0xdb40)}${uEsc(0xdc72)}`)
  })

  it('U-007 an unassigned code point is shown as typed, so the readable text never changes with the Unicode version', () => {
    // U+FDD0 is a noncharacter: unassigned (Cn) for good, and not default-ignorable
    const unassigned = ch(0xfdd0)

    expect(escapeReadableLine(`x${unassigned}`)).toBe(`x${unassigned}`)
    expect(okData(serialize(withText(unassigned))).msgs[0].text).toBe(unassigned)
  })

  it('U-009 line breaks inside text use the block line break in readable text; @data keeps them exactly', () => {
    const text = 'one\r\ntwo\rthree\nfour'
    const block = serialize(withText(text), { indent: '  ', eol: '\r\n' })
    expect(block).toContain('\r\n    one\r\n    two\r\n    three\r\n    four\r\n')
    expect(okData(block).msgs[0].text).toBe(text)
  })

  it('escapes only inside JSON strings, so negative numbers stay numbers', () => {
    expect(escapeJsonForComment('{"x":-1,"t":"a-b<c>&"}')).toBe(
      `{"x":-1,"t":"a${uEsc(0x2d)}b${uEsc(0x3c)}c${uEsc(0x3e)}${uEsc(0x26)}"}`
    )
    const data = makeComment({ view: { w: 10, h: 10, dpr: 1, x: -40, y: -1e-7 } })
    expect(okData(serialize(data)).view).toEqual(data.view)
  })

  it('escapes inline values and lines for the readable part', () => {
    expect(escapeReadableInline('a\tb\nc--d')).toBe(`a${uEsc(9)}b${uEsc(10)}c-\\-d`)
    expect(escapeReadableLine('  @data x')).toBe('  \\@data x')
    expect(escapeReadableLine('\\x')).toBe('\\\\x')
    expect(escapeReadableLine('tab\tkept')).toBe('tab\tkept')
    expect(escapeReadableLine('plain')).toBe('plain')
  })

  it('assertSafeCommentText throws on text that could end the comment', () => {
    expect(() => assertSafeCommentText('<!-- a -- b -->')).toThrow(/end its HTML comment/)
    expect(() => assertSafeCommentText('<!--> -->')).toThrow()
    expect(() => assertSafeCommentText('<!---> -->')).toThrow()
    expect(() => assertSafeCommentText('<!-- a--->')).toThrow()
    expect(() => assertSafeCommentText('not a comment')).toThrow()
    expect(() => assertSafeCommentText('<!-- fine -->')).not.toThrow()
  })
})

describe('damage on read', () => {
  const block = (): string => serialize(makeComment())

  it('U-010 readable text that disagrees with @data → damaged readable-mismatch', () => {
    const edited = block().replace('  Make this button blue', '  Make this button red')
    expect(parseOne(edited)).toMatchObject({ kind: 'damaged', reason: 'readable-mismatch' })
    const header = block().replace(
      '<!-- erfana:comment v1 id=c-k3j7q2m6x7p4d2za',
      '<!-- erfana:comment v1 id=c-k3j7q2m6x7p4d2za extra'
    )
    expect(parseOne(header)).toMatchObject({ kind: 'damaged', reason: 'readable-mismatch' })
  })

  it('whitespace-only differences in the readable text are not damage', () => {
    const reindented = block()
      .split('\n')
      .map((line, i) => (i === 0 ? line : `\t ${line.trim()}   `))
      .join('\r\n')
    expect(parseOne(reindented).kind).toBe('ok')
  })

  it('U-011 invalid JSON → bad-json', () => {
    expect(parseOne(block().replace(/("status":"open")/, '$1,,'))).toMatchObject({
      kind: 'damaged',
      reason: 'bad-json'
    })
  })

  it('U-012 schema violation → schema', () => {
    expect(parseOne(block().replace('"status":"open"', '"status":"closed"'))).toMatchObject({
      kind: 'damaged',
      reason: 'schema'
    })
    expect(
      parseOne(block().replace('@data {"v":1,', '@data {"v":1,"msgs":[],"x":0,'))
    ).toMatchObject({ kind: 'damaged' })
  })

  it('U-013 __proto__ / constructor.prototype in @data → no pollution', () => {
    const hostile = block().replace(
      '@data {"v":1,',
      '@data {"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"v":1,'
    )
    const parsed = parseOne(hostile)
    expect(parsed.kind).toBe('ok')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    if (parsed.kind === 'ok') {
      expect(Object.getPrototypeOf(parsed.data)).toBe(Object.prototype)
      expect(Object.keys(parsed.data)).not.toContain('constructor')
    }
  })

  it('U-014 a block over 2 MB is damaged without JSON.parse; depth 10,000 is damaged without a stack overflow', () => {
    const parseSpy = vi.spyOn(JSON, 'parse')
    const huge = block().replace(
      '"status":"open"',
      `"status":"open","pad":"${'x'.repeat(PREVIEW_LIMITS.COMMENT_BLOCK_MAX_BYTES)}"`
    )
    expect(parseOne(huge)).toMatchObject({ kind: 'damaged', reason: 'limits' })
    expect(parseSpy).not.toHaveBeenCalled()
    // The depth scan decodes object keys one by one; the JSON text itself is never parsed.
    const deep = block().replace(
      '"status":"open"',
      `"status":"open","deep":${'['.repeat(10_000)}${']'.repeat(10_000)}`
    )
    expect(parseOne(deep)).toMatchObject({ kind: 'damaged', reason: 'limits' })
    expect(parseSpy.mock.calls.every(([arg]) => String(arg).length < 64)).toBe(true)
  })

  it('U-015 duplicate keys → damaged', () => {
    const dup = block().replace('"status":"open"', '"status":"open","status":"resolved"')
    expect(parseOne(dup)).toMatchObject({ kind: 'damaged', reason: 'bad-json' })
  })

  it('a block without an @data line, or whose header id differs, is damaged', () => {
    expect(parseOne(block().replace(/\n@data [^\n]*/, ''))).toMatchObject({
      kind: 'damaged',
      reason: 'no-data'
    })
    const other = block().replace('id=c-k3j7q2m6x7p4d2za', `id=${fixedId('c-', 1)}`)
    expect(parseOne(other)).toMatchObject({
      kind: 'damaged',
      reason: 'id-mismatch',
      headerId: fixedId('c-', 1)
    })
  })
})

describe('forward compatibility', () => {
  const future = (): CommentData =>
    ({
      ...makeComment({
        anchor: { tag: 'button', path: 'p', futureAnchor: { a: 1 } },
        msgs: [{ ...makeComment().msgs[0], futureMsg: true }]
      }),
      futureRoot: { keep: ['me'] }
    }) as CommentData

  it('U-016 unknown fields are preserved through an edit', () => {
    const read = okData(serialize(future()))
    const replied = addReply(read, 'A reply', {
      author: GRACE,
      now: FIXED_NOW,
      random: seededRandom(3)
    })
    const reread = okData(serialize(replied))
    expect(reread.futureRoot).toEqual({ keep: ['me'] })
    expect(reread.anchor.futureAnchor).toEqual({ a: 1 })
    expect(reread.msgs[0].futureMsg).toBe(true)
    expect(reread.msgs).toHaveLength(2)
  })

  it('U-017 the reserved role "agent" parses', () => {
    const data = makeComment({
      msgs: [{ ...makeComment().msgs[0], by: { name: 'Bot', role: 'agent' } }]
    })
    expect(okData(serialize(data)).msgs[0].by.role).toBe('agent')
    expect(
      CommentDataSchema.safeParse({
        ...data,
        msgs: [{ ...data.msgs[0], by: { name: 'x', role: 'robot' } }]
      }).success
    ).toBe(false)
  })
})

describe('time and ids', () => {
  const originalTz = process.env.TZ
  afterEach(() => {
    process.env.TZ = originalTz
  })

  it('U-018 timestamps are UTC; output is identical under Asia/Kathmandu and Pacific/Kiritimati', () => {
    const outputs = ['Asia/Kathmandu', 'Pacific/Kiritimati', 'UTC'].map(tz => {
      process.env.TZ = tz
      const data = createThread({
        anchor: makeComment().anchor,
        view: makeComment().view,
        text: 'Same everywhere.',
        context: { author: ADA, now: FIXED_NOW, random: seededRandom(42) }
      })
      return serialize(data)
    })
    expect(new Set(outputs).size).toBe(1)
    expect(outputs[0]).toContain('at 2026-10-25T14:03:00Z:')
    expect(formatTimestamp(new Date('2026-01-02T03:04:05.678Z'))).toBe('2026-01-02T03:04:05Z')
  })

  it('mints ids from 80 random bits in lowercase base32', () => {
    expect(mintCommentId()).toMatch(COMMENT_ID_PATTERN)
    expect(mintMessageId()).toMatch(MESSAGE_ID_PATTERN)
    expect(randomBase32(32, () => Uint8Array.from({ length: 32 }, (_, i) => i))).toBe(
      'abcdefghijklmnopqrstuvwxyz234567'
    )
    expect(randomBase32(2, () => Uint8Array.from([32, 255]))).toBe('a7')
    expect(cryptoRandomBytes(4)).toHaveLength(4)
  })

  it('refuses impossible timestamps and counts characters as code points', () => {
    expect(
      CommentDataSchema.safeParse(
        makeComment({ msgs: [{ ...makeComment().msgs[0], at: '2026-02-30T00:00:00Z' }] })
      ).success
    ).toBe(false)
    expect(codePointLength(`a${ch(0x1f600)}b`)).toBe(3)
  })
})

describe('limits', () => {
  it('U-019 a snapshot over 256 KB is cut and flagged; the cut never splits a surrogate pair or leaves a dash', () => {
    const max = PREVIEW_LIMITS.COMMENT_SNAPSHOT_MAX_BYTES
    const emoji = ch(0x1f600)
    const atBoundary = prepareSnapshot('a'.repeat(max - 2) + emoji + 'tail')
    expect(atBoundary.truncated).toBe(true)
    expect(atBoundary.snapshot).toBe('a'.repeat(max - 2))
    const dashes = prepareSnapshot('b'.repeat(max - 3) + '<!--' + 'c'.repeat(10))
    expect(dashes.snapshot.endsWith('-')).toBe(false)
    expect(dashes.snapshot).toBe('b'.repeat(max - 3) + '<!')
    expect(prepareSnapshot('<li>short</li>')).toEqual({
      snapshot: '<li>short</li>',
      truncated: false
    })
  })

  it('U-020 the worst case block is refused with a limit before any write; a large one that fits parses ok', () => {
    const hostile = '<->&'.repeat(1_000)
    const replies = Array.from({ length: PREVIEW_LIMITS.COMMENT_MAX_REPLIES }, (_, i) =>
      makeReply(i + 1, hostile)
    )
    const snapshot = '<div class="x">'
      .repeat(16_000)
      .slice(0, PREVIEW_LIMITS.COMMENT_SNAPSHOT_MAX_BYTES)
    const worst = makeComment({
      anchor: {
        tag: 'div',
        path: '',
        runtime: { path: 'p:nth-of-type(1)', tag: 'p', snapshot, snapshotSource: 'page' }
      },
      msgs: [{ ...makeComment().msgs[0], text: hostile }, ...replies]
    })
    expect(serializeBlock(worst, LF)).toEqual({ ok: false, reason: 'limit' })
    const fits = makeComment({ ...worst, msgs: worst.msgs.slice(0, 20) })
    expect(okData(serialize(fits))).toEqual(fits)
  })

  it('U-021 a reply that pushes a block over 2 MB → limit, file unchanged', () => {
    const big = '-'.repeat(PREVIEW_LIMITS.COMMENT_MESSAGE_MAX_CHARS)
    const withReplies = (n: number): CommentData =>
      makeComment({
        msgs: [
          { ...makeComment().msgs[0], text: big },
          ...Array.from({ length: n }, (_, i) => makeReply(i + 1, big))
        ]
      })
    // Each reply of 4,000 dashes adds the same number of bytes: fill the block to just under 2 MB.
    const size = (n: number): number => new TextEncoder().encode(serialize(withReplies(n))).length
    const perReply = size(2) - size(1)
    const fit = Math.floor((PREVIEW_LIMITS.COMMENT_BLOCK_MAX_BYTES - size(0)) / perReply)
    const data = withReplies(fit)
    const html = pageWith(serialize(data))
    const doc = analyzeCommentDocument(html)
    expect(doc.state.blocks[0].kind).toBe('ok')
    const tooBig = addReply(data, big, { author: ADA, now: FIXED_NOW, random: seededRandom(9) })
    const plan = planReplace(doc, {
      id: data.id,
      rawHash: doc.state.blocks[0].rawHash,
      data: tooBig
    })
    expect(plan).toEqual({ ok: false, reason: 'limit' })
    expect(doc.text).toBe(html)
  })

  it('refuses over-long text and too many replies as limits, other schema faults as invalid', () => {
    const long = withText('x'.repeat(PREVIEW_LIMITS.COMMENT_MESSAGE_MAX_CHARS + 1))
    expect(serializeBlock(long, LF)).toEqual({ ok: false, reason: 'limit' })
    expect(
      serializeBlock(withText(ch(0x1f600).repeat(PREVIEW_LIMITS.COMMENT_MESSAGE_MAX_CHARS)), LF).ok
    ).toBe(true)
    const many = makeComment({
      msgs: [
        makeComment().msgs[0],
        ...Array.from({ length: PREVIEW_LIMITS.COMMENT_MAX_REPLIES + 1 }, (_, i) =>
          makeReply(i, 'r')
        )
      ]
    })
    expect(serializeBlock(many, LF)).toEqual({ ok: false, reason: 'limit' })
    expect(serializeBlock(makeComment({ id: 'c-bad' }), LF)).toEqual({
      ok: false,
      reason: 'invalid'
    })
    const longName = makeComment({
      msgs: [{ ...makeComment().msgs[0], by: { name: 'n'.repeat(101), role: 'human' } }]
    })
    expect(serializeBlock(longName, LF)).toEqual({ ok: false, reason: 'limit' })
    expect(isLimitIssue({ code: 'invalid_type', message: 'x' })).toBe(false)
  })

  it('refuses a bad layout and data JSON cannot represent', () => {
    expect(serializeBlock(makeComment(), { indent: 'x', eol: '\n' })).toEqual({
      ok: false,
      reason: 'invalid'
    })
    expect(serializeBlock(makeComment(), { indent: '', eol: '\n\n' as '\n' })).toEqual({
      ok: false,
      reason: 'invalid'
    })
    const bigint = { ...makeComment(), extra: BigInt(1) } as CommentData
    expect(serializeBlock(bigint, LF)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('enforces the status / resolved pairing and unique message ids', () => {
    expect(CommentDataSchema.safeParse(makeComment({ status: 'resolved' })).success).toBe(false)
    expect(
      CommentDataSchema.safeParse(
        makeComment({ resolved: { by: ADA, at: '2026-10-25T14:03:00Z' } })
      ).success
    ).toBe(false)
    const twice = makeComment({ msgs: [makeComment().msgs[0], makeComment().msgs[0]] })
    expect(CommentDataSchema.safeParse(twice).success).toBe(false)
  })

  it('keeps the file-size limit equal to the preview entry limit', () => {
    expect(PREVIEW_LIMITS.COMMENT_FILE_MAX_BYTES).toBe(PREVIEW.MAX_ENTRY_HTML_BYTES)
  })
})
