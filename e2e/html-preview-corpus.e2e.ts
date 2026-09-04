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
 * Those reads live in `HtmlPreviewPage` (e2e/pages/html-preview.page.ts).
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
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'

const CORPUS_DIR = path.join(__dirname, 'fixtures', 'html-preview-corpus')

/** Read one corpus file's real content so the tests exercise the shipped input. */
function corpus(relPath: string): string {
  return fs.readFileSync(path.join(CORPUS_DIR, relPath), 'utf-8')
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
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await preview.open('self-contained/index.html')

    // The sentinel is the preview page's own <title> ("-OK-1"), read from its
    // live DOM in the main process. Its inline script also drops the `pending`
    // marker on DOMContentLoaded, so a satisfied `jsRan` proves JS executed.
    await expect
      .poll(async () => (await preview.snapshot())?.docTitle, {
        timeout: PREVIEW_BUDGET_MS,
        message: 'preview <title> never gained the -OK-1 sentinel (page did not load?)'
      })
      .toContain('-OK-1')

    const snapshot = await preview.snapshot()
    // The untrusted inline JS ran (AC25) and the page is still alive after it.
    expect(snapshot?.jsRan).toBe(true)
    expect(snapshot?.destroyed).toBe(false)
  })

  test('runaway-loop: the host stays responsive while the preview floods its own process', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await preview.open('runaway-loop/index.html')

    // The preview view is live and serving the runaway page.
    await expect
      .poll(async () => (await preview.snapshot())?.url, {
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
    await preview.tabClose().click()
    await expect
      .poll(async () => preview.snapshot(), {
        timeout: PREVIEW_BUDGET_MS,
        message: 'preview view was not torn down promptly on tab close'
      })
      .toBeNull()
  })

  test('multi-file: relative CSS, JS and image resolve and the -OK-2 sentinel lands (AC6, AC25)', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await preview.open('multi-file/index.html')

    // app.js sets `-OK-2` ONLY after the relative stylesheet applied AND the
    // relative logo.svg loaded — so the sentinel proves all three relative refs
    // (styles.css, app.js, logo.svg) were served through the confined scheme.
    await expect
      .poll(async () => (await preview.snapshot())?.docTitle, {
        timeout: PREVIEW_BUDGET_MS,
        message: 'preview <title> never gained -OK-2 (a relative asset did not resolve?)'
      })
      .toContain('-OK-2')

    expect((await preview.snapshot())?.destroyed).toBe(false)
  })

  test('error: page renders while its non-fatal load diagnostics are badged (AC20, AC25)', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await preview.open('error/index.html')

    // The page renders despite an uncaught script error, an unresolved module
    // specifier and an unsupported-asset-type link — errors are non-fatal, so the
    // document loads and the view is NOT destroyed by them.
    await expect
      .poll(async () => (await preview.snapshot())?.docTitle, {
        timeout: PREVIEW_BUDGET_MS,
        message: 'error page never loaded its title'
      })
      .toBe('Error corpus page')
    expect((await preview.snapshot())?.destroyed).toBe(false)

    // The failure badge collects the page's load-time diagnostics. Verified
    // behaviour: the uncaught script error and the unresolved bare-module import
    // both register. Note: the README's third sentinel (an `unsupported-asset-type`
    // badge for `data.unknownext`) does NOT fire here — the file IS served (200,
    // octet-stream), but the badge needs the request `destination` to be
    // `style`/`script`, which Chromium does not populate for a privileged
    // custom-scheme subresource in this build, so that diagnostic never records.
    await expect
      .poll(() => preview.failureBadgeCount(), {
        timeout: PREVIEW_BUDGET_MS,
        message: 'failure badge never reached the expected ≥2 diagnostics'
      })
      .toBeGreaterThanOrEqual(2)

    // Both diagnostics name their cause in the popover.
    const entries = await preview.failureBadgeEntries()
    expect(entries).toContain('deliberate uncaught script error')
    expect(entries).toContain('nonexistent-package')
  })

  test('cdn: an unapproved remote subresource is blocked and the page degrades gracefully (AC7)', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await preview.open('cdn/index.html')

    // Host is NOT approved, so the request filter refuses the cdn.jsdelivr.net
    // stylesheet (deterministic — refused before any network). The page keeps its
    // fallback title and never gains -OK-3, and the view survives.
    await expect
      .poll(async () => (await preview.snapshot())?.docTitle, {
        timeout: PREVIEW_BUDGET_MS,
        message: 'cdn fallback page never loaded'
      })
      .toBe('CDN corpus page (fallback)')
    const snapshot = await preview.snapshot()
    expect(snapshot?.docTitle).not.toContain('-OK-3')
    expect(snapshot?.destroyed).toBe(false)

    // The unapproved remote stylesheet did NOT load: the page took its own
    // `onerror` fallback path. Note: the CSP (`default-src 'none'`) blocks the
    // request at the renderer BEFORE the network filter sees it, so no
    // blocked-host failure badge is raised — the page's fallback text is the
    // observable AC7 signal here.
    await expect
      .poll(
        () =>
          preview.eval(
            'document.getElementById("cdn-status") && document.getElementById("cdn-status").textContent'
          ),
        {
          timeout: PREVIEW_BUDGET_MS,
          message: 'cdn page never took its blocked-host fallback path'
        }
      )
      .toContain('CDN blocked')
  })

  test('cdn: the permission band lists the blocked host and can approve it', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    // The band is DOM chrome, so unlike the previewed page it is reachable from
    // the Playwright side. This is the only automated cover for the surface that
    // replaced the approve toast — and for the case that broke the old one: a
    // host is listed whether or not anything popped up, because nothing pops up.
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await preview.open('cdn/index.html')

    const chip = preview.chip()
    await expect(chip).toBeVisible()

    // Counts are ALWAYS shown, including the zeroes: a trust signal that appears
    // only when something is wrong is not a trust signal.
    await expect(chip).toHaveText(/\d+ blocked · \d+ allowed/)

    // The CSP refuses cdn.jsdelivr.net in the renderer, and the violation bridge
    // reports it — so the band must list it even though the network filter never
    // saw the request.
    await expect
      .poll(async () => (await chip.textContent()) ?? '', {
        timeout: PREVIEW_BUDGET_MS,
        message: 'the band never reported the blocked CDN host'
      })
      .toMatch(/[1-9]\d* blocked/)

    await preview.openBand()
    await expect(preview.band().getByText('Blocked on load')).toBeVisible()
    await expect(preview.hostRow('cdn.jsdelivr.net')).toBeVisible()

    // Allow OPENS the question; it does not answer it. That split is what stops a
    // one-way door being opened by a stray Return.
    // The accessible name carries the whole ORIGIN, not the bare host: a
    // permission covers scheme, host and port, and the name has to say what is
    // actually being granted.
    await preview.allowButton('https://cdn.jsdelivr.net').click()
    await expect(preview.confirmDialog()).toBeVisible()
    await expect(preview.band().getByText(/Erfana cannot undo it/)).toBeVisible()

    // Cancel leaves the grant unmade and the host still listed. (The completed
    // grant — Allow → Confirm against a real server — is
    // html-preview-approval.e2e.ts; this fixture points at the public CDN, so
    // confirming here would either hit the network or fail offline.)
    await preview.cancelButton().click()
    await expect(preview.confirmDialog()).toHaveCount(0)
    await expect(preview.hostRow('cdn.jsdelivr.net')).toBeVisible()
  })

  test('the native view is sized on open, with no tab switch to prod it (black-panel regression)', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await preview.open('self-contained/index.html')

    // The page loading proves nothing about what the user sees: a `WebContentsView`
    // left at 0x0 still loads and still runs its scripts. Assert the RECTANGLE.
    //
    // Deliberately short: the panel measures its placeholder on mount, before
    // dockview has laid the panel out, so the first measurement is 0x0 and sends
    // nothing. Before the fix the next send only came from a later tab switch or
    // window resize, so the preview stayed black until the user clicked around —
    // which no other test in this suite could see.
    // Compared against the PLACEHOLDER's real box, not against zero. `> 0` was
    // satisfied by the exact bug it names: the rect a view keeps when no real
    // measurement ever reaches it is `{ x: 0, y: 0, width: 1, height: 1 }`
    // (usePreviewLifecycle seeds `preview:open` with it), and 1 is greater
    // than 0. The regression this test exists for would have shipped green.
    const placeholder = await preview.placeholderBox('index.html')
    expect(placeholder).not.toBeNull()
    const expectedWidth = placeholder?.width ?? 0
    const expectedHeight = placeholder?.height ?? 0
    expect(expectedWidth).toBeGreaterThan(100)

    // A few pixels of tolerance for DIP rounding; the point is that the view
    // tracks the panel, not that it is non-degenerate.
    await expect
      .poll(async () => (await preview.viewBounds())?.width ?? 0, {
        timeout: 5000,
        message: 'preview view never matched its placeholder without user interaction'
      })
      .toBeGreaterThan(expectedWidth - 4)

    const bounds = await preview.viewBounds()
    // The placeholder now IS the page area: the chrome strip is a flow sibling
    // above it rather than an overlay on it, so no inset is subtracted here any
    // more and the height gets the same tight DIP-rounding tolerance as the
    // width. The old allowance was 40px, wide enough to hide a whole missing
    // strip's worth of geometry error.
    expect(bounds?.height).toBeGreaterThan(expectedHeight - 4)
  })
})
