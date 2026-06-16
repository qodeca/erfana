// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E Test for Audio Import with Transcription
 *
 * Tests the full UI lifecycle of the audio transcription feature:
 * file dialog → validation → TranscriptionDialog → language select →
 * progress → real OpenAI transcription → success → output file.
 *
 * No mocks – this test calls the real OpenAI API. The only stub is the
 * native file dialog (Playwright cannot interact with OS dialogs).
 *
 * Requires OPENAI_API_KEY environment variable. Skips if not set.
 *
 * @see Issue #75 - Media import with transcription
 * @see Spec #009 - Media import with transcription specification
 */

import { test, expect, _electron as electron } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'
import { stubDialog } from 'electron-playwright-helpers'
import {
  TEST_IDS,
  byTestId,
  waitForTestId,
  waitForTestIdHidden,
  waitForAppReady,
  openProject,
  closeApp,
  createTestProject,
  createTempUserDataDir
} from './utils/helpers'
import { IMPORT } from '../src/shared/constants'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Path to the WAV fixture (~0.5 MB, ~34s, Harvard sentences).
 * WAV chosen over MP3 because it's the smallest fixture (0.5 MB vs 5.9 MB)
 * and avoids lossy codec variations that could affect transcription consistency.
 */
const AUDIO_FIXTURE = path.resolve(
  __dirname,
  '..',
  'tests',
  'fixtures',
  'audio',
  'supported',
  'speech-harvard-female.wav'
)

/** Expected output filename after transcription */
const OUTPUT_FILENAME = 'speech-harvard-female.md'

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const TRANSCRIPTION_ENABLED = process.env.ERFANA_E2E_TRANSCRIPTION === '1'

// Project-level gating handles "should this suite run at all" via
// ERFANA_E2E_TRANSCRIPTION=1 in playwright.config.ts (transcription
// project's grepInvert). When the operator HAS opted in but forgot to
// provide a key, fail loudly at load time — the previous `test.skip`
// pattern silently green-ticked the run, masking regressions in the
// keyed code path (see capability-summary reporter for the audit line).
if (TRANSCRIPTION_ENABLED && !OPENAI_API_KEY) {
  throw new Error(
    'OPENAI_API_KEY is required when ERFANA_E2E_TRANSCRIPTION=1. ' +
      'Either unset ERFANA_E2E_TRANSCRIPTION to skip the transcription project ' +
      'or provide an OPENAI_API_KEY.'
  )
}

test.describe('Audio transcription', () => {
  // Disable retries – each run makes a real (paid) OpenAI API call.
  // A late assertion failure should not trigger a second transcription.
  test.describe.configure({ retries: 0 })

  test('imports audio file and produces markdown output', async () => {
    // Timeout budget: ~15s app launch + ~90s max API wait + ~15s dialog flow = ~120s
    test.setTimeout(120_000)

    // Phase 1: Setup
    const { projectPath, cleanup: cleanupProject } = await createTestProject({
      'test.md': '# Test Project\n\nSeed file for audio transcription E2E test.\n'
    })
    const { userDataDir, cleanup: cleanupUserData } = await createTempUserDataDir(
      'audio-transcription-happy-path'
    )

    const electronApp = await electron.launch({
      args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    let window: Awaited<ReturnType<typeof electronApp.firstWindow>> | undefined

    try {
      window = await electronApp.firstWindow()
      await waitForAppReady(window)
      await openProject(window, projectPath)

      // Wait for project tree to confirm project is loaded
      await waitForTestId(window, TEST_IDS.PROJECT_TREE, { timeout: 10000 })

      // Phase 2: Set the real OpenAI API key via IPC
      // Safe cast: OPENAI_API_KEY is guaranteed non-null by test.skip guard above
      const apiKey = OPENAI_API_KEY as string
      const setKeyResult = await window.evaluate(
        (key: string) => window.api.transcription.setApiKey(key),
        apiKey
      )
      expect(setKeyResult).toHaveProperty('success', true)

      // Phase 3: Trigger import via WelcomePanel "Import..." button
      // Stub the native file dialog to return our audio fixture
      // (Playwright cannot interact with OS-native dialogs)
      await stubDialog(electronApp, 'showOpenDialog', {
        filePaths: [AUDIO_FIXTURE],
        canceled: false
      })

      const importButton = byTestId(window, TEST_IDS.WELCOME_BTN_IMPORT)
      await expect(importButton).toBeVisible({ timeout: 10000 })
      await importButton.click()

      // Phase 4: Verify TranscriptionDialog opens with language selection
      const dialog = byTestId(window, TEST_IDS.TRANSCRIPTION_DIALOG)
      await waitForTestId(window, TEST_IDS.TRANSCRIPTION_DIALOG, { timeout: 15000 })

      // File name should be displayed
      await expect(dialog).toContainText('speech-harvard-female.wav')

      // Language select should be visible
      const languageSelect = byTestId(window, TEST_IDS.TRANSCRIPTION_LANGUAGE_SELECT)
      await expect(languageSelect).toBeVisible()

      // Select English
      await languageSelect.selectOption('en')

      // Start button should be visible
      const startBtn = byTestId(window, TEST_IDS.TRANSCRIPTION_BTN_START)
      await expect(startBtn).toBeVisible()

      // Phase 5: Start transcription and verify progress state
      await startBtn.click()

      // Progress bar should appear
      await waitForTestId(window, TEST_IDS.TRANSCRIPTION_PROGRESS_BAR, { timeout: 10000 })

      // Cancel button should be visible during transcription
      const cancelBtn = byTestId(window, TEST_IDS.TRANSCRIPTION_BTN_CANCEL)
      await expect(cancelBtn).toBeVisible()

      // Phase 6: Wait for success (real API call – may take 30–60s)
      const successMsg = dialog.locator('.transcription-success-message')
      await expect(successMsg).toHaveText('Transcription complete', { timeout: 90000 })
      await expect(dialog).toContainText(OUTPUT_FILENAME)

      // Done button should be visible in success state
      const doneBtn = byTestId(window, TEST_IDS.TRANSCRIPTION_BTN_DONE)
      await expect(doneBtn).toBeVisible()

      // Phase 7: Close dialog and verify output file
      await doneBtn.click()
      await waitForTestIdHidden(window, TEST_IDS.TRANSCRIPTION_DIALOG, { timeout: 10000 })

      // Verify the output file exists on disk
      const expectedOutputPath = path.join(projectPath, IMPORT.DIR_NAME, OUTPUT_FILENAME)
      await fs.promises.access(expectedOutputPath)

      // Verify file content has expected frontmatter and transcript text
      const fileContent = await fs.promises.readFile(expectedOutputPath, 'utf-8')
      expect(fileContent).toContain('source: "speech-harvard-female.wav"')
      // Harvard sentences – verify transcript contains recognizable words.
      // Speech-to-text is non-deterministic, so check multiple candidates
      // and pass if at least 2 match (resilient to minor transcription variations).
      const harvardWords = ['birch', 'canoe', 'planks', 'smooth', 'glue', 'sheet', 'background']
      const lowerContent = fileContent.toLowerCase()
      const matchCount = harvardWords.filter((w) => lowerContent.includes(w)).length
      expect(matchCount).toBeGreaterThanOrEqual(2)
    } finally {
      await closeApp(electronApp, window)
      await cleanupProject()
      await cleanupUserData()
    }
  })
})
