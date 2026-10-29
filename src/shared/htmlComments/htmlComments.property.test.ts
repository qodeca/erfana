// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Property tests for the comment format (docs/designs/comments/html-preview-comments.md
 * §17, P-001–P-007). P-003 is the proof of decision 24: adding a comment never
 * changes a byte outside the inserted range, and removing it gives the file
 * back exactly.
 *
 * Runs: 200 per property, `FC_NUM_RUNS` overrides; a failure prints its seed
 * and path, and `FC_SEED=<seed>` replays it. Pin a seed that found a bug as an
 * example case in the property it broke.
 */
import fc from 'fast-check'
import { parseFragment } from 'parse5'
import { describe, expect, it } from 'vitest'
import { PREVIEW_LIMITS } from '../preview-limits'
import { buildAnchor, resolveBlockTarget } from './anchor'
import {
  PROPERTY_TIMEOUT_MS,
  commentDataArb,
  documentArb,
  fcParams,
  layoutArb
} from '../comments/__fixtures__/arbitraries'
import { ADA, LINE_SEP, ch, fixedId, makeComment } from '../comments/__fixtures__/commentTestData'
import { encodeText, utf8Length } from '../comments/encoding'
import {
  AGENT_NOTE_LINES,
  assertSafeCommentText,
  renderAgentNote,
  serializeBlock,
  type BlockLayout,
  type CommentAnchor,
  type CommentData
} from '../comments/format'
import { indexHtml, type HtmlIndex, type IndexedElement } from './htmlIndex'
import {
  analyzeCommentDocument,
  parseCommentBlocks,
  parseCommentFile,
  type CommentDocument,
  type ParsedBlock
} from './parse'
import {
  applySplice,
  planDelete,
  planInsert,
  planReplace,
  spliceBytes,
  verifyCommentSplice,
  verifySpliceBytes,
  type SplicePlan
} from './splice'

const NEW_BLOCK_ID = fixedId('c-', 9_000)
const LF_LAYOUT: BlockLayout = { indent: '', eol: '\n' }

/** The one block of a page holding just `block` before a button. */
function readBack(
  block: string,
  layout: { indent: string; eol: string }
): { html: string; blocks: readonly ParsedBlock[] } {
  const html = `<main>${layout.eol}${layout.indent}${block}${layout.eol}${layout.indent}<button>b</button></main>`
  return { html, blocks: parseCommentBlocks(html).blocks }
}

function serialized(
  data: CommentData,
  layout: { indent: string; eol: '\n' | '\r\n' | '\r' }
): string {
  const result = serializeBlock(data, layout)
  if (!result.ok) throw new Error(`serializeBlock refused generated data: ${result.reason}`)
  return result.block
}

const isHigh = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff
const isLow = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff
const INVISIBLE_UNITS: ReadonlySet<number> = new Set([
  0x061c, 0x200b, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066,
  0x2067, 0x2068, 0x2069, 0xfeff
])

/** Code units a block must never hold raw: controls (tab and line breaks aside), C1, invisible characters, lone surrogates. */
function forbiddenUnits(text: string): number[] {
  const found: number[] = []
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i)
    if (isHigh(unit) && isLow(text.charCodeAt(i + 1))) {
      i += 1
      continue
    }
    const control =
      (unit < 0x20 && unit !== 0x09 && unit !== 0x0a && unit !== 0x0d) ||
      (unit >= 0x7f && unit <= 0x9f)
    if (control || isHigh(unit) || isLow(unit) || INVISIBLE_UNITS.has(unit)) found.push(unit)
  }
  return found
}

