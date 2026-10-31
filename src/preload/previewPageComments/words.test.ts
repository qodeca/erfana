// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Selected words in the page (spec 024 024-FR-004, 024-AC-004, preload half):
 * which element a selection comments on, the words and their context, and
 * finding stored words again for the mark. The rules are the shared ones
 * (`shared/comments/selectionWords.ts`), which this sealed preload cannot
 * import; the samples below run through both, so the copies cannot drift.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { chooseWords, collapseRange, locateWords } from '../../shared/comments/selectionWords'
import { collapse, headOf, locate, rangeOfWords, readSelection, selectionTarget, tailOf } from './words'

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  document.body.innerHTML = ''
})

function html(markup: string): void {
  document.body.innerHTML = markup
}

/** Select from `(startNode, startOffset)` to `(endNode, endOffset)` in the page. */
function select(startNode: Node, startOffset: number, endNode: Node, endOffset: number): Range {
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return range
}

const text = (id: string): Text => document.getElementById(id)!.firstChild as Text
const notOverlay = (): boolean => false

describe('024-AC-004 (preload) which element a selection is about', () => {
  it('024-AC-004 (a) three words inside one paragraph: the paragraph, with the words and their context', () => {
    html('<main><p id="p">We ship the beta to ten customers by Friday.</p></main>')
    select(text('p'), 20, text('p'), 33)
    const words = readSelection(window, notOverlay)
    expect(words?.target.id).toBe('p')
    expect(words?.sel).toEqual({ exact: 'ten customers', prefix: 'We ship the beta to ', suffix: ' by Friday.' })
    expect(words?.long).toBeUndefined()
    expect(words?.crossed).toBeUndefined()
  })

  it('024-AC-004 (i) the whole element\'s text: the element, with no words', () => {
    html('<main><p id="p">  Whole   paragraph </p></main>')
    select(text('p'), 0, text('p'), text('p').length)
    const words = readSelection(window, notOverlay)
    expect(words?.target.id).toBe('p')
    expect(words?.sel).toBeUndefined()
  })

  it('024-AC-004 (j) across two sibling <li>: their parent <ul>, not cut', () => {
    html('<main><ul id="list"><li id="a">Alpha one</li><li id="b">Beta two</li></ul></main>')
    const range = select(text('a'), 6, text('b'), 4)
    expect(selectionTarget(range)).toEqual({ target: document.getElementById('list'), crossed: false })
    // The element's text as the file has it: no space between the two items, as in main's parse.
    expect(readSelection(window, notOverlay)?.sel?.exact).toBe('oneBeta')
  })

  it('024-AC-004 (k) across two <section> directly inside <main>: cut to the first section, and says so', () => {
    html('<main><section id="s1"><p id="p1">First part</p></section><section id="s2"><p id="p2">Second part</p></section></main>')
    const range = select(text('p1'), 6, text('p2'), 6)
    expect(selectionTarget(range)).toEqual({ target: document.getElementById('s1'), crossed: true })
    const words = readSelection(window, notOverlay)
    expect(words?.target.id).toBe('s1')
    expect(words?.sel?.exact).toBe('part')
    expect(words?.crossed).toBe(true)
  })

  it('024-AC-004 a selection across body children is cut the same way; one starting in body text itself has no target', () => {
    html('<div id="d1">One two</div><div id="d2">Three</div>')
    expect(selectionTarget(select(text('d1'), 4, text('d2'), 3))).toEqual({ target: document.getElementById('d1'), crossed: true })
    document.body.insertBefore(document.createTextNode('loose '), document.body.firstChild)
    expect(selectionTarget(select(document.body.firstChild!, 0, text('d2'), 3))).toBeNull()
  })

  it('024-AC-004 only spaces, a collapsed selection, no selection or one in the overlay: no words', () => {
    html('<p id="p">a    b</p>')
    select(text('p'), 1, text('p'), 4)
    expect(readSelection(window, notOverlay)).toBeNull()
    select(text('p'), 2, text('p'), 2)
    expect(readSelection(window, notOverlay)).toBeNull()
    window.getSelection()!.removeAllRanges()
    expect(readSelection(window, notOverlay)).toBeNull()
    select(text('p'), 0, text('p'), 1)
    expect(readSelection(window, () => true)).toBeNull()
  })

  it('024-AC-004 (d) more than 200 code points: the first 200, uncut, and `long`', () => {
    const body = Array.from({ length: 60 }, (_, i) => `w${String(i).padStart(3, '0')}`).join(' ')
    html(`<p id="p">${body}</p>`)
    select(text('p'), 0, text('p'), 250)
    const words = readSelection(window, notOverlay)
    expect(words?.long).toBe(true)
    expect([...words!.sel!.exact]).toHaveLength(200)
    expect(words?.sel?.exact).toBe(body.slice(0, 200))
  })

  it('a target too long to read is commented whole', () => {
    html(`<p id="p">${'x'.repeat(200_001)}</p>`)
    select(text('p'), 0, text('p'), 5)
    expect(readSelection(window, notOverlay)).toEqual({ target: document.getElementById('p') })
  })
})

