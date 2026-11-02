// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guide task: docs/user-guide/how-to/transcribe-audio-or-video.md
 *
 * Follows the page step by step as a newcomer would, finding every control by
 * the label the page names. The only stub is the native file picker, which
 * Playwright cannot drive. The audio file is generated with macOS `say`, and
 * transcription uses the Local (whisper.cpp) backend with the real model
 * downloaded through Settings – no OpenAI key is available in the test home.
 */

import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { stubDialog } from 'electron-playwright-helpers'
import { test, expect } from '../fixtures'

const SPOKEN = 'Hello from the Erfana user guide. This is a transcription test.'

test.describe('Guide: transcribe audio or video', () => {
  test.skip(process.platform !== 'darwin', 'Audio fixture is generated with macOS say')

  test('transcribes an audio file with the local backend', async ({
    appWithTestProject: app,
    windowWithTestProject: window,
    testProject
  }) => {
    // Model download (tiny, ~75 MB) + transcription.
    test.setTimeout(600_000)

    // Audio fixture lives outside the project, as a user's recording would.
    const mediaDir = fs.mkdtempSync(path.join(path.dirname(testProject.path), 'guide-media-'))
    const aiff = path.join(mediaDir, 'voice-note.aiff')
    const wav = path.join(mediaDir, 'voice-note.wav')
    execFileSync('say', ['-o', aiff, SPOKEN])
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', aiff, wav])

    // The welcome screen also has an "Import a file" button; the project-tree
    // toolbar one comes first in the DOM.
    const importButton = window.getByRole('button', { name: 'Import a file' }).first()

    await test.step('Before you start: open a project', async () => {
      // The fixture opened the test project; the project tree is visible.
      await expect(importButton).toBeVisible()
    })

    await test.step('Before you start: In Settings, under Transcription, choose a Backend – Local (whisper.cpp): pick a Whisper model, then select Download model', async () => {
      // settings.md: "Open **Settings** with the gear at the bottom of the left activity bar."
      await window.getByRole('button', { name: 'Settings', exact: true }).click()
      await expect(window.getByRole('heading', { name: 'Transcription' })).toBeVisible()

      const backend = window.getByLabel('Backend')
      await backend.selectOption({ label: 'Local (whisper.cpp)' })

      const model = window.getByLabel('Whisper model')
      await expect(model).toBeVisible()
      const tinyLabel = await model
        .locator('option')
        .filter({ hasText: /tiny/i })
        .first()
        .textContent()
      await model.selectOption({ label: (tinyLabel ?? '').trim() })

      await window.getByRole('button', { name: 'Download model' }).click()
      // settings.md: Model status "Shows Ready ... for the selected local model".
      // Scope to the Transcription section: the smallest element holding both
      // the section heading and the Whisper model list.
      const transcriptionSection = window
        .locator('div, section')
        .filter({ has: window.getByRole('heading', { name: 'Transcription' }) })
        .filter({ has: window.getByLabel('Whisper model') })
        .last()
      // The Model status row shows "Ready" twice (description and badge).
      await expect(transcriptionSection.getByText('Ready', { exact: true }).first()).toBeVisible({
        timeout: 480_000
      })

      await window.keyboard.press('Escape')
      await expect(window.getByRole('heading', { name: 'Transcription' })).toBeHidden()
    })

    await test.step('1. In the project tree, select the Import a file toolbar button', async () => {
      // 2. "In the system picker, choose one audio or video file." – native picker stubbed.
      await stubDialog(app, 'showOpenDialog', { filePaths: [wav], canceled: false })
      await importButton.click()
    })

    const dialog = window.getByRole('dialog', { name: 'Transcribe audio' })

    await test.step('2. Erfana opens the Transcribe audio or Transcribe video dialog', async () => {
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      await expect(dialog).toContainText('voice-note.wav')
    })

    await test.step('3. Under Language, choose a language or Auto-detect', async () => {
      await dialog.getByLabel('Language').selectOption({ label: 'Auto-detect' })
    })

    await test.step('4. Select Start transcription', async () => {
      await dialog.getByRole('button', { name: 'Start transcription' }).click()
    })

    await test.step('5. When the dialog shows Transcription complete, select Done', async () => {
      await expect(dialog.getByText('Transcription complete')).toBeVisible({ timeout: 180_000 })
      await dialog.getByRole('button', { name: 'Done' }).click()
      await expect(dialog).toBeHidden()
    })

    await test.step("5. Erfana opens the Markdown transcript, saved in the project's import/ folder", async () => {
      const importDir = path.join(testProject.path, 'import')
      await expect
        .poll(() => (fs.existsSync(importDir) ? fs.readdirSync(importDir) : []))
        .toContainEqual(expect.stringMatching(/^voice-note.*\.md$/))
      const mdName = fs.readdirSync(importDir).find((f) => /^voice-note.*\.md$/.test(f)) ?? ''
      const transcript = fs.readFileSync(path.join(importDir, mdName), 'utf8')
      expect(transcript.toLowerCase()).toContain('transcription')
      // The transcript is open in the editor (a tab with its name).
      await expect(window.getByText(mdName).first()).toBeVisible()
    })

    fs.rmSync(mediaDir, { recursive: true, force: true })
  })
})
