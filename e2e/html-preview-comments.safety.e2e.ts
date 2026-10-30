// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – file safety, hostile pages and the edges of the
 * feature, through the real UI (docs/designs/comments/html-preview-comments.md §12.2
 * E-009 – E-013, E-015, E-019, E-022, E-023, E-027; decisions 4, 8,
 * 12, 14, 21, 24, 28, 32; §19 R3-6, R3-8, Rev 4 "folded sections").
 *
 * - **E-009** an "agent" edits the file while the comment window is open: the
 *   block still lands before its element, and the agent's edit is kept.
 * - **E-010** damaged, newer-format and conflicted blocks (`comments/damaged/`)
 *   are listed under "Needs attention", shown read-only, and deleted only
 *   where main allows it – exactly their own bytes; nothing else changes.
 * - **E-011** with the menu or the window open the native page is hidden and
 *   a fresh still frame stands in, with the selected outline painted in it.
 * - **E-012** an outside edit removes the element: "Not found", and
 *   the block stays in the file (decision 21) – also when the next element
 *   has the same tag, the X-001 case (§19 Rev 4: a position match must be
 *   corroborated).
 * - **E-013** 200 comments on one page: the drawer lists them all, pins are
 *   drawn, and End in the list (R-10: keys reveal) brings the last element into view.
 * - **E-027** the owner's folded-section case: a paragraph inside a
 *   `<details>` the reader opened stays open through comment mode's reload
 *   and the save's reload, with its pin drawn; folded again it is "Not
 *   visible now", and the drawer row's Open unfolds it behind the window –
 *   the pin back once the window closes.
 * - **E-015** a hostile page (`comments/hostile/`: forged events, prototype
 *   overrides, hide-all CSS, a fake pin, a node-deleting observer; and a CSP
 *   `'none'` page) never opens Erfana's window by itself, and its file's
 *   modification time never moves.
 * - **E-019** element rectangles and `innerText` are the same before and after
 *   comments on `pre`, inline, CSS `white-space: pre` and SVG text targets
 *   (`comments/raw-text/`, R3-8).
 * - E-020 ("the Markdown preview has no comment entry") is retired by spec
 *   024 (024-FR-020): its successor is `markdown-preview-comments.e2e.ts`.
 * - **E-022** a PDF export of a commented page carries no pin; Find in page
 *   does not count the overlay's text.
 * - **E-023** with the feature flag off: no comment UI, the page served raw,
 *   and frames run without a preload (today's behaviour, §18).
 *
 * Fixtures are committed byte-exact; the 200-comment page is generated here
 * with the real serializer and never committed (§12.3). Helpers:
 * `pages/html-preview.comments-ui.ts`. Local gate only: e2e is disabled in
 * CI. Condition-based waits only.
 */

import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import * as zlib from 'zlib'
import { stubDialog } from 'electron-playwright-helpers'
import { test, expect } from './fixtures/index'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'
import { evalInFrame } from './pages/html-preview.frames'
import { SearchBarPage } from './pages/search-bar.page'
import {
  OVERLAY_HOSTS_EXPR,
  commentLoads,
  commentPanelState,
  draftsOpened,
  namesFile,
  newestLoad,
  recordDraftsOpened,
  waitForCommentLoad
} from './pages/html-preview.comments'
import {
  CommentChrome,
  accentInStill,
  clickElement,
  diskBytes,
  elementBox,
  expectPin,
  openCommentPage,
  resetCommentSettings,
  reviewer,
  setGlobalSetting,
  singleBlockInsert,
  viewShown,
  waitForBox,
  type ElementPlace
} from './pages/html-preview.comments-ui'
import { commentedPage, commentOn } from '../src/main/services/preview/comments/__test-helpers__/commentedPages'
import { addTo, fixedId } from '../src/shared/comments/__fixtures__/commentTestData'
import { manyCommentsPage } from './fixtures/html-preview-comments-pages'

const CORPUS = path.join(__dirname, 'fixtures', 'html-preview-corpus', 'comments')
const corpus = (rel: string): string => fs.readFileSync(path.join(CORPUS, rel), 'utf-8')

const STATIC = 'comments/static-design/index.html'
const DAMAGED = 'comments/damaged/index.html'
const CONFLICT = 'comments/damaged/conflict.html'
const UNTERMINATED = 'comments/damaged/unterminated.html'
const HOSTILE = 'comments/hostile/index.html'
const CSP_NONE = 'comments/hostile/csp-none.html'
const RAW = 'comments/raw-text/index.html'
const REVIEW = 'comments/review.html'
const MANY = 'comments/many.html'
const FRAMED = 'comments/framed.html'

const REVIEWED = commentedPage()
const REVIEW_TITLE = '-HPC-P3-'

const MANY_COUNT = 200
const MANY_TEXT = manyCommentsPage(MANY_COUNT)

const FOLDED = 'comments/folded.html'
const FOLDED_TITLE = '-HPC-FOLDED-'
/** The owner's case (§19 Rev 4): a paragraph inside a "Technical details" section, folded as served. */
const FOLDED_TEXT = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="utf-8">',
  `  <title>${FOLDED_TITLE}</title>`,
  '  <style>body { font: 16px/1.5 sans-serif; margin: 40px; } p { padding: 12px; }</style>',
  '</head>',
  '<body>',
  '  <h1 id="heading">Release notes</h1>',
  '  <p id="intro">What changed in this release.</p>',
  '  <details id="facts">',
  '    <summary id="facts-summary">Technical details</summary>',
  '    <p id="folded">The parser now reads the file in 64 KB chunks.</p>',
  '  </details>',
  '  <p id="thanks">Thanks to everyone who reported issues.</p>',
  '</body>',
  '</html>',
  ''
].join('\n')
/** Whether the section is open, from the page itself (`none` mid-load). */
const FACTS_OPEN = "(() => { const facts = document.getElementById('facts'); return facts ? String(facts.open) : 'none' })()"