describe('serializer properties', () => {
  it(
    'P-001 parse(serialize(c)) equals c, read from text and from bytes, with the agent note or without it',
    () => {
      const noteArb = fc.constantFrom<readonly string[]>(
        [],
        ['note to agents: other wording.'],
        [AGENT_NOTE_LINES[0]]
      )
      fc.assert(
        fc.property(commentDataArb, layoutArb, noteArb, (data, layout, note) => {
          const block = serialized(data, layout)
          const { html, blocks } = readBack(block, layout)
          expect(blocks).toHaveLength(1)
          expect(blocks[0]).toMatchObject({ kind: 'ok', data })
          const file = parseCommentFile(encodeText(html))
          expect(file.ok && file.doc.state.blocks[0]).toMatchObject({ kind: 'ok', data })
          // Readers skip the note: another writer may leave it out or word it differently.
          const lines = block.split(layout.eol)
          const otherNote = [
            lines[0],
            ...note.map(line => layout.indent + line),
            ...lines.slice(1 + AGENT_NOTE_LINES.length)
          ]
          expect(readBack(otherNote.join(layout.eol), layout).blocks[0]).toMatchObject({
            kind: 'ok',
            data
          })
        }),
        fcParams()
      )
    },
    PROPERTY_TIMEOUT_MS
  )

  it(
    'P-002 a block holds no forbidden sequence and parses as exactly one comment node',
    () => {
      fc.assert(
        fc.property(commentDataArb, layoutArb, (data, layout) => {
          const block = serialized(data, layout)
          expect(block.startsWith('<!--') && block.endsWith('-->')).toBe(true)
          const header = block.indexOf(layout.eol) + layout.eol.length
          expect(block.startsWith(renderAgentNote(layout) + layout.eol, header)).toBe(true)
          const inner = block.slice(4, -3)
          expect(inner).not.toContain('--')
          expect(inner.startsWith('>') || inner.startsWith('->') || inner.endsWith('-')).toBe(false)
          expect(forbiddenUnits(inner)).toEqual([])
          expect(() => assertSafeCommentText(block)).not.toThrow()
          const div = parseFragment(`<div>${block}</div>`).childNodes[0]
          expect('childNodes' in div && div.childNodes.map(node => node.nodeName)).toEqual([
            '#comment'
          ])
          // The HTML input stream turns CR and CRLF into LF before tokenizing.
          expect('childNodes' in div && div.childNodes[0]).toMatchObject({
            data: inner.replace(/\r\n?/g, '\n')
          })
        }),
        fcParams()
      )
    },
    PROPERTY_TIMEOUT_MS
  )

  function nearCap(count: number, length: number, fill: string): CommentData {
    const first = makeComment().msgs[0]
    const msgs = Array.from({ length: count }, (_, i) => ({
      ...first,
      id: fixedId('m-', i),
      text: fill.repeat(length)
    }))
    return makeComment({ msgs })
  }

  const NEAR_CAP_MAX_CHARS = 600_000

  /** Comments near the 2 MB cap: many long messages of one character that escapes to several bytes. */
  const nearCapArb = fc
    .record({
      count: fc.integer({ min: 1, max: PREVIEW_LIMITS.COMMENT_MAX_REPLIES + 1 }),
      length: fc.integer({ min: 2_000, max: PREVIEW_LIMITS.COMMENT_MESSAGE_MAX_CHARS }),
      fill: fc.constantFrom('a', '-', '<', '"', ch(0x1f600), LINE_SEP, ch(0xe9))
    })
    // #429: keep generated blocks near the cap (at most 600,000 message characters, up to
    // about 3.6 MB once escaped), so a run stays cheap under coverage. The explicit examples
    // below still hold the 6 MB refused case.
    .map(({ count, length, fill }) =>
      nearCap(Math.min(count, Math.ceil(NEAR_CAP_MAX_CHARS / length)), length, fill)
    )

  it(
    'P-007 every block the serializer accepts is within 2 MB and reads back ok; the rest are refused as limit',
    () => {
      let accepted = 0
      let refused = 0
      fc.assert(
        fc.property(
          fc.oneof({ arbitrary: commentDataArb, weight: 4 }, { arbitrary: nearCapArb, weight: 1 }),
          layoutArb,
          (data, layout) => {
            const result = serializeBlock(data, layout)
            if (!result.ok) {
              refused += 1
              expect(result.reason).toBe('limit')
              return
            }
            accepted += 1
            expect(utf8Length(result.block)).toBeLessThanOrEqual(
              PREVIEW_LIMITS.COMMENT_BLOCK_MAX_BYTES
            )
            expect(readBack(result.block, layout).blocks[0]).toMatchObject({ kind: 'ok', data })
          }
        ),
        // Both outcomes on every run: about 0.5 MB accepted, about 6 MB refused.
        fcParams({
          examples: [
            [nearCap(60, PREVIEW_LIMITS.COMMENT_MESSAGE_MAX_CHARS, 'a'), LF_LAYOUT],
            [
              nearCap(
                PREVIEW_LIMITS.COMMENT_MAX_REPLIES + 1,
                PREVIEW_LIMITS.COMMENT_MESSAGE_MAX_CHARS,
                '-'
              ),
              LF_LAYOUT
            ]
          ]
        })
      )
      expect(accepted).toBeGreaterThan(0)
      expect(refused).toBeGreaterThan(0)
    },
    // #429: this property serializes blocks of several MB, so it gets three times the budget.
    3 * PROPERTY_TIMEOUT_MS
  )
})

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const wsArb = fc.constantFrom('collapse', 'pre', undefined)
const picksArb = fc.array(fc.nat(), { minLength: 1, maxLength: 6 })

