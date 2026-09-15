// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The keyboard's way into a previewed page and back out (#124, QG-8 U1 and
 * QG-11a H1).
 *
 * Enter on the placeholder gives the page NATIVE keyboard focus. Escape pressed
 * in the page must give it back to Erfana: main hands native focus to the host
 * window's contents before it forwards the key, and the renderer focuses the
 * band chip. A DOM focus alone cannot take native focus back from a
 * `WebContentsView`, so the only honest check is main-side `isFocused()` on
 * both contents – `document.activeElement` would pass either way.
 *
 * Keys in the page go through `webContents.sendInputEvent` (real input, which
 * `before-input-event` sees); Playwright's `page.keyboard` drives the host and
 * would never reach the page.
 *
 * Native focus is observable only while Erfana is the OS key window, so the
 * first test FAILS on a locked screen, naming that cause (`bringAppToFront`).
 * The second needs no OS focus: it records, main-side, that the host was told
 * to take focus before the key was forwarded, and that the chip took DOM focus.
 *
 * Local gate only: e2e is disabled in CI.
 * Condition-based waits only — never a sleep.
 *
 * @see src/main/services/preview/previewHostFocus.ts
 * @see src/renderer/src/components/Panels/HtmlPreviewPanel/hooks/usePreviewPageEntry.ts
 */

import type { ElectronApplication, Page } from '@playwright/test'

import { test, expect } from './fixtures/index'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'
import { dismissAllToasts } from './pages/html-preview.browser'
import {
  bandChip,
  bringAppToFront,
  focusState,
  hostFocusTrail,
  pressKeyInPage,
  recordHostFocusTrail
} from './pages/html-preview.focus'

const FILE = 'focus.html'
const TARGET = HtmlPreviewPage.target(FILE)

/** A page with one field, so a key that reaches the page has somewhere to land. */
const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Keyboard focus page -FOCUS-1</title></head>
<body style="font:16px sans-serif;padding:24px">
  <label for="name">Name</label>
  <input id="name" type="text">
</body>
</html>
`

test.use({ testProjectFiles: { [FILE]: PAGE } })

test.describe('HTML preview — keyboard focus into the page and back', () => {
  test('Enter focuses the page, and Escape in the page returns focus to the chip', async ({
    windowWithTestProject: page,
    appWithTestProject: app
  }) => {
    const preview = await openFocusPage(page, app)
    const placeholder = preview.placeholder(FILE)

    await bringAppToFront(app)
    await placeholder.focus()
    await expect(placeholder).toBeFocused()

    // In: Enter on the placeholder puts native focus in the page.
    await page.keyboard.press('Enter')
    await expect
      .poll(() => focusState(app, TARGET), {
        timeout: PREVIEW_BUDGET_MS,
        message: 'Enter on the placeholder never gave the page keyboard focus'
      })
      .toEqual({ preview: true, host: false })

    // The keyboard really is in the page: Tab reaches its field.
    expect(await pressKeyInPage(app, 'Tab', TARGET)).toBe(true)
    await expect
      .poll(() => preview.eval('document.activeElement?.id ?? ""', TARGET), {
        timeout: PREVIEW_BUDGET_MS,
        message: 'Tab in the page never reached its field'
      })
      .toBe('name')

    // Out: Escape in the page hands native focus back to the host window...
    expect(await pressKeyInPage(app, 'Escape', TARGET)).toBe(true)
    await expect
      .poll(() => focusState(app, TARGET), {
        timeout: PREVIEW_BUDGET_MS,
        message: 'Escape in the page never returned keyboard focus to the window'
      })
      .toEqual({ preview: false, host: true })

    // ...and the renderer puts it on the band chip.
    await expect(bandChip(preview, FILE)).toBeFocused()
  })

  test('Escape in the page tells the host window to take focus before the key is forwarded', async ({
    windowWithTestProject: page,
    appWithTestProject: app
  }) => {
    const preview = await openFocusPage(page, app)
    const placeholder = preview.placeholder(FILE)
    await recordHostFocusTrail(app)

    await placeholder.focus()
    await page.keyboard.press('Enter')
    expect(await pressKeyInPage(app, 'Escape', TARGET)).toBe(true)

    await expect
      .poll(() => hostFocusTrail(app), {
        timeout: PREVIEW_BUDGET_MS,
        message: 'Escape in the page never reached main as a forwarded key'
      })
      .toEqual(['host-focus', 'forwarded:Escape'])
    await expect(bandChip(preview, FILE)).toBeFocused()
  })
})

/** Open the page, wait for it to run, and wait for its placeholder to be a keyboard target. */
async function openFocusPage(page: Page, app: ElectronApplication): Promise<HtmlPreviewPage> {
  const preview = new HtmlPreviewPage(page, app)
  await preview.open(FILE)
  await preview.waitForTitled('-FOCUS-1')
  // A toast that cannot move out of the page's way hides it, and a hidden page
  // is not a keyboard target.
  await dismissAllToasts(page)
  await expect(preview.placeholder(FILE)).toHaveAttribute('tabindex', '0', { timeout: PREVIEW_BUDGET_MS })
  return preview
}
