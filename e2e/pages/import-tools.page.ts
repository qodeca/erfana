// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Settings → Import tools Page Object Model (#250).
 *
 * Each format row carries `data-format` (`pdf` / `office` / `images`) and
 * `data-state` (`checking` / `ready` / `missing`), so a spec can wait for the
 * first detection result without reading styling.
 *
 * @see src/renderer/src/components/Settings/sections/ImportToolsSection.tsx
 */

import { Page, Locator, expect } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { byTestId } from '../utils/locators'

export type ImportFormat = 'pdf' | 'office' | 'images'
export type ImportFormatState = 'checking' | 'unchecked' | 'ready' | 'missing'

export class ImportToolsPage {
  constructor(private readonly page: Page) {}

  section(): Locator {
    return byTestId(this.page, TEST_IDS.SETTINGS_SECTION_IMPORT_TOOLS)
  }

  row(format: ImportFormat): Locator {
    return this.section().locator(
      `[data-testid="${TEST_IDS.SETTINGS_IMPORT_TOOL_STATUS}"][data-format="${format}"]`
    )
  }

  recheckButton(): Locator {
    return byTestId(this.page, TEST_IDS.SETTINGS_BTN_IMPORT_TOOLS_RECHECK)
  }

  liveRegion(): Locator {
    return byTestId(this.page, TEST_IDS.SETTINGS_IMPORT_TOOLS_LIVE)
  }

  /** The row's settled state, once the first detection result has arrived. */
  async waitForSettled(format: ImportFormat): Promise<ImportFormatState> {
    const row = this.row(format)
    await expect(row).toHaveAttribute('data-state', /^(ready|missing)$/, { timeout: 15_000 })
    return (await row.getAttribute('data-state')) as ImportFormatState
  }

  /** Press Check again and wait until the check finished (button enabled again). */
  async checkAgain(): Promise<void> {
    await this.recheckButton().click()
    await expect(this.recheckButton()).toHaveAttribute('aria-disabled', 'false', { timeout: 15_000 })
  }
}
