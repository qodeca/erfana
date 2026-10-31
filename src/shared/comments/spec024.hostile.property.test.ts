// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Hostile selections and block text against both parsers (spec 024,
 * 024-FR-008 third criterion, 024-NFR security checklist item 8): whatever the
 * selected words, the Markdown source line and the comment hold, a block
 * written with its kind's note and hint lines reads `ok` in this version and
 * in the frozen v0.23.1 copy. `anchor.sel` is stored whether or not it is a
 * valid selection, so an invalid one is exercised too.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { analyzeCommentDocument as frozenAnalyze } from './__fixtures__/frozen-v0.23.1/parse'
import { HOSTILE_PIECES, PROPERTY_TIMEOUT_MS, commentDataArb, fcParams, hostileText, layoutArb } from './__fixtures__/arbitraries'
import { LINE_SEP, LONE_HIGH, LONE_LOW, RLO, pageWith } from './__fixtures__/commentTestData'
import { HTML_AGENT_NOTE_LINES, MARKDOWN_AGENT_NOTE_LINES } from './agentNotes'
import { serializeBlock, type CommentData } from './format'
import { markdownTargetHint, selectionHints, wordsHint } from './noteLines'
import { analyzeCommentDocument } from '../htmlComments/parse'

/** The pieces 024-FR-008 names, on top of the shared hostile pieces. */
const NAMED_PIECES = ['-->', '\nstatus: open', '\n@data {}', '<<<<<<<', LONE_HIGH, LONE_LOW, RLO, LINE_SEP]

const piece = fc.constantFrom(...NAMED_PIECES, ...HOSTILE_PIECES)
const hostile = fc
  .tuple(hostileText(0, 20, 120), fc.array(piece, { maxLength: 6 }), hostileText(0, 10, 60))
  .map(([a, pieces, b]) => a + pieces.join('') + b)

const selArb = fc.record({ exact: hostile, prefix: hostile, suffix: hostile })

const kinds = (blocks: readonly { kind: string; reason?: string }[]): string[] =>
  blocks.map(block => (block.kind === 'damaged' ? `damaged: ${block.reason}` : block.kind))

describe('024-FR-008 hostile selections and block text', () => {
  it(
    '024-AC-009 every block with hostile anchor.sel, words hint and Markdown target hint reads ok in the current and the frozen v0.23.1 parser',
    () => {
      fc.assert(
        fc.property(
          commentDataArb,
          selArb,
          hostile,
          hostile,
          layoutArb,
          fc.boolean(),
          (base, sel, target, sourceLine, layout, markdown) => {
            const data: CommentData = { ...base, anchor: { ...base.anchor, sel } }
            const note = [
              ...(markdown ? MARKDOWN_AGENT_NOTE_LINES : HTML_AGENT_NOTE_LINES),
              ...(markdown ? [markdownTargetHint(target, sourceLine)] : []),
              wordsHint(sel.exact),
              ...selectionHints(data)
            ]
            const result = serializeBlock(data, layout, note)
            if (!result.ok) throw new Error(`serialize: ${result.reason}`)
            const page = pageWith(result.block)
            const current = analyzeCommentDocument(page).state.blocks
            expect(kinds(current)).toEqual(['ok'])
            expect(JSON.stringify(current[0].kind === 'ok' && current[0].data.anchor.sel)).toBe(JSON.stringify(sel))
            expect(kinds(frozenAnalyze(page).state.blocks)).toEqual(['ok'])
          }
        ),
        fcParams()
      )
    },
    PROPERTY_TIMEOUT_MS
  )
})
