// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * CommentWriter byte identity and damaged blocks, on real files
 * (docs/designs/comments/html-preview-comments.md decision 12, decision 24, §7.6
 * steps 4–8; SEC-14, SEC-17, M-020).
 *
 * Every check reads the bytes back from disk and compares them byte for byte
 * – through the parsed block range, and through an independent prefix/suffix
 * oracle that does not use the splice code.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import { decodeLossless, serializeBlock, type ParsedBlock } from '../../../shared/htmlComments'
import { BOM, fixedId, makeComment } from '../../../shared/comments/__fixtures__/commentTestData'
import {
  PAGE,
  VIEW,
  blocksOf,
  byId,
  byTag,
  draftFor,
  makeProject,
  makeWriter,
  okBlock,
  snapshot,
  type ElementPick,
  type TempProject
} from '../preview/comments/__test-helpers__/commentWriterHarness'
import type { CommentWriteResult } from './CommentWriter'

let project: TempProject

beforeEach(async () => {
  project = await makeProject()
})

afterEach(async () => {
  await project.dispose()
})

function threadIdOf(result: CommentWriteResult): string {
  if (!result.ok || result.threadId === null) throw new Error(`write failed: ${JSON.stringify(result)}`)
  return result.threadId
}

/** UTF-8 byte range of a decoded-text range of `bytes`. */
function byteRange(bytes: Buffer, range: readonly [number, number]): [number, number] {
  const decoded = decodeLossless(bytes)
  if (!decoded.ok) throw new Error('not UTF-8')
  const start = Buffer.byteLength(decoded.text.slice(0, range[0]), 'utf8')
  return [start, start + Buffer.byteLength(decoded.text.slice(range[0], range[1]), 'utf8')]
}

/** `bytes` without the byte range of `range`. */
function without(bytes: Buffer, range: readonly [number, number]): Buffer {
  const [start, end] = byteRange(bytes, range)
  return Buffer.concat([bytes.subarray(0, start), bytes.subarray(end)])
}

/** Independent oracle: `after` is `before` with ONE contiguous run of bytes inserted. */
function expectOneInsertion(before: Buffer, after: Buffer): void {
  let prefix = 0
  while (prefix < before.length && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1
  }
  expect(after.length).toBeGreaterThan(before.length)
  expect(prefix + suffix).toBe(before.length)
}

async function addOn(rel: string, pick: ElementPick, ws?: string): Promise<CommentWriteResult> {
  const bytes = await project.read(rel)
  return makeWriter().writer.add({
    file: project.target(rel),
    draft: { ...draftFor(bytes, pick), ...(ws === undefined ? {} : { ws }) },
    view: VIEW,
    text: 'Line one\nline two'
  })
}

async function deleteThread(rel: string, threadId: string): Promise<CommentWriteResult> {
  const bytes = await project.read(rel)
  return makeWriter().writer.changeThread({
    file: project.target(rel),
    threadId,
    rawHash: okBlock(bytes, threadId).rawHash,
    change: { op: 'deleteThread' }
  })
}

const LF = PAGE
const CRLF = PAGE.replace(/\n/g, '\r\n')
/** LF, CRLF and CR-only lines in one file; the button line ends in CRLF. */
const MIXED = PAGE.split('\n')
  .map((line, i) => (i === 6 ? `${line}\r\n` : i % 3 === 0 ? `${line}\r` : `${line}\n`))
  .join('')

