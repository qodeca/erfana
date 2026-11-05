// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Panel toolbar overflow (#451) Page Object Model.
 *
 * Reads a panel header row the way a user meets it: a toolbar action is
 * reachable when its button is whole inside the row, or when the row's
 * "More actions" (…) button opens a menu that lists it. The Toolbar overflow
 * card (docs/design-system/system/patterns/toolbar-overflow) is the contract;
 * the menu labels below are its "Menu label" column.
 *
 * The rows are addressed by the class names the panels have always used, so the
 * same spec ran against the app before the overflow menu existed (and failed).
 */

import { Page, Locator, expect } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'

/** A row button's test id → the label it carries in the overflow menu (card table). */
export const MENU_LABEL_BY_TEST_ID: Readonly<Record<string, string>> = {
  [TEST_IDS.TERMINAL_BTN_CAPTURE_SCREEN]: 'Capture screen',
  [TEST_IDS.TERMINAL_BTN_CAPTURE_WINDOW]: 'Capture window',
  [TEST_IDS.TERMINAL_BTN_CAPTURE_AREA]: 'Capture area',
  [TEST_IDS.TERMINAL_BTN_CAMERA]: 'Capture photo',
  [TEST_IDS.TERMINAL_BTN_SCROLL]: 'Scroll to bottom',
  [TEST_IDS.TERMINAL_BTN_RESTART]: 'Restart terminal',
  [TEST_IDS.TERMINAL_BTN_LOCK]: 'Lock scroll to bottom',
  [TEST_IDS.TERMINAL_BTN_EXPAND]: 'Maximize terminal',
  [TEST_IDS.PROJECT_TREE_BTN_OPEN]: 'Change project',
  [TEST_IDS.PROJECT_TREE_BTN_CLOSE]: 'Close project',
  [TEST_IDS.PROJECT_TREE_BTN_NEW_FILE]: 'Create new markdown file',
  [TEST_IDS.PROJECT_TREE_BTN_NEW_FOLDER]: 'Create new folder',
  [TEST_IDS.PROJECT_TREE_BTN_IMPORT]: 'Import a file',
  [TEST_IDS.PROJECT_TREE_BTN_REFRESH]: 'Refresh',
  // The Markdown toolbar (#461): the menu label is the button's accessible name.
  [TEST_IDS.TOOLBAR_BTN_BOLD]: 'Bold',
  [TEST_IDS.TOOLBAR_BTN_ITALIC]: 'Italic',
  [TEST_IDS.TOOLBAR_BTN_STRIKETHROUGH]: 'Strikethrough',
  [TEST_IDS.TOOLBAR_BTN_CODE]: 'Inline code',
  [TEST_IDS.TOOLBAR_BTN_LINK]: 'Insert link',
  [TEST_IDS.TOOLBAR_BTN_IMAGE]: 'Insert image',
  [TEST_IDS.TOOLBAR_BTN_HEADING]: 'Heading 1',
  [TEST_IDS.TOOLBAR_BTN_LIST]: 'Bullet list',
  [TEST_IDS.TOOLBAR_BTN_LIST_ORDERED]: 'Numbered list',
  [TEST_IDS.TOOLBAR_BTN_SEARCH]: 'Find',
  [TEST_IDS.VIEW_MODE_BTN_EDITOR]: 'Editor only',
  [TEST_IDS.VIEW_MODE_BTN_SPLIT_HORIZONTAL]: 'Split horizontal',
  [TEST_IDS.VIEW_MODE_BTN_SPLIT]: 'Split vertical',
  [TEST_IDS.VIEW_MODE_BTN_PREVIEW]: 'Preview only',
  [TEST_IDS.TOOLBAR_BTN_EXPORT_PDF]: 'Export to PDF',
  [TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX]: 'Export to Word',
  // The Mermaid toolbar (#461): a direction's label is its tooltip.
  [`${TEST_IDS.MERMAID_DIRECTION_BTN}-TB`]: 'Top to Bottom',
  [`${TEST_IDS.MERMAID_DIRECTION_BTN}-TD`]: 'Top Down',
  [`${TEST_IDS.MERMAID_DIRECTION_BTN}-BT`]: 'Bottom to Top',
  [`${TEST_IDS.MERMAID_DIRECTION_BTN}-LR`]: 'Left to Right',
  [`${TEST_IDS.MERMAID_DIRECTION_BTN}-RL`]: 'Right to Left',
  [TEST_IDS.MERMAID_BTN_EXPAND]: 'View fullscreen'
}

/** How a toolbar action was reached. */
export type Reach = 'row' | 'menu' | 'unreachable'

/** Sub-pixel slack when comparing a button's box against its row's. */
const BOX_SLACK_PX = 0.5

interface Box {
  x: number
  y: number
  width: number
  height: number
}

function inside(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x - BOX_SLACK_PX &&
    inner.y >= outer.y - BOX_SLACK_PX &&
    inner.x + inner.width <= outer.x + outer.width + BOX_SLACK_PX &&
    inner.y + inner.height <= outer.y + outer.height + BOX_SLACK_PX
  )
}

export class ToolbarOverflowPage {
  constructor(private readonly page: Page) {}

  /** The terminal panel's header row. */
  terminalHeader(): Locator {
    return this.page.locator(`[data-testid="${TEST_IDS.TERMINAL_PANEL}"] .sidebar-panel-header`)
  }

  /** The project panel's header row (title and filter toggle). */
  projectHeader(): Locator {
    return this.page.locator('.project-panel .sidebar-panel-header')
  }

  /** The project tree's project row (project name and its buttons). */
  projectRow(): Locator {
    return this.page.locator(`[data-testid="${TEST_IDS.PROJECT_TREE}"] .project-tree-path`)
  }

