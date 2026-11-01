// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which target a new block's hint names. Fixed cases, so these branches do not
 * depend on the random input of a property test (the file's coverage floor).
 */
import { describe, expect, it } from 'vitest'
import { ADA, FIXED_NOW, VIEW, seededRandom } from '../comments/__fixtures__/commentTestData'
import type { CommentData } from '../comments/format'
import { createThread } from '../comments/thread'
import { markdownKind } from './markdownKind'
import { markdownHints } from './mdHints'
import type { MdIndex } from './mdIndex'

const doc = markdownKind.parse('Intro paragraph.\n\n## Next heading\n', 0)
const target = (doc.index as MdIndex).elements[0]!

/** A comment on the first paragraph, not yet in the file. */
function comment(): CommentData {
  const anchor = markdownKind.anchorOf(doc, target)
  return createThread({ anchor, view: VIEW, text: 'm', context: { author: ADA, now: FIXED_NOW, random: seededRandom(5) } })
}

describe('markdownHints – the target of a block not yet in the file', () => {
  it('names the target at the anchor path', () => {
    expect(markdownHints(comment(), doc)).toEqual(['target in Markdown (when commented): paragraph starting "Intro paragraph."'])
  })

  it('names no target when the anchor has no path', () => {
    const data = comment()
    expect(markdownHints({ ...data, anchor: { ...data.anchor, path: '' } }, doc)).toEqual([])
  })

  it('names no target when the element at the path has another tag', () => {
    const data = comment()
    expect(markdownHints({ ...data, anchor: { ...data.anchor, tag: 'blockquote' } }, doc)).toEqual([])
  })
})