describe('SEC-14 byte identity', () => {
  it.each([
    ['LF', Buffer.from(LF), '\n'],
    ['CRLF', Buffer.from(CRLF), '\r\n'],
    ['mixed LF/CRLF/CR', Buffer.from(MIXED), '\r\n'],
    ['BOM + CRLF', Buffer.from(BOM + CRLF), '\r\n'],
    ['BOM + LF, no trailing newline', Buffer.from(BOM + LF.trimEnd()), '\n']
  ])('SEC-14 %s: add changes only the block, in the line’s own line break; delete restores every byte', async (_name, original, eol) => {
    await project.write('page.html', original)

    const added = await addOn('page.html', byId('buy'))

    const after = await project.read('page.html')
    const block = okBlock(after, threadIdOf(added))
    expectOneInsertion(original, after)
    expect(without(after, block.range).equals(original)).toBe(true)
    const [start, end] = byteRange(after, block.range)
    const inserted = after.subarray(start, end).toString('utf8')
    expect(inserted.split(eol).join('')).not.toMatch(/[\r\n]/)
    expect(after.subarray(0, 3).equals(Buffer.from(BOM)) === original.subarray(0, 3).equals(Buffer.from(BOM))).toBe(true)

    expect(await deleteThread('page.html', block.data.id)).toMatchObject({ ok: true, threadId: null })
    expect((await project.read('page.html')).equals(original)).toBe(true)
  })

  it('SEC-14 a mid-line target and a missing white-space report add no whitespace at all', async () => {
    const original = Buffer.from(CRLF)
    await project.write('page.html', original)

    const midLine = await addOn('page.html', byTag('em'))
    const after = await project.read('page.html')
    const block = okBlock(after, threadIdOf(midLine))
    expect(after.toString('utf8').slice(block.range[1], block.range[1] + 4)).toBe('<em>')
    expect(without(after, block.range).equals(original)).toBe(true)

    await project.write('other.html', original)
    const noWs = await addOn('other.html', byId('buy'), 'preserve')
    const other = await project.read('other.html')
    const otherBlock = okBlock(other, threadIdOf(noWs))
    expect(other.toString('utf8').slice(otherBlock.range[1], otherBlock.range[1] + 7)).toBe('<button')
    expect(without(other, otherBlock.range).equals(original)).toBe(true)
  })

  it.each([
    ['UTF-16 LE with BOM', Buffer.from([0xff, 0xfe, 0x3c, 0x00, 0x70, 0x00, 0x3e, 0x00])],
    ['UTF-16 BE with BOM', Buffer.from([0xfe, 0xff, 0x00, 0x3c, 0x00, 0x70, 0x00, 0x3e])],
    ['invalid UTF-8', Buffer.concat([Buffer.from(PAGE), Buffer.from([0xc3, 0x28])])],
    ['windows-1252 bytes', Buffer.from(PAGE.replace('Buy now', `Caf${String.fromCharCode(0xe9)}`), 'latin1')],
    ['a declared legacy charset', Buffer.from(PAGE.replace('charset="utf-8"', 'charset="windows-1252"'))],
    ['NUL bytes', Buffer.concat([Buffer.from(PAGE), Buffer.from([0x00])])]
  ])('SEC-14 %s is refused with COMMENT_ENCODING_UNSUPPORTED and keeps every byte', async (_name, bytes) => {
    const path = await project.write('page.html', bytes)
    const before = await snapshot(path)
    const writer = makeWriter().writer

    const result = await writer.add({
      file: project.target('page.html'),
      draft: draftFor(Buffer.from(PAGE), byId('buy')),
      view: VIEW,
      text: 'x'
    })

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_ENCODING_UNSUPPORTED, reason: 'encoding' })
    expect(await snapshot(path)).toEqual(before)
  })
})

/** One serialized block for `n`, laid out on its own lines at `indent` (LF). */
function blockText(n: number, indent = '    '): string {
  const result = serializeBlock(makeComment({ id: fixedId('c-', n) }), { indent, eol: '\n' })
  if (!result.ok) throw new Error('fixture block')
  return result.block
}

/** A block whose `@data` JSON is broken (`bad-json`). */
const badJson = (n: number): string => blockText(n).replace('@data {', '@data {{')
/** A block a merge went through: a conflict-marker line inside, no complete hunk in the file. */
const markerInside = (n: number): string => blockText(n).replace('\n    status:', '\n<<<<<<< HEAD\n    status:')

/** PAGE with `blocks` on their own lines right before the button. */
function pageWithBlocks(...blocks: string[]): string {
  return PAGE.replace('    <button', `${blocks.map(b => `    ${b.trimStart()}\n`).join('')}    <button`)
}

function damaged(bytes: Buffer): Array<Extract<ParsedBlock, { kind: 'damaged' }>> {
  return blocksOf(bytes).filter((b): b is Extract<ParsedBlock, { kind: 'damaged' }> => b.kind === 'damaged')
}

