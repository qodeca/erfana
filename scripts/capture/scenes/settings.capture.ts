// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scene `settings`: the settings overlay at the top, and scrolled to Logging
 * and HTML preview (the logs folder path shows the sandbox home). Guide page:
 * reference/settings.md.
 */

import { expect, test } from '@playwright/test'
import { TEST_IDS } from '../../../src/renderer/src/constants/testids'
import { launch, openProject } from '../lib/app'
import { anySelected, shot } from '../lib/shots'

const ROWS = ['settings/overlay', 'settings/logging-and-html-preview']

test('settings', async () => {
  test.skip(!anySelected(ROWS), 'no row of this scene selected')
  const cap = await launch()
  const { page } = cap
  try {
    await openProject(cap)
    await page.getByTestId(TEST_IDS.ACTIVITY_BAR_BTN_SETTINGS).first().click()
    const container = page.getByTestId(TEST_IDS.SETTINGS_CONTAINER)
    await expect(container).toBeVisible()
    await expect(page.getByTestId(TEST_IDS.SETTINGS_SECTION_EDITOR)).toBeVisible()
    // The Logs folder path is always an absolute path in the sandbox home:
    // covered with a solid box (design § Privacy, layer 4), listed in the report.
    const logsPath = page.getByTestId(TEST_IDS.SETTINGS_LOGS_FOLDER_PATH)
    await shot(cap, 'settings/overlay', { mask: [logsPath] })

    // Logging at the top of the scrolled list; Transcription sits between it
    // and HTML preview, so the crop runs from the Logging section to the end
    // of the HTML preview section.
    await page.locator('.settings-content').evaluate((el, id) => {
      const target = el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
      if (target) el.scrollTop = target.offsetTop - 8
    }, TEST_IDS.SETTINGS_SECTION_LOGGING)
    await expect(page.getByTestId(TEST_IDS.SETTINGS_SECTION_LOGGING)).toBeInViewport()
    await shot(cap, 'settings/logging-and-html-preview', {
      crop: [page.getByTestId(TEST_IDS.SETTINGS_SECTION_LOGGING), page.getByTestId(TEST_IDS.SETTINGS_SECTION_HTML_PREVIEW)],
      pad: 16,
      mask: [logsPath]
    })
  } finally {
    await cap.close()
  }
})
