// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The visible "which filter is on" cue of the project tree's Show choice (#452).
 *
 * The issue's complaint was that it was hard to see which filter is on. The
 * checked cell is told apart by CSS alone (a fill AND a lime bottom edge, never
 * colour alone – Segmented control card), and jsdom applies no stylesheet, so
 * the rule is pinned against the stylesheet TEXT, as
 * ImageViewerPanel.toolbarOverflow.test.ts does. Each value must be a design
 * token that exists in design-tokens.css, and must differ from the unchecked
 * cell's value.
 *
 * @see docs/designs/project-tree/toolbar-icons.html
 */

import { describe, expect, it } from 'vitest'

import css from './ProjectTree.css?raw'
import tokens from '../../styles/design-tokens.css?raw'

const CHECKED = ".file-filter__cell[aria-checked='true']"
const CELL = '.file-filter__cell'

/** Stylesheet with block comments removed, so prose cannot satisfy a rule. */
const CLEAN_CSS = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** `@media … { … }` blocks (one level of nesting), so top-level rules can be read without them. */
const MEDIA_BLOCK = /@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g

/** Top-level rules only: a `@media` override must not pass for the base rule. */
const TOP_LEVEL_CSS = CLEAN_CSS.replace(MEDIA_BLOCK, '')

/** The `@media (forced-colors: active)` blocks, concatenated. */
const FORCED_COLORS_CSS = (CLEAN_CSS.match(MEDIA_BLOCK) ?? [])
  .filter(block => /forced-colors\s*:\s*active/.test(block))
  .map(block => block.slice(block.indexOf('{') + 1, block.lastIndexOf('}')))
  .join('\n')

/** Declarations of the rules whose selector list holds EXACTLY `selector`. */
function declarationsFor(source: string, selector: string): string {
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g
  const bodies: string[] = []
  let match: RegExpExecArray | null
  while ((match = rulePattern.exec(source)) !== null) {
    const parts = match[1].split(',').map(part => part.trim().replace(/\s+/g, ' ').replace(/"/g, "'"))
    if (parts.includes(selector)) bodies.push(match[2])
  }
  return bodies.join(';')
}

/** Value of `property` in a declaration block, last declaration winning; `null` when absent. */
function declaredValue(body: string, property: string): string | null {
  const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'gi')
  let value: string | null = null
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) value = match[1].trim()
  return value
}

/** The colour of the cell's bottom edge: the longhand, else the colour inside the shorthand. */
function bottomEdgeColor(body: string): string | null {
  const longhand = declaredValue(body, 'border-block-end-color')
  if (longhand) return longhand
  const shorthand = declaredValue(body, 'border-block-end')
  return shorthand?.match(/var\(--color-[\w-]+\)/)?.[0] ?? null
}

/** Asserts `value` is exactly one `var(--color-…)` token defined in design-tokens.css. */
function expectColorToken(value: string | null): void {
  expect(value).toMatch(/^var\(--color-[\w-]+\)$/)
  const name = value!.slice(4, -1)
  expect(tokens).toMatch(new RegExp(`${name}\\s*:`))
}

const checked = declarationsFor(TOP_LEVEL_CSS, CHECKED)
const cell = declarationsFor(TOP_LEVEL_CSS, CELL)

describe('Show filter: the checked cell is visibly different (#452)', () => {
  it('parses the stylesheet (guards against a vacuous pass)', () => {
    expect(checked).not.toBe('')
    expect(cell).not.toBe('')
  })

  it('fills the checked cell with a colour token, unlike the unchecked cell', () => {
    const fill = declaredValue(checked, 'background')
    expectColorToken(fill)
    expect(fill).not.toBe(declaredValue(cell, 'background'))
  })

  it('colours the checked cell\'s bottom edge with a token, unlike the unchecked edge', () => {
    const edge = bottomEdgeColor(checked)
    expectColorToken(edge)
    expect(edge).not.toBe(bottomEdgeColor(cell))
  })

  it('gives every cell the same thick bottom edge, so checking changes a colour, not a height', () => {
    expect(declaredValue(cell, 'border-block-end')).toMatch(/^var\(--border-width-thick\) solid /)
    for (const property of ['border-block-end', 'border-block-end-width', 'border-width', 'block-size', 'height', 'padding']) {
      expect(declaredValue(checked, property), property).toBeNull()
    }
  })

  it('keeps the checked edge in a Windows contrast theme, where fills are dropped', () => {
    expect(declaredValue(declarationsFor(FORCED_COLORS_CSS, CHECKED), 'border-block-end-color')).toBe('Highlight')
  })
})
