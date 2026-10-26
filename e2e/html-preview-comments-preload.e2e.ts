// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – preload exit test (P4;
 * docs/designs/html-preview-comments.md §13 P4 "e2e exit", §6, §9.2, §19
 * R3-2, R3-7; docs/adrs/0005-sub-frame-preload-one-receive-channel.md).
 *
 * Real Chromium, real preload, real instrumented copy:
 *
 * - **Token strip timing (R3-2).** The page records how many `data-erfana-el`
 *   attributes it can see from a head script, an inline body script, a
 *   `defer` script, an inline and an external module script and its own
 *   `DOMContentLoaded` listener. Every one must see none – while the load
 *   proves the served copy carried tokens.
 * - **Known residual, then void (R3-2, SEC-30).** A custom element defined
 *   before the parser reaches it reads its own token in `connectedCallback`
 *   (the documented exposure) and copies it onto a child. Seen twice, the
 *   token is void: a pick on that element names its tokened ancestor instead.
 * - **A pin for a pre-seeded block (J-005).** Main sends the page its pins on
 *   hello (P5), so the overlay draws a pin at the commented element – checked
 *   in the view's pixels, because the overlay lives in a closed shadow root
 *   (SEC-21: `shadowRoot === null` from the page). The stub then takes the
 *   pins away and shows the one pin again, and the page reports it visible.
 * - **A page CSP does not reach the preload (SEC-24).** A page that sets
 *   `script-src 'none'; style-src 'none'` is still stripped, pinned and
 *   pickable.
 * - **A page that fights the overlay (SEC-28, SEC-31, L1, M1).** In real
 *   Chromium – the unit tests' jsdom has no top layer and no `document.open()`
 *   that erases listeners – a page's `hidePopover()` is undone, even with a
 *   page `beforetoggle` listener that cancels every show; a page that removes
 *   the host in a loop makes the overlay give up within its budget and say so;
 *   and after `document.open()` the guards are back (a comment-mode click is a
 *   pick, the page's handler never runs) while main hears the overlay is
 *   unavailable for that load.
 *
 * Since P5 main answers the page's channels itself; the stub
 * (`html-preview.comments.ts`) records the picks and anchor reports next to
 * main and sends its own state, which lasts until main's next one (main's
 * mode stays off here, so it takes no pick). Local gate only: e2e is disabled
 * in CI. Condition-based waits only.
 */

import type { ElectronApplication } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'
import {
  DOM_TOKENS_EXPR,
  OVERLAY_HOSTS_EXPR,
  OVERLAY_HOST_EXPR,
  OVERLAY_HOST_OPEN_EXPR,
  accentPixelsNear,
  armCommentStub,
  commentStubRecord,
  commentUnavailable,
  enterStubCommentMode,
  overlayReportedUnavailable,
  pickAt,
  sendCommentState,
  waitForCommentLoad,
  type CommentLoadView
} from './pages/html-preview.comments'
import { commentedPage } from '../src/main/services/preview/comments/__test-helpers__/commentedPages'
import { OVERLAY_REPAIRS_PER_SECOND } from '../src/preload/previewPageComments/constants'

const SCRIPTS = 'comments/scripts.html'
const CSP = 'comments/csp.html'
const SCRIPTS_TITLE = '-HPC-P4-'
const CSP_TITLE = '-HPC-P4-CSP-'

/** Three `ok` blocks Erfana wrote, and the `id` of the element each is on. */
const COMMENTED = commentedPage()
const BASE_TITLE = '<title>-HPC-P3-</title>'

/**
 * Head scripts: the counter every later script uses, the page's own
 * `DOMContentLoaded` reading, and a custom element defined before the parser
 * reaches it. The attribute name is built at run time: a source that names it
 * is served raw (instrument.ts, U-091).
 */
const HEAD_SCRIPTS = [
  '<script>',
  '  window.__seen = {}',
  "  const ATTR = 'data-' + 'erfana-el'",
  "  window.__count = () => document.querySelectorAll('[' + ATTR + ']').length",
  "  document.addEventListener('DOMContentLoaded', () => { window.__seen.dcl = window.__count() })",
  "  customElements.define('x-copy', class extends HTMLElement {",
  '    connectedCallback() {',
  "      if (this.querySelector('span') !== null) return",
  '      const token = this.getAttribute(ATTR)',
  '      window.__seen.copied = token',
  '      if (token === null) return',
  "      const copy = document.createElement('span')",
  '      copy.setAttribute(ATTR, token)',
  '      this.prepend(copy)',
  '    }',
  '  })',
  '</script>',
  '<script defer src="defer.js"></script>',
  '<script type="module" src="module.js"></script>'
].join('\n')