/** Up to six distinct eligible elements, picked by the generated numbers. */
function pickTargets(doc: CommentDocument, picks: readonly number[]) {
  const { elements } = doc.index
  if (elements.length === 0) return []
  return [...new Set(picks.map(n => elements[n % elements.length]))]
}

/** A block's position-independent facts, with every offset moved by `shift`. */
function shifted(block: ParsedBlock, shift: (offset: number, isEnd: boolean) => number): unknown {
  const target =
    block.kind === 'ok' && block.target.state === 'attached'
      ? { ...block.target, startOffset: shift(block.target.startOffset, false) }
      : block.kind === 'ok'
        ? block.target
        : undefined
  return {
    kind: block.kind,
    rawHash: block.rawHash,
    range: [shift(block.range[0], false), shift(block.range[1], true)],
    nodeRange: [shift(block.nodeRange[0], false), shift(block.nodeRange[1], true)],
    target,
    data: block.kind === 'ok' ? block.data : undefined,
    reason: block.kind === 'damaged' ? block.reason : undefined
  }
}

/** P-003 and P-005 for one insertion; returns the document with the block added. */
function checkInsertion(doc: CommentDocument, plan: SplicePlan): CommentDocument {
  const newText = applySplice(doc.text, plan)
  const verified = verifyCommentSplice(doc, newText, plan)
  if (!verified.ok) throw new Error(`verifyCommentSplice: ${verified.reason}`)
  // P-003: bytes outside the inserted range are identical.
  const oldBytes = encodeText(doc.text)
  const newBytes = spliceBytes(oldBytes, doc.text, plan)
  expect(newBytes).toEqual(encodeText(newText))
  expect(verifySpliceBytes(oldBytes, newBytes, doc.text, plan)).toBe(true)
  // P-005: the old blocks, shifted by exactly the inserted length, plus the new one.
  const delta = plan.insert.length
  const shift = (offset: number, isEnd: boolean): number =>
    offset > plan.start || (offset === plan.start && !isEnd) ? offset + delta : offset
  const after = verified.doc.state.blocks
  const added = after.findIndex(block => block.nodeRange[0] === plan.start)
  expect(after[added]).toMatchObject({
    kind: 'ok',
    data: plan.data,
    target: { state: 'attached', via: 'position', startOffset: plan.start + delta }
  })
  expect(
    after.filter((_, i) => i !== added).map(block => shifted(block, offset => offset))
  ).toEqual(doc.state.blocks.map(block => shifted(block, shift)))
  return verified.doc
}

