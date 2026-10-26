// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The overlay's stylesheet (docs/designs/html-preview-comments.md §10.2, §7.11;
 * M-064): while main prints the page to PDF, nothing of the overlay is drawn,
 * whatever media the print engine reports.
 */
import { describe, expect, it } from 'vitest'
import { overlayCss } from './overlayStyles'
import { DEFAULT_THEME, type OverlayTheme } from './state'

const HIDE_RULE = '.erf-hpc-root { display: none !important; }'

describe('overlayCss', () => {
  it('draws the overlay in the theme, and hides it in print media only', () => {
    const css = overlayCss(DEFAULT_THEME)
    expect(css).toContain(DEFAULT_THEME.font)
    expect(css).toContain('@media print { .erf-hpc-root { display: none; } }')
    expect(css).not.toContain(HIDE_RULE)
  })

  it('takes its spaces, hairline and line height from the theme, not typed numbers', () => {
    const marked: OverlayTheme = { ...DEFAULT_THEME, ring: '3px', hairline: '7px', space1: '17px', space2: '27px', space4: '37px', leading: '1.777' }
    const css = overlayCss(marked)
    expect(css).toContain('line-height: 1.777;')
    expect(css).toContain('outline: 7px solid')
    expect(css).toContain('padding: 0 27px;')
    expect(css).toContain('padding: 17px 37px;')
    expect(css).toContain('outline-offset: 17px; box-shadow: 0 0 0 27px')
    for (const typed of ['line-height: 1.4', ' 2px', ' 4px', ' 8px']) expect(css).not.toContain(typed)
  })

  it('hover recolours an open pin only; a damaged pin keeps an ink ! when selected', () => {
    const css = overlayCss(DEFAULT_THEME)
    expect(css).toContain(
      '@media (forced-colors: none) {\n  .erf-hpc-pin:not(.erf-hpc-pin--selected):not(.erf-hpc-pin--damaged):hover .erf-hpc-pin__body'
    )
    expect(css).not.toMatch(/(^|\n)\.erf-hpc-pin:hover/)
    expect(css).toContain(`.erf-hpc-pin--damaged.erf-hpc-pin--selected .erf-hpc-pin__count { color: ${DEFAULT_THEME.ink}; }`)
    // Later than the selected rule that paints the count in accent.
    expect(css.indexOf('.erf-hpc-pin--damaged.erf-hpc-pin--selected')).toBeGreaterThan(css.indexOf('.erf-hpc-pin--selected .erf-hpc-pin__count'))
  })

  it('in forced colours a selected pin differs from an open one', () => {
    const forced = overlayCss(DEFAULT_THEME).split('@media (forced-colors: active) {')[1].split('\n}')[0]
    expect(forced).toContain('.erf-hpc-pin .erf-hpc-pin__body { fill: Highlight; stroke: HighlightText; }')
    expect(forced).toContain('.erf-hpc-pin.erf-hpc-pin--selected .erf-hpc-pin__body { fill: Canvas; stroke: Highlight; }')
    expect(forced).toContain(
      '.erf-hpc-pin.erf-hpc-pin--selected .erf-hpc-pin__line, .erf-hpc-pin.erf-hpc-pin--selected .erf-hpc-pin__count { fill: Highlight; color: Highlight; }'
    )
  })

  it('E-022 shows every word as generated content from data-text, and has no visually-hidden live region', () => {
    const css = overlayCss(DEFAULT_THEME)
    expect(css).toContain('.erf-hpc-text::before { content: attr(data-text); }')
    expect(css).not.toContain('.erf-hpc-sr')
    // The count is an HTML box over the bubble's body, coloured, not an SVG fill.
    expect(css).toContain(`.erf-hpc-pin__count { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; color: ${DEFAULT_THEME.ink};`)
  })

  it('M-064 a print hide adds one rule that hides the whole overlay in every media', () => {
    const shown = overlayCss(DEFAULT_THEME)
    const hidden = overlayCss(DEFAULT_THEME, true)
    expect(hidden.startsWith(shown)).toBe(true)
    expect(hidden.slice(shown.length)).toBe(HIDE_RULE)
  })
})
