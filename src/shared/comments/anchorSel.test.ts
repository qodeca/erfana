// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `anchor.sel` (spec 024 Naming contracts, 024-FR-008, 024-FR-010): its rules
 * decide only whether the words are underlined; an invalid `sel` never makes
 * a block Damaged and is kept through every edit.
 */
import { describe, expect, it } from 'vitest'
import { ADA, FIXED_NOW, LONE_HIGH, ZWJ, ch, makeComment, pageWith } from './__fixtures__/commentTestData'
import { SEL_CONTEXT_MAX_CHARS, SEL_EXACT_MAX_CHARS, anchorSelectionOf, isAnchorSelection } from './anchorSel'
import { CommentDataSchema, serializeBlock } from './format'
import { addReply, setStatus } from './thread'
import { analyzeCommentDocument } from '../htmlComments/parse'

const VALID = { exact: 'ship by Friday', prefix: 'We will ', suffix: ' at the latest.' }

describe('anchor.sel rules', () => {
  it('accepts exact of 1 to 200 code points and context of up to 32', () => {
    expect(isAnchorSelection(VALID)).toBe(true)
    expect(isAnchorSelection({ exact: 'a', prefix: '', suffix: '' })).toBe(true)
    expect(isAnchorSelection({ exact: ch(0x1f600).repeat(SEL_EXACT_MAX_CHARS), prefix: '', suffix: '' })).toBe(true)
    expect(isAnchorSelection({ ...VALID, prefix: 'p'.repeat(SEL_CONTEXT_MAX_CHARS), suffix: 's'.repeat(SEL_CONTEXT_MAX_CHARS) })).toBe(true)
    // Loose: a later version may add a field.
    expect(isAnchorSelection({ ...VALID, later: 1 })).toBe(true)
  })

  it('refuses empty or too long parts, missing parts and non-objects', () => {
    expect(isAnchorSelection({ ...VALID, exact: '' })).toBe(false)
    expect(isAnchorSelection({ ...VALID, exact: 'x'.repeat(SEL_EXACT_MAX_CHARS + 1) })).toBe(false)
    expect(isAnchorSelection({ ...VALID, prefix: 'p'.repeat(SEL_CONTEXT_MAX_CHARS + 1) })).toBe(false)
    expect(isAnchorSelection({ ...VALID, suffix: 's'.repeat(SEL_CONTEXT_MAX_CHARS + 1) })).toBe(false)
    expect(isAnchorSelection({ exact: 'x' })).toBe(false)
    for (const value of [undefined, null, 'x', 3, ['x']]) expect(isAnchorSelection(value)).toBe(false)
  })

  it('refuses text that is not rendered text: uncollapsed whitespace, not NFC, a lone surrogate', () => {
    expect(isAnchorSelection({ ...VALID, exact: 'two  spaces' })).toBe(false)
    expect(isAnchorSelection({ ...VALID, exact: 'tab\there' })).toBe(false)
    expect(isAnchorSelection({ ...VALID, exact: 'line\nbreak' })).toBe(false)
    // A space at the join counts too: `prefix` ends and `exact` starts with one.
    expect(isAnchorSelection({ ...VALID, exact: ' ship' })).toBe(false)
    expect(isAnchorSelection({ ...VALID, exact: `cafe${String.fromCharCode(0x301)}` })).toBe(false)
    expect(isAnchorSelection({ ...VALID, exact: `half ${LONE_HIGH}` })).toBe(false)
  })

  it('refuses a cut through a grapheme at either join', () => {
    const family = `${ch(0x1f469)}${ZWJ}${ch(0x1f467)}`
    expect(isAnchorSelection({ exact: family, prefix: 'a ', suffix: ' b' })).toBe(true)
    expect(isAnchorSelection({ exact: ch(0x1f469), prefix: '', suffix: `${ZWJ}${ch(0x1f467)}` })).toBe(false)
    expect(isAnchorSelection({ exact: String.fromCharCode(0x301), prefix: 'e', suffix: '' })).toBe(false)
  })

  it('anchorSelectionOf: the valid sel, else undefined', () => {
    const anchor = makeComment().anchor
    expect(anchorSelectionOf(anchor)).toBeUndefined()
    expect(anchorSelectionOf({ ...anchor, sel: VALID })).toEqual(VALID)
    expect(anchorSelectionOf({ ...anchor, sel: { ...VALID, exact: '' } })).toBeUndefined()
  })
})

describe('anchor.sel in @data (024-FR-008, 024-FR-010)', () => {
  const invalidSels: unknown[] = [{ exact: '' }, 'words', 42, null, [1, 2], { exact: 'a  b', prefix: '', suffix: '', x: { y: 1 } }]

  it('is optional: a block without it is valid, and any sel – valid or not – keeps the block ok', () => {
    expect(CommentDataSchema.safeParse(makeComment()).success).toBe(true)
    for (const sel of [VALID, ...invalidSels]) {
      const data = makeComment({ anchor: { ...makeComment().anchor, sel } })
      expect(CommentDataSchema.safeParse(data).success).toBe(true)
      const block = serializeBlock(data, { indent: '', eol: '\n' })
      if (!block.ok) throw new Error(block.reason)
      const [parsed] = analyzeCommentDocument(pageWith(block.block)).state.blocks
      expect(parsed.kind, JSON.stringify(sel)).toBe('ok')
      if (parsed.kind === 'ok') expect(parsed.data.anchor.sel).toEqual(sel)
    }
  })

  it('is kept unchanged by reply and resolve, valid or not', () => {
    const context = { author: ADA, now: FIXED_NOW }
    for (const sel of [VALID, ...invalidSels]) {
      const data = makeComment({ anchor: { ...makeComment().anchor, sel } })
      const next = setStatus(addReply(data, 'Done.', context), 'resolved', context)
      expect(JSON.stringify(next.anchor)).toBe(JSON.stringify(data.anchor))
    }
  })
})
