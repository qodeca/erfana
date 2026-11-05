// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E: the Markdown and Mermaid toolbars keep every action reachable when
 * narrow (#461, after #451).
 *
 * Narrows the editor area with real splitter drags (the project tree and the
 * terminal widened as far as the dock allows, leaving the editor at its
 * minimum), then checks each Markdown toolbar action: either its button is
 * whole inside the toolbar, or the toolbar's "More actions" (…) menu lists it.
 * Then narrows a Mermaid diagram – first by the split view, then to a narrow
 * column – and checks its direction and fullscreen actions the same way.
 *
 * The contract is the Toolbar overflow card
 * (docs/design-system/system/patterns/toolbar-overflow, decided 2026-11-03);
 * the design is docs/designs/editor-toolbar-overflow/.
 *
 * Waits are condition-based only (Playwright auto-waiting and `expect.poll`).
 */

import { test, expect } from './fixtures/index'
import { TEST_IDS } from './utils/helpers'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { TerminalPage } from './pages/terminal.page'
import { ToolbarOverflowPage, type Reach } from './pages/toolbar-overflow.page'

/** Far enough to reach a dock limit from any start. */
const DRAG_FAR_PX = 1500

/** The dock keeps the editor at least 400 px wide (`MIN_SIZES.centerEditor`); allow the sashes. */
const EDITOR_NARROW_MAX_PX = 460

/** A diagram column narrower than any toolbar of five directions and fullscreen. */
const DIAGRAM_NARROW_PX = 120

const DOC = [
  '# Diagram',
  '',
  '```mermaid',
  'flowchart LR',
  '  A --> B',
  '```',
  ''
].join('\n')

/** Every Markdown toolbar action in the split views (formatting shown), left to right. */
const MARKDOWN_ACTIONS = [
  TEST_IDS.TOOLBAR_BTN_BOLD,
  TEST_IDS.TOOLBAR_BTN_ITALIC,
  TEST_IDS.TOOLBAR_BTN_STRIKETHROUGH,
  TEST_IDS.TOOLBAR_BTN_CODE,
  TEST_IDS.TOOLBAR_BTN_LINK,
  TEST_IDS.TOOLBAR_BTN_IMAGE,
  TEST_IDS.TOOLBAR_BTN_HEADING,
  TEST_IDS.TOOLBAR_BTN_LIST,
  TEST_IDS.TOOLBAR_BTN_LIST_ORDERED,
  TEST_IDS.TOOLBAR_BTN_SEARCH,
  TEST_IDS.VIEW_MODE_BTN_EDITOR,
  TEST_IDS.VIEW_MODE_BTN_SPLIT_HORIZONTAL,
  TEST_IDS.VIEW_MODE_BTN_SPLIT,
  TEST_IDS.VIEW_MODE_BTN_PREVIEW,
  TEST_IDS.TOOLBAR_BTN_EXPORT_PDF,
  TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX
]

/** A flowchart's actions: five directions, then fullscreen. */
const MERMAID_ACTIONS = [
  ...['TB', 'TD', 'BT', 'LR', 'RL'].map((d) => `${TEST_IDS.MERMAID_DIRECTION_BTN}-${d}`),
  TEST_IDS.MERMAID_BTN_EXPAND
]

function unreachable(reach: Record<string, Reach>): string[] {
  return Object.entries(reach)
    .filter(([, how]) => how === 'unreachable')
    .map(([id]) => id)
}

test.describe('Editor toolbar overflow (#461)', () => {
  test.use({ testProjectFiles: { 'diagram.md': DOC } })

  test('every Markdown and Mermaid toolbar action stays reachable when narrow, by pointer and keyboard', async ({
    windowWithTestProject: page
  }) => {
    test.setTimeout(120_000)

    const tree = new ProjectTreePage(page)
    const tabs = new TabBarPage(page)
    const panel = new EditorPanelPage(page)
    const terminal = new TerminalPage(page)
    const bars = new ToolbarOverflowPage(page)

    await tree.fileRow('diagram.md').click()
    await tabs.waitForTab('diagram.md')
    await panel.waitForReady()
    // Split vertical: the formatting buttons show, and the preview (with the diagram) is half the editor.
    await panel.setViewMode('split')
    await terminal.open()

    await test.step('narrow the editor to the dock minimum → every Markdown action reachable', async () => {
      const projectTree = page.locator(`[data-testid="${TEST_IDS.PROJECT_TREE}"]`)
      const terminalPanel = page.locator(`[data-testid="${TEST_IDS.TERMINAL_PANEL}"]`)
      await bars.dragPanelEdge(projectTree, 'right', DRAG_FAR_PX)
      await bars.dragPanelEdge(terminalPanel, 'left', -DRAG_FAR_PX)
      await expect
        .poll(async () => (await panel.content().boundingBox())?.width ?? Number.POSITIVE_INFINITY)
        .toBeLessThanOrEqual(EDITOR_NARROW_MAX_PX)

      // Sixteen 32 px buttons do not fit in 400 px: some must have moved.
      await expect(bars.moreButton(bars.markdownToolbar())).toBeVisible()
      const reach = await bars.reachability(bars.markdownToolbar(), MARKDOWN_ACTIONS)
      expect(unreachable(reach), JSON.stringify(reach)).toEqual([])
      expect(Object.values(reach)).toContain('menu')
      // Rightmost first: the exports go before Bold does.
      expect(reach[TEST_IDS.TOOLBAR_BTN_EXPORT_DOCX]).toBe('menu')
      expect(reach[TEST_IDS.TOOLBAR_BTN_BOLD]).toBe('row')
      // The live region never moves.
      await expect(bars.markdownToolbar().getByRole('status')).toHaveCount(1)
    })

    await test.step('keyboard: ↑ opens on the last item, Esc returns to …, the view mode is a checked item', async () => {
      const more = bars.moreButton(bars.markdownToolbar())
      await more.focus()
      await page.keyboard.press('ArrowUp')
      await expect(bars.menu()).toBeVisible()
      await expect(more).toHaveAttribute('aria-expanded', 'true')
      await expect(bars.menuItem('Export to Word')).toBeFocused()
      await expect(bars.menuItem('Split vertical')).toHaveAttribute('aria-checked', 'true')
      await page.keyboard.press('Escape')
      await expect(bars.menu()).toHaveCount(0)
      await expect(more).toBeFocused()
    })

    await test.step('the diagram in the split view → every Mermaid action reachable', async () => {
      const toolbar = bars.mermaidToolbar()
      await bars.mermaidGroup(toolbar).hover()
      await expect(toolbar).toBeVisible()
      const reach = await bars.reachability(toolbar, MERMAID_ACTIONS)
      expect(unreachable(reach), JSON.stringify(reach)).toEqual([])
    })

    await test.step('narrow the diagram to a thin column → its actions move into … and stay reachable', async () => {
      const toolbar = bars.mermaidToolbar()
      await toolbar.evaluate((row, width) => {
        const container = row.closest<HTMLElement>('.mermaid-container')
        if (!container) throw new Error('no .mermaid-container around the Mermaid toolbar')
        container.style.width = `${width}px`
      }, DIAGRAM_NARROW_PX)
      await bars.mermaidGroup(toolbar).hover()
      await expect(bars.moreButton(toolbar)).toBeVisible()
      const reach = await bars.reachability(toolbar, MERMAID_ACTIONS)
      expect(unreachable(reach), JSON.stringify(reach)).toEqual([])
      expect(Object.values(reach)).toContain('menu')

      // The current direction is the checked item; it is disabled, there is nothing to change to.
      await bars.moreButton(toolbar).click()
      await expect(bars.menuItem('Left to Right')).toHaveAttribute('aria-checked', 'true')
      await expect(bars.menuItem('Left to Right')).toHaveAttribute('aria-disabled', 'true')
      await page.keyboard.press('Escape')
      await expect(bars.menu()).toHaveCount(0)
      await expect(bars.moreButton(toolbar)).toBeFocused()
    })
  })
})
