// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Placement and byte identity (docs/designs/html-preview-comments.md
 * decision 24, §5.2, §19 R3-8; U-040–U-043, U-050–U-061).
 *
 * Every write here goes through the bytes, as the writer will: decode
 * losslessly, plan on the text, splice the original Buffer, and prove that
 * every byte outside the block is the same.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ADA,
  BOM,
  FIXED_NOW,
  GRACE,
  LATER,
  domSignature,
  elementOf,
  fixedId,
  makeComment,
  seededRandom
} from './__fixtures__/commentTestData'
import { decodeLossless } from './encoding'
import type { CommentData } from './format'
import { analyzeCommentDocument, type CommentDocument } from './parse'
import {
  applySplice,
  lineLayoutAt,
  planDelete,
  planInsert,
  planReplace,
  spliceBytes,
  verifyCommentSplice,
  verifySplice,
  verifySpliceBytes,
  type SplicePlan
} from './splice'
import { addReply, editMessage, setStatus } from './thread'

const CONTEXTS = join(__dirname, '__fixtures__', 'contexts')
const COMPAT = join(__dirname, '__fixtures__', 'v1-compat')

function comment(n: number, tag: string): CommentData {
  return makeComment({ id: fixedId('c-', n), anchor: { tag, path: '' } })
}

interface Written {
  readonly bytes: Buffer
  readonly plan: SplicePlan
  readonly doc: CommentDocument
}

/** Decode, plan, splice the Buffer and verify it – the writer's path, without the disk. */
function write(
  bytes: Buffer,
  makePlan: (doc: CommentDocument) => ReturnType<typeof planInsert>
): Written {
  const decoded = decodeLossless(bytes)
  if (!decoded.ok) throw new Error(`decode: ${decoded.reason}`)
  const doc = analyzeCommentDocument(decoded.text)
  const result = makePlan(doc)
  if (!result.ok) throw new Error(`plan: ${result.reason}`)
  const out = Buffer.from(spliceBytes(bytes, decoded.text, result.plan))
  expect(verifySpliceBytes(bytes, out, decoded.text, result.plan)).toBe(true)
  const verified = verifyCommentSplice(doc, applySplice(decoded.text, result.plan), result.plan)
  expect(verified).toMatchObject({ ok: true })
  return { bytes: out, plan: result.plan, doc }
}

function add(
  bytes: Buffer,
  tag: string,
  data: CommentData,
  options: { n?: number; ws?: string } = {}
): Written {
  return write(bytes, doc =>
    planInsert(doc, {
      targetStart: elementOf(doc.index, tag, options.n).start,
      data,
      ws: options.ws
    })
  )
}

function okBlock(doc: CommentDocument, id: string) {
  const block = doc.state.blocks.find(b => b.kind === 'ok' && b.data.id === id)
  if (!block || block.kind !== 'ok') throw new Error(`no ok block ${id}`)
  return block
}

function replace(bytes: Buffer, id: string, change: (data: CommentData) => CommentData): Buffer {
  return write(bytes, doc => {
    const block = okBlock(doc, id)
    return planReplace(doc, { id, rawHash: block.rawHash, data: change(block.data) })
  }).bytes
}

function remove(bytes: Buffer, id: string): Buffer {
  return write(bytes, doc => planDelete(doc, { block: { id }, rawHash: okBlock(doc, id).rawHash }))
    .bytes
}

const PAGE =
  '<!doctype html>\n<main>\n  <p>Text <em>inline</em> here.</p>\n  <button class="cta">Buy</button>\n</main>\n'

