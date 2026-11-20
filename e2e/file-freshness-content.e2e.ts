// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * #478 content an open tab cannot show, and files that moved (plan § 5.3:
 * C1, C2, L2, L4).
 *
 * - **C1** – an editor tab whose file turns too large (10 MiB), binary or
 *   UTF-16 names the reason, keeps the last good text and is read-only (so
 *   autosave cannot write it); Reload tries a too-large file again; a good
 *   write afterwards recovers. An image tab whose file grows past 50 MB says
 *   so and recovers the same way.
 * - **C2** – a file renamed, moved, or whose folder is renamed shows the
 *   deleted notice with Restore file and Close tab; Restore file writes it back.
 * - **L2** (Windows) – a file locked during a change: released within the
 *   read retries it shows; held longer the tab says it cannot be read; Reload
 *   after the release recovers.
 * - **L4** – a copy that keeps the old size and modification time is shown at
 *   the latest when the tab is shown again.
 *
 * Condition-based waits only.
 */
import { mkdir, readFile, rename, stat, utimes, writeFile } from 'fs/promises'
import { join } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { MonacoPage } from './pages/monaco.page'
import { KeyboardHelper } from './pages/keyboard.helper'
import { ImageViewerPage } from './pages/image-viewer.page'
import { FileFreshnessPage } from './pages/file-freshness.page'
import { copyKeepingMtime, writeHoldingLock, writeInPlace } from './utils/freshness-writers'

/** A change, a refusal or a recovery reaching the tab. */
const SHOW_BUDGET_MS = 10_000
/** A rename or move confirmed as a delete (settle, confirm window, re-check). */
const DELETE_BUDGET_MS = 15_000
const MIB = 1024 * 1024
/** Past the editor's 10 MiB limit (Q2) and the image viewer's 50 MiB one (shown as "50 MB"). */
const EDITOR_TOO_LARGE_BYTES = 11 * MIB
const IMAGE_TOO_LARGE_BYTES = 51 * MIB
/** L2: inside the read retries (100 + 300 + 900 ms), and well past them. */
const LOCK_SHORT_MS = 300
const LOCK_LONG_MS = 6_000

function doc(marker: string): string {
  return `# Doc\n\n${marker}\n`
}

function svg(marker: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" data-marker="${marker}" width="64" height="64" viewBox="0 0 64 64">` +
    '<rect width="64" height="64" fill="#1f1f1f"/></svg>\n'
  )
}

test.use({
  testProjectFiles: {
    'a.md': doc('start-a'),
    'b.md': doc('start-b'),
    'moves/renamed.md': doc('start-renamed'),
    'moves/moved.md': doc('start-moved'),
    'parent/inner.md': doc('start-inner'),
    'pic.svg': svg('start'),
    'other.svg': svg('other')
  }
})

/** The POMs one test needs. */
function poms(page: Page, app: ElectronApplication) {
  const keyboard = new KeyboardHelper(page)
  return {
    tree: new ProjectTreePage(page),
    tabs: new TabBarPage(page),
    panel: new EditorPanelPage(page),
    monaco: new MonacoPage(page, keyboard),
    fresh: new FileFreshnessPage(page, app)
  }
}

/** Opens `relPath` in the editor view and waits until Monaco shows `marker`. */
async function openInEditor(page: Page, app: ElectronApplication, relPath: string, marker: string): Promise<void> {
  const { tree, tabs, panel, monaco } = poms(page, app)
  const folders = relPath.split('/').slice(0, -1)
  if (folders.length > 0) await tree.expandTo(folders.map((_, i) => folders.slice(0, i + 1).join('/')))
  await tree.fileRow(relPath).click()
  await tabs.waitForTab(relPath.split('/').pop() ?? relPath)
  await panel.waitForReady()
  await panel.setViewMode('editor')
  await monaco.waitForReady()
  await expect.poll(() => monaco.getContent()).toContain(marker)
}

/**
 * Asserts the tab shows the unavailable notice with `copy`, still holds
 * `lastGood`, and is read-only: text typed into it never reaches the buffer.
 */