describe('024-AC-004 (preload) the copies of the shared selection rules agree with them', () => {
  const samples: Array<[string, number, number]> = [
    ['Ship  by\n Friday.', 5, 15],
    ['  café   au lait ', 2, 8],
    ['á b c', 0, 2],
    ['one two three', 4, 7]
  ]

  it.each(samples)('collapse(%j) matches collapseRange', (raw, start, end) => {
    expect(collapse(raw, start, end)).toEqual(collapseRange(raw, start, end))
  })

  it('cuts on grapheme boundaries and counts code points', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}'
    expect(headOf(`ab${family}cd`, 3)).toBe('ab')
    expect(tailOf(`ab${family}cd`, 2)).toBe('cd')
    expect(headOf('x'.repeat(40), 32)).toHaveLength(32)
  })

  it('finds stored words as the shared rule does: in context first, then alone, never a tie', () => {
    const text = 'the plan and the plan'
    for (const sel of [
      { exact: 'the plan', prefix: '', suffix: ' and' },
      { exact: 'plan', prefix: 'the ', suffix: '' },
      { exact: 'and', prefix: '', suffix: '' },
      { exact: 'the plan', prefix: '', suffix: '' },
      { exact: 'gone', prefix: '', suffix: '' }
    ]) {
      expect(locate(text, sel)).toBe(locateWords(text, sel)?.start ?? null)
    }
    expect(chooseWords({ text, start: 0, end: 8 }).kind).toBe('words')
  })
})

describe('C-12 (HTML) finding stored words in the page for the mark', () => {
  it('C-12 (HTML) a range over the words, across text nodes and collapsed spaces', () => {
    html('<p id="p">Ship <b>the   beta</b> today</p>')
    const range = rangeOfWords(document.getElementById('p')!, { exact: 'the beta today', prefix: 'Ship ', suffix: '' })
    expect(range?.toString()).toBe('the   beta</b> today'.replace('</b>', ''))
    // A trailing space is not part of the text the words are looked up in.
    html('<p id="p">Ship the beta </p>')
    expect(rangeOfWords(document.getElementById('p')!, { exact: 'the beta', prefix: 'Ship ', suffix: '' })?.toString()).toBe('the beta')
  })

  it('C-12 (HTML) no range when the words are gone, appear twice, or the text is not NFC', () => {
    html('<p id="p">beta and beta</p><p id="q">café</p>')
    expect(rangeOfWords(document.getElementById('p')!, { exact: 'gamma', prefix: '', suffix: '' })).toBeNull()
    expect(rangeOfWords(document.getElementById('p')!, { exact: 'beta', prefix: '', suffix: '' })).toBeNull()
    expect(rangeOfWords(document.getElementById('q')!, { exact: 'cafe', prefix: '', suffix: '' })).toBeNull()
    expect(rangeOfWords(document.createElement('p'), { exact: 'x', prefix: '', suffix: '' })).toBeNull()
  })
})
