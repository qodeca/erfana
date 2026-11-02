// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – instrumentation exit test (P3;
 * docs/designs/comments/html-preview-comments.md §13 P3 "e2e exit", §6, §19 R3-1).
 *
 * A page that already carries comment blocks – written by the real P1
 * serializer, the same builder the unit tests use (`commentedPages.ts`) – is
 * seeded into a temp project and opened in the real preview. The protocol
 * handler serves a copy with an element token on every eligible element and
 * registers the load; the e2e hook (`globalThis.__erfanaE2eComments`) names,
 * for each block, the token of the element it is on, and the file on disk must
 * not change.
 *
 * Since P4 the preload strips every token at document start, so the live DOM
 * carries none (`[]`). That each block's token names its element is checked
 * the way the product will use it: in comment mode (driven by the test's stub
 * of main, `html-preview.comments.ts`), a trusted click on the element sends a
 * pick carrying exactly that token.
 *
 * It is also the real-app check of the request-class rule the ledger relies on
 * (`PreviewRequestKindLedger.ts`): a document load reaches `protocol.handle`
 * without `user-agent`. If an Electron upgrade changes that, no load is
 * instrumented and every test here that expects a load fails.
 *
 * Local gate only: e2e is disabled in CI. Condition-based waits only.
 */

import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'

import type { ElectronApplication } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'
import { evalInFrame } from './pages/html-preview.frames'
import {
  DOM_TOKENS_EXPR,
  commentLoads,
  commentUnavailable,
  enterStubCommentMode,
  namesFile,
  pickAt,
  waitForCommentLoad,
  type CommentLoadView,
  type StubTarget
} from './pages/html-preview.comments'
import {
  BASE_PAGE,
  commentedPage
} from '../src/main/services/preview/comments/__test-helpers__/commentedPages'

const PAGE = 'comments/page.html'
const PLAIN = 'comments/plain.html'
const FRAMED = 'comments/framed.html'
const RELOADED = 'comments/reloaded.html'

const PAGE_TITLE = '-HPC-P3-'
const PLAIN_TITLE = '-HPC-P3-PLAIN-'
const FRAMED_TITLE = '-HPC-P3-FRAMED-'
const RELOADED_TITLE = '-HPC-P3-RELOAD-'

/** Three `ok` blocks Erfana wrote, and the `id` of the element each is on. */
const COMMENTED = commentedPage()

/** The commented page under another title. */
function retitled(title: string): string {
  return COMMENTED.text.replace(`<title>${PAGE_TITLE}</title>`, `<title>${title}</title>`)
}

/**
 * The commented page, fetching its own URL as it loads: the S1e race. The
 * fetches a reload aborts leave notes behind; the next document load must
 * still be the one instrumented.
 */
const SELF_FETCH =
  '<script>for (let i = 0; i < 4; i += 1) fetch(location.href).catch(() => {})</script>\n'
const RELOADED_TEXT = retitled(`${RELOADED_TITLE}0`).replace('</body>', `${SELF_FETCH}</body>`)

/** A page without blocks that frames the commented page. */
const FRAMED_TEXT = [
  '<!doctype html>',
  `<html lang="en"><head><title>${FRAMED_TITLE}</title></head>`,
  '<body>',
  '  <h1 id="host">Host page</h1>',
  '  <iframe id="child" src="page.html" width="640" height="360"></iframe>',
  '</body></html>',
  ''
].join('\n')

test.use({
  testProjectFiles: {
    [PAGE]: COMMENTED.text,
    [PLAIN]: BASE_PAGE.replace(`<title>${PAGE_TITLE}</title>`, `<title>${PLAIN_TITLE}</title>`),
    [FRAMED]: FRAMED_TEXT,
    [RELOADED]: RELOADED_TEXT,
    'notes.md': '# Notes\n'
  }
})

/** Open `relPath` and wait until its own document carries `title`. */
async function openTitled(preview: HtmlPreviewPage, relPath: string, title: string): Promise<void> {
  await preview.open(relPath)
  await preview.withReadError(
    expect
      .poll(async () => (await preview.snapshot(HtmlPreviewPage.target(relPath)))?.docTitle, {
        timeout: PREVIEW_BUDGET_MS,
        message: `${relPath} never showed its ${title} title`
      })
      .toBe(title)
  )
}

/** The newest `scope` load of `relPath` whose three blocks all resolved to a token. */
function waitForLoad(
  app: ElectronApplication,
  relPath: string,
  scope: CommentLoadView['scope'],
  isNew?: (load: CommentLoadView) => boolean
): Promise<CommentLoadView> {
  return waitForCommentLoad(app, relPath, scope, COMMENTED.targets.size, isNew)
}

/** Block id → the block's token, as the load registered it. */
function blockTokens(load: CommentLoadView): Map<string, string | undefined> {
  return new Map(load.blocks.map(block => [block.id as string, block.token]))
}

/**
 * Block id → the token a comment-mode click on the block's element sends,
 * and whether every pick came from the expected frame.
 */
async function tokensByPick(
  app: ElectronApplication,
  target: StubTarget,
  fromFrame: (pick: { fromMain: boolean; frameUrl: string }) => boolean
): Promise<Map<string, unknown>> {
  await enterStubCommentMode(app, target)
  const picked = new Map<string, unknown>()
  for (const [blockId, elementId] of COMMENTED.targets) {
    const pick = await pickAt(app, elementId, target)
    expect(fromFrame(pick), `the pick for #${elementId} came from another frame`).toBe(true)
    expect(pick.payload).toMatchObject({ kind: 'open', via: 'pointer' })
    picked.set(blockId, pick.payload.token)
  }
  return picked
}

