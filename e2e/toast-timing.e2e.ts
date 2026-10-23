// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Toast timing in the real app (WCAG 2.2.1 Timing Adjustable): an error toast
 * stays until it is closed, and Escape on a focused toast closes it and hands
 * focus back to where it came from.
 *
 * The error comes from a real flow: clicking a preview link to a file that
 * does not exist raises "File Not Found".
 *
 * Condition-based waits only, except the one deliberate pause that IS the
 * claim under test (the toast outlives the error's old auto-dismiss time).
 *
 * @see src/renderer/src/components/Toast/ToastContext.tsx
 */

import { test, expect } from './fixtures/index'
import { EditorPanelPage } from './pages/editor-panel.page'
import { ProjectTreePage } from './pages/project-tree.page'
import { byTestId } from './utils/locators'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { TOAST_DURATION } from '../src/shared/constants'

test.use({
  testProjectFiles: { 'links.md': '# Links\n\n[a missing page](./missing.md)\n' }
})

test.describe('Toast timing', () => {
  test('an error toast stays past the auto-dismiss time, and Escape closes it and returns focus', async ({
    windowWithTestProject: page
  }) => {
    const panel = new EditorPanelPage(page)
    await new ProjectTreePage(page).fileRow('links.md').click()
    await panel.waitForReady()
    await panel.setViewMode('preview')

    const link = panel.previewPane().locator('a[href="./missing.md"]')
    await expect(link).toHaveClass(/broken-link/)
    await link.click()

    const toast = byTestId(page, `${TEST_IDS.TOAST}-error`).filter({ hasText: 'File Not Found' })
    await expect(toast).toHaveCount(1)
    await expect(byTestId(page, TEST_IDS.TOAST_LIVE_ALERT)).toContainText('File Not Found')

    // KNOWN_WAIT: none – outliving the error's old auto-dismiss time is the claim under test
    await page.waitForTimeout(TOAST_DURATION.ERROR + 1500)
    await expect(toast).toHaveCount(1)

    // Focus moves from the link into the toast, then Escape closes it
    await link.focus()
    await toast.getByTestId(TEST_IDS.TOAST_BTN_DISMISS).focus()
    await page.keyboard.press('Escape')
    await expect(toast).toHaveCount(0)
    await expect(link).toBeFocused()
  })
})
