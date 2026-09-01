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

/**
 * Click an element by id inside the live preview page whose title matches.
 *
 * @returns `true` only when the page WAS found and the element WAS clicked.
 *
 * The return value is the point. This used to swallow every failure — the
 * `catch` wrapped the click itself — and return normally, so a renamed fixture
 * id, or an element that never rendered, produced a test that quietly clicked
 * nothing. Every caller here then asserted only that something bad had not
 * happened, which is equally true of a click that never occurred. The three
 * security cases in this file proved nothing at all.
 */
async function clickInPreview(
  app: ElectronApplication,
  docTitle: string,
  elementId: string
): Promise<boolean> {
  return app.evaluate(
    async ({ webContents }, { title, id }) => {
      for (const wc of webContents.getAllWebContents()) {
        if (!wc.getURL().startsWith('erfana-preview://')) continue
        let found = ''
        try {
          found = await wc.executeJavaScript('document.title')
        } catch {
          // Mid-load or already gone: this is not the page we are looking for.
          // Only the IDENTIFICATION probe is allowed to fail quietly.
          continue
        }
        if (!found.includes(title)) continue
        return await wc.executeJavaScript(
          `(() => {
             const el = document.getElementById(${JSON.stringify(id)})
             if (!el) return false
             el.click()
             return true
           })()`
        )
      }
      return false
    },
    { title: docTitle, id: elementId }
  )
}

/**
 * Click `elementId`, then drive a known-good link behind it and wait for that
 * to land.
 *
 * Why a barrier rather than a poll: `expect.poll(...).not.toContain(...)` stops
 * the moment the assertion holds, and a negative assertion holds on the FIRST
 * sample — before a click can possibly have been routed. Playwright's own
 * matcher returns `continuePolling: false` as soon as a `.not` matcher does not
 * throw. So the timeout never applied and the effect was never waited for.
 *
 * Both clicks traverse the same preload → main → policy → renderer pipeline in
 * order, so once the second has visibly landed the first has had its full
 * chance. The negative is then asserted once, on settled state.
 */
async function clickThenSettle(app: ElectronApplication, elementId: string): Promise<void> {
  expect(await clickInPreview(app, '-LINKS-1', elementId)).toBe(true)
  expect(await clickInPreview(app, '-LINKS-1', 'plain')).toBe(true)
  await waitForPreviewTitled(app, '-LINKS-TARGET-')
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

    expect(await clickInPreview(appWithTestProject, '-LINKS-1', 'plain')).toBe(true)

    // The target opens as its OWN running preview; the source page stays open.
    await waitForPreviewTitled(appWithTestProject, '-LINKS-TARGET-')
    expect(await liveTitles(appWithTestProject)).toContain('-LINKS-1')
  })

  test('a javascript: link cannot navigate the preview or open anything', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    // WHAT THIS DOES AND DOES NOT CLAIM. The previous version of this test was
    // called "a javascript: link never runs", and that is false: measured on
    // Electron 39, clicking the fixture's `javascript:` link executes it and
    // replaces the document with the expression's value.
    //
    // That is not an escalation, and it is not a hole. `script-src` carries
    // 'unsafe-inline' and 'unsafe-eval' DELIBERATELY (previewCsp.ts), because a
    // preview exists to run the page. The threat model's primary attacker, T1,
    // is defined as an .html file that "runs arbitrary JavaScript, including
    // unsafe-eval" (docs/security.md). A javascript: URL gives the page a second
    // route to something it is already allowed to do to its own document. The
    // boundary is the sandboxed opaque origin and the sealed in-memory session,
    // not script-src.
    //
    // Two things worth recording about the old assertion. It polled with
    // `.not.toContain(...)`, which returns on the first sample, so it never
    // waited. And it watched the document TITLE — which a successful payload
    // wipes, because the expression yields a string and the browser then
    // replaces the whole document. It could not have detected the thing it
    // named even given unlimited time.
    //
    // So this asserts the invariants that DO hold and that do matter: the view
    // does not navigate, and nothing new is opened.
    await openPreview(windowWithTestProject, 'links/index.html')
    await waitForPreviewTitled(appWithTestProject, '-LINKS-1')
    const before = await livePreviews(appWithTestProject)
    const sourceUrl = before[0].url

    expect(await clickInPreview(appWithTestProject, '-LINKS-1', 'dangerous')).toBe(true)

    // The barrier cannot be another click on this page — the payload replaced
    // its document, so there is no `-LINKS-1` left to click. Drive a real UI
    // action instead and wait for it, which drains the same pipeline.
    await openPreview(windowWithTestProject, 'self-contained/index.html')
    await waitForPreviewTitled(appWithTestProject, '-OK-1')

    const after = await livePreviews(appWithTestProject)
    // The sealed view stayed on its own document: no navigation escaped.
    expect(after.map((p) => p.url)).toContain(sourceUrl)
    // Only the preview this test opened on purpose is new.
    expect(after.length).toBe(before.length + 1)
  })

  test('a link escaping the project opens nothing', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    await openPreview(windowWithTestProject, 'links/index.html')
    await waitForPreviewTitled(appWithTestProject, '-LINKS-1')

    const before = (await livePreviews(appWithTestProject)).length
    await clickThenSettle(appWithTestProject, 'escape')

    // Nothing new is ever shown for a path outside the project. The barrier's
    // own target accounts for exactly one new preview; a third would be the
    // escaped file.
    expect((await livePreviews(appWithTestProject)).length).toBe(before + 1)
    expect(await liveTitles(appWithTestProject)).not.toContain('hosts')
  })

  test('a same-page anchor scrolls instead of opening a tab', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    await openPreview(windowWithTestProject, 'links/index.html')
    await waitForPreviewTitled(appWithTestProject, '-LINKS-1')

    const before = (await livePreviews(appWithTestProject)).length
    await clickThenSettle(appWithTestProject, 'anchor')

    // A fragment on the same document is a scroll, so only the barrier's own
    // target may appear.
    expect((await livePreviews(appWithTestProject)).length).toBe(before + 1)
  })
})