/** The file's bytes, to prove instrumentation never writes. */
function bytesOf(projectPath: string, relPath: string): Buffer {
  return fs.readFileSync(path.join(projectPath, relPath))
}

test.describe('HTML Preview comments – instrumentation (P3 exit)', () => {
  test("every pre-seeded block's token names the element the block is on", async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const before = bytesOf(testProject.path, PAGE)
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await openTitled(preview, PAGE, PAGE_TITLE)

    const load = await waitForLoad(appWithTestProject, PAGE, 'page')
    expect(load.blocks.map(b => [b.id, b.kind, b.status])).toEqual([
      [expect.any(String), 'ok', 'resolved'],
      [expect.any(String), 'ok', 'open'],
      [expect.any(String), 'ok', 'open']
    ])
    expect(load.tokenCount).toBeGreaterThan(COMMENTED.targets.size)

    // The preload took every token out of the live document (P4)…
    const target = HtmlPreviewPage.target(PAGE)
    expect(await preview.eval(DOM_TOKENS_EXPR, target)).toBe('[]')
    // …and a click on each block's element names that block's token.
    expect(await tokensByPick(appWithTestProject, target, pick => pick.fromMain)).toEqual(blockTokens(load))
    expect(await commentUnavailable(appWithTestProject)).toEqual([])

    // Serving an instrumented copy never touches the file (M-030).
    expect(bytesOf(testProject.path, PAGE).equals(before)).toBe(true)
  })

  test('OD-01 a page without blocks is instrumented too, with no blocks, so a right-click can start its first comment', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await openTitled(preview, PLAIN, PLAIN_TITLE)

    expect(await preview.eval(DOM_TOKENS_EXPR, HtmlPreviewPage.target(PLAIN))).toBe('[]')
    // OD-01 (spec 024): every page is instrumented while HTML comments are on – it was served raw before.
    const loads = await commentLoads(appWithTestProject)
    const plain = loads.filter(load => namesFile(load.realPath, PLAIN))
    expect(plain.map(load => ({ scope: load.scope, blocks: load.blocks }))).toEqual([{ scope: 'page', blocks: [] }])
    expect(plain[0].tokenCount).toBeGreaterThan(0)
    expect(await commentUnavailable(appWithTestProject)).toEqual([])
  })

  test('the same file inside a frame gets its own frame-scoped load', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await openTitled(preview, FRAMED, FRAMED_TITLE)

    const load = await waitForLoad(appWithTestProject, PAGE, 'frame')
    const target = HtmlPreviewPage.target(FRAMED)
    // The frame runs the preload too (ADR 0005): its tokens are stripped…
    await preview.withReadError(
      expect
        .poll(() => evalInFrame(appWithTestProject, 'page.html', DOM_TOKENS_EXPR, target), {
          timeout: PREVIEW_BUDGET_MS,
          message: 'the framed page never answered'
        })
        .toBe('[]')
    )
    // …and its picks come from the frame, with the frame load's tokens.
    const frame: StubTarget = { ...target, frameUrlIncludes: 'page.html', iframeId: 'child' }
    const picked = await tokensByPick(
      appWithTestProject,
      frame,
      pick => !pick.fromMain && pick.frameUrl.endsWith('/page.html')
    )
    expect(picked).toEqual(blockTokens(load))

    // The host page has no blocks: under OD-01 it is instrumented too, as a page load with no blocks.
    expect(await preview.eval(DOM_TOKENS_EXPR, target)).toBe('[]')
    const loads = await commentLoads(appWithTestProject)
    expect(loads.filter(l => namesFile(l.realPath, FRAMED)).map(l => ({ scope: l.scope, blocks: l.blocks }))).toEqual([{ scope: 'page', blocks: [] }])
    expect(loads.filter(l => namesFile(l.realPath, PAGE)).map(l => l.scope)).toEqual(['frame'])
  })

  test('a reload of a page that fetches its own URL instruments the new document (S1e)', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await openTitled(preview, RELOADED, `${RELOADED_TITLE}0`)
    const first = await waitForLoad(appWithTestProject, RELOADED, 'page')

    // Save until the preview reloads: a save that lands before the watch set
    // is armed is simply not seen, so the save is retried.
    const file = path.join(testProject.path, RELOADED)
    let round = 0
    await expect(async () => {
      round += 1
      await fsp.writeFile(
        file,
        RELOADED_TEXT.replace(`${RELOADED_TITLE}0`, `${RELOADED_TITLE}${round}`),
        'utf-8'
      )
      await preview.withReadError(
        expect
          .poll(async () => (await preview.snapshot(HtmlPreviewPage.target(RELOADED)))?.docTitle, {
            timeout: 3_000
          })
          .toBe(`${RELOADED_TITLE}${round}`)
      )
    }).toPass({ timeout: PREVIEW_BUDGET_MS })

    const firstTokens = new Set(first.blocks.map(b => b.token))
    const latest = await waitForLoad(appWithTestProject, RELOADED, 'page', load =>
      load.blocks.every(b => !firstTokens.has(b.token))
    )
    expect(latest.loadId).not.toBe(first.loadId)
    const target = HtmlPreviewPage.target(RELOADED)
    expect(await tokensByPick(appWithTestProject, target, pick => pick.fromMain)).toEqual(blockTokens(latest))
    expect(await commentUnavailable(appWithTestProject)).toEqual([])
  })
})