describe('placement', () => {
  it('U-040 line-start target → own lines and an unchanged target line; mid-line → no added whitespace', () => {
    const own = add(Buffer.from(PAGE), 'button', comment(1, 'button'), { ws: 'collapse' })
    const text = own.bytes.toString('utf8')
    expect(own.plan.placement).toBe('own-lines')
    expect(text).toContain('\n  -->\n  <button class="cta">Buy</button>\n')
    expect(text.split('\n')).toContain('  <button class="cta">Buy</button>')
    const mid = add(Buffer.from(PAGE), 'em', comment(2, 'em'), { ws: 'collapse' })
    expect(mid.plan.placement).toBe('mid-line')
    expect(mid.bytes.toString('utf8')).toContain('  --><em>inline</em>')
    const minified = '<main><p>one</p><button>Buy</button></main>'
    const flat = add(Buffer.from(minified), 'button', comment(3, 'button'), { ws: 'collapse' })
    expect(flat.plan.placement).toBe('mid-line')
    expect(flat.bytes.toString('utf8')).toContain('<p>one</p><!-- erfana:comment v1')
  })

  it('U-040 uses the target line’s own line break, else the file’s first, else LF', () => {
    expect(lineLayoutAt('a\r\n  <b>\nc', 5)).toEqual({ indent: '  ', atLineStart: true, eol: '\n' })
    expect(lineLayoutAt('a\r\n  <b>', 5)).toEqual({ indent: '  ', atLineStart: true, eol: '\r\n' })
    expect(lineLayoutAt('a\r<b>', 2)).toEqual({ indent: '', atLineStart: true, eol: '\r' })
    expect(lineLayoutAt('\t<b> x', 1)).toEqual({ indent: '\t', atLineStart: true, eol: '\n' })
    expect(lineLayoutAt('  x <b>\r\n', 4)).toEqual({
      indent: '  ',
      atLineStart: false,
      eol: '\r\n'
    })
    expect(lineLayoutAt(`${BOM}<b>`, 1, 1)).toEqual({ indent: '', atLineStart: true, eol: '\n' })
  })

  it('U-041 the parse5 DOM is unchanged apart from the comment and collapsible whitespace', () => {
    const html = readFileSync(join(CONTEXTS, 'flow.html'), 'utf8')
    const before = domSignature(html)
    const doc = analyzeCommentDocument(html)
    for (const el of doc.index.elements) {
      for (const ws of ['collapse', undefined]) {
        const plan = planInsert(doc, { targetStart: el.start, data: comment(4, el.tag), ws })
        if (!plan.ok) throw new Error(`${el.tag}: ${plan.reason}`)
        expect(domSignature(applySplice(html, plan.plan))).toEqual(before)
      }
    }
  })

  it('U-042 a line-start target inside <pre>, <listing> or <textarea> content is placed mid-line', () => {
    const html = readFileSync(join(CONTEXTS, 'flow.html'), 'utf8')
    const doc = analyzeCommentDocument(html)
    for (const tag of ['b', 'i', 'u']) {
      const el = elementOf(doc.index, tag)
      expect(el.preformatted).toBe(true)
      expect(lineLayoutAt(html, el.start).atLineStart).toBe(true)
      const plan = planInsert(doc, { targetStart: el.start, data: comment(5, tag), ws: 'collapse' })
      expect(plan.ok && plan.plan.placement).toBe('mid-line')
    }
  })

  it('U-043 a white-space-collapse other than "collapse" (or none) → mid-line', () => {
    const doc = analyzeCommentDocument(PAGE)
    const button = elementOf(doc.index, 'button')
    for (const ws of ['preserve', 'preserve-breaks', 'break-spaces', '', undefined]) {
      const plan = planInsert(doc, { targetStart: button.start, data: comment(6, 'button'), ws })
      expect(plan.ok && plan.plan.placement).toBe('mid-line')
    }
  })
})

