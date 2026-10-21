// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Settings → Import tools (#250): the optional tools' status is shown before
 * any file is picked, and Check again re-runs detection in main without a
 * restart, rate-limited.
 *
 * Host-independent on purpose: whether LibreOffice and ImageMagick are
 * installed differs per machine, so the spec asserts that every row settles
 * on a state, that a missing tool shows a hint and a ready one does not, and
 * that the recheck round-trip and its rate limit behave – not which tools exist.
 */

import { test, expect } from './fixtures/index'
import { openSettings } from './utils/helpers'
import { ImportToolsPage } from './pages/import-tools.page'

test.describe('Settings – Import tools', () => {
  test('shows each format’s status and a hint only for a missing tool', async ({ window }) => {
    await openSettings(window)
    const tools = new ImportToolsPage(window)
    await expect(tools.section()).toBeVisible()

    expect(await tools.waitForSettled('pdf')).toBe('ready')
    for (const format of ['office', 'images'] as const) {
      const state = await tools.waitForSettled(format)
      const row = tools.row(format)
      // The state is spelled out in words, not colour alone.
      await expect(row).toContainText(state === 'ready' ? 'Ready' : 'not found')
      await expect(row.getByText(/then choose Check again/)).toHaveCount(state === 'missing' ? 1 : 0)
    }
  })

  test('Check again re-runs detection, then a quick second press is rate-limited', async ({ window }) => {
    await openSettings(window)
    const tools = new ImportToolsPage(window)
    const before = await tools.waitForSettled('office')

    // Startup detection may have run under 3 s ago, so the first press can be
    // throttled; retry the press until a real probe has run.
    await expect(async () => {
      await tools.checkAgain()
      await expect(tools.liveRegion()).toHaveText('Check complete.', { timeout: 1_000 })
    }).toPass({ timeout: 20_000, intervals: [1_000] })
    // Same machine, same tools: a fresh probe agrees with the startup result.
    expect(await tools.waitForSettled('office')).toBe(before)

    await tools.checkAgain()
    await expect(tools.liveRegion()).toHaveText('Checked a moment ago – try again in a few seconds.')
  })

  test('Check again is reachable and operable from the keyboard', async ({ window }) => {
    await openSettings(window)
    const tools = new ImportToolsPage(window)
    await tools.waitForSettled('office')

    await tools.recheckButton().focus()
    await expect(tools.recheckButton()).toBeFocused()
    await window.keyboard.press('Enter')

    await expect(tools.liveRegion()).toHaveText(/Check complete\.|Checked a moment ago/, { timeout: 15_000 })
  })
})