async function expectBlocked(page: Page, app: ElectronApplication, copy: RegExp, lastGood: string): Promise<void> {
  const { monaco, fresh } = poms(page, app)
  await expect(fresh.unavailableNotice()).toBeVisible({ timeout: SHOW_BUDGET_MS })
  await expect(fresh.unavailableNotice()).toContainText(copy)
  await expect(fresh.unavailableNotice()).toContainText('This tab is read-only until the file can be shown again.')
  expect(await monaco.getContent()).toContain(lastGood)
  await monaco.focus()
  await monaco.typeWithoutWaiting('typed-while-blocked')
  expect(await monaco.getContent(), 'C1: a blocked tab is read-only').not.toContain('typed-while-blocked')
}

test.describe('#478 C1: content an editor tab cannot show', () => {
  test('too large, binary and UTF-16 each name the reason, stay read-only, and a good write recovers', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    test.setTimeout(120_000)
    const { fresh, monaco } = poms(page, app)
    const file = join(testProject.path, 'a.md')
    await openInEditor(page, app, 'a.md', 'start-a')

    await writeInPlace(file, `# Big\n\n${'x'.repeat(99)}\n`.repeat(EDITOR_TOO_LARGE_BYTES / 100 + 1))
    await expectBlocked(page, app, /a\.md is too large to show here \(.*limit 10 MB\)/, 'start-a')
    // Reload tries again: still too large, still blocked
    await fresh.unavailableNotice().getByRole('button', { name: /reload/i }).click()
    await expect(fresh.unavailableNotice()).toContainText('too large', { timeout: SHOW_BUDGET_MS })

    await writeInPlace(file, doc('good-after-large'))
    await expect.poll(() => monaco.getContent(), { timeout: SHOW_BUDGET_MS }).toContain('good-after-large')
    await expect(fresh.unavailableNotice()).toHaveCount(0)

    await writeInPlace(file, Buffer.from([0x23, 0x20, 0x00, 0x01, 0x02, 0xff, 0x0a]))
    await expectBlocked(page, app, /a\.md no longer contains text Erfana can show\./, 'good-after-large')
    await writeInPlace(file, doc('good-after-binary'))
    await expect.poll(() => monaco.getContent(), { timeout: SHOW_BUDGET_MS }).toContain('good-after-binary')

    await writeInPlace(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(doc('utf16'), 'utf16le')]))
    await expectBlocked(page, app, /a\.md now uses a text encoding Erfana cannot show/, 'good-after-binary')
    await writeInPlace(file, doc('good-after-utf16'))
    await expect.poll(() => monaco.getContent(), { timeout: SHOW_BUDGET_MS }).toContain('good-after-utf16')
    await expect(fresh.unavailableNotice()).toHaveCount(0)
    // Nothing typed while blocked was ever saved
    expect(await readFile(file, 'utf-8')).toBe(doc('good-after-utf16'))
  })
})

test.describe('#478 C1: content an image tab cannot show', () => {
  test('an image past 50 MB says so and keeps the last image; a good write recovers', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    const viewer = new ImageViewerPage(page, SHOW_BUDGET_MS)
    const file = join(testProject.path, 'pic.svg')
    await viewer.openFromTree('pic.svg')

    await writeInPlace(file, Buffer.concat([Buffer.from(svg('huge')), Buffer.alloc(IMAGE_TOO_LARGE_BYTES, 0x20)]))
    await viewer.expectBanner('unavailable')
    await expect(viewer.banner()).toContainText(/too large to show here \(.*limit 50 MB\)/)
    expect(await viewer.marker()).toBe('start')

    await writeInPlace(file, svg('after-huge'))
    await viewer.waitForMarker('after-huge')
    await viewer.expectNoBanner()
  })
})

