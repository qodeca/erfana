// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Narrow-width contract for the image viewer's toolbar (issue #73).
 *
 * The export group pushed the row's non-shrinkable width from ~335px to ~380px.
 * dockview lets a group go down to 100px and this app declares no per-panel
 * minimum, so in that band the full-screen button, a separator and then Copy
 * used to fall past the right edge of `.container` (`overflow: hidden`) and be
 * painted nowhere - still focusable by Tab, but invisible, which is a WCAG 2.2
 * SC 2.4.11 failure. "Three buttons, always visible" is a locked requirement,
 * so the row may not hide, collapse or drop anything: it scrolls instead.
 *
 * Asserted against the stylesheet TEXT because jsdom performs no layout - it
 * reports every width as 0, so an overflow this file exists to prevent cannot
 * be observed there. The repo already pins CSS this way in
 * `RootErrorBoundary.css.test.ts` and `styles/userSelect.audit.test.ts`.
 *
 * @module ImageViewerPanel.toolbarOverflow.test
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */

import { describe, expect, it } from 'vitest'

import css from './ImageViewerPanel.module.css?raw'

/** Stylesheet with block comments removed, so prose cannot satisfy a rule. */
const CLEAN_CSS = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Clusters that must keep their full width, per the locked requirement. */
const CONTROL_CLUSTERS = ['.toolbarControls', '.toolbarActions', '.toolbarExport'] as const

/**
 * Declaration block of the rule whose selector is EXACTLY `selector`.
 *
 * Exact match on purpose: `.toolbar` must not be satisfied by `.toolbarExport`
 * or by `.toolbar::-webkit-scrollbar`.
 *
 * @param selector - Full selector text
 * @returns The declarations, or `''` when no such rule exists
 */
function declarationsFor(selector: string): string {
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g
  const bodies: string[] = []
  let match: RegExpExecArray | null
  while ((match = rulePattern.exec(CLEAN_CSS)) !== null) {
    const parts = match[1].split(',').map((part) => part.trim().replace(/\s+/g, ' '))
    if (parts.includes(selector)) bodies.push(match[2])
  }
  return bodies.join(';')
}

/**
 * Value of `property` in a declaration block, last declaration winning.
 *
 * @param body - Declaration block, braces excluded
 * @param property - CSS property name
 * @returns The declared value, or `null` when absent
 */
function declaredValue(body: string, property: string): string | null {
  const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'gi')
  let value: string | null = null
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) value = match[1].trim()
  return value
}

describe('ImageViewerPanel toolbar at narrow widths', () => {
  it('parses the stylesheet (guards against a vacuous pass)', () => {
    // Without this, a renamed class would make every assertion below trivially
    // true rather than failing.
    expect(declarationsFor('.toolbar')).not.toBe('')
    expect(declarationsFor('.container')).not.toBe('')
  })

  it('scrolls horizontally instead of letting `.container` clip the row', () => {
    const toolbar = declarationsFor('.toolbar')

    // `auto`, not `scroll`: nothing is shown at the widths the panel normally
    // has, and the port only becomes scrollable once the row cannot fit.
    expect(declaredValue(toolbar, 'overflow-x')).toBe('auto')
    // The clipping ancestor is unchanged - the toolbar is now the inner scroll
    // port, so a focused control scrolls into view here instead of the browser
    // scrolling a hidden ancestor nobody can see.
    expect(declaredValue(declarationsFor('.container'), 'overflow')).toBe('hidden')
  })

  it('grows no vertical scrollbar on a single-line row', () => {
    expect(declaredValue(declarationsFor('.toolbar'), 'overflow-y')).toBe('hidden')
  })

  it('suppresses the scrollbar visually, in both spellings', () => {
    // A 10px horizontal bar would eat a third of the row, and only in the
    // narrow band this whole rule exists to survive.
    expect(declaredValue(declarationsFor('.toolbar'), 'scrollbar-width')).toBe('none')
    expect(
      declaredValue(declarationsFor('.toolbar::-webkit-scrollbar'), 'display'),
      'Chromium (and therefore Electron) honours the pseudo-element, not the ' +
        'standard property - dropping it puts the bar back.'
    ).toBe('none')
  })

  it.each(CONTROL_CLUSTERS)('keeps %s at full size, so nothing is squashed', (selector) => {
    // The locked requirement is three export buttons always visible and
    // clickable. A shrinking cluster would trade the scroll for unhittable
    // slivers, which is the same defect wearing a different hat.
    expect(declaredValue(declarationsFor(selector), 'flex-shrink')).toBe('0')
  })

  it('keeps the group separators from collapsing with the clusters', () => {
    // The two separators are what make the row read as three regions. At 1px
    // wide a shrinkable rule goes to zero before anything else does, taking the
    // boundary with it precisely where the row is hardest to follow.
    expect(declaredValue(declarationsFor('.toolbarSeparator'), 'flex-shrink')).toBe('0')
  })

  it('lets the text give way first, so scrolling is the last resort', () => {
    // Metadata, then the status slot: both shrink to nothing before the row
    // overflows at all, which is why a normally-sized panel never scrolls.
    expect(declaredValue(declarationsFor('.toolbarMetadata'), 'min-width')).toBe('0')
    expect(declaredValue(declarationsFor('.statusSlot'), 'min-width')).toBe('0')
  })
})
