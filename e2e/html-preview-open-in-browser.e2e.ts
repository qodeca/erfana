// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview – "Open in default browser" (#124, part 4, WI-26).
 *
 * P4-AC1 the project tree offers the item for `.html` files – second, after
 * "Open as source", then a separator – and hands the file's REAL path to the
 * launcher; P4-AC2 the toolbar button acts on the page the tab shows NOW, so
 * after a same-tab move from A to B it sends B, and it is `aria-disabled`
 * (never `disabled`) from the press to the answer; P4-AC3 no default browser
 * found → the `.html` app and an info notice, a failed launch → an error toast
 * naming the platform's reveal command, success silent. P4-AC5 (external links
 * unchanged) is the links spec. DoD-2: this spec.
 *
 * No test starts a browser. The app is launched with `ERFANA_E2E_BROWSER_SEAM=1`
 * and each test installs a recording seam in the main process
 * (`html-preview.browser.ts`), which refuses to arm unless the variable really
 * reached the app. The default-browser lookup is stubbed to a fixed path, so
 * the assertions do not depend on the machine's own default browser.
 *
 * Paths: the seam receives the confined REAL path, so expectations go through
 * `realpath` (macOS temp folders live under `/var` → `/private/var`).
 *
 * Local gate only: e2e is disabled in CI. Condition-based waits only.
 *
 * @see docs/design/design-issue-124-part4.md
 */

import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'

import type { ElectronApplication, Page } from '@playwright/test'
import { test as base, expect } from './fixtures/index'
import { HtmlPreviewPage } from './pages/html-preview.page'
import { ProjectTreePage } from './pages/project-tree.page'
import {
  BROWSER_SEAM_ENV,
  OPEN_IN_BROWSER_LABEL,
  armBrowserSeam,
  browserSeamCalls,
  dismissAllToasts,
  expectedBrowserLaunch,
  openInBrowserButton,
  releaseBrowserSeam,
  rendererPlatform,
  revealCommandFor,
  setBrowserSeamMode,
  stubBrowserLookup,
  stubBrowserPath,
  toastsOf,
  waitForBrowserSeamCalls
} from './pages/html-preview.browser'

const PAGE_A = 'site/a.html'
const PAGE_B = 'site/b.html'
const REAL_PAGE = 'site/real.html'
/** A symlink to `REAL_PAGE`, made in setup: the launcher must get the target. */
const ALIAS = 'alias.html'

