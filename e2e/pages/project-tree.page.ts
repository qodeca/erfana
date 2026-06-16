// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Project tree Page Object Model.
 *
 * Encapsulates tree navigation, file clicks, and folder toggling.
 * Does NOT include openProject/openProjectViaUI – those require
 * ElectronApplication and remain standalone functions in helpers.ts.
 *
 * @see e2e/utils/helpers.ts - Backward-compatible adapter
 */

import { Page, Locator, expect } from '@playwright/test'
import { sep } from 'path'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import type { GitDisplayStatus } from '../../src/shared/ipc/git-schema'
import { byTestId, byDynamicTestId, waitForTestId, waitForTestIdHidden } from '../utils/locators'

export class ProjectTreePage {
  constructor(private readonly page: Page) {}

  async openProjectTree(): Promise<void> {
    await byTestId(this.page, TEST_IDS.ACTIVITY_BAR_BTN_FILES).click()
    await waitForTestId(this.page, TEST_IDS.PROJECT_TREE)
  }

  // TODO(spec-018): Extract to SettingsPage or AppPage when scope grows
  async openSettings(): Promise<void> {
    await byTestId(this.page, TEST_IDS.ACTIVITY_BAR_BTN_SETTINGS).click()
    await waitForTestId(this.page, TEST_IDS.SETTINGS_OVERLAY)
  }

  async closeSettings(): Promise<void> {
    await this.page.keyboard.press('Escape')
    await waitForTestIdHidden(this.page, TEST_IDS.SETTINGS_OVERLAY)
  }

  async clickFileInTree(filePath: string): Promise<void> {
    const node = byDynamicTestId(this.page, TEST_IDS.PROJECT_TREE_NODE, filePath)
    await node.click()
  }

  async toggleFolder(folderPath: string): Promise<void> {
    const toggle = byDynamicTestId(this.page, TEST_IDS.PROJECT_TREE_TOGGLE, folderPath)
    await toggle.click()
  }

  async clickFileByName(fileName: string): Promise<void> {
    const fileNode = this.page
      .locator(`[data-testid^="${TEST_IDS.PROJECT_TREE_NODE_FILE}-"]`)
      .filter({ hasText: fileName })

    await expect(fileNode).toBeVisible({ timeout: 5000 })
    await fileNode.click()

    await waitForTestId(this.page, TEST_IDS.EDITOR_CONTENT, { timeout: 10000 })
  }

  // ---------------------------------------------------------------------------
  // Toolbar action buttons
  // ---------------------------------------------------------------------------

  /** The toolbar "Open project" / "Change project" button. */
  openProjectButton(): Locator {
    return byTestId(this.page, TEST_IDS.PROJECT_TREE_BTN_OPEN)
  }

  /** The toolbar "Import" button (rendered only when a project is open). */
  toolbarImportButton(): Locator {
    return byTestId(this.page, TEST_IDS.PROJECT_TREE_BTN_IMPORT)
  }

  /** Click the toolbar Import button (asserts it is visible first). */
  async clickToolbarImport(): Promise<void> {
    const btn = this.toolbarImportButton()
    await expect(btn).toBeVisible({ timeout: 5000 })
    await btn.click()
  }

  // ---------------------------------------------------------------------------
  // Git status decorations (badges on files, dots on folders)
  //
  // Node test-ids are a djb2 hash of the node's ABSOLUTE path, so matching by
  // test-id requires the test to reproduce the renderer's exact path string
  // (separator AND drive-letter casing) byte-for-byte. On Windows the opened
  // project path's casing can differ from what `mkdtemp` returned, which
  // changes the hash. To stay robust, these helpers locate nodes by the
  // `data-path` attribute (also set on the testid'd `.project-tree-item`),
  // matched on its trailing path segment + `data-type`. Both the file
  // letter-badge and the folder dot render as a single `role="img"` span
  // carrying `data-git-status` (see GitStatusBadge.tsx).
  //
  // `relPath` is the project-relative path with `/` separators; it is converted
  // to the OS separator and used in a CSS `[data-path$="…"]` suffix match.
  // ---------------------------------------------------------------------------

  /** OS-separator suffix of a project-relative path (e.g. `src\\components`). */
  private nativeSuffix(relPath: string): string {
    return sep + relPath.split('/').join(sep)
  }

