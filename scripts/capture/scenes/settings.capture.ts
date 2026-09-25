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
    await shot(cap, 'settings/overlay')

    // Logging at the top of the scrolled list; Transcription sits between it
    // and HTML preview, so the crop is the whole settings box.
    await page.locator('.settings-content').evaluate((el, id) => {
      const target = el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
      if (target) el.scrollTop = target.offsetTop - 8
    }, TEST_IDS.SETTINGS_SECTION_LOGGING)
    await expect(page.getByTestId(TEST_IDS.SETTINGS_SECTION_LOGGING)).toBeInViewport()
    await shot(cap, 'settings/logging-and-html-preview', { crop: container, pad: 0 })
  } finally {
    await cap.close()
  }
})
