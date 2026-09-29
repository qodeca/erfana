// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scene `capture-buttons`: the terminal's capture buttons, and the camera
 * dialog showing Chromium's fake camera – never a real one. Guide page:
 * how-to/send-a-screenshot-or-photo-to-the-agent.md.
 */

import { expect, test } from '@playwright/test'
import { TEST_IDS } from '../../../src/renderer/src/constants/testids'
import { launch, openProject } from '../lib/app'
import { anySelected, drawTitleTooltip, removeDrawnTooltips, shot } from '../lib/shots'

const ROWS = ['send-a-screenshot/capture-buttons', 'send-a-screenshot/camera-dialog']

test('capture-buttons', async () => {
  test.skip(!anySelected(ROWS), 'no row of this scene selected')
  const cap = await launch({ extraArgs: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
  const { page } = cap
  try {
    await openProject(cap)
    const header = page.getByTestId(TEST_IDS.TERMINAL_PANEL).locator('.sidebar-panel-header')
    const area = page.getByTestId(TEST_IDS.TERMINAL_BTN_CAPTURE_AREA)
    await expect(area).toBeVisible()
    const areaTip = await drawTitleTooltip(page, area, 'capture-tip-area')
    await shot(cap, 'send-a-screenshot/capture-buttons', { crop: [header, areaTip], pad: 4, keepHover: true })
    await removeDrawnTooltips(page)

    await page.getByTestId(TEST_IDS.TERMINAL_BTN_CAMERA).click()
    const dialog = page.getByTestId(TEST_IDS.CAMERA_DIALOG)
    await expect(dialog).toBeVisible()
    const video = page.getByTestId(TEST_IDS.CAMERA_PREVIEW)
    await expect(video).toBeVisible()
    // The fake camera's pattern moves; hold one frame so the shot can settle.
    await page.waitForFunction((id) => {
      const v = document.querySelector(`[data-testid="${id}"]`) as HTMLVideoElement | null
      return v !== null && v.readyState >= 2 && v.videoWidth > 0
    }, TEST_IDS.CAMERA_PREVIEW)
    await video.evaluate((v) => (v as HTMLVideoElement).pause())
    await shot(cap, 'send-a-screenshot/camera-dialog', { crop: page.getByTestId(TEST_IDS.DIALOG_CONTAINER), pad: 16 })
  } finally {
    await cap.close()
  }
})
