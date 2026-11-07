// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared guard of the `visual` Playwright project: every visual spec
 * (`e2e/visual-regression*.e2e.ts`) calls it before its `toHaveScreenshot`.
 */
import * as fs from 'fs'
import * as path from 'path'
import type { TestInfo } from '@playwright/test'

/** `snapshotDir` of the `visual` project in `playwright.config.ts`. */
const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots')

/**
 * Assert that a baseline exists for this platform. Throws to fail the test
 * loudly when the baseline is missing — previously this skipped silently,
 * which meant the first run on a new platform auto-wrote whatever the app
 * rendered as canonical (the autobaseline trap). Generate new baselines
 * via `npm run test:e2e:update-screenshots` and commit them in a PR.
 *
 * No-ops when running under `--update-snapshots` (the update script sets
 * `updateSnapshots !== 'none'`, signalling the operator intends to write).
 */
export function assertBaselineExists(screenshotName: string, testInfo: TestInfo): void {
  if (testInfo.config.updateSnapshots !== 'none') return
  // Path mirrors snapshotPathTemplate: {snapshotDir}/{arg}-{platform}{ext}
  // where {arg} = screenshotName (without .png), {platform} = process.platform
  const nameWithoutExt = screenshotName.replace(/\.png$/, '')
  const baselinePath = path.join(SCREENSHOT_DIR, `${nameWithoutExt}-${process.platform}.png`)
  if (fs.existsSync(baselinePath)) return
  throw new Error(
    `Missing visual baseline: ${nameWithoutExt}-${process.platform}.png. ` +
    `Generate via 'npm run test:e2e:update-screenshots' and commit the new baseline in a PR. ` +
    `The auto-write-on-first-run path is intentionally closed (config: updateSnapshots: 'none').`
  )
}