/** After `<main>`: the custom element, then an inline and an inline module script. */
const BODY_TAIL = [
  '  <x-copy id="xc">copy me</x-copy>',
  '  <script>window.__seen.inline = window.__count()</script>',
  '  <script type="module">window.__seen.moduleInline = window.__count()</script>',
  ''
].join('\n')

const SCRIPTS_TEXT = COMMENTED.text
  .replace(BASE_TITLE, `<title>${SCRIPTS_TITLE}</title>`)
  .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n${HEAD_SCRIPTS}\n`)
  .replace('  <template>', `${BODY_TAIL}  <template>`)

const CSP_TEXT = COMMENTED.text
  .replace(BASE_TITLE, `<title>${CSP_TITLE}</title>`)
  .replace(
    '<meta charset="utf-8">',
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; style-src 'none'">`
  )

test.use({
  testProjectFiles: {
    [SCRIPTS]: SCRIPTS_TEXT,
    'comments/defer.js': 'window.__seen.defer = window.__count()\n',
    'comments/module.js': 'window.__seen.moduleSrc = window.__count()\n',
    [CSP]: CSP_TEXT,
    'notes.md': '# Notes\n'
  }
})

/** Open `relPath`, wait for its title and its instrumented load. */
async function openCommented(
  preview: HtmlPreviewPage,
  app: ElectronApplication,
  relPath: string,
  title: string
): Promise<CommentLoadView> {
  await preview.open(relPath)
  await preview.withReadError(
    expect
      .poll(async () => (await preview.snapshot(HtmlPreviewPage.target(relPath)))?.docTitle, {
        timeout: PREVIEW_BUDGET_MS,
        message: `${relPath} never showed its ${title} title`
      })
      .toBe(title)
  )
  return waitForCommentLoad(app, relPath, 'page', COMMENTED.targets.size)
}

/** The token of the block on the element with `elementId`. */
function tokenOn(load: CommentLoadView, elementId: string): string {
  const blockId = [...COMMENTED.targets].find(([, id]) => id === elementId)?.[0]
  const token = load.blocks.find(block => block.id === blockId)?.token
  if (token === undefined) throw new Error(`no block token on #${elementId}`)
  return token
}

/**
 * The pin of the pre-seeded block on `elementId`: main draws it on the page's
 * hello; then the stub takes every pin away, shows that one pin again, and
 * waits until it is drawn and reported visible.
 */
async function expectPinDrawn(app: ElectronApplication, relPath: string, load: CommentLoadView, elementId: string): Promise<void> {
  const target = HtmlPreviewPage.target(relPath)
  await expect
    .poll(() => accentPixelsNear(app, elementId, target), {
      timeout: PREVIEW_BUDGET_MS,
      message: `main never drew the pin at #${elementId}`
    })
    .toBeGreaterThanOrEqual(40)
  expect(await armCommentStub(app, target)).toBe(true)
  // Without pins, nothing of the pin's colour is there.
  expect(await sendCommentState(app, { mode: false, commentable: true, icons: [] }, target)).toBe(true)
  await expect.poll(() => accentPixelsNear(app, elementId, target), { timeout: PREVIEW_BUDGET_MS }).toBe(0)

  const key = 'k-pin'
  const icon = { key, token: tokenOn(load, elementId), count: 1, status: 'open' }
  expect(await sendCommentState(app, { mode: false, commentable: true, icons: [icon] }, target)).toBe(true)
  await expect
    .poll(() => accentPixelsNear(app, elementId, target), {
      timeout: PREVIEW_BUDGET_MS,
      message: `no pin drawn at #${elementId}`
    })
    .toBeGreaterThanOrEqual(40)
  await expect
    .poll(async () => (await commentStubRecord(app, target))?.anchors.at(-1)?.payload, {
      timeout: PREVIEW_BUDGET_MS,
      message: 'the pin was never reported visible'
    })
    .toEqual({ visible: [key], hidden: [] })
}