  /** CSS-escape a value for use inside a `[data-path$="…"]` selector. */
  private cssEscapeAttr(value: string): string {
    // Backslash and double-quote are the only chars that break a quoted
    // attribute selector here; escape both.
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  }

  /** The FILE node item (`.project-tree-item`) for a project-relative path. */
  fileRow(relPath: string): Locator {
    const suffix = this.cssEscapeAttr(this.nativeSuffix(relPath))
    return this.page.locator(
      `[data-testid^="${TEST_IDS.PROJECT_TREE_NODE_FILE}-"][data-type="file"][data-path$="${suffix}"]`
    )
  }

  /** The FOLDER node item (`.project-tree-item`) for a project-relative path. */
  folderRow(relPath: string): Locator {
    const suffix = this.cssEscapeAttr(this.nativeSuffix(relPath))
    return this.page.locator(
      `[data-testid^="${TEST_IDS.PROJECT_TREE_NODE_FOLDER}-"][data-type="directory"][data-path$="${suffix}"]`
    )
  }

  /** The wrapping treeitem (`.project-tree-node`) for a project-relative folder. */
  private folderTreeItem(relPath: string): Locator {
    const suffix = this.cssEscapeAttr(this.nativeSuffix(relPath))
    return this.page.locator(
      `.project-tree-node[role="treeitem"][data-type="directory"][data-path$="${suffix}"]`
    )
  }

  /**
   * The ROOT project folder item. It is the single top-level ProjectTreeNode
   * (`rootFolderNode`) and is a direct child of `.project-tree-content`, so it
   * cannot be addressed by a relative-path suffix (empty rel). Matched
   * structurally instead.
   */
  rootFolderRow(): Locator {
    return this.page.locator(
      '.project-tree-content > .project-tree-node[data-type="directory"] > .project-tree-item'
    )
  }

  // The git badge/dot is a `role="img"` span carrying `data-git-status`. Scope
  // to that span via the attribute — the row also contains lucide chevron /
  // file icons that render as `role="img"`, so a bare getByRole('img') would
  // match multiple elements and trip Playwright strict mode.

  /** The git letter-badge inside a FILE node row. */
  gitBadge(relPath: string): Locator {
    return this.fileRow(relPath).getByRole('img').and(this.page.locator('[data-git-status]'))
  }

  /** The git dot inside a FOLDER node row. */
  gitDot(relPath: string): Locator {
    return this.folderRow(relPath).getByRole('img').and(this.page.locator('[data-git-status]'))
  }

  /** The git dot inside the ROOT project folder row. */
  gitDotRoot(): Locator {
    return this.rootFolderRow().getByRole('img').and(this.page.locator('[data-git-status]'))
  }

  /**
   * Assert a decoration is visible AND carries the expected git status.
   * Both assertions auto-retry, so this also waits for the status to settle.
   */
  async expectStatus(locator: Locator, status: GitDisplayStatus): Promise<void> {
    await expect(locator).toBeVisible()
    await expect(locator).toHaveAttribute('data-git-status', status)
  }

  /**
   * Assert a node row carries no git decoration. The row always has a chevron /
   * file-icon `role="img"`, so scope strictly to the `[data-git-status]` badge
   * span — only that element signals a git status.
   */
  async expectNoStatus(rowLocator: Locator): Promise<void> {
    const badge = rowLocator.getByRole('img').and(this.page.locator('[data-git-status]'))
    await expect(badge).toHaveCount(0)
  }

  /**
   * Expand every ancestor folder (project-relative paths, root→leaf order) so
   * descendant nodes are mounted. Child nodes — and their git dots — only exist
   * in the DOM once their parent folder is expanded. aria-expanded lives on the
   * wrapping treeitem; the click toggle is the inner `.file-icon` span.
   */
  async expandTo(ancestorRelPaths: string[]): Promise<void> {
    for (const relPath of ancestorRelPaths) {
      const treeItem = this.folderTreeItem(relPath)
      await expect(treeItem).toBeVisible()
      const expanded = await treeItem.getAttribute('aria-expanded')
      if (expanded !== 'true') {
        await this.folderRow(relPath).click()
      }
      await expect(treeItem).toHaveAttribute('aria-expanded', 'true')
    }
  }
}
