// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E selection tests for issue #211 (CSS audit — user-select).
 *
 * Two organic surfaces verify selection behavior end-to-end in the real
 * Chromium-via-Electron environment: the markdown preview (where the
 * original regression killed the prompt-template context menu) and the
 * settings overlay (a representative panel-content surface). If a future
 * regression brought back `user-select: none` on either surface, the
 * browser would refuse to honor `Selection.addRange` on the subtree and the
 * assertion would fail.
 *
 * Cross-cutting CSS-policy coverage for all audited surfaces lives in the
 * raw-CSS unit test at `src/renderer/src/styles/userSelect.audit.test.ts`,
 * which reads each component CSS file via Vite `?raw` and asserts the
 * named selector still declares `user-select: text`. The E2E here only
 * exercises the two surfaces that can be driven with a real component mount.
 *
 * Why programmatic select (not drag): selection inside Electron's content
 * area depends on a real mouse-drag gesture that Playwright simulates only
 * partially. The selection-then-assert pair used here mirrors the canonical
 * pattern from `context-menu-explain.e2e.ts` (`selectAndOpenPreviewContextMenu`)
 * and isolates the assertion from input-routing flakiness. The CSS rule is
 * what gates whether the call succeeds — that's exactly what the audit fix
 * touches and what this test must verify.
 *
 * @see docs/ui-style-guide.md § Text selection policy
 * @see src/renderer/src/styles/userSelect.audit.test.ts — raw-CSS policy coverage
 */

import { test, expect } from './fixtures/index'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { byTestId } from './utils/locators'
import { clickFileByName, openSettings } from './utils/helpers'

const SEED = {
  'test.md': '# Selectable\n\nThis is a paragraph the audit test selects programmatically.\n'
}

/**
 * Select the entire text content of `selector` inside `page`, then return
 * `window.getSelection().toString()` from the same evaluation. Doing both in
 * a single page.evaluate avoids a Playwright IPC round-trip during which a
 * focus change could collapse the selection.
 */
async function selectTextAndRead(
  page: import('@playwright/test').Page,
  selector: string
): Promise<string> {
  return page.evaluate((sel) => {
    const node = document.querySelector(sel)
    if (!node) throw new Error(`Selector not found: ${sel}`)
    const range = document.createRange()
    range.selectNodeContents(node)
    const selection = window.getSelection()
    if (!selection) throw new Error('window.getSelection() returned null')
    selection.removeAllRanges()
    selection.addRange(range)
    return selection.toString()
  }, selector)
}

test.describe('user-select audit (#211) — organic surfaces yield non-empty selections', () => {
  test.use({ testProjectFiles: SEED })

  test('Markdown preview: paragraph text is programmatically selectable', async ({
    windowWithTestProject
  }) => {
    // Open the file via the project tree (no Monaco wait — default open mode
    // is preview-only and the `withOpenFile` fixture blocks waiting for an
    // editor that never mounts; see fixture-smoke.e2e.ts:97-121 fixme).
    await clickFileByName(windowWithTestProject, 'test.md')

    const preview = byTestId(windowWithTestProject, TEST_IDS.EDITOR_PREVIEW)
    await expect(preview).toBeVisible({ timeout: 10_000 })

    const paragraph = preview.locator('.markdown-preview-content p').first()
    await expect(paragraph).toBeVisible({ timeout: 10_000 })

    const selected = await selectTextAndRead(
      windowWithTestProject,
      `[data-testid="${TEST_IDS.EDITOR_PREVIEW}"] .markdown-preview-content p`
    )

    expect(
      selected.trim().length,
      'Markdown preview paragraph yielded an empty selection (user-select regression?)'
    ).toBeGreaterThan(0)
  })

  test('Settings overlay: a section heading is programmatically selectable', async ({
    windowWithTestProject
  }) => {
    await openSettings(windowWithTestProject)

    const overlay = byTestId(windowWithTestProject, TEST_IDS.SETTINGS_OVERLAY)
    await expect(overlay).toBeVisible({ timeout: 10_000 })

    const content = overlay.locator('.settings-content')
    await expect(content).toBeVisible({ timeout: 5_000 })

    const loggingSection = byTestId(windowWithTestProject, TEST_IDS.SETTINGS_SECTION_LOGGING)
    await expect(loggingSection).toBeVisible({ timeout: 5_000 })

    const selected = await selectTextAndRead(
      windowWithTestProject,
      `[data-testid="${TEST_IDS.SETTINGS_SECTION_LOGGING}"]`
    )

    expect(
      selected.trim().length,
      'Settings section yielded an empty selection (user-select regression?)'
    ).toBeGreaterThan(0)
  })
})
