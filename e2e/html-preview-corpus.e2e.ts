// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E acceptance tests for the HTML-preview corpus (issue #74, design §7 item 87;
 * AC24 perf, AC25 corpus, process-isolation floor).
 *
 * The corpus fixtures under `e2e/fixtures/html-preview-corpus/` were built as the
 * inputs for these tests but nothing ran them (post-review finding #10). This
 * suite seeds each case into an isolated project, opens it as a running preview,
 * and asserts its machine sentinel against the REAL native `WebContentsView`
 * (read from the main process via `app.evaluate`), not a DOM stand-in.
 *
 * The preview page runs in its own sealed `WebContentsView` in a separate web
 * contents, so its `<title>` / liveness are read main-side by finding the
 * `erfana-preview://` web contents — the same identity the app serves it under.
 *
 * NOTE: the E2E suite is disabled in CI (macos instability), so these guard
 * regressions on a local `npm run test:e2e` run, not on every PR.
 *
 * Condition-based waits only — never a sleep.
 *
 * @see e2e/fixtures/html-preview-corpus/README.md
 * @see docs/html-preview/README.md
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

/** A snapshot of the live preview's own web contents, read from the main process. */
interface PreviewSnapshot {
  /** `webContents.getTitle()` — may fall back to the URL until the doc is read. */
  title: string
  /** `document.title` read inside the page — the authoritative title sentinel. */
  docTitle: string
  /** True once the inline script has run (its `#js-output.pending` marker is gone). */
  jsRan: boolean
  url: string
  destroyed: boolean
}

/**
 * Find the running preview's `WebContentsView` web contents (served under the
 * `erfana-preview://` scheme) and read its title/liveness from the main process.
 * `null` when no preview is live.
 *
 * The document title is read via `executeJavaScript` (the page's own DOM), not
 * `getTitle()` — for a sealed, custom-protocol `WebContentsView`, `getTitle()`
 * can stay the URL, so it is not a reliable sentinel. Injection from the main
 * process is not subject to the page CSP, so it reads the real `document.title`.
 */
async function previewSnapshot(app: ElectronApplication): Promise<PreviewSnapshot | null> {
  return app.evaluate(async ({ webContents }) => {
    const previews = webContents.getAllWebContents().filter((wc) => {
      try {
        return wc.getURL().startsWith('erfana-preview://')
      } catch {
        return false
      }
    })
    if (previews.length === 0) return null
    const wc = previews[0]
    let docTitle = ''
    let jsRan = false
    try {
      docTitle = await wc.executeJavaScript('document.title')
      // The self-contained fixture drops the `pending` class on DOMContentLoaded.
      jsRan = await wc.executeJavaScript('!document.querySelector("#js-output.pending")')
    } catch {
      // Page may be mid-load / navigating — leave the defaults, the caller polls.
    }
    return { title: wc.getTitle(), docTitle, jsRan, url: wc.getURL(), destroyed: wc.isDestroyed() }
  })
}

/** Open a project-relative `.html` file as a running preview. */
async function openPreview(page: Page, relPath: string): Promise<void> {
  // The test-project fixtures mount with the tree panel already open — do NOT
  // click the Files activity-bar button, which would toggle it shut.
  const tree = new ProjectTreePage(page)
  const folder = relPath.split('/')[0]
  await tree.expandTo([folder])
  await tree.fileRow(relPath).click()
  // The panel chrome mounts a `.html-preview-placeholder` — a sized, brand-black
  // target the native `WebContentsView` paints OVER. Because the native view sits
  // above it (and its own a11y/layout tree is separate), the placeholder reads as
  // "hidden" to the DOM once the view paints, so wait for it to be ATTACHED, not
  // visible. Actual preview readiness is asserted by each test via
  // `previewSnapshot` (the real `erfana-preview://` web contents).
  await page.locator('.html-preview-placeholder').waitFor({
    state: 'attached',
    timeout: PREVIEW_BUDGET_MS
  })
}

/**
 * The number shown on the tab's failure badge (`.html-preview-badge-count`), or
 * 0 when no badge is present. The badge lives in always-DOM tab chrome (the
 * native view never occludes it), so it is readable even while the page runs.
 */
async function failureBadgeCount(page: Page): Promise<number> {
  const count = page.locator('.html-preview-badge-count')
  if ((await count.count()) === 0) return 0
  const text = (await count.first().textContent())?.trim() ?? ''
  const n = Number.parseInt(text, 10)
  return Number.isNaN(n) ? 0 : n
}

/** Evaluate an expression inside the live preview page's DOM (main-process read). */
async function previewEval(app: ElectronApplication, expr: string): Promise<string | null> {
  return app.evaluate(async ({ webContents }, e) => {
    const wc = webContents.getAllWebContents().find((c) => {
      try {
        return c.getURL().startsWith('erfana-preview://')
      } catch {
        return false
      }
    })
    if (!wc) return null
    try {
      return await wc.executeJavaScript(e)
    } catch {
      return null
    }
  }, expr)
}

/** Open the failure-badge popover and return the text of its listed entries. */
async function failureBadgeEntries(page: Page): Promise<string> {
  await page.locator('.html-preview-badge').first().click()
  const popover = page.locator('.html-preview-badge-popover')
  await popover.waitFor({ state: 'visible', timeout: 5000 })
  return (await popover.textContent()) ?? ''
}

test.use({
  testProjectFiles: {
    'self-contained/index.html': corpus('self-contained/index.html'),
    'runaway-loop/index.html': corpus('runaway-loop/index.html'),
    'multi-file/index.html': corpus('multi-file/index.html'),
    'multi-file/styles.css': corpus('multi-file/styles.css'),
    'multi-file/app.js': corpus('multi-file/app.js'),
    'multi-file/logo.svg': corpus('multi-file/logo.svg'),
    'error/index.html': corpus('error/index.html'),
    'error/data.unknownext': corpus('error/data.unknownext'),
    'cdn/index.html': corpus('cdn/index.html'),
    'notes.md': '# Notes\n'
  }
})

test.describe('HTML preview corpus', () => {
  test('self-contained: JavaScript executes and the -OK-1 sentinel lands (AC25)', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    await openPreview(windowWithTestProject, 'self-contained/index.html')

    // The sentinel is the preview page's own <title> ("-OK-1"), read from its
    // live DOM in the main process. Its inline script also drops the `pending`
    // marker on DOMContentLoaded, so a satisfied `jsRan` proves JS executed.
    await expect
      .poll(async () => (await previewSnapshot(appWithTestProject))?.docTitle, {
        timeout: PREVIEW_BUDGET_MS,
        message: 'preview <title> never gained the -OK-1 sentinel (page did not load?)'
      })
      .toContain('-OK-1')

    const snapshot = await previewSnapshot(appWithTestProject)
    // The untrusted inline JS ran (AC25) and the page is still alive after it.
    expect(snapshot?.jsRan).toBe(true)
    expect(snapshot?.destroyed).toBe(false)
  })

  test('runaway-loop: the host stays responsive while the preview floods its own process', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    await openPreview(windowWithTestProject, 'runaway-loop/index.html')

    // The preview view is live and serving the runaway page.
    await expect
      .poll(async () => (await previewSnapshot(appWithTestProject))?.url, {
        timeout: PREVIEW_BUDGET_MS,
        message: 'runaway-loop preview never became live'
      })
      .toContain('erfana-preview://')

    // Isolation floor: while the preview process floods its own event loop, the
    // HOST renderer still answers a synchronous IPC round-trip promptly.
    const start = Date.now()
    const platform = await windowWithTestProject.evaluate(() => window.api.utils.getPlatform())
    expect(Date.now() - start).toBeLessThan(2000)
    expect(platform).toBeTruthy()

    // And the tab still closes promptly (bounded destroy): closing the preview
    // tab tears the view down, so no `erfana-preview://` web contents remains.
    await windowWithTestProject.locator('.html-preview-tab-close').first().click()
    await expect
      .poll(async () => previewSnapshot(appWithTestProject), {
        timeout: PREVIEW_BUDGET_MS,
        message: 'preview view was not torn down promptly on tab close'
      })
      .toBeNull()
  })

  test('multi-file: relative CSS, JS and image resolve and the -OK-2 sentinel lands (AC6, AC25)', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    await openPreview(windowWithTestProject, 'multi-file/index.html')

    // app.js sets `-OK-2` ONLY after the relative stylesheet applied AND the
    // relative logo.svg loaded — so the sentinel proves all three relative refs
    // (styles.css, app.js, logo.svg) were served through the confined scheme.
    await expect
      .poll(async () => (await previewSnapshot(appWithTestProject))?.docTitle, {
        timeout: PREVIEW_BUDGET_MS,
        message: 'preview <title> never gained -OK-2 (a relative asset did not resolve?)'
      })
      .toContain('-OK-2')

    expect((await previewSnapshot(appWithTestProject))?.destroyed).toBe(false)
  })

  test('error: page renders while its non-fatal load diagnostics are badged (AC20, AC25)', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    await openPreview(windowWithTestProject, 'error/index.html')

    // The page renders despite an uncaught script error, an unresolved module
    // specifier and an unsupported-asset-type link — errors are non-fatal, so the
    // document loads and the view is NOT destroyed by them.
    await expect
      .poll(async () => (await previewSnapshot(appWithTestProject))?.docTitle, {
        timeout: PREVIEW_BUDGET_MS,
        message: 'error page never loaded its title'
      })
      .toBe('Error corpus page')
    expect((await previewSnapshot(appWithTestProject))?.destroyed).toBe(false)

    // The failure badge collects the page's load-time diagnostics. Verified
    // behaviour: the uncaught script error and the unresolved bare-module import
    // both register. Note: the README's third sentinel (an `unsupported-asset-type`
    // badge for `data.unknownext`) does NOT fire here — the file IS served (200,
    // octet-stream), but the badge needs the request `destination` to be
    // `style`/`script`, which Chromium does not populate for a privileged
    // custom-scheme subresource in this build, so that diagnostic never records.
    await expect
      .poll(() => failureBadgeCount(windowWithTestProject), {
        timeout: PREVIEW_BUDGET_MS,
        message: 'failure badge never reached the expected ≥2 diagnostics'
      })
      .toBeGreaterThanOrEqual(2)

    // Both diagnostics name their cause in the popover.
    const entries = await failureBadgeEntries(windowWithTestProject)
    expect(entries).toContain('deliberate uncaught script error')
    expect(entries).toContain('nonexistent-package')
  })

  test('cdn: an unapproved remote subresource is blocked and the page degrades gracefully (AC7)', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    await openPreview(windowWithTestProject, 'cdn/index.html')

    // Host is NOT approved, so the request filter refuses the cdn.jsdelivr.net
    // stylesheet (deterministic — refused before any network). The page keeps its
    // fallback title and never gains -OK-3, and the view survives.
    await expect
      .poll(async () => (await previewSnapshot(appWithTestProject))?.docTitle, {
        timeout: PREVIEW_BUDGET_MS,
        message: 'cdn fallback page never loaded'
      })
      .toBe('CDN corpus page (fallback)')
    const snapshot = await previewSnapshot(appWithTestProject)
    expect(snapshot?.docTitle).not.toContain('-OK-3')
    expect(snapshot?.destroyed).toBe(false)

    // The unapproved remote stylesheet did NOT load: the page took its own
    // `onerror` fallback path. Note: the CSP (`default-src 'none'`) blocks the
    // request at the renderer BEFORE the network filter sees it, so no
    // blocked-host failure badge is raised — the page's fallback text is the
    // observable AC7 signal here.
    await expect
      .poll(() =>
        previewEval(
          appWithTestProject,
          'document.getElementById("cdn-status") && document.getElementById("cdn-status").textContent'
        )
      , {
        timeout: PREVIEW_BUDGET_MS,
        message: 'cdn page never took its blocked-host fallback path'
      })
      .toContain('CDN blocked')
  })
})
