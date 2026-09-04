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
 * `WebContentsView`, so the renderer's DOM cannot see it. Those reads live in
 * `HtmlPreviewPage` (e2e/pages/html-preview.page.ts).
 *
 * Clicks land inside that sealed view, which Playwright cannot reach, so they
 * are dispatched main-side. `clickInPreview` uses `executeJavaScript`, and those
 * synthesised clicks are UNTRUSTED (`isTrusted === false`) — which is precisely
 * what the preload refuses — so those tests drive the `will-navigate` path, the
 * fallback that keeps plain links working when the preload is absent. The
 * external-link case needs the TRUSTED path (a gesture is the only thing that
 * may reach the OS browser), so it uses `clickTrusted`, a real input event via
 * `webContents.sendInputEvent`.
 *
 * Condition-based waits only — never a sleep.
 *
 * @see docs/html-preview/README.md#links
 * @see specs/designs/sd-074b-preview-navigation-and-multiview.md
 */

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'

import type { BaseWindow, MessageBoxOptions } from 'electron'

import { test, expect } from './fixtures/index'
import { LogTail } from './fixtures/logTail'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'

const CORPUS_DIR = path.join(__dirname, 'fixtures', 'html-preview-corpus')

/** Read one corpus file's real content so the tests exercise the shipped input. */
function corpus(relPath: string): string {
  return fs.readFileSync(path.join(CORPUS_DIR, relPath), 'utf-8')
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
async function clickThenSettle(preview: HtmlPreviewPage, elementId: string): Promise<void> {
  expect(await preview.clickInPreview('-LINKS-1', elementId)).toBe(true)
  expect(await preview.clickInPreview('-LINKS-1', 'plain')).toBe(true)
  await preview.waitForTitled('-LINKS-TARGET-')
}

/**
 * The page behind the external-link case. Written at runtime with a host that
 * is unique to this run, because the assertion reads `main.log`, which every
 * Erfana process on the machine appends to — a fixed host could match a line
 * written by a sibling worker. `.invalid` is reserved (RFC 2606): even if the
 * dialog were somehow accepted, nothing resolves.
 */
function externalLinkPage(host: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>External link page -EXTERNAL-1</title></head>
<body>
  <p><a id="ext" href="https://${host}/page">Open the outside</a></p>
</body>
</html>
`
}

test.use({
  testProjectFiles: {
    'links/index.html': corpus('links/index.html'),
    'links/target.html': corpus('links/target.html'),
    'self-contained/index.html': corpus('self-contained/index.html'),
    // Placeholder; the test rewrites it with a run-unique host before opening it.
    'external/index.html': externalLinkPage('placeholder.invalid'),
    'notes.md': '# Notes\n'
  }
})

test.describe('HTML preview — independent previews', () => {
  test('two .html files run at the same time, with no refusal', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await preview.open('links/index.html')
    await preview.waitForTitled('-LINKS-1')

    await preview.open('self-contained/index.html')
    await preview.waitForTitled('-OK-1')

    // The refusal that used to appear for a second preview is gone.
    await expect(
      windowWithTestProject.getByText('This file is already previewed in another window.')
    ).toHaveCount(0)

    // Both pages are alive at once — the whole point of the change.
    const titles = await preview.liveTitles()
    expect(titles).toContain('-LINKS-1')
    expect(titles).toContain('-OK-1')
  })
})

test.describe('HTML preview — link routing', () => {
  test('a plain link opens its target in a new tab', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await preview.open('links/index.html')
    await preview.waitForTitled('-LINKS-1')

    expect(await preview.clickInPreview('-LINKS-1', 'plain')).toBe(true)

    // The target opens as its OWN running preview; the source page stays open.
    await preview.waitForTitled('-LINKS-TARGET-')
    expect(await preview.liveTitles()).toContain('-LINKS-1')
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
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await preview.open('links/index.html')
    await preview.waitForTitled('-LINKS-1')
    const before = await preview.livePreviews()
    const sourceUrl = before[0].url

    expect(await preview.clickInPreview('-LINKS-1', 'dangerous')).toBe(true)

    // The barrier cannot be another click on this page — the payload replaced
    // its document, so there is no `-LINKS-1` left to click. Drive a real UI
    // action instead and wait for it, which drains the same pipeline.
    await preview.open('self-contained/index.html')
    await preview.waitForTitled('-OK-1')

    const after = await preview.livePreviews()
    // The sealed view stayed on its own document: no navigation escaped.
    expect(after.map((p) => p.url)).toContain(sourceUrl)
    // Only the preview this test opened on purpose is new.
    expect(after.length).toBe(before.length + 1)
  })

  test('a link escaping the project opens nothing', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await preview.open('links/index.html')
    await preview.waitForTitled('-LINKS-1')

    const before = (await preview.livePreviews()).length
    await clickThenSettle(preview, 'escape')

    // Nothing new is ever shown for a path outside the project. The barrier's
    // own target accounts for exactly one new preview; a third would be the
    // escaped file.
    expect((await preview.livePreviews()).length).toBe(before + 1)
    expect(await preview.liveTitles()).not.toContain('hosts')
  })

  test('a same-page anchor scrolls instead of opening a tab', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await preview.open('links/index.html')
    await preview.waitForTitled('-LINKS-1')

    const before = (await preview.livePreviews()).length
    await clickThenSettle(preview, 'anchor')

    // A fragment on the same document is a scroll, so only the barrier's own
    // target may appear.
    expect((await preview.livePreviews()).length).toBe(before + 1)
  })
})

test.describe('HTML preview — external links', () => {
  test('an https: link asks before opening, and Cancel is logged as the outcome', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    // The question is a NATIVE message box parented to the window
    // (`dialog.showMessageBox` in externalLinkConsent.ts). Playwright cannot
    // click it and a CDP key press goes to the renderer, not to the box, so the
    // outcome is observed where the app records it: `main.log` gains one line
    // per step — `asking`, then `cancelled` / `opened` / `refused`.
    //
    // To answer the box, the test wraps `dialog.showMessageBox` so the REAL box
    // still opens with the app's own options, plus Electron's documented
    // `signal`: aborting it closes the box "as if it was cancelled by the user"
    // and the unmodified consent code then logs `cancelled`. No button is
    // stubbed and no result is invented; only the dismissal is driven.
    const host = `e2e-${crypto.randomBytes(6).toString('hex')}.invalid`
    await fsp.writeFile(
      path.join(testProject.path, 'external', 'index.html'),
      externalLinkPage(host),
      'utf-8'
    )

    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await preview.open('external/index.html')
    await preview.waitForTitled('-EXTERNAL-1')

    await appWithTestProject.evaluate(({ dialog }) => {
      const original = dialog.showMessageBox.bind(dialog)
      const controller = new AbortController()
      ;(globalThis as { __erfanaE2eExternalDialog?: AbortController }).__erfanaE2eExternalDialog =
        controller
      // The app always calls the parented form (externalLinkConsent.ts:
      // "always parented"), so only that overload is wrapped.
      dialog.showMessageBox = ((window: BaseWindow, options: MessageBoxOptions) =>
        original(window, { ...options, signal: controller.signal })) as typeof dialog.showMessageBox
    })

    const log = new LogTail()
    await log.mark()

    // A trusted click: the preload reports a gesture, main routes it as
    // `external`, and only a gesture may reach the consent step.
    expect(await preview.clickTrusted('ext', HtmlPreviewPage.target('external/index.html'))).toBe(
      true
    )

    const asking = new RegExp(`Preview external link: asking.*https://${host}`)
    await log.waitFor(asking, {
      timeout: PREVIEW_BUDGET_MS,
      message: 'main.log never recorded the external-link question being asked'
    })
    // Dismiss the real box the way Electron lets a caller cancel it.
    await appWithTestProject.evaluate(() => {
      ;(globalThis as { __erfanaE2eExternalDialog?: AbortController }).__erfanaE2eExternalDialog?.abort()
    })

    const cancelled = new RegExp(`Preview external link: cancelled.*https://${host}`)
    await log.waitFor(cancelled, {
      timeout: PREVIEW_BUDGET_MS,
      message: 'main.log never recorded the external-link question being cancelled'
    })

    // The whole outcome, in order, and nothing was handed to the OS.
    const trail = await log.appended()
    expect(trail).not.toMatch(new RegExp(`Preview external link: opened.*https://${host}`))
    expect(trail.indexOf('external link: asking')).toBeLessThan(
      trail.indexOf('external link: cancelled')
    )
  })
})