describe('byte identity', () => {
  const original = Buffer.from(PAGE)

  it('U-050 add = input[0..o] + block + input[o..]', () => {
    const { bytes, plan } = add(original, 'button', comment(7, 'button'), { ws: 'collapse' })
    const o = PAGE.indexOf('<button')
    expect(bytes.subarray(0, o)).toEqual(original.subarray(0, o))
    expect(bytes.subarray(o + Buffer.byteLength(plan.insert))).toEqual(original.subarray(o))
  })

  it('U-051 an edit replaces only the block range', () => {
    const added = add(original, 'button', comment(8, 'button'), { ws: 'collapse' }).bytes
    const doc = analyzeCommentDocument(added.toString('utf8'))
    const [start, end] = okBlock(doc, fixedId('c-', 8)).nodeRange
    const edited = replace(added, fixedId('c-', 8), d =>
      editMessage(d, d.msgs[0].id, 'Edited.', LATER)!
    )
    expect(edited.subarray(0, start)).toEqual(added.subarray(0, start))
    expect(edited.subarray(edited.length - (added.length - end))).toEqual(added.subarray(end))
  })

  it('U-052 delete(add(f)) is byte-identical', () => {
    for (const ws of ['collapse', undefined]) {
      for (const tag of ['button', 'em', 'p']) {
        const added = add(original, tag, comment(9, tag), { ws }).bytes
        expect(remove(added, fixedId('c-', 9))).toEqual(original)
      }
    }
  })

  it('U-053 add → edit → reply → resolve → re-open → delete returns the original bytes', () => {
    const id = fixedId('c-', 10)
    const context = { author: GRACE, now: LATER, random: seededRandom(5) }
    let bytes = add(original, 'button', comment(10, 'button'), { ws: 'collapse' }).bytes
    bytes = replace(bytes, id, d => editMessage(d, d.msgs[0].id, 'Edited text', LATER)!)
    bytes = replace(bytes, id, d => addReply(d, 'A reply', context))
    bytes = replace(bytes, id, d => setStatus(d, 'resolved', context))
    bytes = replace(bytes, id, d =>
      setStatus(d, 'open', { ...context, author: ADA, now: FIXED_NOW })
    )
    expect(remove(bytes, id)).toEqual(original)
  })

  it('U-054 editing one of two blocks leaves the other identical', () => {
    let bytes = add(original, 'button', comment(11, 'button'), { ws: 'collapse' }).bytes
    bytes = add(bytes, 'em', comment(12, 'em')).bytes
    const doc = analyzeCommentDocument(bytes.toString('utf8'))
    const other = okBlock(doc, fixedId('c-', 12))
    const otherRaw = doc.text.slice(...other.nodeRange)
    const edited = replace(bytes, fixedId('c-', 11), d =>
      addReply(d, 'More', { author: ADA, now: LATER, random: seededRandom(1) })
    )
    const after = analyzeCommentDocument(edited.toString('utf8'))
    const again = okBlock(after, fixedId('c-', 12))
    expect(after.text.slice(...again.nodeRange)).toBe(otherRaw)
    expect(again.rawHash).toBe(other.rawHash)
  })

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR only', '\r']
  ])(
    'U-055 %s endings, no trailing newline and trailing whitespace survive add and delete',
    (_label, eol) => {
      const body = ['<main>  ', '  <h1>Title</h1>\t', '  <p>Para</p>', '</main>'].join(eol)
      const original = Buffer.from(body)
      for (const tag of ['h1', 'p']) {
        const added = add(original, tag, comment(13, tag), { ws: 'collapse' })
        expect(added.plan.insert.includes(eol)).toBe(true)
        expect(added.plan.insert.replaceAll(eol, '')).not.toMatch(/[\r\n]/)
        expect(remove(added.bytes, fixedId('c-', 13))).toEqual(original)
      }
    }
  )

  it('U-055 mixed line endings: the block uses its target line’s ending', () => {
    const mixed = Buffer.from('<main>\r\n  <h1>T</h1>\n  <p>P</p>\r\n</main>')
    const h1 = add(mixed, 'h1', comment(14, 'h1'), { ws: 'collapse' })
    expect(h1.plan.insert.includes('\r')).toBe(false)
    const p = add(mixed, 'p', comment(14, 'p'), { ws: 'collapse' })
    expect(p.plan.insert.split('\r\n').length).toBeGreaterThan(3)
    expect(remove(h1.bytes, fixedId('c-', 14))).toEqual(mixed)
    expect(remove(p.bytes, fixedId('c-', 14))).toEqual(mixed)
  })

  it('U-056 a BOM is kept; a file without one never gains one', () => {
    const withBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('<p>x</p>\r\n<b>y</b>\r\n')
    ])
    const added = add(withBom, 'p', comment(15, 'p'), { ws: 'collapse' }).bytes
    expect([...added.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(remove(added, fixedId('c-', 15))).toEqual(withBom)
    const noBom = add(original, 'p', comment(15, 'p')).bytes
    expect(noBom[0]).toBe(0x3c)
  })

  it('U-057 UTF-8 with a stray invalid byte is read-only and its bytes are untouched', () => {
    const broken = Buffer.concat([Buffer.from('<p>caf'), Buffer.from([0xe9]), Buffer.from('</p>')])
    const copy = Buffer.from(broken)
    expect(decodeLossless(broken)).toEqual({ ok: false, reason: 'invalid-utf8' })
    expect(broken).toEqual(copy)
  })

  it('U-058 UTF-16 LE/BE and windows-1252 are refused and left untouched', () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<p>x</p>', 'utf16le')])
    const be = Buffer.from([0xfe, 0xff, 0x00, 0x3c])
    const cp1252 = Buffer.from([0x3c, 0x70, 0x3e, 0x93, 0x71, 0x94, 0x3c])
    expect(decodeLossless(le)).toEqual({ ok: false, reason: 'utf16' })
    expect(decodeLossless(be)).toEqual({ ok: false, reason: 'utf16' })
    expect(decodeLossless(cp1252)).toEqual({ ok: false, reason: 'invalid-utf8' })
  })

  it('U-059 editing next to a damaged block leaves its bytes identical', () => {
    const html = readFileSync(join(COMPAT, 'c04-damaged-and-newer.html'))
    const doc = analyzeCommentDocument(html.toString('utf8'))
    const damaged = doc.state.blocks
      .filter(b => b.kind !== 'ok')
      .map(b => doc.text.slice(...b.nodeRange))
    const okId = doc.state.blocks.find(b => b.kind === 'ok')!
    const id = okId.kind === 'ok' ? okId.data.id : ''
    const edited = replace(html, id, d =>
      addReply(d, 'Next to damage', { author: ADA, now: LATER, random: seededRandom(2) })
    )
    const after = analyzeCommentDocument(edited.toString('utf8'))
    expect(
      after.state.blocks.filter(b => b.kind !== 'ok').map(b => after.text.slice(...b.nodeRange))
    ).toEqual(damaged)
  })

  it('U-060 an unchanged non-canonical block is never re-serialized', () => {
    const html = readFileSync(join(COMPAT, 'c03-other-writer.html'))
    const doc = analyzeCommentDocument(html.toString('utf8'))
    const [first, second] = doc.state.blocks
    const secondRaw = doc.text.slice(...second.nodeRange)
    const id = first.kind === 'ok' ? first.data.id : ''
    const edited = replace(html, id, d =>
      addReply(d, 'Reply', { author: ADA, now: LATER, random: seededRandom(4) })
    )
    expect(edited.toString('utf8')).toContain(secondRaw)
  })

  it('U-061 a hash precondition mismatch → stale, no output', () => {
    const added = add(original, 'button', comment(16, 'button'), { ws: 'collapse' }).bytes
    const doc = analyzeCommentDocument(added.toString('utf8'))
    const block = okBlock(doc, fixedId('c-', 16))
    expect(
      planReplace(doc, { id: block.data.id, rawHash: 'f'.repeat(64), data: block.data })
    ).toEqual({ ok: false, reason: 'stale' })
    expect(planDelete(doc, { block: { id: block.data.id }, rawHash: 'f'.repeat(64) })).toEqual({
      ok: false,
      reason: 'stale'
    })
  })
})

