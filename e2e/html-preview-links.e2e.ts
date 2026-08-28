// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E for in-page links and independent previews (sd-074b).
 *
 * Two behaviours that could not be tested before because neither existed: a
 * link click inside a previewed page, and a second preview running at the same
 * time as the first.
 *
 * Everything is asserted against the REAL `erfana-preview://` web contents read
 * from the main process, never a DOM stand-in — the page runs in its own sealed
 * `WebContentsView`, so the renderer's DOM cannot see it.
 *
 * Clicks land inside that sealed view, which Playwright cannot reach, so they
 * are dispatched main-side with `executeJavaScript`. Those synthesised clicks
 * are UNTRUSTED (`isTrusted === false`) — which is precisely what the preload
 * refuses — so the tests drive the `will-navigate` path, the fallback that keeps
 * plain links working when the preload is absent. The trusted path is covered by
 * unit tests and by the manual bench.
 *
 * Condition-based waits only — never a sleep.
 *
 * @see docs/html-preview/README.md#links
 * @see specs/designs/sd-074b-preview-navigation-and-multiview.md
 */

import * as fs from 'fs'
import * as path from 'path'

import { test, expect } from './fixtures/index'
import { ProjectTreePage } from './pages/project-tree.page'
import type { ElectronApplication, Page } from '@playwright/test'

const CORPUS_DIR = path.join(__dirname, 'fixtures', 'html-preview-corpus')

/** Read one corpus file's real content so the tests exercise the shipped input. */
function corpus(relPath: string): string {
  return fs.readFileSync(path.join(CORPUS_DIR, relPath), 'utf-8')
}

/** Generous budget: an Electron `WebContentsView` load + native paint + IPC. */
const PREVIEW_BUDGET_MS = 20_000

/** Every live preview's URL and document title, read from the main process. */
async function livePreviews(
  app: ElectronApplication
): Promise<Array<{ url: string; docTitle: string }>> {
  return app.evaluate(async ({ webContents }) => {
    const previews = webContents.getAllWebContents().filter((wc) => {
      try {
        return wc.getURL().startsWith('erfana-preview://') && !wc.isDestroyed()
      } catch {
        return false
      }
    })
    const out: Array<{ url: string; docTitle: string }> = []
    for (const wc of previews) {
      let docTitle = ''
      try {
        docTitle = await wc.executeJavaScript('document.title')
      } catch {
        // Mid-load; the caller polls.
      }
      out.push({ url: wc.getURL(), docTitle })
    }
    return out
  })
}

/** Click an element by id inside the live preview page whose title matches. */
async function clickInPreview(
  app: ElectronApplication,
  docTitle: string,
  elementId: string
): Promise<void> {
  await app.evaluate(
    async ({ webContents }, { title, id }) => {
      for (const wc of webContents.getAllWebContents()) {
        try {
          if (!wc.getURL().startsWith('erfana-preview://')) continue
          const found: string = await wc.executeJavaScript('document.title')
          if (!found.includes(title)) continue
          await wc.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).click()`)
          return
        } catch {
          // Not the page we want, or it went away; keep looking.
        }
      }
    },
    { title: docTitle, id: elementId }
  )
}

/** Open a project-relative `.html` file as a running preview. */
async function openPreview(page: Page, relPath: string): Promise<void> {
  const tree = new ProjectTreePage(page)
  await tree.expandTo([relPath.split('/')[0]])
  await tree.fileRow(relPath).click()
  await page.locator('.html-preview-placeholder').first().waitFor({
    state: 'attached',
    timeout: PREVIEW_BUDGET_MS
  })
}

/**
 * Wait until a live preview's document title CONTAINS this sentinel.
 *
 * Substring, not equality: the shared corpus fixtures carry a descriptive title
 * with the sentinel embedded (`Self-contained corpus page -OK-1`).
 */
async function waitForPreviewTitled(app: ElectronApplication, sentinel: string): Promise<void> {
  await expect
    .poll(async () => (await livePreviews(app)).some((p) => p.docTitle.includes(sentinel)), {
      timeout: PREVIEW_BUDGET_MS
    })
    .toBe(true)
}

/** Every live preview title, joined — for `toContain` assertions on the set. */
async function liveTitles(app: ElectronApplication): Promise<string> {
  return (await livePreviews(app)).map((p) => p.docTitle).join(' | ')
}

test.use({
  testProjectFiles: {
    'links/index.html': corpus('links/index.html'),
    'links/target.html': corpus('links/target.html'),
    'self-contained/index.html': corpus('self-contained/index.html'),
    'notes.md': '# Notes\n'
  }
})

test.describe('HTML preview — independent previews', () => {
  test('two .html files run at the same time, with no refusal', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    await openPreview(windowWithTestProject, 'links/index.html')
    await waitForPreviewTitled(appWithTestProject, '-LINKS-1')

    await openPreview(windowWithTestProject, 'self-contained/index.html')
    await waitForPreviewTitled(appWithTestProject, '-OK-1')

    // The refusal that used to appear for a second preview is gone.
    await expect(
      windowWithTestProject.getByText('This file is already previewed in another window.')
    ).toHaveCount(0)

    // Both pages are alive at once — the whole point of the change.
    const titles = await liveTitles(appWithTestProject)
    expect(titles).toContain('-LINKS-1')
    expect(titles).toContain('-OK-1')
  })
})

test.describe('HTML preview — link routing', () => {
  test('a plain link opens its target in a new tab', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    await openPreview(windowWithTestProject, 'links/index.html')
    await waitForPreviewTitled(appWithTestProject, '-LINKS-1')

    await clickInPreview(appWithTestProject, '-LINKS-1', 'plain')

    // The target opens as its OWN running preview; the source page stays open.
    await waitForPreviewTitled(appWithTestProject, '-LINKS-TARGET-')
    expect(await liveTitles(appWithTestProject)).toContain('-LINKS-1')
  })

  test('a javascript: link never runs and never opens anything', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    await openPreview(windowWithTestProject, 'links/index.html')
    await waitForPreviewTitled(appWithTestProject, '-LINKS-1')

    await clickInPreview(appWithTestProject, '-LINKS-1', 'dangerous')

    // The fixture's javascript: URL would rename the document if it ever ran.
    await expect
      .poll(async () => liveTitles(appWithTestProject), { timeout: 5000 })
      .not.toContain('-HIJACKED-')
  })

  test('a link escaping the project opens nothing', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    await openPreview(windowWithTestProject, 'links/index.html')
    await waitForPreviewTitled(appWithTestProject, '-LINKS-1')

    const before = (await livePreviews(appWithTestProject)).length
    await clickInPreview(appWithTestProject, '-LINKS-1', 'escape')

    // Nothing new is ever shown for a path outside the project.
    await expect
      .poll(async () => (await livePreviews(appWithTestProject)).length, { timeout: 5000 })
      .toBe(before)
  })

  test('a same-page anchor scrolls instead of opening a tab', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    await openPreview(windowWithTestProject, 'links/index.html')
    await waitForPreviewTitled(appWithTestProject, '-LINKS-1')

    const before = (await livePreviews(appWithTestProject)).length
    await clickInPreview(appWithTestProject, '-LINKS-1', 'anchor')

    await expect
      .poll(async () => (await livePreviews(appWithTestProject)).length, { timeout: 5000 })
      .toBe(before)
  })
})
