// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scene `images`: the image viewer, and an open image deleted on disk.
 * Guide pages: how-to/view-and-export-images.md.
 */

import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { TEST_IDS } from '../../../src/renderer/src/constants/testids'
import { launch, openFile, openProject, visible } from '../lib/app'
import { anySelected, shot } from '../lib/shots'

const ROWS = ['images/image-viewer', 'images/deleted-file']

test('images', async () => {
  test.skip(!anySelected(ROWS), 'no row of this scene selected')
  const cap = await launch()
  const { page, sandbox: sb } = cap
  try {
    await openProject(cap)
    await openFile(cap, 'images/garden-map.svg')
    const viewer = visible(page, TEST_IDS.IMAGE_VIEWER_PANEL)
    await expect(viewer).toBeVisible()
    await expect(viewer.locator('img').first()).toBeVisible()
    const area = page.getByTestId(TEST_IDS.EDITOR_AREA)
    await shot(cap, 'images/image-viewer', { crop: area, pad: 0 })

    fs.unlinkSync(path.join(sb.project, 'images', 'garden-map.svg'))
    await expect(visible(page, TEST_IDS.IMAGE_VIEWER_DELETED_BANNER)).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.image-tab-deleted')).toBeVisible()
    await shot(cap, 'images/deleted-file', { crop: area, pad: 0 })
  } finally {
    await cap.close()
  }
})
