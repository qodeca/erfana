// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * 024-AC-015: outside damage (024-FR-014). Each fixture in
 * `__fixtures__/outside/` is `original.md` after one outside tool, made once
 * with the command in that folder's README and the tool versions of
 * `verification/outside-tools.md`. Each test first checks its own
 * precondition – the block really differs from the original, or really
 * does not – then the state Erfana shows: `ok` where the tool left the block
 * readable, Damaged otherwise, and gone (the removed-outside note) where a
 * re-indent turned it into code. Rebuild from data is offered only where the
 * `@data` line is still valid. Reading never changes a byte.
 *
 * `MD_OUTSIDE_WRITE=1` writes `original.md` again (the derived files are made
 * from it by the README's commands).
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CommentDataSchema } from '../comments/format'
import { parseDataJson, type ParsedBlock } from '../comments/blocks'
import { decodeLossless, encodeText } from '../comments/encoding'
import { addComment, parseMd, pickOf, targetBy, written } from './__test-helpers__/mdHarness'

const FOLDER = join(__dirname, '__fixtures__', 'outside')

const BEFORE = [
  '# Release notes',
  '',
  'The release ships when every check is green and the release notes are written, reviewed and published on the website.',
  '',
  '- Freeze the API on Monday.',
  '- Run the load test against staging and record the numbers in the shared sheet for the whole team.',
  ''
].join('\n')

function original(): string {
  const doc = parseMd(BEFORE)
  const first = written(addComment(BEFORE, pickOf(doc, targetBy(doc, 'paragraph', 'release ships')), 'Name the checks.', { seed: 51 }))
  const next = parseMd(first.text)
  return written(addComment(first.text, pickOf(next, targetBy(next, 'item', 'load test')), 'Use production-sized data.', { seed: 52 })).text
}

if (process.env.MD_OUTSIDE_WRITE === '1') writeFileSync(join(FOLDER, 'original.md'), encodeText(original()))

const read = (name: string): { bytes: Buffer; text: string } => {
  const bytes = readFileSync(join(FOLDER, name))
  const decoded = decodeLossless(new Uint8Array(bytes))
  if (!decoded.ok) throw new Error(decoded.reason)
  return { bytes, text: decoded.text }
}

/** Each block's raw text, from `<!--` to its close. */
const rawBlocks = (text: string): string[] => parseMd(text).state.blocks.map(b => text.slice(b.nodeRange[0], b.nodeRange[1]))

/** True when the block's `@data` line is still valid – the condition for Rebuild from data. */
function dataValid(text: string, block: ParsedBlock): boolean {
  const raw = text.slice(block.nodeRange[0], block.nodeRange[1])
  const line = raw.split(/\r\n|\r|\n/).find(l => l.trimStart().startsWith('@data '))
  if (line === undefined) return false
  try {
    return CommentDataSchema.safeParse(parseDataJson(line.trimStart().slice('@data '.length))).success
  } catch {
    return false
  }
}

const stateOf = (block: ParsedBlock): string =>
  block.kind === 'ok' ? `ok ${block.target.state}` : block.kind === 'damaged' ? `damaged ${block.reason}` : block.kind

interface Expected {
  /** The tool changes the blocks' bytes (precondition). */
  readonly blocksDiffer: boolean
  /** The tool changes the file at all; absent: it does. */
  readonly fileDiffers?: false
  /** Each block's state, in file order. */
  readonly states: readonly string[]
  /** Rebuild from data offered, per damaged block. */
  readonly rebuild?: readonly boolean[]
  readonly readOnly?: string
}

/** The expected state per tool – `verification/outside-tools.md` § Results. */
const EXPECTED: Record<string, Expected> = {
  'prettier-prose-always.md': { blocksDiffer: false, states: ['ok attached', 'ok attached'] },
  'git-autocrlf.md': { blocksDiffer: true, states: ['ok attached', 'ok attached'] },
  // Erfana writes no line ending in a blank, so trimming changes nothing at all.
  'trailing-trimmed.md': { blocksDiffer: false, fileDiffers: false, states: ['ok attached', 'ok attached'] },
  'reindent-4-top.md': { blocksDiffer: true, states: ['ok attached'] },
  // Differs from the recorded row ("list → code"): Erfana writes item n's block right after item
  // n − 1's paragraph, with no blank line, and indented code cannot interrupt a paragraph – so the
  // re-indented block is an inline comment in that paragraph, still readable and attached.
  'reindent-4-list.md': { blocksDiffer: true, states: ['ok attached', 'ok attached'] },
  'deleted-status-line.md': { blocksDiffer: true, states: ['damaged readable-mismatch', 'ok attached'], rebuild: [true] },
  'deleted-data-line.md': { blocksDiffer: true, states: ['damaged no-data', 'ok attached'], rebuild: [false] },
  // The @data line survives the hunk, but the file is read-only until the conflict is resolved.
  'conflict-markers.md': { blocksDiffer: true, states: ['damaged conflict-marker', 'ok attached'], rebuild: [true], readOnly: 'conflict-markers' }
}

describe('024-AC-015 outside damage', () => {
  const base = read('original.md')

  it('024-AC-015 original.md is what Erfana writes: two blocks, both ok and attached', () => {
    expect(base.text).toBe(original())
    expect(parseMd(base.text).state.blocks.map(stateOf)).toEqual(['ok attached', 'ok attached'])
  })

  it.each(Object.entries(EXPECTED))('024-AC-015 %s shows the recorded state, and reading changes nothing', (name, expected) => {
    const fixture = read(name)
    // Precondition: the tool really changed the file, and the blocks exactly as recorded.
    expect(fixture.text !== base.text, 'the file differs from the original').toBe(expected.fileDiffers ?? true)
    const same = JSON.stringify(rawBlocks(fixture.text)) === JSON.stringify(rawBlocks(base.text))
    expect(same, 'blocks differ from the original').toBe(!expected.blocksDiffer)

    const hash = createHash('sha256').update(fixture.bytes).digest('hex')
    const doc = parseMd(fixture.text)
    expect(doc.state.blocks.map(stateOf)).toEqual(expected.states)
    const damaged = doc.state.blocks.filter(b => b.kind === 'damaged')
    expect(damaged.map(b => dataValid(fixture.text, b))).toEqual(expected.rebuild ?? [])
    expect(doc.state.readOnlyReason).toBe(expected.readOnly)
    expect(createHash('sha256').update(readFileSync(join(FOLDER, name))).digest('hex')).toBe(hash)
  })

  it('024-AC-015 a re-indent that turns a block into code removes it without damage (the removed-outside note)', () => {
    const doc = parseMd(read('reindent-4-top.md').text)
    expect(doc.state.blocks).toHaveLength(1)
    expect(doc.state.blocks.every(b => b.kind === 'ok')).toBe(true)
    expect(doc.index.elements.some(t => t.tag === 'pre')).toBe(true)
  })
})
