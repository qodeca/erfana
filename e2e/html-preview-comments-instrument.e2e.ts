// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – instrumentation exit test (P3;
 * docs/designs/html-preview-comments.md §13 P3 "e2e exit", §6, §19 R3-1).
 *
 * A page that already carries comment blocks – written by the real P1
 * serializer, the same builder the unit tests use (`commentedPages.ts`) – is
 * seeded into a temp project and opened in the real preview. The protocol
 * handler serves a copy with an element token on every eligible element and
 * registers the load; the e2e hook (`globalThis.__erfanaE2eComments`) names,
 * for each block, the token of the element it is on. Each token must mark that
 * element in the live document, and the file on disk must not change.
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
  idOfTokenExpr,
  namesFile,
  newestLoad,
  type CommentLoadView
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

/** Wait for the newest `scope` load of `relPath` whose three blocks all resolved to a token. */
async function waitForLoad(
  app: ElectronApplication,
  relPath: string,
  scope: CommentLoadView['scope'],
  isNew: (load: CommentLoadView) => boolean = () => true
): Promise<CommentLoadView> {
  let found: CommentLoadView | undefined
  await expect
    .poll(
      async () => {
        found = newestLoad(await commentLoads(app), relPath, scope)
        return found !== undefined && isNew(found) && found.blocks.every(b => b.token !== undefined)
          ? found.blocks.length
          : -1
      },
      { timeout: PREVIEW_BUDGET_MS, message: `no instrumented ${scope} load of ${relPath}` }
    )
    .toBe(COMMENTED.targets.size)
  return found!
}

/** Block id → `id` of the element its token marks, read by `readIdOf` in the live document. */
async function elementsOfBlocks(
  load: CommentLoadView,
  readIdOf: (token: string) => Promise<unknown>
): Promise<Map<string, unknown>> {
  const found = new Map<string, unknown>()
  for (const block of load.blocks) found.set(block.id!, await readIdOf(block.token!))
  return found
}

/** The file's bytes, to prove instrumentation never writes. */
function bytesOf(projectPath: string, relPath: string): Buffer {
  return fs.readFileSync(path.join(projectPath, relPath))
}

test.describe('HTML Preview comments – instrumentation (P3 exit)', () => {
  test("every pre-seeded block's token marks the element the block is on", async ({
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

    const target = HtmlPreviewPage.target(PAGE)
    const ids = await elementsOfBlocks(load, token => preview.eval(idOfTokenExpr(token), target))
    expect(ids).toEqual(new Map(COMMENTED.targets))

    // The live document carries exactly the load's tokens, each once.
    const domTokens = JSON.parse((await preview.eval(DOM_TOKENS_EXPR, target)) ?? '[]') as string[]
    expect(domTokens).toHaveLength(load.tokenCount)
    expect(new Set(domTokens).size).toBe(load.tokenCount)
    expect(await commentUnavailable(appWithTestProject)).toEqual([])

    // Serving an instrumented copy never touches the file (M-030).
    expect(bytesOf(testProject.path, PAGE).equals(before)).toBe(true)
  })

  test('a page without blocks is served as it is on disk', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await openTitled(preview, PLAIN, PLAIN_TITLE)

    expect(await preview.eval(DOM_TOKENS_EXPR, HtmlPreviewPage.target(PLAIN))).toBe('[]')
    const loads = await commentLoads(appWithTestProject)
    expect(loads.filter(load => namesFile(load.realPath, PLAIN))).toEqual([])
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
    let ids = new Map<string, unknown>()
    await expect
      .poll(
        async () => {
          ids = await elementsOfBlocks(load, token =>
            evalInFrame(appWithTestProject, 'page.html', idOfTokenExpr(token), target)
          )
          return [...ids.values()].every(id => id !== null)
        },
        { timeout: PREVIEW_BUDGET_MS, message: 'the framed page never answered' }
      )
      .toBe(true)
    expect(ids).toEqual(new Map(COMMENTED.targets))

    // The host page has no blocks: it is served raw, and only the frame's load exists.
    expect(await preview.eval(DOM_TOKENS_EXPR, target)).toBe('[]')
    const loads = await commentLoads(appWithTestProject)
    expect(loads.filter(l => namesFile(l.realPath, FRAMED))).toEqual([])
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
    expect(
      await elementsOfBlocks(latest, token => preview.eval(idOfTokenExpr(token), target))
    ).toEqual(new Map(COMMENTED.targets))
    expect(await commentUnavailable(appWithTestProject)).toEqual([])
  })
})
