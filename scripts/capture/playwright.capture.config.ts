// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Playwright config for the documentation capture (#138). Its own file, so
 * the e2e config (`playwright.config.ts`) is untouched: one worker, no
 * retries (nothing is retried silently, spec § 7), no trace, no video except
 * the README demo's own recording.
 *
 * Run it through `npm run docs:screenshots`, which builds the app, prepares
 * the sandbox and sets the environment the scenes read.
 */
import { defineConfig } from '@playwright/test'
import path from 'node:path'

const sandbox = process.env.ERFANA_CAPTURE_SANDBOX

export default defineConfig({
  testDir: './scenes',
  testMatch: '**/*.capture.ts',
  timeout: 3 * 60_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: sandbox ? path.join(sandbox, 'playwright') : undefined,
  use: {
    trace: 'off',
    screenshot: 'off',
    video: 'off'
  }
})
