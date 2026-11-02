// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment marks (comments-v2 C-12, C-17, R-01): two highlights – the mark
 * and the open thread's mark – and the thread under a point.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COMMENT_ACTIVE_HIGHLIGHT,
  COMMENT_HIGHLIGHT,
  COMMENT_HIGHLIGHT_PRIORITY,
  commentMarkAt,
  commentMarksOf,
  setCommentMarks
} from './commentHighlights'

function words(text: string, from: number, to: number): { el: HTMLElement; range: Range } {
  const el = document.createElement('p')
  el.textContent = text
  document.body.appendChild(el)
  const range = document.createRange()
  range.setStart(el.firstChild!, from)
  range.setEnd(el.firstChild!, to)
  return { el, range }
}

function caretAt(node: Node, offset: number): void {
  Object.defineProperty(document, 'caretRangeFromPoint', {
    configurable: true,
    value: () => {
      const range = document.createRange()
      range.setStart(node, offset)
      return range
    }
  })
}

afterEach(() => {
  setCommentMarks('a', [])
  setCommentMarks('b', [])
  delete (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('commentHighlights', () => {
  it('C-12 paints the open thread under its own name, below Find, and the rest as the mark – both owners together', () => {
    const set = vi.fn()
    const remove = vi.fn()
    class FakeHighlight {
      readonly ranges: Range[]
      priority = 0
      constructor(...ranges: Range[]) {
        this.ranges = ranges
      }
    }
    vi.stubGlobal('Highlight', FakeHighlight)
    vi.stubGlobal('CSS', { highlights: { set, delete: remove } })
    const one = words('ship by Friday', 0, 4)
    const two = words('ten customers', 4, 13)
    setCommentMarks('a', [{ range: one.range, threadKey: 't1' }])
    setCommentMarks('b', [{ range: two.range, threadKey: 't2', active: true }])
    const last = (name: string): FakeHighlight => set.mock.calls.filter(([n]) => n === name).at(-1)![1] as FakeHighlight
    expect(last(COMMENT_HIGHLIGHT).ranges.map(String)).toEqual(['ship'])
    expect(last(COMMENT_ACTIVE_HIGHLIGHT).ranges.map(String)).toEqual(['customers'])
    expect(last(COMMENT_ACTIVE_HIGHLIGHT).priority).toBe(COMMENT_HIGHLIGHT_PRIORITY)
    // The mark is painted last, so a reader of the registry sees it whole.
    expect(set.mock.calls.at(-1)?.[0]).toBe(COMMENT_HIGHLIGHT)
    setCommentMarks('b', [])
    expect(remove).toHaveBeenCalledWith(COMMENT_ACTIVE_HIGHLIGHT)
    expect(commentMarksOf('a')).toEqual([one.range])
  })

  it('C-17 the thread under a point: inside its words, nothing beside them, nothing without caretRangeFromPoint', () => {
    const { el, range } = words('We ship the beta to ten customers', 20, 33)
    setCommentMarks('a', [{ range, threadKey: 't7' }])
    expect(commentMarkAt('a', 1, 1)).toBeNull()
    caretAt(el.firstChild!, 25)
    expect(commentMarkAt('a', 1, 1)).toBe('t7')
    expect(commentMarkAt('nobody', 1, 1)).toBeNull()
    caretAt(el.firstChild!, 3)
    expect(commentMarkAt('a', 1, 1)).toBeNull()
    // A node from elsewhere (the content re-rendered): no hit, no throw.
    caretAt(document.createTextNode('detached'), 1)
    expect(commentMarkAt('a', 1, 1)).toBeNull()
  })
})
