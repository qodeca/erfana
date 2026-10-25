// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * Guards the one keyboard answer issue #100 asks for.
 *
 * The Menu card (status="decided") prescribes roving tabindex and argues that
 * aria-activedescendant forces a second, hand-painted focus ring. The Rows &
 * lists card (status="decided") shipped a demo doing exactly that: the <ul>
 * was the only tab stop, arrows moved an attribute, and row.css carried its
 * own ring used only in the state gallery. An engineer got two incompatible
 * instructions from two binding cards — and #88, #89 and #90 block on which
 * one is right.
 *
 * This file runs the Row card's own demo script, presses an arrow key, and
 * asserts what the Menu card decided is what both cards now do: real DOM
 * focus is what moves (roving), the list carries no second pattern, and the
 * row's ring is the Focus card's ring — reachable in the live demo, not
 * painted privately for the gallery.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const MENU = readFileSync(path.join(ROOT, 'design/system/components/menu/index.html'), 'utf8')
const ROW = readFileSync(path.join(ROOT, 'design/system/components/row/index.html'), 'utf8')
const ROW_CSS = readFileSync(path.join(ROOT, 'design/system/components/row/row.css'), 'utf8')

/** The two cards were binding when #100 was filed, and must stay binding. */
const DECIDED = 'status="decided"'

function buildCardDom(card) {
  // The card's scripts execute inside jsdom (external stylesheet links stay
  // unloaded with the default resources setting), so the assertions exercise
  // the demo's own keyboard code.
  const dom = new JSDOM(card, { runScripts: 'dangerously', url: 'https://cards.erfana.test/' })
  const scripts = [...dom.window.document.querySelectorAll('script')]
  expect(scripts.length).toBeGreaterThan(0)
  return dom
}

const OUTLINE_DECLARATION = 'outline: var(--border-width-thick) solid var(--color-border-focus)'

describe('the two decided list cards agree on keyboard movement (#100)', () => {
  it('both cards are still decided, so one contradicting the other still matters', () => {
    expect(MENU).toContain(DECIDED)
    expect(ROW).toContain(DECIDED)
  })

  it('the Menu card still names roving tabindex over aria-activedescendant', () => {
    expect(MENU).toMatch(/Roving <code>tabindex<\/code>, not <code>aria-activedescendant<\/code>/)
  })

  it('the Rows card carries no opposite pattern and cites the Menu decision', () => {
    // An exception would be legitimate if a card named it; silence is not. The
    // prose may mention the rejected pattern while explaining the choice, but
    // the demo must not use it.
    const demo = ROW.slice(ROW.indexOf('<script>'), ROW.indexOf('</script>'))
    expect(demo, 'the Rows demo still sets aria-activedescendant').not.toMatch(
      /aria-activedescendant/
    )
    expect(ROW, "the Rows card must name the Menu card's roving decision").toMatch(/Menu card/)
  })

  it('the Rows demo implements roving: exactly one row tab stop, real focus moves', () => {
    const dom = buildCardDom(ROW)
    const win = dom.window
    const doc = win.document

    // The container is not a tab stop any more — the row that holds
    // tabindex="0" is. Tab enters the list exactly once.
    const list = doc.getElementById('list')
    expect(list, 'the demo list is missing').not.toBeNull()
    expect(list.getAttribute('tabindex'), 'the <ul> still holds its own tab stop').toBeNull()

    const firstRow = doc.getElementById('row-0')
    expect(firstRow.tabIndex, 'the active row must carry tabindex="0" (roving)').toBe(0)
    firstRow.focus()
    expect(doc.activeElement, 'a keyboard user can reach the list').toBe(firstRow)

    firstRow.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    const second = doc.getElementById('row-1')
    expect(second.tabIndex).toBe(0)
    expect(doc.getElementById('row-0').tabIndex).toBe(-1)
    expect(doc.activeElement, 'arrows must move real DOM focus between rows').toBe(second)
    expect(second.getAttribute('aria-selected')).toBe('true')

    second.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(doc.activeElement).toBe(doc.getElementById('row-2'))
  })
})

describe("the row focus ring is the Focus card's ring, and the live demo reaches it", () => {
  /** Body of the rule block whose selector list contains a selector. */
  function rule(selector) {
    // Comments may sit inside a block's selector section, so drop them first.
    for (const block of ROW_CSS.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
      const brace = block.indexOf('{')
      if (brace === -1) continue
      const selectors = block
        .slice(0, brace)
        .split(',')
        .map(s => s.trim())
      if (selectors.includes(selector)) return block.slice(brace + 1)
    }
    return null
  }

  it('a focused row shows the standard inset ring, not a charted alternative', () => {
    const focused = rule('.erf-row--focus')
    expect(focused, 'row.css draws no row focus ring at all').not.toBeNull()
    expect(focused).toContain(OUTLINE_DECLARATION)
    expect(focused, 'rows scroll, so the ring is inset (the Focus card variant)').toContain(
      'outline-offset: calc(var(--space-1) * -1)'
    )
  })

  it('the gallery class and real focus paint the same ring — reachable, not hand-painted', () => {
    // The gallery stand-in only earns its place by describing the state a
    // keyboard user reaches in the live demo: the same declaration, keyed to
    // real focus.
    const realFocus = rule('.erf-row:focus-visible')
    expect(realFocus, 'real row focus must carry the same ring as the gallery').not.toBeNull()
    expect(realFocus).toContain(OUTLINE_DECLARATION)
    const gallery = rule('.erf-row--focus')
    for (const declaration of gallery
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)) {
      expect(realFocus).toContain(declaration)
    }
  })
})
