// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The overlay host's pure parts: the toolbar counts (OD-04), a target's open
 * threads (C-22) and what the picker says about it (C-10).
 */
import { describe, expect, it } from 'vitest'
import { fileView, thread } from '../../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { MARKDOWN_WORDS, MD_SPOKEN_COPY, SPOKEN_EXCERPT_MAX_CHARS } from '../commentCopyWords'
import { countsOf, spokenTarget, threadsOn } from './hostParts'
import type { PreviewCommentAdapter } from './previewAdapter'

function blocks(): { a: HTMLElement; b: HTMLElement; adapter: PreviewCommentAdapter } {
  const a = document.createElement('p')
  a.textContent = `  We   ship ${'very '.repeat(20)}late.  `
  const b = document.createElement('li')
  b.textContent = 'two'
  const byLine = new Map<number, HTMLElement>([
    [6, a],
    [9, b]
  ])
  const adapter = {
    words: MARKDOWN_WORDS,
    tagOf: (el: HTMLElement) => el.tagName.toLowerCase(),
    lineOf: (el: HTMLElement) => (el === a ? 6 : 9),
    attach: (placement: { line: number }) => byLine.get(placement.line) ?? null
  } as unknown as PreviewCommentAdapter
  return { a, b, adapter }
}

describe('hostParts', () => {
  it('OD-04 countsOf: every open thread found or not, ▲ damaged only, newer in neither', () => {
    const file = fileView({
      threads: [thread(1), thread(2, { attached: false }), thread(3, { status: 'resolved' })],
      damaged: [{ blockKey: 'b1', rawHash: 'a'.repeat(64), reason: 'schema', line: 3, raw: 'x' }],
      newer: [{ blockKey: 'n1', version: 2, line: 4 }]
    })
    expect(countsOf(file)).toEqual({ open: 2, resolved: 1, attention: 1 })
    expect(countsOf(null)).toBeNull()
  })

  it('C-22 threadsOn: the open, found threads attached to the target, none for another', () => {
    const { a, b, adapter } = blocks()
    const file = fileView({
      threads: [thread(1), thread(2, { status: 'resolved' }), thread(3, { attached: false }), thread(4)]
    })
    const placements = [
      { threadKey: 't1', line: 9, tag: 'li' },
      { threadKey: 't2', line: 9, tag: 'li' },
      { threadKey: 't3', line: 9, tag: 'li' },
      { threadKey: 't4', line: 9, tag: 'li' }
    ]
    expect(threadsOn(b, adapter, placements, file)).toEqual(['t1', 't4'])
    expect(threadsOn(a, adapter, placements, file)).toEqual([])
    expect(threadsOn(b, adapter, placements, null)).toEqual([])
  })

  it('C-10 spokenTarget: kind, line, the first 60 characters with whitespace collapsed, and the open comments', () => {
    const { a, b, adapter } = blocks()
    const file = fileView({ threads: [thread(1)] })
    const placements = [{ threadKey: 't1', line: 9, tag: 'li' }]
    const said = spokenTarget(a, adapter, placements, file)
    const excerpt = `We ship ${'very '.repeat(20)}late.`.slice(0, SPOKEN_EXCERPT_MAX_CHARS).trimEnd()
    expect(said).toBe(MD_SPOKEN_COPY.target('paragraph', 6, `${excerpt}…`, 0))
    expect(said).toMatch(/^Paragraph, line 6: “We ship very/)
    expect(spokenTarget(b, adapter, placements, file)).toBe('List item, line 9: “two”. 1 comment.')
    b.textContent = ''
    expect(spokenTarget(b, adapter, placements, file)).toBe('List item, line 9. 1 comment.')
  })
})