  /** The Markdown editor panel's toolbar (#461). */
  markdownToolbar(): Locator {
    return this.page.locator(`[data-testid="${TEST_IDS.MARKDOWN_TOOLBAR}"]`)
  }

  /** The first Mermaid diagram's toolbar in the preview (#461). */
  mermaidToolbar(): Locator {
    return this.page.locator(`[data-testid="${TEST_IDS.MERMAID_TOOLBAR}"]`).first()
  }

  /**
   * A Mermaid toolbar's button group – the part that takes the pointer (the row
   * itself lets clicks through to the diagram), so hover this to reveal it.
   */
  mermaidGroup(toolbar: Locator): Locator {
    return toolbar.getByRole('group', { name: 'Layout direction' })
  }

  /** The row's "More actions" (…) button. */
  moreButton(row: Locator): Locator {
    return row.getByRole('button', { name: 'More actions', exact: true })
  }

  /** The open overflow menu (portalled, so page-scoped). */
  menu(): Locator {
    return this.page.getByRole('menu')
  }

  /**
   * A menu item by its exact accessible name, whatever its role. The name
   * leaves out the shortcut column, which is aria-hidden (the shortcut is the
   * item's `aria-keyshortcuts`).
   */
  menuItem(label: string): Locator {
    const menu = this.menu()
    return menu
      .getByRole('menuitem', { name: label, exact: true })
      .or(menu.getByRole('menuitemcheckbox', { name: label, exact: true }))
      .or(menu.getByRole('menuitemradio', { name: label, exact: true }))
  }

  /** The test ids of the action buttons currently in the row, in row order. */
  async rowActionTestIds(row: Locator): Promise<string[]> {
    return row.locator('button[data-testid]').evaluateAll((buttons) =>
      buttons.map((b) => b.getAttribute('data-testid') ?? '')
    )
  }

  /**
   * Drag the splitter on the panel's `edge` by `deltaX` px, with a real pointer.
   * The splitter is found by geometry: the dockview sash whose centre sits on
   * that edge of the panel.
   */
  async dragPanelEdge(panel: Locator, edge: 'left' | 'right', deltaX: number): Promise<void> {
    const box = await panel.boundingBox()
    if (!box) throw new Error('panel has no box')
    const edgeX = edge === 'left' ? box.x : box.x + box.width
    const sashes = this.page.locator('.dv-sash')
    const count = await sashes.count()
    let target: Box | null = null
    for (let i = 0; i < count; i += 1) {
      const sash = await sashes.nth(i).boundingBox()
      if (!sash || sash.width === 0 || sash.height < box.height / 2) continue
      if (Math.abs(sash.x + sash.width / 2 - edgeX) <= 6) target = sash
    }
    if (!target) throw new Error(`no splitter on the panel's ${edge} edge (x=${edgeX})`)
    const startX = target.x + target.width / 2
    const startY = target.y + target.height / 2
    await this.page.mouse.move(startX, startY)
    await this.page.mouse.down()
    await this.page.mouse.move(startX + deltaX, startY, { steps: 12 })
    await this.page.mouse.up()
  }

  /**
   * How each action was reached: whole inside the row, else through the
   * "More actions" menu, else not at all. The menu is closed again with Escape.
   */
  async reachability(row: Locator, testIds: readonly string[]): Promise<Record<string, Reach>> {
    const rowBox = await row.boundingBox()
    if (!rowBox) throw new Error('row has no box')
    const viewport = await this.page.evaluate(() => ({
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight
    }))
    const result: Record<string, Reach> = {}
    const pending: string[] = []
    for (const id of testIds) {
      const button = row.locator(`[data-testid="${id}"]`)
      const box = (await button.count()) === 1 && (await button.isVisible()) ? await button.boundingBox() : null
      if (box && inside(box, rowBox) && inside(box, viewport)) result[id] = 'row'
      else pending.push(id)
    }
    if (pending.length === 0) return result

    const more = this.moreButton(row)
    if ((await more.count()) === 0) {
      for (const id of pending) result[id] = 'unreachable'
      return result
    }
    await more.click()
    await expect(this.menu()).toBeVisible()
    for (const id of pending) {
      const item = this.menuItem(MENU_LABEL_BY_TEST_ID[id] ?? `unknown test id ${id}`)
      const box = (await item.count()) === 1 ? await item.boundingBox() : null
      result[id] = box && inside(box, viewport) ? 'menu' : 'unreachable'
    }
    await this.page.keyboard.press('Escape')
    await expect(this.menu()).toHaveCount(0)
    return result
  }

  /**
   * Hold the row narrower than its panel with an inline `max-width`, so the
   * row's own ResizeObserver sees it narrow – the same signal a splitter drag
   * gives it. Needed only below the dock's 170 px minimum, where the terminal
   * keeps the raised Maximize beside … by design. Undo with {@link releaseRow}.
   */
  async constrainRow(row: Locator, maxWidthPx: number): Promise<void> {
    await row.evaluate((el, px) => {
      ;(el as HTMLElement).style.maxWidth = `${px}px`
    }, maxWidthPx)
    await expect.poll(async () => (await row.boundingBox())?.width ?? Infinity).toBeLessThanOrEqual(maxWidthPx)
  }

  /** Remove the width {@link constrainRow} set. */
  async releaseRow(row: Locator): Promise<void> {
    await row.evaluate((el) => {
      ;(el as HTMLElement).style.maxWidth = ''
    })
  }

  /** The `data-testid` or accessible name of the focused element. */
  async focusedName(): Promise<string> {
    return this.page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el) return ''
      return el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''
    })
  }
}
