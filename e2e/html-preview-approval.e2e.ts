// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The approval chain, end to end (#111).
 *
 * Five links — the band writes the origin, `PreviewAllowlistStore` persists it,
 * `buildPreviewCsp` emits it, `decideRequest` compares it, and the page reloads
 * — each pinned by its own unit fixture and, until this spec, never tested
 * against each other. The vocabulary of that chain changed twice (host → origin
 * in #108, trailing dots in #110), which is exactly the kind of change where
 * four components must agree byte-for-byte and agreeing with your own fixture
 * proves nothing.
 *
 * So this stands up a real server on an ephemeral loopback port, points a page
 * at it, and asserts — in order — that nothing reaches the socket before
 * approval, that the band names the whole origin, that Allow → Confirm makes
 * the script actually run inside the page, that the server saw the request,
 * and that the grant landed in the project file under `origins`.
 *
 * Local gate only: e2e is disabled in CI.
 * Condition-based waits only — never a sleep.
 *
 * @see e2e/fixtures/localServer.ts
 * @see docs/html-preview/README.md
 */

import * as fsp from 'fs/promises'
import * as path from 'path'

import { test, expect } from './fixtures/localServer'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'
import { PREVIEW } from '../src/shared/constants'

/**
 * The page under test. `data-remote="pending"` is set in the markup, so a read
 * of `pending` proves the document loaded AND the script did not run — as
 * opposed to a read of `undefined`, which would also be true of a page that
 * never loaded at all.
 */
function entryPage(probeUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Approval probe -APPROVAL-1</title></head>
<body data-remote="pending">
  <p>Remote script: <span id="status">pending</span></p>
  <script src="${probeUrl}"></script>
</body>
</html>
`
}

test.use({
  testProjectFiles: {
    // Placeholder only; the test rewrites it once the server's port is known.
    'remote/index.html': entryPage('http://127.0.0.1:1/placeholder.js'),
    'notes.md': '# Notes\n'
  }
})

test.describe('HTML preview — approving an origin', () => {
  test('Allow → Confirm makes the blocked loopback script load, and records the origin', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject,
    localServer
  }) => {
    // The entry file has to be written at runtime: `test.use({ testProjectFiles })`
    // is static and cannot see the live port.
    await fsp.writeFile(
      path.join(testProject.path, 'remote', 'index.html'),
      entryPage(localServer.probeUrl),
      'utf-8'
    )

    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await preview.open('remote/index.html')

    // The document loads; the remote script does not run.
    await expect
      .poll(() => preview.eval('document.body.dataset.remote'), {
        timeout: PREVIEW_BUDGET_MS,
        message: 'approval probe page never loaded'
      })
      .toBe('pending')

    // (1) Blocked — and the server never received a request. The second clause
    // is what makes it real: the CSP refuses in the renderer, so the socket must
    // never be touched.
    // (`toContainText`: the chip also renders its expand caret.)
    const chip = preview.chip()
    await expect(chip).toContainText('1 blocked · 0 allowed', { timeout: PREVIEW_BUDGET_MS })
    expect(localServer.requests).toHaveLength(0)

    // (2) The Allow button's accessible name carries the whole origin, port
    // included — that is what is being granted.
    await preview.openBand()
    await expect(preview.hostRow(localServer.origin)).toBeVisible()
    const allow = preview.allowButton(localServer.origin)
    await expect(allow).toBeVisible()
    await expect(allow).toHaveAccessibleName(`Allow ${localServer.origin}`)

    // (3) Allow opens the question; Confirm answers it.
    await allow.click()
    await expect(preview.confirmDialog()).toBeVisible()
    const approvedAt = Date.now()
    await preview.confirmButton().click()

    // The band reaches its SUCCESS state — not merely "no longer Saving…" —
    // inside the renderer's own deadline on the invoke. On this branch main is
    // time-boxed and the renderer races the invoke against that deadline, so
    // even a hung purge or re-read cannot strand the band; a healthy run
    // answers long before it.
    await expect(chip).toContainText('0 blocked · 1 allowed', {
      timeout: PREVIEW.APPROVE_UI_DEADLINE_MS + 5_000
    })
    await expect(preview.confirmDialog()).toHaveCount(0)
    await expect(preview.band().getByText('Saving…')).toHaveCount(0)
    await expect(preview.allowedSection()).toBeVisible()
    await expect(preview.hostRow(localServer.origin)).toBeVisible()

    // (4) The page reloaded under the new CSP and the script ran. This is the
    // assertion that did not exist before: the reload is asynchronous and the
    // poll is the barrier.
    await expect
      .poll(() => preview.eval('document.body.dataset.remote'), {
        timeout: PREVIEW_BUDGET_MS,
        message: 'the approved script never ran inside the preview'
      })
      .toBe('loaded')

    // (5) A real fetch reached the server, after the approval — not a cached or
    // optimistic render.
    const probeHits = localServer.requests.filter((r) => r.path === '/probe.js')
    expect(probeHits.length).toBeGreaterThanOrEqual(1)
    expect(probeHits[0].at).toBeGreaterThanOrEqual(approvedAt)

    // (6) The grant is in the project file, under `htmlPreview.allowlist.origins`
    // and NOT under `hosts`: `hosts` is a projection carrying only default-port
    // https origins (what a host entry could ever express), and a
    // non-default-port http origin has no such legacy projection.
    const settingsPath = path.join(testProject.path, '.erfana', 'settings.json')
    const settings = JSON.parse(await fsp.readFile(settingsPath, 'utf-8')) as {
      htmlPreview?: { allowlist?: { origins?: string[]; hosts?: string[] } }
    }
    const allowlist = settings.htmlPreview?.allowlist
    expect(allowlist?.origins).toEqual([localServer.origin])
    expect(allowlist?.hosts ?? []).not.toContain('127.0.0.1')
    expect(allowlist?.hosts ?? []).not.toContain(localServer.origin)
  })
})