const CARDS = 'comments/cards.html'
const CARDS_TITLE = '-HPC-CARDS-'
/** The first card, which the outside edit of E-012 (X-001 case) removes. */
const FIRST_CARD = [
  '<article class="card">',
  '      <h2>Roasted to order</h2>',
  '      <p>We roast only what we sell that week.</p>',
  '    </article>'
].join('\n')

/**
 * Three sibling cards without ids, as on the X-001 page, each with one open
 * comment from the real serializer; `ids` are the comments in card order.
 */
function cardsPage(): { readonly text: string; readonly ids: readonly string[] } {
  let text = [
    '<!doctype html>',
    '<html lang="en">',
    `<head><meta charset="utf-8"><title>${CARDS_TITLE}</title></head>`,
    '<body>',
    '  <section class="features">',
    `    ${FIRST_CARD}`,
    '    <article class="card">',
    '      <h2>Grinder rental</h2>',
    '      <p>Borrow a burr grinder for 5 EUR a month.</p>',
    '    </article>',
    '    <article class="card">',
    '      <h2>Pause any time</h2>',
    '      <p>Skip a week or cancel from your account page.</p>',
    '    </article>',
    '  </section>',
    '</body>',
    '</html>',
    ''
  ].join('\n')
  const ids = [0, 1, 2].map(n => fixedId('c-', 400 + n))
  ids.forEach((id, n) => {
    text = addTo(text, 'article', commentOn(text, 'article', n, { id }), { n, ws: 'collapse' }).text
  })
  return { text, ids }
}

const CARDS_PAGE = cardsPage()

/** A page that frames the commented page (E-023). */
const FRAMED_TEXT = [
  '<!doctype html>',
  '<html lang="en"><head><meta charset="utf-8"><title>-HPC-FLAG-FRAMED-</title></head>',
  '<body>',
  '  <h1 id="host">Host page</h1>',
  '  <iframe id="child" src="review.html" width="560" height="320"></iframe>',
  '</body></html>',
  ''
].join('\n')

test.use({
  testProjectFiles: {
    [STATIC]: corpus('static-design/index.html'),
    [DAMAGED]: corpus('damaged/index.html'),
    [CONFLICT]: corpus('damaged/conflict.html'),
    [UNTERMINATED]: corpus('damaged/unterminated.html'),
    [HOSTILE]: corpus('hostile/index.html'),
    [CSP_NONE]: corpus('hostile/csp-none.html'),
    [RAW]: corpus('raw-text/index.html'),
    [REVIEW]: REVIEWED.text,
    [MANY]: MANY_TEXT,
    [CARDS]: CARDS_PAGE.text,
    [FRAMED]: FRAMED_TEXT
  }
})

const NAME = 'Reviewer Safety Ny27'
const STATIC_TARGET = HtmlPreviewPage.target(STATIC)

/** The removed stretch when `after` is `before` with one run of bytes taken out; `null` otherwise. */
function removedStretch(before: Buffer, after: Buffer): string | null {
  const gone = before.length - after.length
  if (gone <= 0) return null
  let prefix = 0
  while (prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  if (!before.subarray(prefix + gone).equals(after.subarray(prefix))) return null
  return before.subarray(prefix, prefix + gone).toString('utf-8')
}

/** Every content stream of a PDF, inflated where it is Flate-encoded, as Latin-1 text. */
function pdfStreams(pdf: Buffer): string[] {
  const out: string[] = []
  const text = pdf.toString('latin1')
  const re = /stream\r?\n/g
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const start = m.index + m[0].length
    const end = text.indexOf('endstream', start)
    if (end < 0) break
    const raw = pdf.subarray(start, end)
    try {
      out.push(zlib.inflateSync(raw).toString('latin1'))
    } catch {
      out.push(raw.toString('latin1'))
    }
    re.lastIndex = end
  }
  return out
}

