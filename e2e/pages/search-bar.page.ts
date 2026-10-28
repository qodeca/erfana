// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Find-bar Page Object Model.
 *
 * The bar is one component in front of three different providers — Monaco, the
 * rendered markdown preview, and `findInPage` inside the native HTML preview —
 * so the same locators serve every view mode, and the match label is the
 * clearest signal that the right provider is wired up.
 *
 * The label is `"<ordinal> of <total>"` when there are hits, `"No results"`
 * when a query matches nothing, and empty when the query is empty. Parsing it
 * here keeps that format in one place.
 *
 * @see src/renderer/src/components/Search/SearchBar.tsx
 * @see src/renderer/src/hooks/useSearchKeyboard.ts
 */

import { Page, Locator, expect } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { byTestId } from '../utils/locators'

/** The parsed state of the match-count label. */
export interface MatchCount {
  ordinal: number
  total: number
}

export class SearchBarPage {
  constructor(private readonly page: Page) {}

  bar(): Locator {
    return byTestId(this.page, TEST_IDS.SEARCH_BAR)
  }

  input(): Locator {
    return byTestId(this.page, TEST_IDS.SEARCH_BAR_INPUT)
  }

  countLabel(): Locator {
    return byTestId(this.page, TEST_IDS.SEARCH_BAR_COUNT)
  }

  caseToggle(): Locator {
    return byTestId(this.page, TEST_IDS.SEARCH_BAR_TOGGLE_CASE)
  }

  wordToggle(): Locator {
    return byTestId(this.page, TEST_IDS.SEARCH_BAR_TOGGLE_WORD)
  }

  nextButton(): Locator {
    return byTestId(this.page, TEST_IDS.SEARCH_BAR_BTN_NEXT)
  }

  prevButton(): Locator {
    return byTestId(this.page, TEST_IDS.SEARCH_BAR_BTN_PREV)
  }

  closeButton(): Locator {
    return byTestId(this.page, TEST_IDS.SEARCH_BAR_BTN_CLOSE)
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Wait for the bar to be open with its input focused and ready to type into. */
  async waitForOpen(): Promise<void> {
    await expect(this.bar()).toBeVisible({ timeout: 10_000 })
    await expect(this.input()).toBeFocused()
  }

  async waitForClosed(): Promise<void> {
    await expect(this.bar()).toHaveCount(0, { timeout: 10_000 })
  }

  /** Type a query, replacing whatever the bar was seeded with. */
  async search(query: string): Promise<void> {
    await this.input().fill(query)
  }

  // ---------------------------------------------------------------------------
  // Match count
  // ---------------------------------------------------------------------------

  /** The label's raw text: `"2 of 5"`, `"No results"`, or empty. */
  async countText(): Promise<string> {
    return (await this.countLabel().textContent())?.trim() ?? ''
  }

  /** Parse the label, or return null when it is not reporting matches. */
  async matchCount(): Promise<MatchCount | null> {
    const match = /^(\d+) of (\d+)$/.exec(await this.countText())
    return match ? { ordinal: Number(match[1]), total: Number(match[2]) } : null
  }

  /** Wait until the label settles on a given total, and return it. */
  async waitForTotal(total: number): Promise<void> {
    await expect
      .poll(async () => (await this.matchCount())?.total ?? null, { timeout: 10_000 })
      .toBe(total)
  }

  /** Wait until the highlighted match is the nth one. */
  async waitForOrdinal(ordinal: number): Promise<void> {
    await expect
      .poll(async () => (await this.matchCount())?.ordinal ?? null, { timeout: 10_000 })
      .toBe(ordinal)
  }
}