test.describe('#478 C2: a file renamed, moved, or whose folder is renamed', () => {
  test('shows the deleted notice with Restore file and Close tab; Restore file writes it back', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    test.setTimeout(120_000)
    const { tabs, fresh } = poms(page, app)
    const at = (rel: string): string => join(testProject.path, ...rel.split('/'))
    await openInEditor(page, app, 'moves/renamed.md', 'start-renamed')
    await openInEditor(page, app, 'moves/moved.md', 'start-moved')
    await openInEditor(page, app, 'parent/inner.md', 'start-inner')

    await rename(at('moves/renamed.md'), at('moves/renamed-new.md'))
    await mkdir(at('elsewhere'))
    await rename(at('moves/moved.md'), at('elsewhere/moved.md'))
    await rename(at('parent'), at('parent-new'))

    for (const name of ['renamed.md', 'moved.md', 'inner.md']) {
      await expect(fresh.deletedTabMark(name), `C2: ${name} not shown as deleted`).toBeVisible({ timeout: DELETE_BUDGET_MS })
      // A deleted tab's label reads "<name> (deleted)", so it is clicked, not `activate`d by exact name
      await tabs.tab(name).click()
      await expect(fresh.deletedNotice()).toContainText(`${name} was deleted, renamed or moved on disk.`)
      await expect(fresh.restoreFileButton()).toBeVisible()
      await expect(fresh.closeTabButton()).toBeVisible()
    }

    // Restore file saves the tab back where it was
    await tabs.tab('renamed.md').click()
    await expect(fresh.deletedNotice()).toContainText('renamed.md')
    await fresh.restoreFileButton().click()
    await expect.poll(async () => readFile(at('moves/renamed.md'), 'utf-8').catch(() => ''), { timeout: SHOW_BUDGET_MS }).toContain(
      'start-renamed'
    )
    await expect(fresh.deletedTabMark('renamed.md')).toHaveCount(0, { timeout: SHOW_BUDGET_MS })

    // Close tab closes it
    await tabs.tab('moved.md').click()
    await expect(fresh.deletedNotice()).toContainText('moved.md')
    await fresh.closeTabButton().click()
    await tabs.waitForTabGone('moved.md')
  })
})

test.describe('#478 L2: a file locked during a change', () => {
  test.skip(process.platform !== 'win32', 'exclusive file locks are a Windows behaviour')

  test('released within the retries it shows; held longer the tab says so; Reload after the release recovers', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    test.setTimeout(120_000)
    const { fresh, monaco } = poms(page, app)
    const file = join(testProject.path, 'a.md')
    await openInEditor(page, app, 'a.md', 'start-a')

    const short = writeHoldingLock(file, doc('locked-short'), LOCK_SHORT_MS)
    await short.released
    await expect.poll(() => monaco.getContent(), { timeout: SHOW_BUDGET_MS }).toContain('locked-short')
    await expect(fresh.unavailableNotice()).toHaveCount(0)

    const long = writeHoldingLock(file, doc('locked-long'), LOCK_LONG_MS)
    await long.locked
    await expect(fresh.unavailableNotice()).toContainText('a.md cannot be read right now', { timeout: LOCK_LONG_MS })
    await long.released
    await fresh.unavailableNotice().getByRole('button', { name: /reload/i }).click()
    await expect.poll(() => monaco.getContent(), { timeout: SHOW_BUDGET_MS }).toContain('locked-long')
    await expect(fresh.unavailableNotice()).toHaveCount(0)
  })
})

/**
 * Overwrites `target` with `content` (same length as its current text) and
 * keeps its size and modification time, as a copy tool that preserves times does.
 */
async function copySameStamp(target: string, content: string, scratch: string): Promise<void> {
  const before = await stat(target)
  expect(content.length, 'setup: same size').toBe(before.size)
  await writeFile(scratch, content)
  await utimes(scratch, before.atime, before.mtime)
  await copyKeepingMtime(scratch, target)
}

test.describe('#478 L4: a copy that keeps size and modification time', () => {
  test('an editor and an image tab show it at the latest when shown again', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const { tabs, fresh } = poms(page, app)
    const viewer = new ImageViewerPage(page, SHOW_BUDGET_MS)
    await openInEditor(page, app, 'a.md', 'start-a')
    await openInEditor(page, app, 'b.md', 'start-b')

    await copySameStamp(join(testProject.path, 'a.md'), doc('copied1'), join(testProject.path, 'b.scratch'))
    await tabs.activate('a.md')
    await fresh.waitForContent('copied1', SHOW_BUDGET_MS, 'L4: editor never showed the mtime-keeping copy')

    await viewer.openFromTree('pic.svg')
    await viewer.openFromTree('other.svg')
    await copySameStamp(join(testProject.path, 'pic.svg'), svg('copy1'), join(testProject.path, 'c.scratch'))
    // Image tabs are dockview's own tabs: shown again through the tree
    await viewer.openFromTree('pic.svg')
    await viewer.waitForMarker('copy1')
  })
})