test.describe('HTML Preview comments – preload (P4 exit)', () => {
  test('R3-2 tokens are stripped before inline, defer and module scripts run', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    const load = await openCommented(preview, appWithTestProject, SCRIPTS, SCRIPTS_TITLE)
    // The served copy did carry tokens: every eligible element has one.
    expect(load.tokenCount).toBeGreaterThan(COMMENTED.targets.size)

    const target = HtmlPreviewPage.target(SCRIPTS)
    let seen: Record<string, unknown> = {}
    await preview.withReadError(
      expect
        .poll(
          async () => {
            seen = JSON.parse((await preview.eval('JSON.stringify(window.__seen ?? {})', target)) ?? '{}')
            return ['inline', 'moduleInline', 'defer', 'moduleSrc', 'dcl'].every(k => k in seen)
          },
          { timeout: PREVIEW_BUDGET_MS, message: 'the page scripts never all ran' }
        )
        .toBe(true)
    )
    expect(seen).toMatchObject({ inline: 0, moduleInline: 0, defer: 0, moduleSrc: 0, dcl: 0 })
    expect(await preview.eval(DOM_TOKENS_EXPR, target)).toBe('[]')
    expect(await commentUnavailable(appWithTestProject)).toEqual([])
  })

  test('SEC-30 a custom element that copies its token makes it void – the documented residual', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    const load = await openCommented(preview, appWithTestProject, SCRIPTS, SCRIPTS_TITLE)
    const target = HtmlPreviewPage.target(SCRIPTS)
    const copied = JSON.parse((await preview.eval('JSON.stringify(window.__seen.copied)', target)) ?? 'null')
    // An already-defined element's callback runs before the preload's
    // observer: it can read its token (R3-2, harmless – tokens are not authoritative).
    expect(copied).toMatch(/^[a-z2-7]{12}$/)

    await enterStubCommentMode(appWithTestProject, target)
    const pick = await pickAt(appWithTestProject, 'xc', target)
    expect(pick.payload.token).not.toBe(copied)
    expect(pick.payload.runtime).toMatchObject({ tag: 'x-copy', path: expect.stringContaining('x-copy') })
    // The other elements keep their tokens.
    const onButton = await pickAt(appWithTestProject, 'cta', target)
    expect(onButton.payload.token).toBe(tokenOn(load, 'cta'))
  })

  test('J-005 a pin is drawn for a pre-seeded block, outside comment mode, in a closed shadow root', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    const load = await openCommented(preview, appWithTestProject, SCRIPTS, SCRIPTS_TITLE)
    await expectPinDrawn(appWithTestProject, SCRIPTS, load, 'cta')
    // SEC-21: one host, its shadow root closed to the page.
    expect(await preview.eval(OVERLAY_HOSTS_EXPR, HtmlPreviewPage.target(SCRIPTS))).toBe('[true]')
  })

  test('SEC-31 and L1 a hidden host is shown again – even past a page beforetoggle listener that cancels', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await openCommented(preview, appWithTestProject, SCRIPTS, SCRIPTS_TITLE)
    const target = HtmlPreviewPage.target(SCRIPTS)
    await enterStubCommentMode(appWithTestProject, target)
    expect(await preview.eval(OVERLAY_HOST_OPEN_EXPR, target)).toBe('true')

    // SEC-31: the page hides the host.
    expect(await preview.eval(`(() => { const host = ${OVERLAY_HOST_EXPR}; host.hidePopover(); return String(host.matches(':popover-open')) })()`, target)).toBe('false')
    await expect
      .poll(() => preview.eval(OVERLAY_HOST_OPEN_EXPR, target), { timeout: PREVIEW_BUDGET_MS, message: 'the host was never shown again' })
      .toBe('true')

    // L1: a page listener in the window's capture phase cancels every show, then the page hides the host again.
    // Semicolons: the host expression starts with `[`, which would otherwise index the line above.
    const cancelAndHide = [
      '(() => {',
      '  window.__cancelled = 0;',
      "  window.addEventListener('beforetoggle', event => { if (event.newState === 'open') { window.__cancelled += 1; event.preventDefault() } }, true);",
      `  ${OVERLAY_HOST_EXPR}.hidePopover();`,
      "  return 'ok'",
      '})()'
    ].join('\n')
    expect(await preview.eval(cancelAndHide, target)).toBe('ok')
    await expect
      .poll(() => preview.eval(OVERLAY_HOST_OPEN_EXPR, target), { timeout: PREVIEW_BUDGET_MS, message: 'a page beforetoggle listener kept the host hidden' })
      .toBe('true')
    // The host's popover events never reached the page's listener.
    expect(await preview.eval('String(window.__cancelled)', target)).toBe('0')
    expect(await overlayReportedUnavailable(appWithTestProject, target)).toBe(false)
  })

  test('SEC-28 a page that keeps removing the host makes the overlay give up within its budget – no spin', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await openCommented(preview, appWithTestProject, SCRIPTS, SCRIPTS_TITLE)
    const target = HtmlPreviewPage.target(SCRIPTS)
    await enterStubCommentMode(appWithTestProject, target)

    const fight = [
      '(() => {',
      '  window.__removed = 0',
      "  const fight = () => { const host = [...document.documentElement.children].find(el => el.localName === 'div'); if (host) { host.remove(); window.__removed += 1 } }",
      '  new MutationObserver(fight).observe(document.documentElement, { childList: true })',
      '  fight()',
      "  return 'ok'",
      '})()'
    ].join('\n')
    expect(await preview.eval(fight, target)).toBe('ok')
    await expect
      .poll(() => overlayReportedUnavailable(appWithTestProject, target), { timeout: PREVIEW_BUDGET_MS, message: 'main never heard the overlay was unavailable' })
      .toBe(true)
    const removed = Number(await preview.eval('String(window.__removed)', target))
    // The first removal, then one per repair: the budget, not the page, ended it.
    expect(removed).toBeGreaterThan(1)
    expect(removed).toBeLessThanOrEqual(1 + OVERLAY_REPAIRS_PER_SECOND)

    // A pick paints before it is sent, so a render has run since: still no host, and nothing re-attached.
    await pickAt(appWithTestProject, 'cta', target)
    expect(await preview.eval(OVERLAY_HOSTS_EXPR, target)).toBe('[]')
    expect(Number(await preview.eval('String(window.__removed)', target))).toBe(removed)
  })

  test('M1 after document.open() the guards are back – a comment-mode click is still a pick – and main hears it', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await openCommented(preview, appWithTestProject, SCRIPTS, SCRIPTS_TITLE)
    const target = HtmlPreviewPage.target(SCRIPTS)
    await enterStubCommentMode(appWithTestProject, target)
    expect(await overlayReportedUnavailable(appWithTestProject, target)).toBe(false)

    const written = [
      '<!doctype html><html><head><meta charset="utf-8"><title>' + SCRIPTS_TITLE + '</title></head>',
      '<body style="margin:0"><button id="written" onclick="window.__clicked = true"',
      ' style="position:absolute;left:40px;top:40px;width:240px;height:90px">Written</button></body></html>'
    ].join('')
    const rewrite = `(() => { document.open(); document.write(${JSON.stringify(written)}); document.close(); return 'ok' })()`
    expect(await preview.eval(rewrite, target)).toBe('ok')

    await expect
      .poll(() => overlayReportedUnavailable(appWithTestProject, target), { timeout: PREVIEW_BUDGET_MS, message: 'main never heard of the replaced document' })
      .toBe(true)
    // The host is back on the new <html>, its shadow root still closed.
    await expect
      .poll(() => preview.eval(OVERLAY_HOSTS_EXPR, target), { timeout: PREVIEW_BUDGET_MS, message: 'the host never came back' })
      .toBe('[true]')

    const pick = await pickAt(appWithTestProject, 'written', target)
    expect(pick.payload).toMatchObject({ kind: 'open', via: 'pointer' })
    // Written by the page, so it carries no token.
    expect(pick.payload.token).toBeUndefined()
    expect(await preview.eval('String(window.__clicked === true)', target)).toBe('false')
  })

  test("SEC-24 a page with CSP script-src 'none' is still stripped, pinned and pickable", async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    const load = await openCommented(preview, appWithTestProject, CSP, CSP_TITLE)
    const target = HtmlPreviewPage.target(CSP)
    expect(await preview.eval(DOM_TOKENS_EXPR, target)).toBe('[]')
    await expectPinDrawn(appWithTestProject, CSP, load, 'cta')

    await enterStubCommentMode(appWithTestProject, target)
    const pick = await pickAt(appWithTestProject, 'when', target)
    expect(pick.payload).toMatchObject({ kind: 'open', token: tokenOn(load, 'when') })
  })
})
