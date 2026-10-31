// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Selected words in the DOM (spec 024 024-FR-004): a live range to a range
 * in the target's collapsed text, and stored words back to a range.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { rangeOfWords, targetText, wordsInTarget } from './domWords'

function mount(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.appendChild(root)
  return root
}

/** The boundary point `offset` characters into the text of `el`'s descendants. */
function point(el: Node, offset: number): [Node, number] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let left = offset
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = (node as Text).data.length
    if (left <= length) return [node, left]
    left -= length
  }
  throw new Error('offset past the text')
}

function rangeOver(start: [Node, number], end: [Node, number]): Range {
  const range = document.createRange()
  range.setStart(...start)
  range.setEnd(...end)
  return range
}

describe('domWords', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('reads a selection across inline elements as one range in the collapsed text', () => {
    const root = mount('<p id="p">We  ship <em>by\n Friday</em>, <a href="#">then</a> rest.</p>')
    const p = root.querySelector<HTMLElement>('#p')!
    const raw = p.textContent!
    const range = rangeOver(point(p, raw.indexOf('ship')), point(p, raw.indexOf('Friday') + 6))
    const words = wordsInTarget(p, range)
    expect(words.text).toBe('We ship by Friday, then rest.')
    expect(words.text.slice(words.start, words.end)).toBe('ship by Friday')
    expect(words.cut).toBe(false)
    expect(targetText(p)).toBe(words.text)
  })

  it('a selection that runs into the next block is cut to the block it started in', () => {
    const root = mount('<p id="a">First paragraph ends here.</p><p id="b">Second one.</p>')
    const a = root.querySelector<HTMLElement>('#a')!
    const b = root.querySelector<HTMLElement>('#b')!
    const range = rangeOver(point(a, 6), point(b, 6))
    const words = wordsInTarget(a, range)
    expect(words.cut).toBe(true)
    expect(words.text.slice(words.start, words.end)).toBe('paragraph ends here.')
  })

  it('maps stored words back to a DOM range, across elements and collapsed spaces', () => {
    const root = mount('<p id="p">Ship   <strong>by</strong>\nFriday. Then ship by Monday.</p>')
    const p = root.querySelector<HTMLElement>('#p')!
    const range = rangeOfWords(p, { exact: 'by Friday', prefix: 'Ship ', suffix: '. Then ship by Monday.' })
    expect(range?.toString().replace(/\s+/g, ' ')).toBe('by Friday')
    expect(rangeOfWords(p, { exact: 'by', prefix: 'gone', suffix: 'gone' })).toBeNull()
    expect(rangeOfWords(p, { exact: 'Tuesday', prefix: '', suffix: '' })).toBeNull()
  })
})