describe('SEC-17 damaged and conflicted blocks are never rewritten', () => {
  it('SEC-17 add, reply, edit and delete next to a damaged and a merge-damaged block leave both byte-identical', async () => {
    const broken = badJson(1)
    const merged = markerInside(2)
    const ok = blockText(3)
    await project.write('page.html', pageWithBlocks(broken, ok, merged))
    expect(damaged(await project.read('page.html')).map(b => b.reason)).toEqual(['bad-json', 'conflict-marker'])
    const writer = makeWriter().writer
    const okId = fixedId('c-', 3)
    const change = async (c: Parameters<typeof writer.changeThread>[0]['change']) =>
      writer.changeThread({
        file: project.target('page.html'),
        threadId: okId,
        rawHash: okBlock(await project.read('page.html'), okId).rawHash,
        change: c
      })

    expect(await addOn('page.html', byId('buy'))).toMatchObject({ ok: true })
    expect(await change({ op: 'reply', text: 'Next to damage.' })).toMatchObject({ ok: true })
    expect(await change({ op: 'setStatus', status: 'resolved' })).toMatchObject({ ok: true })
    const text = (await project.read('page.html')).toString('utf8')
    expect(text.split(broken.trimStart())).toHaveLength(2)
    expect(text.split(merged.trimStart())).toHaveLength(2)
    expect(await change({ op: 'deleteThread' })).toMatchObject({ ok: true })

    const after = await project.read('page.html')
    expect(damaged(after).map(b => b.reason)).toEqual(['bad-json', 'conflict-marker'])
    expect(after.toString('utf8')).toContain(broken.trimStart())
    expect(after.toString('utf8')).toContain(merged.trimStart())
  })

  it('SEC-17 a damaged block cannot be edited by its id: COMMENT_BLOCK_CHANGED, nothing written', async () => {
    await project.write('page.html', pageWithBlocks(badJson(1)))
    const before = await snapshot(project.path('page.html'))
    const [block] = damaged(before.bytes)

    const result = await makeWriter().writer.changeThread({
      file: project.target('page.html'),
      threadId: fixedId('c-', 1),
      rawHash: block.rawHash,
      change: { op: 'reply', text: 'x' }
    })

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED, reason: 'block-changed' })
    expect(await snapshot(project.path('page.html'))).toEqual(before)
  })

  it('SEC-17 a file with a complete conflict hunk is read-only: COMMENT_FILE_CONFLICTED for every operation', async () => {
    const ok = blockText(3)
    const conflicted = pageWithBlocks(ok).replace(
      '    <section',
      '<<<<<<< HEAD\n    <p>ours</p>\n=======\n    <p>theirs</p>\n>>>>>>> feature\n    <section'
    )
    await project.write('page.html', conflicted)
    const before = await snapshot(project.path('page.html'))
    const writer = makeWriter().writer

    const added = await addOn('page.html', byId('buy'))
    const deleted = await writer.changeThread({
      file: project.target('page.html'),
      threadId: fixedId('c-', 3),
      rawHash: okBlock(before.bytes, fixedId('c-', 3)).rawHash,
      change: { op: 'deleteThread' }
    })

    for (const result of [added, deleted]) {
      expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_FILE_CONFLICTED, reason: 'conflict-markers' })
    }
    expect(await snapshot(project.path('page.html'))).toEqual(before)
  })
})

describe('M-020 deleting a damaged block', () => {
  it('M-020 removes exactly the range of a terminated damaged block and nothing else', async () => {
    const original = Buffer.from(pageWithBlocks(blockText(3)))
    await project.write('page.html', pageWithBlocks(badJson(1), blockText(3)))
    const [block] = damaged(await project.read('page.html'))

    const result = await makeWriter().writer.deleteDamagedBlock({
      file: project.target('page.html'),
      rawHash: block.rawHash
    })

    expect(result).toMatchObject({ ok: true, threadId: null })
    expect((await project.read('page.html')).equals(original)).toBe(true)
  })

  it('M-020 picks one of two identical damaged blocks only by its start offset', async () => {
    await project.write('page.html', pageWithBlocks(badJson(1), badJson(1)))
    const blocks = damaged(await project.read('page.html'))
    const writer = makeWriter().writer
    const file = project.target('page.html')

    const ambiguous = await writer.deleteDamagedBlock({ file, rawHash: blocks[0].rawHash })
    const second = await writer.deleteDamagedBlock({
      file,
      rawHash: blocks[1].rawHash,
      start: blocks[1].nodeRange[0]
    })

    expect(ambiguous).toEqual({ ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED, reason: 'block-changed' })
    expect(second).toMatchObject({ ok: true })
    expect((await project.read('page.html')).toString('utf8')).toBe(pageWithBlocks(badJson(1)))
  })

  it('M-020 refuses a damaged block whose bytes changed, an ok block and a newer-version block', async () => {
    const newer = blockText(4).replace('erfana:comment v1', 'erfana:comment v2')
    await project.write('page.html', pageWithBlocks(badJson(1), blockText(3), newer))
    const before = await snapshot(project.path('page.html'))
    const blocks = blocksOf(before.bytes)
    expect(blocks.map(b => b.kind)).toEqual(['damaged', 'ok', 'newer'])
    const writer = makeWriter().writer
    const file = project.target('page.html')

    const results = [
      await writer.deleteDamagedBlock({ file, rawHash: 'f'.repeat(64) }),
      await writer.deleteDamagedBlock({ file, rawHash: blocks[1].rawHash }),
      await writer.deleteDamagedBlock({ file, rawHash: blocks[2].rawHash, start: blocks[2].nodeRange[0] })
    ]

    for (const result of results) {
      expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED, reason: 'block-changed' })
    }
    expect(await snapshot(project.path('page.html'))).toEqual(before)
  })

  it('M-020 an unterminated block makes the file read-only: its deletion is refused and nothing is written', async () => {
    const cut = `${PAGE.replace('    <button', `    ${blockText(1).slice(0, -3)}\n    <button`)}`
    await project.write('page.html', cut)
    const before = await snapshot(project.path('page.html'))
    const [block] = damaged(before.bytes)
    expect(block.reason).toBe('unterminated')

    const result = await makeWriter().writer.deleteDamagedBlock({
      file: project.target('page.html'),
      rawHash: block.rawHash
    })

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_FILE_READ_ONLY, reason: 'unterminated-block' })
    expect(await snapshot(project.path('page.html'))).toEqual(before)
  })
})
