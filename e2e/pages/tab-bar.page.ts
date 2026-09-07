// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Editor tab-bar Page Object Model.
 *
 * Tabs carry dynamic testids hashed from the file's ABSOLUTE path, which makes
 * them awkward to address from a test: the spec would have to reproduce the
 * renderer's exact path string, separators and Windows drive-letter casing
 * included. `ProjectTreePage` already documents that trap for tree nodes.
 *
 * So this POM addresses tabs the way a user does — by the filename printed on
 * them, and by the close button's accessible name (`Close <file>`). Active
 * state is read from dockview's own `.dv-active-tab` wrapper, which is the
 * only place the selection actually lives.
 *
 * @see src/renderer/src/components/Tabs/EditorTab.tsx
 * @see src/renderer/src/components/Tabs/useTabContextMenu.tsx
 */

import { Page, Locator, expect } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { byTestId } from '../utils/locators'

export class TabBarPage {
  constructor(private readonly page: Page) {}

  /** Every editor tab currently open (excludes the non-closable Welcome tab). */
  allTabs(): Locator {
    return this.page.locator('.editor-tab')
  }

  /** One editor tab, addressed by the filename it displays. */
  tab(fileName: string): Locator {
    return this.page.locator('.editor-tab').filter({
      has: this.page.locator('.editor-tab-filename', { hasText: fileName })
    })
  }

  /** The active editor tab, whichever it is. */
  activeTab(): Locator {
    return this.page.locator('.dv-active-tab .editor-tab')
  }

  /** The unsaved-changes dot on a tab. Absent entirely when the file is clean. */
  dirtyDot(fileName: string): Locator {
    return this.tab(fileName).getByLabel('Unsaved changes')
  }

  /** A tab's close (×) button. */
  closeButton(fileName: string): Locator {
    return this.tab(fileName).getByRole('button', { name: `Close ${fileName}`, exact: true })
  }

  /** The Welcome ("Home") tab, which cannot be closed. */
  welcomeTab(): Locator {
    return this.page.locator('.welcome-tab')
  }

  // ---------------------------------------------------------------------------
  // Waits
  // ---------------------------------------------------------------------------

  /** Wait until the named file has a tab. */
  async waitForTab(fileName: string): Promise<void> {
    await expect(this.tab(fileName)).toBeVisible({ timeout: 10_000 })
  }

  /** Wait until the named file has no tab. */
  async waitForTabGone(fileName: string): Promise<void> {
    await expect(this.tab(fileName)).toHaveCount(0, { timeout: 10_000 })
  }

  /** Assert which file the active tab belongs to. */
  async expectActive(fileName: string): Promise<void> {
    await expect(this.activeTab().locator('.editor-tab-filename')).toHaveText(fileName)
  }

  /** Click a tab to bring its panel forward. */
  async activate(fileName: string): Promise<void> {
    await this.tab(fileName).click()
    await this.expectActive(fileName)
  }

  // ---------------------------------------------------------------------------
  // Tab context menu
  //
  // Rendered through the shared `ContextMenu` primitive into `#portal-root`,
  // so it is page-scoped and shares its testid with every other context menu.
  // ---------------------------------------------------------------------------

  contextMenu(): Locator {
    return byTestId(this.page, TEST_IDS.CONTEXT_MENU)
  }

  contextMenuItem(label: string): Locator {
    return this.contextMenu().getByRole('menuitem').filter({ hasText: label })
  }

  /** Right-click a tab and invoke one of its entries (Close / Close Others / Close All). */
  async runContextMenuAction(fileName: string, label: string): Promise<void> {
    const target = this.tab(fileName)
    await expect(target).toBeVisible()
    await target.click({ button: 'right' })
    await expect(this.contextMenu()).toBeVisible({ timeout: 5000 })

    const item = this.contextMenuItem(label)
    await expect(item).toBeVisible()
    await item.click()
    await expect(this.contextMenu()).toHaveCount(0, { timeout: 5000 })
  }
}
