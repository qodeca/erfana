// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scene `mermaid`: a rendered diagram with its toolbar, the full-screen
 * viewer, the diagram chat and a diagram error. Guide page:
 * how-to/work-with-mermaid-diagrams.md, reference/troubleshooting.md.
 */

import { expect, test } from '@playwright/test'
import { TEST_IDS } from '../../../src/renderer/src/constants/testids'
import { launch, openFile, openProject, visible } from '../lib/app'
import { anySelected, shot } from '../lib/shots'

const ROWS = ['mermaid/diagram', 'mermaid/full-screen-viewer', 'mermaid/diagram-chat', 'mermaid/diagram-error']

test('mermaid', async () => {
  test.skip(!anySelected(ROWS), 'no row of this scene selected')
  const cap = await launch()
  const { page } = cap
  try {
    await openProject(cap)

    await openFile(cap, 'drafts/broken-diagram.md')
    const preview = (): ReturnType<typeof visible> => visible(page, TEST_IDS.EDITOR_PREVIEW)
    await expect(preview().locator('.mermaid-error')).toBeVisible({ timeout: 20_000 })
    await shot(cap, 'mermaid/diagram-error', { crop: visible(page, TEST_IDS.EDITOR_CONTENT), pad: 0 })

    await openFile(cap, 'handbook/compost-guide.md')
    const diagram = preview().locator('.mermaid-container').first()
    await expect(diagram.locator('.mermaid-diagram svg')).toBeVisible({ timeout: 20_000 })
    await diagram.scrollIntoViewIfNeeded()
    await diagram.hover()
    await expect(visible(page, TEST_IDS.MERMAID_TOOLBAR)).toBeVisible()
    // The diagram toolbar shows only while the pointer is over the diagram.
    await shot(cap, 'mermaid/diagram', { crop: visible(page, TEST_IDS.EDITOR_CONTENT), pad: 0, keepHover: true })

    await visible(page, TEST_IDS.MERMAID_BTN_EXPAND).click()
    // Two overlays mount (one per diagram host); the last one is on top.
    const viewer = visible(page, TEST_IDS.DIAGRAM_VIEWER).last()
    await expect(viewer).toBeVisible()
    await expect(viewer.getByTestId(TEST_IDS.DIAGRAM_VIEWER_SVG).locator('svg')).toBeVisible()
    // F fits the whole diagram in the viewer (the viewer's own shortcut).
    await page.keyboard.press('f')
    await shot(cap, 'mermaid/full-screen-viewer')

    await visible(page, TEST_IDS.CHAT_BUBBLE_BTN_OPEN).last().click()
    await expect(visible(page, TEST_IDS.CHAT_PANEL).last()).toBeVisible()
    await visible(page, TEST_IDS.CHAT_TEXTAREA).last().fill('Add a step for turning the heap every two weeks.')
    await shot(cap, 'mermaid/diagram-chat')
  } finally {
    await cap.close()
  }
})
