// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Build-graph invariant guard (#216 follow-up / screenshot-overlay CSS leak).
 *
 * `ScreenshotOverlay.css` sets global `html, body, #root { cursor: crosshair; … }`
 * because it is meant to style ONLY the dedicated area-select pop-up window. The
 * renderer has a single `index.html` entry, so any *static* top-level import of the
 * overlay component pulls its plain (non-module) stylesheet into the MAIN window's
 * CSS bundle — turning the whole app's default cursor into a crosshair.
 *
 * The fix is to load the overlay via a dynamic `import()` on the overlay route only,
 * so the bundler emits its JS+CSS as a separate chunk that the main window never loads.
 *
 * jsdom cannot bundle, so the testable surface for this regression is the import
 * strategy in `main.tsx` itself. This test fails if the overlay is ever statically
 * imported again.
 */
describe('main.tsx overlay import isolation', () => {
  const source = readFileSync(resolve(__dirname, 'main.tsx'), 'utf8')

  it('does not statically import the ScreenshotOverlay at module top level', () => {
    const staticImport = /^\s*import\s+.*ScreenshotOverlay.*\s+from\s+['"][^'"]*Screenshot\/ScreenshotOverlay['"]/m
    expect(source).not.toMatch(staticImport)
  })

  it('loads the ScreenshotOverlay via a dynamic import()', () => {
    const dynamicImport = /import\(\s*['"][^'"]*Screenshot\/ScreenshotOverlay['"]\s*\)/
    expect(source).toMatch(dynamicImport)
  })
})
