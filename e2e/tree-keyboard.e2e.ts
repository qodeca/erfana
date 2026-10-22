// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E: the project tree is keyboard-operable and virtualised (#87 / #88 /
 * #89, review finding [33]).
 *
 * - One Tab stop for the whole tree; arrows, Home/End, Enter, type-ahead and
 *   Shift+F10 operate it (the Rows card's contract,
 *   design/system/components/row/index.html).
 * - The focused row draws the standard focus ring, inset (Focus card).
 * - Rows are a flat, virtualised list: a big folder mounts a screenful, and
 *   pointer drag-and-drop still moves a file into a folder.
 */

import { join } from 'path'
import { stat } from 'fs/promises'
import type { Page, Locator } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { byTestId } from './utils/locators'

/** The element that has DOM focus, described for assertions. */
async function focused(page: Page): Promise<{ path: string | null; role: string | null; inTree: boolean }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return {
      path: el?.dataset?.path ?? null,
      role: el?.getAttribute('role') ?? null,
      inTree: !!el?.closest('[role="tree"]')
    }
  })
}

/** Project-relative suffix of a focused row's absolute path, with `/` separators. */
function rel(path: string | null, projectPath: string): string | null {
  if (path === null) return null
  return path.slice(projectPath.length).replace(/\\/g, '/').replace(/^\//, '')
}

/** Tab from the toolbar's last button into the tree. */
async function tabIntoTree(page: Page): Promise<void> {
  await byTestId(page, TEST_IDS.PROJECT_TREE_BTN_REFRESH).focus()
  await page.keyboard.press('Tab')
  await expect.poll(async () => (await focused(page)).role).toBe('treeitem')
}

test.describe('Project tree keyboard (#87)', () => {
  test.use({
    testProjectFiles: {
      'README.md': '# Readme\n',
      'notes.md': '# Notes\n',
      'docs/guide.md': '# Guide\n',
      'docs/zebra.md': '# Zebra\n'
    }
  })

  test('the whole tree is one Tab stop', async ({ windowWithTestProject: page, testProject }) => {
    await tabIntoTree(page)
    expect(rel((await focused(page)).path, testProject.path)).toBe('')

    await page.keyboard.press('Tab')
    expect((await focused(page)).inTree).toBe(false)

    await expect(page.locator('[role="tree"] [tabindex="0"]')).toHaveCount(1)
  })

  test('arrows, Home, End and type-ahead move focus; Enter opens a file', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    await tabIntoTree(page)
    // Order: root, docs/, notes.md, README.md (folders first, then by name).
    await page.keyboard.press('ArrowDown')
    expect(rel((await focused(page)).path, testProject.path)).toBe('docs')
    await page.keyboard.press('End')
    expect(rel((await focused(page)).path, testProject.path)).toBe('README.md')
    await page.keyboard.press('Home')
    expect(rel((await focused(page)).path, testProject.path)).toBe('')

    await page.keyboard.press('n')
    expect(rel((await focused(page)).path, testProject.path)).toBe('notes.md')

    await page.keyboard.press('Enter')
    await expect(byTestId(page, TEST_IDS.EDITOR_CONTENT)).toBeVisible({ timeout: 10_000 })
  })

  test('→ opens a folder and steps in, ← steps out and closes it', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    const tree = new ProjectTreePage(page)
    await tabIntoTree(page)
    await page.keyboard.press('ArrowDown')

    await page.keyboard.press('ArrowRight')
    await expect(tree.folderRow('docs')).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('ArrowRight')
    expect(rel((await focused(page)).path, testProject.path)).toBe('docs/guide.md')

    await page.keyboard.press('ArrowLeft')
    expect(rel((await focused(page)).path, testProject.path)).toBe('docs')
    await page.keyboard.press('ArrowLeft')
    await expect(tree.folderRow('docs')).toHaveAttribute('aria-expanded', 'false')
    await expect(tree.fileRow('docs/guide.md')).toHaveCount(0)
  })

  test('the focused row shows the standard focus ring', async ({ windowWithTestProject: page }) => {
    await tabIntoTree(page)
    await page.keyboard.press('ArrowDown')

    const ring = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement as Element)
      return { style: style.outlineStyle, width: style.outlineWidth, offset: style.outlineOffset }
    })
    expect(ring).toEqual({ style: 'solid', width: '2px', offset: '-2px' })
  })

  test('Shift+F10 opens the focused row\'s menu', async ({ windowWithTestProject: page }) => {
    const tree = new ProjectTreePage(page)
    await tabIntoTree(page)
    await page.keyboard.press('End')

    await page.keyboard.press('Shift+F10')
    await expect(tree.contextMenu()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(tree.contextMenu()).toHaveCount(0)
  })

  test('dragging a file onto a folder still moves it', async ({ windowWithTestProject: page, testProject }) => {
    const tree = new ProjectTreePage(page)
    const source = tree.fileRow('notes.md')
    // By path, not by test id: a folder under a drag swaps its test id for
    // the drop-target one.
    const target = page.locator('.project-tree-item[data-type="directory"][data-path$="docs"]')

    await dragByPointer(page, source, target)

    await expect.poll(async () => exists(join(testProject.path, 'docs', 'notes.md'))).toBe(true)
    await tree.expandTo(['docs'])
    await tree.waitForFile('docs/notes.md')
  })
})

test.describe('Project tree virtualisation ([33])', () => {
  const COUNT = 2000
  test.use({
    testProjectFiles: Object.fromEntries(
      Array.from({ length: COUNT }, (_, i) => [`big/f${String(i).padStart(5, '0')}.md`, '#\n'])
    )
  })

  test('a 2,000-file folder mounts a screenful of rows, and End reaches the last one', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    const tree = new ProjectTreePage(page)
    await tree.expandTo(['big'])
    await tree.waitForFile('big/f00000.md')

    const mounted = await page.locator('[role="treeitem"]').count()
    expect(mounted).toBeLessThan(150)
    await expect(tree.fileRow('big/f00000.md')).toHaveAttribute('aria-setsize', String(COUNT))

    await tree.fileRow('big/f00000.md').focus()
    await page.keyboard.press('End')
    expect(rel((await focused(page)).path, testProject.path)).toBe(`big/f${String(COUNT - 1).padStart(5, '0')}.md`)
    await expect(tree.fileRow(`big/f${String(COUNT - 1).padStart(5, '0')}.md`)).toBeInViewport()
  })
})

/**
 * A pointer drag dnd-kit's PointerSensor accepts: press, move past its
 * activation distance in steps, then release over the target.
 */
async function dragByPointer(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error('drag source or target is not visible')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 12, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
  // The folder is highlighted as the drop target before the release: the
  // flat rows must be measured where they are drawn.
  await expect(target).toHaveAttribute('data-drop-target', 'true')
  await page.mouse.up()
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
