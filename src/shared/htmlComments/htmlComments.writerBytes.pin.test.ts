// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Writer byte pins (spec 024, 024-FR-020; architecture note
 * specs/spec-t3-024-unified-comments/architecture/001-shared-comment-base.md
 * § 6 commit 4, § 8 C26).
 *
 * INVARIANT PINS – never updated. They freeze what the v0.23.1 write path puts
 * on disk for one page saved four ways (LF, CRLF, mixed line endings, a UTF-8
 * BOM): add a thread on its own lines, add one mid-line, reply, resolve, delete
 * one thread, delete the other. Every step runs the shipped planner on the
 * bytes exactly as the writer does – decode losslessly, plan on the text,
 * splice the original bytes, verify – with a fixed clock, fixed authors and a
 * seeded random source, so the output is the same on every machine.
 *
 * The expected bytes live in `__fixtures__/pins/` (`-text` in .gitattributes,
 * so git never converts them). A failure here means the refactor changed what
 * Erfana writes into a user's file: fix the code, never the fixture.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ADA, FIXED_NOW, GRACE, LATER, VIEW, elementOf, seededRandom } from './__fixtures__/commentTestData'
import { decodeLossless } from './encoding'
import type { CommentAnchor, CommentData } from './format'
import { analyzeCommentDocument, type CommentDocument } from './parse'
import {
  applySplice,
  planDelete,
  planInsert,
  planReplace,
  spliceBytes,
  verifyCommentSplice,
  verifySpliceBytes,
  type PlanResult
} from './splice'
import { addReply, createThread, setStatus } from './thread'

const PINS = join(__dirname, '__fixtures__', 'pins')
const ROOT = join(__dirname, '..', '..', '..')

/** The four ways the same page is saved. */
const PIN_CASES = ['lf', 'crlf', 'mixed', 'bom'] as const
type PinCase = (typeof PIN_CASES)[number]

/** The write steps, in order; each file holds the bytes after its step. */
const PIN_STEPS = ['1-add-own', '2-add-mid', '3-reply', '4-resolve', '5-delete-mid'] as const
type PinStep = (typeof PIN_STEPS)[number]

const BUTTON: CommentAnchor = {
  tag: 'button',
  cls: ['cta'],
  path: 'html > body > main:nth-of-type(1) > button:nth-of-type(1)',
  quote: { exact: 'Buy now', prefix: 'start at 5 €.', suffix: '' }
}

const EM: CommentAnchor = {
  tag: 'em',
  path: 'html > body > main:nth-of-type(1) > p:nth-of-type(1) > em:nth-of-type(1)',
  quote: { exact: 'start', prefix: 'Plans', suffix: 'at 5 €.' }
}

/** Thread 1 (own lines, on the button): non-ASCII text, so UTF-8 encoding is pinned too. */
const FIRST = createThread({
  anchor: BUTTON,
  view: VIEW,
  text: 'Make this button bigger – “Buy now” reads café-small. ✓',
  context: { author: ADA, now: FIXED_NOW, random: seededRandom(1) }
})

/** Thread 2 (mid-line, on the inline `<em>`). */
const SECOND = createThread({
  anchor: EM,
  view: VIEW,
  text: 'Is “start” the right verb here?',
  context: { author: GRACE, now: FIXED_NOW, random: seededRandom(2) }
})

/** The input file of `name`, as committed. */
function pinInput(name: PinCase): Buffer {
  return readFileSync(join(PINS, `${name}.input.html`))
}

/** Decode, plan, splice the bytes and verify – the writer's path, without the disk. */
function write(bytes: Buffer, makePlan: (doc: CommentDocument) => PlanResult): Buffer {
  const decoded = decodeLossless(bytes)
  if (!decoded.ok) throw new Error(`decode: ${decoded.reason}`)
  const doc = analyzeCommentDocument(decoded.text)
  const result = makePlan(doc)
  if (!result.ok) throw new Error(`plan: ${result.reason}`)
  const out = Buffer.from(spliceBytes(bytes, decoded.text, result.plan))
  expect(verifySpliceBytes(bytes, out, decoded.text, result.plan)).toBe(true)
  expect(verifyCommentSplice(doc, applySplice(decoded.text, result.plan), result.plan)).toMatchObject({ ok: true })
  return out
}

function okBlock(doc: CommentDocument, id: string) {
  const block = doc.state.blocks.find(b => b.kind === 'ok' && b.data.id === id)
  if (!block || block.kind !== 'ok') throw new Error(`no ok block ${id}`)
  return block
}

