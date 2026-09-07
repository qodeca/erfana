// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Find in document — opening the bar, counting matches, navigating them,
 * the case-sensitivity toggle, and closing.
 *
 * Search is a three-provider abstraction (`MonacoSearchProvider`,
 * `PreviewSearchProvider`, `PreviewPageSearchProvider`) behind one bar, and it
 * had no end-to-end coverage. Provider selection is exactly the kind of wiring
 * unit tests cannot check: each provider is tested against its own fake, and
 * the thing that breaks in practice is which one the panel hands the bar.
 *
 * So each test states which view mode it is in, and the match count is the
 * assertion — a bar attached to the wrong provider reports the wrong total,
 * or none at all.
 *
 * @see src/renderer/src/components/Search/SearchBar.tsx
 * @see src/renderer/src/providers/search/
 */

import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { SearchBarPage } from './pages/search-bar.page'
import { MonacoPage } from './pages/monaco.page'
import { KeyboardHelper } from './pages/keyboard.helper'

/**
 * Three lowercase `needle`s and one capitalised `Needle`, so a case-sensitive
 * search has a different, checkable total from a case-insensitive one.
 */
const HAYSTACK = [
  '# Haystack',
  '',
  'first needle here',
  'second needle here',
  'third needle here',
  'a capitalised Needle here',
  ''
].join('\n')

const OTHER = '# Other\n\nnothing to find in this one\n'

test.use({
  testProjectFiles: {
    'haystack.md': HAYSTACK,
    'other.md': OTHER
  }
})

async function openHaystack(page: Page): Promise<{
  panel: EditorPanelPage
  search: SearchBarPage
  monaco: MonacoPage
}> {
  const tree = new ProjectTreePage(page)
  const tabs = new TabBarPage(page)
  const panel = new EditorPanelPage(page)

  await tree.fileRow('haystack.md').click()
  await tabs.waitForTab('haystack.md')
  await panel.waitForReady()

  return {
    panel,
    search: new SearchBarPage(page),
    monaco: new MonacoPage(page, new KeyboardHelper(page))
  }
}

test.describe('Opening and closing the find bar', () => {
  test('should open on the keyboard shortcut with the input focused', async ({
    windowWithTestProject,
    keyboardHelper
  }) => {
    const { search } = await openHaystack(windowWithTestProject)

    await windowWithTestProject.keyboard.press(`${await keyboardHelper.getModifier()}+f`)

    // The shortcut is registered in the capture phase specifically so Monaco's
    // own find widget never wins; a focused app bar is the proof it did.
    await search.waitForOpen()
  })

  test('should open from the toolbar button', async ({ windowWithTestProject }) => {
    const { panel, search } = await openHaystack(windowWithTestProject)

    await panel.searchButton().click()

    await search.waitForOpen()
  })

  test('should close on Escape', async ({ windowWithTestProject, keyboardHelper }) => {
    const { search } = await openHaystack(windowWithTestProject)

    await windowWithTestProject.keyboard.press(`${await keyboardHelper.getModifier()}+f`)
    await search.waitForOpen()
    await windowWithTestProject.keyboard.press('Escape')

    await search.waitForClosed()
  })

  test('should close on the close button', async ({ windowWithTestProject, keyboardHelper }) => {
    const { search } = await openHaystack(windowWithTestProject)

    await windowWithTestProject.keyboard.press(`${await keyboardHelper.getModifier()}+f`)
    await search.waitForOpen()
    await search.closeButton().click()

    await search.waitForClosed()
  })
})