describe('plan refusals', () => {
  const html = readFileSync(join(COMPAT, 'c04-damaged-and-newer.html'), 'utf8')
  const doc = analyzeCommentDocument(html)

  it('never rewrites a damaged or newer block, but deletes a terminated damaged one whose bytes match', () => {
    const damaged = doc.state.blocks.find(
      b => b.kind === 'damaged' && b.reason === 'readable-mismatch'
    )!
    const headerId = damaged.kind === 'damaged' ? damaged.headerId! : ''
    expect(
      planReplace(doc, {
        id: headerId,
        rawHash: damaged.rawHash,
        data: makeComment({ id: headerId })
      })
    ).toEqual({
      ok: false,
      reason: 'not-editable'
    })
    const newer = doc.state.blocks.find(b => b.kind === 'newer')!
    expect(
      planDelete(doc, { block: { start: newer.nodeRange[0] }, rawHash: newer.rawHash })
    ).toEqual({
      ok: false,
      reason: 'not-editable'
    })
    const del = planDelete(doc, {
      block: { start: damaged.nodeRange[0] },
      rawHash: damaged.rawHash
    })
    expect(del.ok).toBe(true)
    if (del.ok) {
      expect(verifyCommentSplice(doc, applySplice(html, del.plan), del.plan)).toMatchObject({
        ok: true
      })
      expect(del.plan.end - del.plan.start).toBe(damaged.range[1] - damaged.range[0])
    }
  })

  it('refuses unknown blocks, a wrong id and a read-only file', () => {
    expect(planReplace(doc, { id: fixedId('c-', 31), rawHash: '', data: makeComment() })).toEqual({
      ok: false,
      reason: 'not-found'
    })
    expect(planDelete(doc, { block: { start: 3 }, rawHash: '' })).toEqual({
      ok: false,
      reason: 'not-found'
    })
    const ok = doc.state.blocks.find(b => b.kind === 'ok')!
    const okId = ok.kind === 'ok' ? ok.data.id : ''
    expect(
      planReplace(doc, {
        id: okId,
        rawHash: ok.rawHash,
        data: makeComment({ id: fixedId('c-', 32) })
      })
    ).toEqual({
      ok: false,
      reason: 'invalid'
    })
    const locked = analyzeCommentDocument(
      readFileSync(join(COMPAT, 'c06-conflict-hunk.html'), 'utf8')
    )
    const any = locked.state.blocks[0]
    expect(
      planDelete(locked, { block: { start: any.nodeRange[0] }, rawHash: any.rawHash })
    ).toEqual({ ok: false, reason: 'read-only' })
    expect(planReplace(locked, { id: 'x', rawHash: any.rawHash, data: makeComment() })).toEqual({
      ok: false,
      reason: 'read-only'
    })
    expect(
      planInsert(analyzeCommentDocument(PAGE), { targetStart: 1, data: makeComment() })
    ).toEqual({ ok: false, reason: 'not-eligible' })
  })

  it('refuses invalid data and a file already at the block cap', () => {
    const page = analyzeCommentDocument(PAGE)
    const button = elementOf(page.index, 'button').start
    expect(planInsert(page, { targetStart: button, data: makeComment({ id: 'c-x' }) })).toEqual({
      ok: false,
      reason: 'invalid'
    })
    const ok = doc.state.blocks.find(b => b.kind === 'ok')!
    const okId = ok.kind === 'ok' ? ok.data.id : ''
    expect(
      planReplace(doc, {
        id: okId,
        rawHash: ok.rawHash,
        data: makeComment({ id: okId, status: 'resolved' })
      })
    ).toEqual({
      ok: false,
      reason: 'invalid'
    })
    const full: CommentDocument = { ...page, state: { ...page.state, blocks: Array(500).fill(ok) } }
    expect(planInsert(full, { targetStart: button, data: makeComment() })).toEqual({
      ok: false,
      reason: 'limit'
    })
  })
})

