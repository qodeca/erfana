// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scene `transcribe`: the transcription dialog for an audio file, and the
 * Transcription settings with no key stored. Nothing is transcribed (no key,
 * no network). Guide pages: how-to/transcribe-audio-or-video.md, reference/settings.md.
 */

import { expect, test } from '@playwright/test'
import path from 'node:path'
import { TEST_IDS } from '../../../src/renderer/src/constants/testids'
import { launch, openProject, stubOpenDialog } from '../lib/app'
import { anySelected, shot } from '../lib/shots'

const ROWS = ['transcribe/transcription-dialog', 'transcribe/settings-transcription']

test('transcribe', async () => {
  test.skip(!anySelected(ROWS), 'no row of this scene selected')
  const cap = await launch()
  const { page, sandbox: sb } = cap
  try {
    await openProject(cap)
    await stubOpenDialog(cap, path.join(sb.project, 'recordings', 'committee-voice-note.m4a'))
    await page.getByTestId(TEST_IDS.PROJECT_TREE_BTN_IMPORT).click()
    await expect(page.getByTestId(TEST_IDS.TRANSCRIPTION_DIALOG)).toBeVisible({ timeout: 20_000 })
    await shot(cap, 'transcribe/transcription-dialog', { crop: page.getByTestId(TEST_IDS.DIALOG_CONTAINER), pad: 16 })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId(TEST_IDS.TRANSCRIPTION_DIALOG)).toHaveCount(0)

    await page.getByTestId(TEST_IDS.ACTIVITY_BAR_BTN_SETTINGS).first().click()
    const section = page.getByTestId(TEST_IDS.SETTINGS_SECTION_TRANSCRIPTION)
    await expect(section).toBeVisible()
    await section.scrollIntoViewIfNeeded()
    await expect(page.getByTestId(TEST_IDS.SETTINGS_INPUT_API_KEY)).toHaveValue('')
    await shot(cap, 'transcribe/settings-transcription', { crop: section, pad: 12 })
  } finally {
    await cap.close()
  }
})