test.describe('Matching in the editor', () => {
  test('should count every match of the query', async ({
    windowWithTestProject,
    keyboardHelper
  }) => {
    const { panel, search, monaco } = await openHaystack(windowWithTestProject)
    await panel.setViewMode('editor')
    await monaco.waitForReady()

    await windowWithTestProject.keyboard.press(`${await keyboardHelper.getModifier()}+f`)
    await search.waitForOpen()
    await search.search('needle')

    // Four: three lowercase plus the capitalised one, since the default is
    // case-insensitive.
    await search.waitForTotal(4)
    await search.waitForOrdinal(1)
  })

  test('should say so when nothing matches', async ({
    windowWithTestProject,
    keyboardHelper
  }) => {
    const { panel, search, monaco } = await openHaystack(windowWithTestProject)
    await panel.setViewMode('editor')
    await monaco.waitForReady()

    await windowWithTestProject.keyboard.press(`${await keyboardHelper.getModifier()}+f`)
    await search.waitForOpen()
    await search.search('zzzznotpresent')

    await expect(search.countLabel()).toHaveText('No results', { timeout: 10_000 })
  })

  test('should step forward and back through the matches', async ({
    windowWithTestProject,
    keyboardHelper
  }) => {
    const { panel, search, monaco } = await openHaystack(windowWithTestProject)
    await panel.setViewMode('editor')
    await monaco.waitForReady()

    await windowWithTestProject.keyboard.press(`${await keyboardHelper.getModifier()}+f`)
    await search.waitForOpen()
    await search.search('needle')
    await search.waitForTotal(4)

    await search.nextButton().click()
    await search.waitForOrdinal(2)

    await search.nextButton().click()
    await search.waitForOrdinal(3)

    await search.prevButton().click()
    await search.waitForOrdinal(2)
  })

  test('should wrap from the last match back to the first', async ({
    windowWithTestProject,
    keyboardHelper
  }) => {
    const { panel, search, monaco } = await openHaystack(windowWithTestProject)
    await panel.setViewMode('editor')
    await monaco.waitForReady()

    await windowWithTestProject.keyboard.press(`${await keyboardHelper.getModifier()}+f`)
    await search.waitForOpen()
    await search.search('needle')
    await search.waitForTotal(4)

    for (let i = 0; i < 3; i += 1) {
      await search.nextButton().click()
    }
    await search.waitForOrdinal(4)

    await search.nextButton().click()
    // Wrapping is what makes the button usable without counting; stopping dead
    // at the end would be a regression.
    await search.waitForOrdinal(1)
  })

  test('should drop the capitalised match when case sensitivity is on', async ({
    windowWithTestProject,
    keyboardHelper
  }) => {
    const { panel, search, monaco } = await openHaystack(windowWithTestProject)
    await panel.setViewMode('editor')
    await monaco.waitForReady()

    await windowWithTestProject.keyboard.press(`${await keyboardHelper.getModifier()}+f`)
    await search.waitForOpen()
    await search.search('needle')
    await search.waitForTotal(4)

    await search.caseToggle().click()

    // `Needle` no longer counts, so three remain.
    await search.waitForTotal(3)
  })
})

test.describe('Matching in the preview', () => {
  test('should count matches in the rendered markdown', async ({
    windowWithTestProject,
    keyboardHelper
  }) => {
    // No view-mode switch: preview is how the file opens, so this is the
    // provider most users actually hit first.
    const { panel, search } = await openHaystack(windowWithTestProject)
    await expect(panel.previewPane()).toBeVisible()

    await windowWithTestProject.keyboard.press(`${await keyboardHelper.getModifier()}+f`)
    await search.waitForOpen()
    await search.search('needle')

    await search.waitForTotal(4)
  })
})

test.describe('Search state across files', () => {
  test('should reset the query when a different file is opened', async ({
    windowWithTestProject,
    keyboardHelper
  }) => {
    const tree = new ProjectTreePage(windowWithTestProject)
    const tabs = new TabBarPage(windowWithTestProject)
    const { search } = await openHaystack(windowWithTestProject)

    await windowWithTestProject.keyboard.press(`${await keyboardHelper.getModifier()}+f`)
    await search.waitForOpen()
    await search.search('needle')
    await search.waitForTotal(4)

    await tree.fileRow('other.md').click()
    await tabs.waitForTab('other.md')

    // A stale query reporting stale counts against a new document is worse
    // than no search at all, so the bar must not carry over.
    await expect
      .poll(async () => (await search.bar().count()) === 0 || (await search.input().inputValue()) === '', {
        timeout: 10_000
      })
      .toBe(true)
  })
})