function add(bytes: Buffer, tag: string, data: CommentData, ws?: string): Buffer {
  return write(bytes, doc => planInsert(doc, { targetStart: elementOf(doc.index, tag).start, data, ws }))
}

function replace(bytes: Buffer, id: string, change: (data: CommentData) => CommentData): Buffer {
  return write(bytes, doc => {
    const block = okBlock(doc, id)
    return planReplace(doc, { id, rawHash: block.rawHash, data: change(block.data) })
  })
}

function remove(bytes: Buffer, id: string): Buffer {
  return write(bytes, doc => planDelete(doc, { block: { id }, rawHash: okBlock(doc, id).rawHash }))
}

/** Every step's output for one input, in {@link PIN_STEPS} order, then the final delete. */
function runChain(input: Buffer): { steps: Record<PinStep, Buffer>; last: Buffer } {
  const reply = { author: GRACE, now: LATER, random: seededRandom(3) }
  const own = add(input, 'button', FIRST, 'collapse')
  const mid = add(own, 'em', SECOND)
  const replied = replace(mid, FIRST.id, d => addReply(d, 'Agreed – and make it blue.', reply))
  const resolved = replace(replied, FIRST.id, d => setStatus(d, 'resolved', reply))
  const midGone = remove(resolved, SECOND.id)
  return {
    steps: {
      '1-add-own': own,
      '2-add-mid': mid,
      '3-reply': replied,
      '4-resolve': resolved,
      '5-delete-mid': midGone
    },
    last: remove(midGone, FIRST.id)
  }
}

const expected = (name: PinCase, step: PinStep): Buffer => readFileSync(join(PINS, `${name}.${step}.html`))

describe('writer byte pins (invariant)', () => {
  it.each(PIN_CASES)('PIN-W-001 %s: every write step produces exactly its committed bytes', name => {
    const { steps } = runChain(pinInput(name))
    for (const step of PIN_STEPS) {
      // Compared as Buffers, so a diff shows the first differing byte.
      expect(steps[step], `${name}.${step}`).toEqual(expected(name, step))
    }
  })

  it.each(PIN_CASES)('PIN-W-002 %s: deleting both threads returns the original bytes', name => {
    expect(runChain(pinInput(name)).last).toEqual(pinInput(name))
  })

  it.each(PIN_CASES)('PIN-W-003 %s: delete right after add returns the original bytes', name => {
    const input = pinInput(name)
    expect(remove(add(input, 'button', FIRST, 'collapse'), FIRST.id)).toEqual(input)
    expect(remove(add(input, 'em', SECOND), SECOND.id)).toEqual(input)
  })

  it('PIN-W-004 each input file has the line endings and BOM its case names', () => {
    const text = (name: PinCase): string => pinInput(name).toString('latin1')
    expect(text('lf')).not.toContain('\r')
    expect(text('crlf').replaceAll('\r\n', '')).not.toMatch(/[\r\n]/)
    expect(text('mixed')).toContain('\r\n')
    expect(text('mixed').replaceAll('\r\n', '')).toContain('\n')
    expect([...pinInput('bom').subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    for (const name of ['lf', 'crlf', 'mixed'] as const) expect(pinInput(name)[0]).toBe(0x3c)
  })

  it('PIN-W-005 each own-lines block takes its target line’s ending; the BOM stays first', () => {
    const own = (name: PinCase): string => runChain(pinInput(name)).steps['1-add-own'].toString('latin1')
    expect(own('lf')).not.toContain('\r')
    expect(own('crlf').replaceAll('\r\n', '')).not.toMatch(/[\r\n]/)
    // In the mixed file the button's line ends in CRLF: the whole block uses CRLF.
    const mixed = own('mixed')
    const block = mixed.slice(mixed.indexOf('<!-- erfana:comment'), mixed.indexOf('<button'))
    expect(block.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/)
    expect(block).toContain('\r\n')
    expect([...runChain(pinInput('bom')).steps['1-add-own'].subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  })

  it('PIN-W-006 the pins folder holds exactly the inputs and step files, nothing else', () => {
    const want = PIN_CASES.flatMap(name => [`${name}.input.html`, ...PIN_STEPS.map(step => `${name}.${step}.html`)])
    expect(readdirSync(PINS).sort()).toEqual(want.sort())
  })

  it('PIN-W-007 git keeps the pin files’ bytes (`-text`, no line-ending conversion)', () => {
    const file = relative(ROOT, join(PINS, 'crlf.input.html')).replaceAll('\\', '/')
    const out = execFileSync('git', ['check-attr', 'text', '--', file], { cwd: ROOT, encoding: 'utf8' })
    expect(out.trim()).toBe(`${file}: text: unset`)
  })
})