/** The UX spec §7 texts the renderer shows. */
const ERROR_TITLE = 'Could not open in browser'
const FALLBACK_TITLE = 'Opened in the app for .html files'

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title>
<style>a { display: inline-block; padding: 24px; font-size: 24px; }</style></head>
<body>${body}</body>
</html>
`
}

interface Oib {
  app: ElectronApplication
  page: Page
  preview: HtmlPreviewPage
  tree: ProjectTreePage
  /** `process.platform` as the renderer reports it. */
  platform: string
  /** The real path of a project-relative file. */
  real: (relPath: string) => string
}

const test = base.extend<{ oib: Oib }>({
  // The symlink exists before the project opens, so the first tree read lists it.
  testProject: async ({ testProject }, use) => {
    await fsp.symlink(path.join('site', 'real.html'), path.join(testProject.path, ALIAS), 'file')
    await use(testProject)
  },
  oib: async ({ windowWithTestProject: page, appWithTestProject: app, testProject }, use) => {
    const platform = await rendererPlatform(page)
    await armBrowserSeam(app)
    await stubBrowserLookup(app, { path: stubBrowserPath(platform) })
    await dismissAllToasts(page)
    await use({
      app,
      page,
      preview: new HtmlPreviewPage(page, app),
      tree: new ProjectTreePage(page),
      platform,
      real: (relPath) => fs.realpathSync.native(path.join(testProject.path, ...relPath.split('/')))
    })
    // Nothing may stay held when the app closes.
    await releaseBrowserSeam(app)
  }
})

test.use({
  testProjectFiles: {
    [PAGE_A]: page('Open in browser A -OIB-A-', '<p><a id="to-b" href="b.html">Go to B</a></p>'),
    [PAGE_B]: page('Open in browser B -OIB-B-', '<p><a id="to-a" href="a.html">Back to A</a></p>'),
    [REAL_PAGE]: page('Open in browser real -OIB-REAL-', '<p>real</p>'),
    'notes.md': '# Notes\n'
  }
})

// The fixtures launch Electron with `{ ...process.env }`: set the variable for
// this file's launches only, and put the worker's value back afterwards.
let previousSeamEnv: string | undefined
test.beforeAll(() => {
  previousSeamEnv = process.env[BROWSER_SEAM_ENV]
  process.env[BROWSER_SEAM_ENV] = '1'
})
test.afterAll(() => {
  if (previousSeamEnv === undefined) delete process.env[BROWSER_SEAM_ENV]
  else process.env[BROWSER_SEAM_ENV] = previousSeamEnv
})

/** The open context menu as labels, with `---` for each separator. */
async function menuEntries(tree: ProjectTreePage): Promise<string[]> {
  return tree
    .contextMenu()
    .locator('[role="menuitem"], [role="separator"]')
    .evaluateAll((nodes) =>
      nodes.map((n) => (n.getAttribute('role') === 'separator' ? '---' : (n.textContent ?? '').trim()))
    )
}

async function openPreview(h: Oib, relPath: string, sentinel: string): Promise<void> {
  await h.preview.open(relPath)
  await h.preview.waitForTitled(sentinel)
  await expect(openInBrowserButton(h.page)).toBeVisible()
}

/** Press the toolbar button and wait until main has answered (busy cleared). */
async function pressAndSettle(h: Oib, calls: number): Promise<void> {
  await openInBrowserButton(h.page).click()
  await waitForBrowserSeamCalls(h.app, calls)
  await expect(openInBrowserButton(h.page)).not.toHaveAttribute('aria-disabled', 'true')
}

test.describe('Open in default browser – project tree (P4-AC1)', () => {
  test('should offer "Open in default browser" second, after "Open as source" and before a separator, when a .html file is right-clicked', async ({ oib: h }) => {
    await h.tree.expandTo(['site'])
    await h.tree.openContextMenu(h.tree.fileRow(REAL_PAGE))

    const entries = await menuEntries(h.tree)
    expect(entries.slice(0, 3)).toEqual(['Open as source', OPEN_IN_BROWSER_LABEL, '---'])
    expect(entries.filter((e) => e === OPEN_IN_BROWSER_LABEL)).toHaveLength(1)
  })

  test('should not offer "Open in default browser" when a Markdown file or a folder is right-clicked', async ({ oib: h }) => {
    await h.tree.openContextMenu(h.tree.fileRow('notes.md'))
    expect(await menuEntries(h.tree)).not.toContain(OPEN_IN_BROWSER_LABEL)
    await h.page.keyboard.press('Escape')
    await expect(h.tree.contextMenu()).toHaveCount(0)

    await h.tree.openContextMenu(h.tree.folderRow('site'))
    expect(await menuEntries(h.tree)).not.toContain(OPEN_IN_BROWSER_LABEL)
  })

  test('should hand the launcher the real path of the file when the item is chosen on a symlink', async ({ oib: h }) => {
    const target = h.real(REAL_PAGE)
    expect(fs.lstatSync(path.join(path.dirname(h.real('notes.md')), ALIAS)).isSymbolicLink()).toBe(true)

    await h.tree.runContextMenuAction(h.tree.fileRow(ALIAS), OPEN_IN_BROWSER_LABEL)

    expect(await waitForBrowserSeamCalls(h.app, 1)).toEqual([expectedBrowserLaunch(h.platform, target)])
  })
})

test.describe('Open in default browser – preview toolbar (P4-AC2)', () => {
  test('should send the page the tab shows now when pressed after a same-tab move from A to B', async ({ oib: h }) => {
    await openPreview(h, PAGE_A, '-OIB-A-')
    await pressAndSettle(h, 1)

    const toggle = h.page.getByTestId('preview-band-link-mode')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    // A trusted click: only a gesture may move the tab in place.
    expect(await h.preview.clickTrusted('to-b', HtmlPreviewPage.target(PAGE_A))).toBe(true)
    await h.preview.waitForTitled('-OIB-B-')
    await expect
      .poll(async () => (await h.preview.livePreviews()).map((p) => p.url))
      .toEqual([expect.stringMatching(/\/site\/b\.html$/)])
    await expect(h.preview.tab('b.html')).toBeVisible()

    await pressAndSettle(h, 2)
    expect(await browserSeamCalls(h.app)).toEqual([
      expectedBrowserLaunch(h.platform, h.real(PAGE_A)),
      expectedBrowserLaunch(h.platform, h.real(PAGE_B))
    ])
  })

  test('should stay aria-disabled, never disabled, and ignore presses until main answers, then stay silent on success', async ({ oib: h }) => {
    await openPreview(h, PAGE_A, '-OIB-A-')
    await setBrowserSeamMode(h.app, 'hold')
    const button = openInBrowserButton(h.page)

    await button.click()
    await waitForBrowserSeamCalls(h.app, 1)
    await expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(await button.getAttribute('disabled')).toBeNull()

    // A keyboard press while busy: ignored, and focus stays on the button.
    await button.focus()
    await h.page.keyboard.press('Enter')
    await expect(button).toBeFocused()

    await setBrowserSeamMode(h.app, 'answer')
    expect(await releaseBrowserSeam(h.app)).toBe(1)
    await expect(button).not.toHaveAttribute('aria-disabled', 'true')

    // Barrier for the ignored press: one legitimate press after it. Once ITS
    // answer is back, any request the busy press had sent has been seen too.
    await pressAndSettle(h, 2)
    const calls = await browserSeamCalls(h.app)
    expect(calls).toHaveLength(2)
    expect(calls.every((c) => c.filePath === h.real(PAGE_A))).toBe(true)
    // Success is silent: no refusal and no fallback notice.
    await expect(toastsOf(h.page, 'error')).toHaveCount(0)
    await expect(toastsOf(h.page, 'info')).toHaveCount(0)
  })
})

test.describe('Open in default browser – fallback and failure (P4-AC3)', () => {
  test('should open the file in the .html app and say so when no default browser can be found', async ({ oib: h }) => {
    await stubBrowserLookup(h.app, 'reject')
    await openPreview(h, PAGE_A, '-OIB-A-')

    await pressAndSettle(h, 1)

    expect(await browserSeamCalls(h.app)).toEqual([{ via: 'fallback', appPath: null, filePath: h.real(PAGE_A) }])
    const notice = toastsOf(h.page, 'info')
    await expect(notice).toHaveCount(1)
    await expect(notice).toContainText(FALLBACK_TITLE)
    await expect(notice).toContainText('a.html')
    await expect(toastsOf(h.page, 'error')).toHaveCount(0)
  })

  test("should show the launch-failure toast naming the platform's reveal command when the browser does not start", async ({ oib: h }) => {
    await setBrowserSeamMode(h.app, 'throw')
    await openPreview(h, PAGE_A, '-OIB-A-')

    await pressAndSettle(h, 1)

    const failure = toastsOf(h.page, 'error')
    await expect(failure).toHaveCount(1)
    await expect(failure).toContainText(ERROR_TITLE)
    await expect(failure).toContainText(
      `Your browser did not start. Try again, or use ${revealCommandFor(h.platform)} to open the file yourself.`
    )
    // A failed launch does not fall back: the one call was the browser.
    expect(await browserSeamCalls(h.app)).toEqual([expectedBrowserLaunch(h.platform, h.real(PAGE_A))])
    await expect(toastsOf(h.page, 'info')).toHaveCount(0)
  })
})