/** Whether a PDF content stream sets a fill or stroke colour near `rgb` (0–255). */
function pdfUsesColour(streams: readonly string[], rgb: readonly [number, number, number]): boolean {
  const op = /(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)\s+(rg|RG|sc|SC|scn|SCN)\b/g
  for (const s of streams) {
    for (let m = op.exec(s); m !== null; m = op.exec(s)) {
      const got = [Number(m[1]), Number(m[2]), Number(m[3])]
      if (got.every((v, i) => Math.abs(v * 255 - rgb[i]) <= 3)) return true
    }
  }
  return false
}

test.describe('HTML Preview comments – safety and edges (P7)', () => {
  test.afterEach(async ({ windowWithTestProject }) => {
    await resetCommentSettings(windowWithTestProject)
  })

  test('E-009 an agent edits the file while the window is open: the block lands before its element and the agent edit is kept', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const file = path.join(testProject.path, STATIC)
    await setGlobalSetting(page, 'comments', reviewer(NAME))

    const panelId = await openCommentPage(preview, app, STATIC, '-HPC-STATIC-')
    await chrome.modeOn(app, panelId, STATIC_TARGET)
    await clickElement(app, 'vat', 'left', STATIC_TARGET)
    await expect(chrome.window()).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })

    // The "agent" adds a section above the element and rewords a line after it.
    const original = await fsp.readFile(file, 'utf-8')
    const agentText = original
      .replace('  <section id="plans">', '  <aside id="agent-note">\n    <p>Added by an agent.</p>\n  </aside>\n  <section id="plans">')
      .replace('Prices exclude VAT.', 'Prices exclude VAT and shipping.')
      .replace('<p id="vat">', '<p id="vat" class="small">')
    expect(agentText).not.toBe(original)
    await fsp.writeFile(file, agentText, 'utf-8')
    const agentBytes = await diskBytes(file)

    await chrome.saveNewComment('Agent-P7: still about this paragraph', STATIC)
    const inserted = singleBlockInsert(agentBytes, await diskBytes(file))
    expect(inserted, 'the save did not add exactly one block to the agent\'s version').not.toBeNull()
    expect(agentBytes.subarray(inserted?.offset ?? 0).toString('utf-8').startsWith('<p id="vat" class="small">')).toBe(true)
  })

  test('E-010 damaged, newer and conflicted blocks: listed, read-only, deleted only where allowed – nothing else changes', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const file = path.join(testProject.path, DAMAGED)
    await setGlobalSetting(page, 'comments', reviewer(NAME))
    const before = await diskBytes(file)

    await openCommentPage(preview, app, DAMAGED, '-HPC-DAMAGED-')
    // OD-04: the count is damaged blocks only; the newer-format block counts in neither.
    await expect(chrome.listButton()).toHaveAccessibleName('Comments, 2 damaged', { timeout: PREVIEW_BUDGET_MS })
    await chrome.openDrawer()
    await chrome.filter('cantEdit').click()
    await expect(chrome.filter('cantEdit')).toContainText("Can't edit")
    const rows = chrome.drawerRows()
    await expect(rows).toHaveCount(3, { timeout: PREVIEW_BUDGET_MS })
    await expect(rows.getByTestId('comment-drawer-tag')).toHaveText(['Damaged', 'Damaged', 'Newer format – read-only'])

    // The newer-format block: shown, never changeable.
    // R-10 (approvals.md, 2026-10-29): a click on a row opens its thread; only the active row has Open.
    await rows.nth(2).getByTestId('comment-drawer-row-main').click()
    const win = chrome.window()
    await expect(win.getByTestId('comment-newer')).toHaveCount(1, { timeout: PREVIEW_BUDGET_MS })
    await expect(win.getByTestId('comment-delete-block')).toHaveCount(0)
    await page.getByTestId('comment-close').click()
    await expect(win).toHaveCount(0)

    // The bad-JSON block: its raw text read-only, and Delete block… removes exactly it.
    await rows.nth(0).getByTestId('comment-drawer-row-main').click()
    await expect(win.getByTestId('comment-damaged')).toHaveCount(1, { timeout: PREVIEW_BUDGET_MS })
    const raw = (await win.getByTestId('comment-damaged-raw').textContent()) ?? ''
    expect(raw).toContain('id=c-aaaaaaaaaaaaaaaa')
    await win.getByTestId('comment-delete-block').click()
    await win.getByTestId('comment-delete-block-confirm').click()
    // Exactly the block and the line break and indent after it (its own
    // lines) – every other byte, the other two blocks included, untouched.
    const was = before.toString('utf-8')
    const at = was.indexOf(raw.trim())
    expect(at, 'the raw text shown is not the block in the file').toBeGreaterThan(0)
    const expected = was.slice(0, at) + was.slice(at + raw.trim().length).replace(/^(\r\n|\n|\r)[ \t]*/, '')
    await expect.poll(async () => (await fsp.readFile(file, 'utf-8')) === expected, { timeout: PREVIEW_BUDGET_MS, message: 'the delete changed more than the block' }).toBe(true)
    expect(removedStretch(before, await diskBytes(file))).not.toBeNull()
    const after = await fsp.readFile(file, 'utf-8')
    expect(after).toContain('id=c-bbbbbbbbbbbbbbbb')
    expect(after).toContain('erfana:comment v2 id=c-cccccccccccccccc')

    // A conflicted file: read-only, its own wording, no delete.
    const conflictFile = path.join(testProject.path, CONFLICT)
    const conflictBefore = await diskBytes(conflictFile)
    const conflict = new CommentChrome(page, preview, 'conflict.html')
    await openCommentPage(preview, app, CONFLICT, '-HPC-CONFLICT-')
    await conflict.openDrawer()
    await conflict.filter('cantEdit').click()
    await conflict.drawerRows().first().getByTestId('comment-drawer-row-open').click()
    await expect(win.getByTestId('comment-damaged')).toContainText('git conflict markers', { timeout: PREVIEW_BUDGET_MS })
    await expect(win.getByTestId('comment-read-only')).toBeVisible()
    await expect(win.getByTestId('comment-delete-block')).toHaveCount(0)
    await page.getByTestId('comment-close').click()

    // An unterminated block: listed, no delete (fix it in source).
    const unterminatedFile = path.join(testProject.path, UNTERMINATED)
    const unterminatedBefore = await diskBytes(unterminatedFile)
    const unterminated = new CommentChrome(page, preview, 'unterminated.html')
    await openCommentPage(preview, app, UNTERMINATED, '-HPC-UNTERMINATED-')
    await unterminated.openDrawer()
    await unterminated.filter('cantEdit').click()
    await unterminated.drawerRows().first().getByTestId('comment-drawer-row-open').click()
    await expect(win.getByTestId('comment-damaged')).toHaveCount(1, { timeout: PREVIEW_BUDGET_MS })
    await expect(win.getByTestId('comment-delete-block')).toHaveCount(0)
    await page.getByTestId('comment-close').click()

    expect((await diskBytes(conflictFile)).equals(conflictBefore)).toBe(true)
    expect((await diskBytes(unterminatedFile)).equals(unterminatedBefore)).toBe(true)
  })

  test('E-011 with the menu or the window open the page is hidden behind a fresh still that shows the selected outline', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    await setGlobalSetting(page, 'comments', reviewer(NAME))
    const panelId = await openCommentPage(preview, app, STATIC, '-HPC-STATIC-')
    await chrome.modeOn(app, panelId, STATIC_TARGET)
    const box = await waitForBox(app, 'team-copy', STATIC_TARGET)
    const still = preview.stillFrame('index.html')

    /** The view is hidden, and the still shown in its place carries the outline of #team-copy. */
    const expectFrozenWithOutline = async (): Promise<void> => {
      await expect.poll(() => viewShown(app, STATIC_TARGET), { timeout: PREVIEW_BUDGET_MS }).toBe(false)
      await expect(still).toHaveCount(1, { timeout: PREVIEW_BUDGET_MS })
      // The 2 px accent ring around a 491 × 24 box is well over 500 device pixels.
      await expect.poll(() => accentInStill(app, still, box), { timeout: PREVIEW_BUDGET_MS }).toBeGreaterThan(500)
    }
    // A still with no outline in it reads as a page without one: the check can fail.
    expect(await accentInStill(app, still, box)).toBeNull()

    await clickElement(app, 'team-copy', 'right', STATIC_TARGET)
    await expect(chrome.menu()).toBeVisible({ timeout: PREVIEW_BUDGET_MS })
    await expectFrozenWithOutline()

    await page.getByTestId('comment-menu-add').click()
    await expect(chrome.window()).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
    await expectFrozenWithOutline()

    // Closed: the live page is back.
    await page.getByTestId('comment-cancel').click()
    await expect(chrome.window()).toHaveCount(0)
    await expect.poll(() => viewShown(app, STATIC_TARGET), { timeout: PREVIEW_BUDGET_MS }).toBe(true)
  })

  test('E-012 an outside edit removes the element: "Not found", and the block stays in the file', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'review.html')
    const target = HtmlPreviewPage.target(REVIEW)
    const file = path.join(testProject.path, REVIEW)
    const ctaBlock = [...REVIEWED.targets].find(([, id]) => id === 'cta')?.[0] as string

    await openCommentPage(preview, app, REVIEW, REVIEW_TITLE)
    await expectPin(app, 'cta', true, target)
    // The outside edit: the button is gone, its id, its place and its words with it.
    const text = await fsp.readFile(file, 'utf-8')
    await fsp.writeFile(file, text.replace('<button id="cta" class="btn">Buy now</button>', '<span id="gone">Sold out</span>'), 'utf-8')
    await expect.poll(() => preview.eval("String(document.getElementById('gone') !== null)", target), { timeout: PREVIEW_BUDGET_MS }).toBe('true')

    // OD-04: a not-found open comment stays under Open, with its tag.
    await chrome.openDrawer()
    await chrome.filter('open').click()
    const row = chrome.drawerRows().filter({ has: page.getByTestId('comment-drawer-tag').filter({ hasText: 'Not found' }) })
    await expect(row).toHaveCount(1, { timeout: PREVIEW_BUDGET_MS })
    await row.getByTestId('comment-drawer-row-main').click() // R-10: a row click opens its thread
    const win = chrome.window()
    await expect(win.getByTestId('comment-not-found')).toContainText('This element is no longer in', { timeout: PREVIEW_BUDGET_MS })
    await expect(win.getByTestId('comment-not-found-quote')).toHaveText('Buy now')
    // Decision 21: nothing was moved or deleted.
    const after = await fsp.readFile(file, 'utf-8')
    expect(after).toContain(`id=${ctaBlock}`)
    expect(after).toContain('<span id="gone">Sold out</span>')
  })

  test('E-012 the removed card has a same-tag card right after it: "Not found", never the next card (X-001)', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'cards.html')
    const file = path.join(testProject.path, CARDS)
    const [onFirst, ...onOthers] = CARDS_PAGE.ids

    await openCommentPage(preview, app, CARDS, CARDS_TITLE)
    const before = await waitForCommentLoad(app, CARDS, 'page', CARDS_PAGE.ids.length)
    // The outside edit: the first card is gone, its block stays, and the second card now follows that block.
    const text = await fsp.readFile(file, 'utf-8')
    expect(text).toContain(FIRST_CARD)
    await fsp.writeFile(file, text.replace(FIRST_CARD, ''), 'utf-8')
    // Main: the first comment names no element; the other two keep theirs.
    await expect
      .poll(
        async () => {
          const load = newestLoad(await commentLoads(app), CARDS, 'page')
          if (!load || load.loadId === before.loadId) return null
          return load.blocks.map(block => [block.id, block.token !== undefined])
        },
        { timeout: PREVIEW_BUDGET_MS, message: 'no load of the edited cards page' }
      )
      .toEqual([[onFirst, false], ...onOthers.map(id => [id, true])])

    await chrome.openDrawer()
    await chrome.filter('open').click()
    const notFound = chrome.drawerRows().filter({ has: page.getByTestId('comment-drawer-tag').filter({ hasText: 'Not found' }) })
    await expect(notFound).toHaveCount(1, { timeout: PREVIEW_BUDGET_MS })
    await notFound.getByTestId('comment-drawer-row-main').click() // R-10: a row click opens its thread
    const win = chrome.window()
    await expect(win.getByTestId('comment-not-found')).toContainText('This element is no longer in', { timeout: PREVIEW_BUDGET_MS })
    await expect(win.getByTestId('comment-not-found-quote')).toHaveText('Roasted to order We roast only what we sell that week.')
    // Decision 21: nothing was moved or deleted.
    const after = await fsp.readFile(file, 'utf-8')
    for (const id of CARDS_PAGE.ids) expect(after).toContain(`id=${id}`)
    expect(after).not.toContain('<h2>Roasted to order</h2>')
  })

  test('E-013 200 comments: the drawer lists every one, pins are drawn, and End in the list brings the last into view', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'many.html')
    const target = HtmlPreviewPage.target(MANY)

    await openCommentPage(preview, app, MANY, '-HPC-MANY-')
    await waitForCommentLoad(app, MANY, 'page', MANY_COUNT)
    await expect(chrome.listButton()).toHaveAccessibleName(`${MANY_COUNT} comments`, { timeout: PREVIEW_BUDGET_MS })
    await expectPin(app, 'p-0', true, target)
    await expectPin(app, 'p-1', true, target)

    await chrome.openDrawer()
    await expect(chrome.filter('open')).toContainText(`Open ${MANY_COUNT}`)
    await expect(chrome.drawerRows()).toHaveCount(MANY_COUNT, { timeout: PREVIEW_BUDGET_MS })
    // Keyboard to the last row: End reveals it (R-10 – arrow keys, Home and End reveal; Enter opens the thread).
    await chrome.drawer().getByTestId('comment-drawer-row-main').first().focus()
    await page.keyboard.press('End')
    await expect(chrome.drawer().getByTestId('comment-drawer-row-main').last()).toBeFocused()
    await expect
      .poll(
        async () => {
          const box = await elementBox(app, `p-${MANY_COUNT - 1}`, target)
          return box !== null && box.top >= 0 && box.bottom <= box.viewportHeight
        },
        { timeout: PREVIEW_BUDGET_MS, message: 'the last row\'s element never came into view' }
      )
      .toBe(true)
  })

  test('E-027 a comment inside a folded <details>: the section stays open through the reloads and the pin draws; folded again, the drawer row\'s Open unfolds it', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'folded.html')
    const target = HtmlPreviewPage.target(FOLDED)
    const file = path.join(testProject.path, FOLDED)
    const factsOpen = (message: string, open: boolean): Promise<void> =>
      expect
        .poll(() => preview.eval(FACTS_OPEN, target), { timeout: PREVIEW_BUDGET_MS, message })
        .toBe(String(open))
    // Written here, so no other spec's project carries it.
    await fsp.writeFile(file, FOLDED_TEXT, 'utf-8')
    await setGlobalSetting(page, 'comments', reviewer(NAME))

    const panelId = await openCommentPage(preview, app, FOLDED, FOLDED_TITLE)
    await factsOpen('the section was not served folded', false)
    // The reader unfolds "Technical details" with a real click on its summary (comment mode is off).
    await clickElement(app, 'facts-summary', 'left', target)
    await factsOpen('the summary click never unfolded the section', true)

    // Comment mode reloads the page – it has no comments yet, so it was served raw – and keeps the section open.
    await chrome.modeOn(app, panelId, target)
    await factsOpen('comment mode\'s reload folded the section', true)

    // Comment the paragraph inside it: one block before it, and after the save's reload it is open, with its pin.
    const before = await diskBytes(file)
    await clickElement(app, 'folded', 'left', target)
    await expect(chrome.window()).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
    await chrome.saveNewComment('Folded-Rev4: say why 64 KB', FOLDED)
    const inserted = singleBlockInsert(before, await diskBytes(file))
    expect(inserted, 'not exactly one block inserted').not.toBeNull()
    expect(before.subarray(inserted?.offset ?? 0).toString('utf-8').startsWith('<p id="folded">')).toBe(true)
    await waitForCommentLoad(app, FOLDED, 'page', 1)
    await factsOpen('the save\'s reload folded the section', true)
    await expectPin(app, 'folded', true, target)

    // Folded again – in comment mode a click on the summary is a pick, so the page folds it, as a script
    // would: no pin, and the drawer says "Not visible now".
    expect(await preview.eval("(document.getElementById('facts').open = false, 'folded')", target)).toBe('folded')
    await expectPin(app, 'folded', false, target)
    await chrome.openDrawer()
    const row = chrome.drawerRows().first()
    await expect(row.getByTestId('comment-drawer-tag')).toHaveText(['Not visible now'], { timeout: PREVIEW_BUDGET_MS })

    // The row's Open: its thread in the window, and behind it the section unfolds; once closed, the pin is back.
    await row.getByTestId('comment-drawer-row-open').click()
    await expect(chrome.window()).toHaveAttribute('data-view', 'threads', { timeout: PREVIEW_BUDGET_MS })
    await page.getByTestId('comment-close').click()
    await expect(chrome.window()).toHaveCount(0, { timeout: PREVIEW_BUDGET_MS })
    await factsOpen('the drawer\'s Open never unfolded the section', true)
    await expect(row.getByTestId('comment-drawer-tag')).toHaveCount(0, { timeout: PREVIEW_BUDGET_MS })
    await expectPin(app, 'folded', true, target)
  })

  test('E-015 a hostile page never opens Erfana\'s window by itself, and its file is never written', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const target = HtmlPreviewPage.target(HOSTILE)
    const place: ElementPlace = { ...target, clientRects: true }
    const file = path.join(testProject.path, HOSTILE)
    await setGlobalSetting(page, 'comments', reviewer(NAME))
    const mtime = (await fsp.stat(file)).mtimeMs
    await recordDraftsOpened(page)

    const panelId = await openCommentPage(preview, app, HOSTILE, '-HPC-HOSTILE-')
    // Outside comment mode the page's fake pin is just the page's: its handler runs, Erfana opens nothing.
    await clickElement(app, 'fake-pin', 'left', place)
    await expect.poll(() => preview.eval('String(window.__hostile.fakePinClicks)', target), { timeout: PREVIEW_BUDGET_MS }).toBe('1')

    // Comment mode on (the page keeps deleting the overlay; the guards stay).
    await chrome.modeButton().click()
    await expect(chrome.modeButton()).toHaveAttribute('aria-pressed', 'true', { timeout: PREVIEW_BUDGET_MS })
    await expect.poll(async () => (await commentPanelState(app, panelId))?.commentableFrames ?? 0, { timeout: PREVIEW_BUDGET_MS }).toBeGreaterThan(0)
    // Let the page forge another 25 rounds of events in comment mode.
    const forged = Number(await preview.eval('String(window.__hostile.forged)', target))
    await expect
      .poll(async () => Number(await preview.eval('String(window.__hostile.forged)', target)), { timeout: PREVIEW_BUDGET_MS })
      .toBeGreaterThan(forged + 25)
    expect(await draftsOpened(page)).toEqual([])
    await expect(chrome.window()).toHaveCount(0)
    await expect(chrome.menu()).toHaveCount(0)

    // The harness is live: a trusted right-click does open the element menu.
    await clickElement(app, 'target', 'right', place)
    await expect(chrome.menu()).toBeVisible({ timeout: PREVIEW_BUDGET_MS })
    await page.keyboard.press('Escape')
    await expect(chrome.menu()).toHaveCount(0)
    expect((await draftsOpened(page)).map(d => d.kind)).toEqual(['menu'])

    // A CSP 'none' page, forged at from outside its CSP: nothing either.
    const cspTarget = HtmlPreviewPage.target(CSP_NONE)
    const cspFile = path.join(testProject.path, CSP_NONE)
    const cspMtime = (await fsp.stat(cspFile)).mtimeMs
    const csp = new CommentChrome(page, preview, 'csp-none.html')
    const cspPanel = await openCommentPage(preview, app, CSP_NONE, '-HPC-CSPNONE-')
    await csp.modeOn(app, cspPanel, cspTarget)
    const forge = "(['pointerdown','mousedown','mouseup','contextmenu','click'].forEach(t => document.getElementById('target').dispatchEvent(new MouseEvent(t, { bubbles: true, button: t === 'contextmenu' ? 2 : 0 }))), document.getElementById('target').click(), 'forged')"
    expect(await preview.eval(forge, cspTarget)).toBe('forged')
    // A real click after the forged ones: only it opens the window.
    await clickElement(app, 'target', 'left', cspTarget)
    await expect(csp.window()).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
    expect((await draftsOpened(page)).map(d => d.kind)).toEqual(['menu', 'open'])
    await page.getByTestId('comment-cancel').click()

    expect((await fsp.stat(file)).mtimeMs).toBe(mtime)
    expect((await fsp.stat(cspFile)).mtimeMs).toBe(cspMtime)
  })

  test('E-019 element rectangles and innerText are the same before and after comments on pre, inline, white-space: pre and SVG text', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const target = HtmlPreviewPage.target(RAW)
    const ids = ['title', 'code', 'in-pre', 'para', 'inline', 'ws-pre', 'in-ws', 'pic', 'label', 'label-2', 'plain']
    const LAYOUT = `JSON.stringify({ text: document.body.innerText, rects: ${JSON.stringify(ids)}.map(id => { const r = document.getElementById(id).getBoundingClientRect(); return [id, +r.left.toFixed(2), +r.top.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)] }) })`
    await setGlobalSetting(page, 'comments', reviewer(NAME))

    const panelId = await openCommentPage(preview, app, RAW, '-HPC-RAWTEXT-')
    await chrome.modeOn(app, panelId, target)
    const before = await preview.eval(LAYOUT, target)
    expect(before).not.toBeNull()

    const commented = ['in-pre', 'inline', 'in-ws', 'label', 'plain']
    for (const [n, id] of commented.entries()) {
      await clickElement(app, id, 'left', target)
      await expect(chrome.window()).toHaveAttribute('data-view', 'new', { timeout: PREVIEW_BUDGET_MS })
      await chrome.saveNewComment(`Layout-P7 ${id}`, RAW)
      await waitForCommentLoad(app, RAW, 'page', n + 1)
      // #426: the save reloads the page. The served load lands before the new page's
      // overlay is up in comment mode, so a click sent at once can hit a page that
      // ignores it. Wait for main's mode, the page's hello and the overlay again.
      await chrome.modeOn(app, panelId, target)
    }
    const text = await fsp.readFile(path.join(testProject.path, RAW), 'utf-8')
    expect(text.split('erfana:comment v1').length - 1).toBe(commented.length)
    // Rendering unchanged: the same text, and every box where it was.
    await expect.poll(() => preview.eval(LAYOUT, target), { timeout: PREVIEW_BUDGET_MS }).toBe(before)
  })

  test('E-022 a PDF export of a commented page carries no pin', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    await setGlobalSetting(page, 'comments', reviewer(NAME))
    const panelId = await openCommentPage(preview, app, STATIC, '-HPC-STATIC-')
    await chrome.modeOn(app, panelId, STATIC_TARGET)
    await clickElement(app, 'team-copy', 'left', STATIC_TARGET)
    await chrome.saveNewComment('Pdf-P7: no pin in print', STATIC)
    await expectPin(app, 'team-copy', true, STATIC_TARGET)

    // The page's own swatch colour is in the PDF (the reader works); the pin's fill is not.
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'erfana-hpc-pdf-'))
    try {
      const out = path.join(dir, 'commented.pdf')
      await stubDialog(app, 'showSaveDialog', { canceled: false, filePath: out })
      await preview.panel('index.html').getByTestId('preview-band-export-pdf').click()
      await expect.poll(async () => (await fsp.stat(out).catch(() => null))?.size ?? 0, { timeout: PREVIEW_BUDGET_MS }).toBeGreaterThan(1000)
      const streams = pdfStreams(await fsp.readFile(out))
      expect(pdfUsesColour(streams, [0x12, 0x34, 0x56]), "the PDF reader found not even the page's own swatch").toBe(true)
      expect(pdfUsesColour(streams, [0xa0, 0xa8, 0xff]), 'a pin was printed into the PDF').toBe(false)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
    // The overlay is back after the print.
    await expectPin(app, 'team-copy', true, STATIC_TARGET)
  })

  test("E-022 Find in page does not count the overlay's text", async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const chrome = new CommentChrome(page, preview, 'index.html')
    const find = new SearchBarPage(page)
    const findButton = preview.panel('index.html').getByTestId('preview-band-find')
    await setGlobalSetting(page, 'comments', reviewer(NAME))
    const panelId = await openCommentPage(preview, app, STATIC, '-HPC-STATIC-')

    /** Search `query` and return the bar's count once it has answered. */
    let phase = 'before comment mode'
    const countOf = async (query: string, expected: string): Promise<void> => {
      await find.search(query)
      await expect.poll(() => find.countText(), { timeout: PREVIEW_BUDGET_MS, message: `Find "${query}" ${phase}` }).toBe(expected)
    }
    // Before comment mode: the page's own words count, and the label's words
    // ("p#team-copy", the mode tab's "Esc to leave") are nowhere on the page.
    await findButton.click()
    await find.waitForOpen()
    await countOf('Starter', '1 of 1')
    await countOf('team-copy', 'No results')
    await countOf('Esc to leave', 'No results')
    await find.closeButton().click()
    await find.waitForClosed()

    // In comment mode with the outline's label drawn on #team-copy and the
    // mode tab up: the overlay's text must not be counted (§10.2).
    phase = 'in comment mode, the label drawn'
    await chrome.modeOn(app, panelId, STATIC_TARGET)
    await clickElement(app, 'team-copy', 'none', STATIC_TARGET)
    await findButton.click()
    await find.waitForOpen()
    await countOf('Starter', '1 of 1')
    await countOf('team-copy', 'No results')
    await countOf('Esc to leave', 'No results')
  })

  test('E-023 feature flag off: no comment UI, the page served raw, frames without a preload', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    await setGlobalSetting(page, 'htmlPreview', { enabled: true, comments: { enabled: false } })

    await preview.open(FRAMED)
    const target = HtmlPreviewPage.target(FRAMED)
    await preview.waitForTitled('-HPC-FLAG-FRAMED-')
    await expect.poll(() => evalInFrame(app, 'review.html', 'document.title', target), { timeout: PREVIEW_BUDGET_MS }).toBe(REVIEW_TITLE)
    const panel = preview.panel('framed.html')
    await expect(panel.getByTestId('preview-band-find')).toBeVisible({ timeout: PREVIEW_BUDGET_MS })
    // No comment tool in the toolbar, no drawer, no overlay, no pin.
    await expect(panel.locator('[data-testid^="preview-band-comment"]')).toHaveCount(0)
    expect(await evalInFrame(app, 'review.html', OVERLAY_HOSTS_EXPR, target)).toBe('[]')
    expect(await preview.eval(OVERLAY_HOSTS_EXPR, target)).toBe('[]')
    // Served raw: no instrumented load of the commented file, in a frame or not.
    expect((await commentLoads(app)).filter(load => namesFile(load.realPath, REVIEW))).toEqual([])
    // Today's session policy: frames run without a preload.
    const prefs = await app.evaluate(({ webContents }, urlIncludes) => {
      const wc = webContents.getAllWebContents().find(c => c.getURL().includes(urlIncludes))
      // Not in the Electron typings, but a public WebContents method at run time.
      const read = wc as unknown as { getLastWebPreferences?: () => { nodeIntegrationInSubFrames?: boolean; sandbox?: boolean } | null } | undefined
      const p = read?.getLastWebPreferences?.()
      return p ? { nodeIntegrationInSubFrames: p.nodeIntegrationInSubFrames === true, sandbox: p.sandbox === true } : null
    }, target.urlIncludes as string)
    expect(prefs).toEqual({ nodeIntegrationInSubFrames: false, sandbox: true })
  })
})