describe('document properties', () => {
  it(
    'P-003 + P-005 adding a comment changes no byte outside it, delete(add) is the identity, and other blocks only shift',
    () => {
      fc.assert(
        fc.property(documentArb, picksArb, wsArb, ({ text }, picks, ws) => {
          const doc = analyzeCommentDocument(text)
          expect(doc.state.writable).toBe(true)
          for (const el of pickTargets(doc, picks)) {
            const data = makeComment({ id: NEW_BLOCK_ID, anchor: buildAnchor(doc.index, el) })
            const planned = planInsert(doc, { targetStart: el.start, data, ws })
            if (!planned.ok) throw new Error(`planInsert before <${el.tag}>: ${planned.reason}`)
            const added = checkInsertion(doc, planned.plan)
            const block = added.state.blocks.find(
              b => b.kind === 'ok' && b.data.id === NEW_BLOCK_ID
            )!
            const removal = planDelete(added, {
              block: { id: NEW_BLOCK_ID },
              rawHash: block.rawHash
            })
            if (!removal.ok) throw new Error(`planDelete: ${removal.reason}`)
            expect(applySplice(added.text, removal.plan)).toBe(text)
            expect(spliceBytes(encodeText(added.text), added.text, removal.plan)).toEqual(
              encodeText(text)
            )
            expect(verifyCommentSplice(added, text, removal.plan)).toMatchObject({ ok: true })
          }
        }),
        fcParams()
      )
    },
    PROPERTY_TIMEOUT_MS
  )

  it(
    'P-004 every insertion point is in the tokenizer data state: a comment put there is a comment and nothing else changes',
    () => {
      fc.assert(
        fc.property(documentArb, ({ text }) => {
          const index = indexHtml(text)
          for (const el of index.elements) {
            const probed = indexHtml(
              `${text.slice(0, el.start)}<!--probe-->${text.slice(el.start)}`
            )
            expect(
              probed.comments.find(c => c.start === el.start)?.data,
              `before <${el.tag}> at ${el.start}`
            ).toBe('probe')
            expect(probed.comments).toHaveLength(index.comments.length + 1)
            expect(probed.tagSequence).toEqual(index.tagSequence)
          }
        }),
        fcParams()
      )
    },
    PROPERTY_TIMEOUT_MS
  )

  const mutationArb = fc.record({
    flips: fc.array(
      fc.tuple(fc.nat(), fc.constantFrom('-', '>', '<', '!', '"', '{', '}', 'x', '\n', ' ', '=')),
      { maxLength: 6 }
    ),
    markers: fc.array(
      fc.tuple(
        fc.nat(),
        fc.constantFrom('<<<<<<< ours', '=======', '>>>>>>> theirs', '||||||| base')
      ),
      { maxLength: 4 }
    ),
    cut: fc.option(fc.nat(), { nil: undefined }),
    byteFlips: fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 255 })), { maxLength: 4 })
  })

  /** Character flips, inserted conflict-marker lines and a truncation point. */
  interface TextMutation {
    readonly flips: ReadonlyArray<readonly [number, string]>
    readonly markers: ReadonlyArray<readonly [number, string]>
    readonly cut: number | undefined
  }

  function mutate(text: string, mutation: TextMutation): string {
    let out = text
    for (const [n, char] of mutation.flips) {
      if (out.length === 0) break
      const at = n % out.length
      out = out.slice(0, at) + char + out.slice(at + 1)
    }
    for (const [n, marker] of mutation.markers) {
      const starts = [0, ...[...out.matchAll(/\r\n|\r|\n/g)].map(m => m.index + m[0].length)]
      const at = starts[n % starts.length]
      out = `${out.slice(0, at)}${marker}\n${out.slice(at)}`
    }
    return mutation.cut === undefined ? out : out.slice(0, mutation.cut % (out.length + 1))
  }

  /** Every write a user could ask for on `doc`, as planned (refusals included). */
  function allPlans(
    doc: CommentDocument
  ): Array<{ result: ReturnType<typeof planInsert>; own?: ParsedBlock }> {
    const plans: Array<{ result: ReturnType<typeof planInsert>; own?: ParsedBlock }> = []
    for (const el of doc.index.elements.slice(0, 40)) {
      plans.push({
        result: planInsert(doc, {
          targetStart: el.start,
          data: makeComment({ id: NEW_BLOCK_ID }),
          ws: 'collapse'
        })
      })
    }
    for (const block of doc.state.blocks) {
      plans.push({
        result: planDelete(doc, { block: { start: block.nodeRange[0] }, rawHash: block.rawHash }),
        own: block
      })
      if (block.kind !== 'ok') continue
      const data: CommentData = {
        ...block.data,
        status: 'resolved',
        resolved: { by: ADA, at: '2026-10-26T09:12:00Z' }
      }
      plans.push({
        result: planReplace(doc, { id: block.data.id, rawHash: block.rawHash, data }),
        own: block
      })
    }
    return plans
  }

  it(
    'P-006 a mutated file never throws and never yields a write range touching a damaged block',
    () => {
      fc.assert(
        fc.property(documentArb, mutationArb, ({ text }, mutation) => {
          const mutated = mutate(text, mutation)
          const doc = analyzeCommentDocument(mutated)
          const bytes = encodeText(mutated)
          expect(() => parseCommentFile(bytes)).not.toThrow()
          const flipped = Uint8Array.from(bytes)
          for (const [n, value] of mutation.byteFlips)
            if (flipped.length) flipped[n % flipped.length] = value
          expect(() => parseCommentFile(flipped)).not.toThrow()
          const damaged = doc.state.blocks.filter(block => block.kind !== 'ok')
          for (const { result, own } of allPlans(doc)) {
            if (!doc.state.writable) {
              expect(result).toEqual({ ok: false, reason: 'read-only' })
              continue
            }
            if (!result.ok) continue
            const { start, end } = result.plan
            for (const block of damaged) {
              if (block === own) continue
              const [d0, d1] = block.nodeRange
              const touches = start === end ? d0 < start && start < d1 : start < d1 && end > d0
              expect(
                touches,
                `${result.plan.op} [${start}, ${end}) vs damaged [${d0}, ${d1})`
              ).toBe(false)
            }
          }
        }),
        fcParams()
      )
    },
    PROPERTY_TIMEOUT_MS
  )
})