describe('verification', () => {
  const doc = analyzeCommentDocument(PAGE)
  const button = elementOf(doc.index, 'button').start
  const planned = planInsert(doc, {
    targetStart: button,
    data: comment(40, 'button'),
    ws: 'collapse'
  })
  if (!planned.ok) throw new Error(planned.reason)
  const plan = planned.plan
  const good = applySplice(PAGE, plan)

  it('verifySplice is exact', () => {
    expect(verifySplice(PAGE, good, plan)).toBe(true)
    expect(verifySplice(PAGE, good + ' ', plan)).toBe(false)
    expect(verifySplice(PAGE, good.replace('Buy', 'Bye'), plan)).toBe(false)
    expect(verifySplice(PAGE, 'x' + good.slice(1), plan)).toBe(false)
  })

  it('verifySpliceBytes is exact', () => {
    const bytes = Buffer.from(PAGE)
    const out = Buffer.from(spliceBytes(bytes, PAGE, plan))
    expect(verifySpliceBytes(bytes, out, PAGE, plan)).toBe(true)
    const tampered = [Buffer.concat([out, Buffer.from(' ')]), Buffer.from(out).fill(0x20, 0, 1)]
    const inBlock = Buffer.from(out)
    inBlock[button + 10] = 0x21
    const after = Buffer.from(out)
    after[after.length - 2] = 0x21
    for (const bad of [...tampered, inBlock, after])
      expect(verifySpliceBytes(bytes, bad, PAGE, plan)).toBe(false)
  })

  it('fails closed when the result is not exactly one well-formed block more', () => {
    expect(verifyCommentSplice(doc, good + 'x', plan)).toEqual({ ok: false, reason: 'bytes' })
    const twoBlocks: SplicePlan = { ...plan, insert: plan.insert + plan.insert }
    expect(verifyCommentSplice(doc, applySplice(PAGE, twoBlocks), twoBlocks)).toEqual({
      ok: false,
      reason: 'block-count'
    })
    const extraComment: SplicePlan = { ...plan, insert: plan.insert + '<!-- note -->' }
    expect(verifyCommentSplice(doc, applySplice(PAGE, extraComment), extraComment)).toEqual({
      ok: false,
      reason: 'comment-count'
    })
    const breakout: SplicePlan = {
      ...plan,
      insert: plan.insert.replace('-->', '--><script>alert(1)</script><!--x-->')
    }
    expect(verifyCommentSplice(doc, applySplice(PAGE, breakout), breakout).ok).toBe(false)
    const element: SplicePlan = { ...plan, insert: plan.insert + '<i></i>' }
    expect(verifyCommentSplice(doc, applySplice(PAGE, element), element)).toEqual({
      ok: false,
      reason: 'elements'
    })
    const wrongData: SplicePlan = { ...plan, data: comment(41, 'button') }
    expect(verifyCommentSplice(doc, good, wrongData)).toEqual({ ok: false, reason: 'block-data' })
    const shifted: SplicePlan = {
      ...plan,
      data: comment(40, 'button'),
      insert: ' ' + plan.insert,
      start: plan.start
    }
    expect(verifyCommentSplice(doc, applySplice(PAGE, shifted), shifted)).toEqual({
      ok: false,
      reason: 'block-data'
    })
  })
})
