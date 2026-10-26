// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The overlay's stylesheet (docs/designs/html-preview-comments.md §10.2, §7.11;
 * M-064): while main prints the page to PDF, nothing of the overlay is drawn,
 * whatever media the print engine reports.
 */
import { describe, expect, it } from 'vitest'
import { overlayCss } from './overlayStyles'
import { DEFAULT_THEME } from './state'

const HIDE_RULE = '.erf-hpc-root { display: none !important; }'

describe('overlayCss', () => {
  it('draws the overlay in the theme, and hides it in print media only', () => {
    const css = overlayCss(DEFAULT_THEME)
    expect(css).toContain(DEFAULT_THEME.font)
    expect(css).toContain('@media print { .erf-hpc-root { display: none; } }')
    expect(css).not.toContain(HIDE_RULE)
  })

  it('M-064 a print hide adds one rule that hides the whole overlay in every media', () => {
    const shown = overlayCss(DEFAULT_THEME)
    const hidden = overlayCss(DEFAULT_THEME, true)
    expect(hidden.startsWith(shown)).toBe(true)
    expect(hidden.slice(shown.length)).toBe(HIDE_RULE)
  })
})