// ---------------------------------------------------------------------------
// Re-attachment
// ---------------------------------------------------------------------------

/**
 * A block right before the element `at`, its anchor taken part by part from
 * the element the comment was made on (`own`), from `at`, or bent: an `id`
 * that `at` does not carry, a quote whose text is gone.
 */
const placedAnchorArb = fc.record({
  at: fc.nat(),
  of: fc.nat(),
  tag: fc.constantFrom('own', 'at'),
  id: fc.constantFrom('own', 'at', 'changed', 'none'),
  path: fc.constantFrom('own', 'at', 'none'),
  quote: fc.constantFrom('own', 'at', 'gone', 'none')
})

type PlacedAnchor = typeof placedAnchorArb extends fc.Arbitrary<infer T> ? T : never

function anchorBefore(index: HtmlIndex, at: IndexedElement, recipe: PlacedAnchor): CommentAnchor {
  const own = buildAnchor(index, index.elements[recipe.of % index.elements.length])
  const next = buildAnchor(index, at)
  const part = <T>(choice: string, mine: T, theirs: T): T | undefined =>
    choice === 'own' ? mine : choice === 'at' ? theirs : undefined
  const id =
    recipe.id === 'changed' ? `${next.id ?? 'x'}-changed` : part(recipe.id, own.id, next.id)
  const quote =
    recipe.quote === 'gone'
      ? own.quote && { ...own.quote, exact: 'gone' }
      : part(recipe.quote, own.quote, next.quote)
  return {
    tag: recipe.tag === 'own' ? own.tag : next.tag,
    path: part(recipe.path, own.path, next.path) ?? '',
    ...(id ? { id } : {}),
    ...(quote ? { quote } : {})
  }
}

describe('re-attachment properties', () => {
  it(
    'P-008 a block never attaches to an element that carries another id than the stored one, and stays on the element after it whose id agrees',
    () => {
      fc.assert(
        fc.property(
          documentArb,
          fc.array(placedAnchorArb, { minLength: 1, maxLength: 8 }),
          ({ text }, recipes) => {
            const index = indexHtml(text)
            if (index.elements.length === 0) return
            for (const recipe of recipes) {
              const at = index.elements[recipe.at % index.elements.length]
              const anchor = anchorBefore(index, at, recipe)
              const target = resolveBlockTarget(index, {
                after: at.start,
                anchor,
                blockEnds: new Map()
              })
              if (target.state === 'attached' && anchor.id) {
                const found = index.elementAt(target.startOffset)?.id
                expect(
                  !found || found === anchor.id,
                  `${target.via}: ${found} for ${anchor.id}`
                ).toBe(true)
              }
              if (anchor.id && at.id === anchor.id && at.tag === anchor.tag) {
                expect(target).toEqual({
                  state: 'attached',
                  startOffset: at.start,
                  via: 'position'
                })
              }
            }
          }
        ),
        // X-001 with ids: the element after the block is another card, and every backup names it too.
        fcParams({
          examples: [
            [
              {
                text: '<main><article id="pause">Pause any time</article></main>',
                eol: '\n',
                bom: false
              },
              [{ at: 1, of: 1, tag: 'at', id: 'changed', path: 'at', quote: 'at' }]
            ]
          ]
        })
      )
    },
    PROPERTY_TIMEOUT_MS
  )
})
