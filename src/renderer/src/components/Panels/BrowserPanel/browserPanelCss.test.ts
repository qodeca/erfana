// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The browser panel's CSS rules that jsdom cannot lay out or paint, read as
 * text (the `CommentDrawer.test.tsx` approach): container-query folds and
 * forced-colours repaints (spec 025 round-2 UI review).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string): string => readFileSync(resolve(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const PICK_ROW_CSS = read('PickRow.css')
const STRIP_ROWS_CSS = read('StripRows.css')

/** The bodies of every at-rule whose prelude is `prelude` (balanced braces). */
function atRuleBodies(css: string, prelude: string): string[] {
  const bodies: string[] = []
  let from = 0
  for (;;) {
    const at = css.indexOf(prelude, from)
    if (at === -1) return bodies
    const open = css.indexOf('{', at)
    let depth = 1
    let i = open + 1
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    bodies.push(css.slice(open + 1, i - 1))
    from = i
  }
}

/** A selector list split at its top-level commas (not those inside `:is(…)`), each part whitespace-normalised. */
function selectorList(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') depth++
    else if (list[i] === ')') depth--
    else if (list[i] === ',' && depth === 0) {
      parts.push(list.slice(start, i))
      start = i + 1
    }
  }
  parts.push(list.slice(start))
  return parts.map(part => part.replace(/\s+/g, ' ').trim())
}

/** The declarations of every top-level rule in `css` whose selector list contains `selector`, joined. */
function declarationsFor(css: string, selector: string): string {
  const found: string[] = []
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = selectorList(match[1])
    if (selectors.includes(selector)) found.push(match[2])
  }
  return found.join(';')
}

const decl = (body: string, property: string): string | null =>
  body.match(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+)`))?.[1].trim() ?? null

const LONG_CLAUSE_ROW = '.erf-brw-pick:is([data-surface], [data-panel-closed])'

describe('pick row: the long first clauses keep their room (025-FR-065)', () => {
  const fold = atRuleBodies(PICK_ROW_CSS, '@container (max-width: 560px)').join('\n')

  it('hides Pick element\'s label from sight only, and the tag, while the panel or dialog is open or the panel closed', () => {
    const label = declarationsFor(fold, `${LONG_CLAUSE_ROW} .erf-brw-pickbtn__label`)
    expect(decl(label, 'position')).toBe('absolute')
    expect(decl(label, 'clip-path')).toBe('inset(50%)')
    // Never display: none – the label is the button's accessible name.
    expect(decl(label, 'display')).toBeNull()
    expect(decl(declarationsFor(fold, `${LONG_CLAUSE_ROW} .erf-brw-banner-line .erf-brw-tag`), 'display')).toBe('none')
  })

  it('gives the panel-closed place the same width preset and target fold as an open surface', () => {
    expect(decl(declarationsFor(PICK_ROW_CSS, `${LONG_CLAUSE_ROW} .erf-brw-width`), 'display')).toBe('none')
    const narrow = atRuleBodies(PICK_ROW_CSS, '@container (max-width: 660px)').join('\n')
    expect(decl(declarationsFor(narrow, `${LONG_CLAUSE_ROW} .erf-brw-target`), 'display')).toBe('none')
  })
})

describe('pick row: Pick element keeps its name at every width', () => {
  it('hides its label from sight only below 380px, never with display: none (the label is its only name)', () => {
    const narrow = atRuleBodies(PICK_ROW_CSS, '@container (max-width: 380px)').join('\n')
    const label = declarationsFor(narrow, '.erf-brw-pickbtn__label')
    expect(decl(label, 'position')).toBe('absolute')
    expect(decl(label, 'clip-path')).toBe('inset(50%)')
    expect(decl(label, 'display')).toBeNull()
  })
})

describe('pick row: Pick element in forced colours and when disabled', () => {
  const forced = atRuleBodies(PICK_ROW_CSS, '@media (forced-colors: active)').join('\n')

  it('repaints the pressed toggle\'s edge and focus ring in system colours, as it opts out of forced colours', () => {
    const pressed = declarationsFor(forced, ".erf-brw-pickbtn[aria-pressed='true']")
    expect(decl(pressed, 'forced-color-adjust')).toBe('none')
    expect(decl(pressed, 'background')).toBe('Highlight')
    expect(decl(pressed, 'border-color')).toBe('Highlight')
    expect(decl(declarationsFor(forced, ".erf-brw-pickbtn[aria-pressed='true']:focus-visible"), 'outline-color')).toBe('CanvasText')
  })

  it('does not react to hover while disabled (Buttons card)', () => {
    expect(decl(declarationsFor(PICK_ROW_CSS, ".erf-brw-pickbtn[aria-disabled='true']"), 'cursor')).toBe('not-allowed')
    expect(decl(declarationsFor(PICK_ROW_CSS, ".erf-brw-pickbtn[aria-disabled='true']:hover"), 'background')).toBe('transparent')
    expect(decl(declarationsFor(PICK_ROW_CSS, ".erf-brw-actions__step[aria-disabled='true']"), 'cursor')).toBe('not-allowed')
    expect(decl(declarationsFor(PICK_ROW_CSS, ".erf-brw-actions__step[aria-disabled='true']:hover"), 'background')).toBe('transparent')
  })
})

describe('strip rows: the input guard\'s blocked look (OD-6, Buttons card)', () => {
  it('is a transparent fill with the label dimmed on its element, winning over hover', () => {
    for (const selector of [
      ".erf-site-prompt__button[aria-disabled='true']",
      ".erf-site-prompt__button[aria-disabled='true']:hover",
      ".erf-site-prompt__close[aria-disabled='true']",
      ".erf-site-prompt__close[aria-disabled='true']:hover"
    ]) {
      const body = declarationsFor(STRIP_ROWS_CSS, selector)
      expect(decl(body, 'background'), selector).toBe('transparent')
      expect(decl(body, 'cursor'), selector).toBe('not-allowed')
    }
    for (const selector of [".erf-site-prompt__button[aria-disabled='true'] > *", ".erf-site-prompt__close[aria-disabled='true'] > *"]) {
      expect(decl(declarationsFor(STRIP_ROWS_CSS, selector), 'opacity'), selector).toBe('var(--opacity-disabled)')
    }
  })

  it('shows GrayText text and edge in forced colours', () => {
    const forced = atRuleBodies(STRIP_ROWS_CSS, '@media (forced-colors: active)').join('\n')
    for (const selector of [".erf-site-prompt__button[aria-disabled='true']", ".erf-site-prompt__close[aria-disabled='true']"]) {
      const body = declarationsFor(forced, selector)
      expect(decl(body, 'color'), selector).toBe('GrayText')
      expect(decl(body, 'border-color'), selector).toBe('GrayText')
    }
  })
})
