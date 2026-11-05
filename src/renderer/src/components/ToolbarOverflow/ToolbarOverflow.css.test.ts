// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The CSS the toolbar overflow fit relies on (#451), pinned as stylesheet text.
 *
 * `useToolbarOverflow` decides what moves from measured widths, and only CSS
 * makes those measurements true: the row may shrink with its panel and paints
 * nothing past its edge, the title's `min-width` IS the reserve the hook reads,
 * a hidden part leaves layout, the button group never shrinks, and the gap the
 * hook reads is the gap the row draws. jsdom performs no layout (and does not
 * load these stylesheets), so the only automated guard on a narrow panel is the
 * e2e spec, which is not a required check. This file is the required-CI guard,
 * the same way `ImageViewerPanel.toolbarOverflow.test.ts` pins the image
 * viewer's row.
 *
 * @see docs/design-system/system/patterns/toolbar-overflow (decided)
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declared, designTokens, parseRules, type CssRule } from '../../test-utils/cssAudit'

function rulesOf(relativeToComponents: string): CssRule[] {
  const full = resolve(__dirname, '..', relativeToComponents)
  return parseRules({ file: relativeToComponents, css: readFileSync(full, 'utf8') })
}

const OVERFLOW = rulesOf('ToolbarOverflow/ToolbarOverflow.css')
const PROJECT_TREE = rulesOf('ProjectTree/ProjectTree.css')

/** The joined bodies of every rule whose selector list contains exactly `selector`. */
function bodyOf(rules: readonly CssRule[], selector: string): string {
  return rules
    .filter((rule) => rule.selector.split(',').some((part) => part.trim() === selector))
    .map((rule) => rule.body)
    .join(';')
}

function value(rules: readonly CssRule[], selector: string, property: string): string | null {
  return declared(bodyOf(rules, selector), property)
}

describe('ToolbarOverflow.css – the contract the fit is measured against (#451)', () => {
  it('parses the stylesheet (guards against a vacuous pass)', () => {
    for (const selector of [
      '.erf-toolbar-overflow',
      '.erf-toolbar-overflow__title',
      '.erf-toolbar-overflow__actions',
      '.erf-toolbar-overflow__slot'
    ]) {
      expect(bodyOf(OVERFLOW, selector), selector).not.toBe('')
    }
  })

  it('lets the row shrink with its panel and paint nothing past its edge', () => {
    // A flex item's min-width defaults to its content: without 0 the row would
    // stay as wide as all its buttons and the panel would clip it (the bug).
    expect(value(OVERFLOW, '.erf-toolbar-overflow', 'min-width')).toBe('0')
    expect(value(OVERFLOW, '.erf-toolbar-overflow', 'overflow')).toBe('hidden')
  })

  it('gives the title a length min-width – the reserve useToolbarOverflow reads', () => {
    // The hook parses getComputedStyle(title).minWidth; `auto` or 0 would make
    // the title reserve 0 and buttons would never move while the title shrinks.
    const reserve = value(OVERFLOW, '.erf-toolbar-overflow__title', 'min-width')
    const token = reserve?.match(/^var\((--space-\d+)\)$/)?.[1]
    expect(token, `min-width: ${reserve}`).toBeDefined()
    const resolved = designTokens().get(token as string) ?? ''
    expect(resolved).toMatch(/^\d+(\.\d+)?px$/)
    expect(parseFloat(resolved)).toBeGreaterThan(0)
  })

  it('truncates the title in place down to that reserve (card rule 3)', () => {
    expect(value(OVERFLOW, '.erf-toolbar-overflow__title', 'overflow')).toBe('hidden')
    expect(value(OVERFLOW, '.erf-toolbar-overflow__title', 'text-overflow')).toBe('ellipsis')
    expect(value(OVERFLOW, '.erf-toolbar-overflow__title', 'white-space')).toBe('nowrap')
  })

  it.each(['.erf-toolbar-overflow__icon[hidden]', '.erf-toolbar-overflow__title[hidden]'])(
    'takes %s out of layout, beating the part’s own display rule',
    (selector) => {
      // `.erf-toolbar-overflow__icon { display: inline-flex }` is an author rule,
      // so it beats the UA's `[hidden] { display: none }`: without this rule a
      // "hidden" icon would still take its width and the row would overflow.
      expect(value(OVERFLOW, selector, 'display')).toBe('none')
    }
  )

  it('never shrinks the button group or a slot: a button is whole in the row or in the menu', () => {
    expect(value(OVERFLOW, '.erf-toolbar-overflow__actions', 'flex')).toBe('0 0 auto')
    expect(value(OVERFLOW, '.erf-toolbar-overflow__slot', 'flex')).toBe('0 0 auto')
    // The group sits at the row's end, so … is the row's last control.
    expect(value(OVERFLOW, '.erf-toolbar-overflow__actions', 'margin-left')).toBe('auto')
  })

  it('draws the button gap as a flex `gap` – the column-gap the hook reads – from the host’s custom property', () => {
    expect(value(OVERFLOW, '.erf-toolbar-overflow__actions', 'display')).toBe('flex')
    expect(value(OVERFLOW, '.erf-toolbar-overflow__actions', 'gap')).toBe(
      'var(--erf-toolbar-overflow-gap, var(--space-4))'
    )
  })

  it('keeps the project row’s measured gap equal to the gap its own actions class draws', () => {
    // ProjectTree passes actionsClassName="project-tree-actions", whose own `gap`
    // competes with the group's at equal specificity. The custom property makes
    // both say the same, so the hook never measures one gap while CSS draws another.
    const hostGap = value(PROJECT_TREE, '.project-tree-path', '--erf-toolbar-overflow-gap')
    expect(hostGap).not.toBeNull()
    expect(hostGap).toBe(value(PROJECT_TREE, '.project-tree-actions', 'gap'))
  })

  it('animates nothing: buttons leave and return instantly (card rule 10)', () => {
    // A width transition would hand the hook mid-animation widths during a drag.
    for (const rule of OVERFLOW) {
      expect(declared(rule.body, 'transition'), rule.selector).toBeNull()
      expect(declared(rule.body, 'animation'), rule.selector).toBeNull()
    }
  })
})
