// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – service and IPC exit test (P5;
 * docs/designs/html-preview-comments.md §13 P5 "e2e exit", §7.1–§7.7, §8,
 * §12.4; M-040, M-058, SEC-09, SEC-20, SEC-23).
 *
 * Real Chromium, real preload, real main – no stub. The test plays only the
 * renderer's side, through the real `window.api.previewComments` bridge (P6
 * builds the UI on it):
 *
 * - **Save → reload → restore.** Comment mode on, the reader scrolls down and
 *   clicks an element; main opens a draft and the renderer saves it. The file
 *   gains exactly one block, the view reloads once, the scroll comes back, the
 *   mode stays on and the new pin is drawn. Read through the e2e hook
 *   (`state(panelId)`: reloads, the last restore, drafts held).
 * - **SEC-20.** After add, reply, edit and delete – and a refused request that
 *   carries the same text – no file in the worker's `~/.erfana/logs/` holds
 *   comment text, an author name or email, or the project folder's absolute
 *   path on any line (a named allow-list covers other subsystems' own lines).
 * - **SEC-09.** A page cannot `pushState` to another path (Chromium throws),
 *   and after a same-document step a click still opens a draft on the file
 *   the load named.
 * - **New comment from a pin (§10.4).** A click on a pin opens its threads with
 *   a draft on the same element; saving through it adds a second thread there,
 *   and the list carries each thread's stored quote ("It was attached to:").
 * - **SEC-23 (residual S6).** A page that fetches its own URL reads its own
 *   blocks, authors included: documented, expected to pass.
 *
 * Local gate only: e2e is disabled in CI. Condition-based waits only.
 */

import * as fsp from 'fs/promises'
import * as path from 'path'
import { pathToFileURL } from 'url'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { appLogsDir } from './fixtures/isolation'
import { LogTail, appMainLogPath } from './fixtures/logTail'
import { HtmlPreviewPage, PREVIEW_BUDGET_MS } from './pages/html-preview.page'
import {
  OVERLAY_HOSTS_EXPR,
  accentPixelsNear,
  clickAt,
  commentPanelState,
  listComments,
  recordDraftsOpened,
  saveComment,
  setCommentMode,
  waitForCommentLoad,
  waitForCommentPanel,
  waitForDraftOpened
} from './pages/html-preview.comments'
import { commentedPage } from '../src/main/services/preview/comments/__test-helpers__/commentedPages'
import type { CommentThreadView } from '../src/shared/ipc/preview-comment-schema'

const PAGE = 'comments/service.html'
const TITLE = '-HPC-P5-'
const COMMENTED = commentedPage()
const BLOCKS = COMMENTED.targets.size

/** A tall page: the element the test comments on sits far below the fold. */
const SERVICE_TEXT = COMMENTED.text
  .replace('<title>-HPC-P3-</title>', `<title>${TITLE}</title>`)
  .replace(
    '  <template>',
    [
      '  <div style="height:2400px"></div>',
      '  <p id="low">A paragraph far down the page.</p>',
      '  <div style="height:2400px"></div>',
      '  <template>'
    ].join('\n')
  )

/** Marker strings, unique to this spec, that must never reach a log. */
const AUTHOR = { authorName: 'Reviewer Q7x2Lm', authorEmail: 'q7x2lm@example.invalid', identityNoticeSeen: true }
const NOTE = 'Note-Zk81Pq: make this paragraph shorter'
const REPLY = 'Reply-Vb27Ne: agreed'
const EDITED = 'Edited-Hy64Rd: shorter, and bold'

test.use({
  testProjectFiles: {
    [PAGE]: SERVICE_TEXT,
    'notes.md': '# Notes\n'
  }
})

type SettingsWindow = { api: { globalSettings: { set(key: string, value: unknown): Promise<{ success: boolean }> } } }

/** Set one app-level setting through the renderer's real bridge. */
async function setGlobalSetting(page: Page, key: string, value: unknown): Promise<void> {
  const result = await page.evaluate(
    ({ k, v }) => (window as unknown as SettingsWindow).api.globalSettings.set(k, v),
    { k: key, v: value }
  )
  expect(result, `globalSettings.set('${key}')`).toEqual({ success: true })
}

/** Open the page, wait for its title and its instrumented load, and return its panel id. */
async function openService(preview: HtmlPreviewPage, app: ElectronApplication): Promise<string> {
  await preview.open(PAGE)
  await preview.withReadError(
    expect
      .poll(async () => (await preview.snapshot(HtmlPreviewPage.target(PAGE)))?.docTitle, {
        timeout: PREVIEW_BUDGET_MS,
        message: `${PAGE} never showed its ${TITLE} title`
      })
      .toBe(TITLE)
  )
  await waitForCommentLoad(app, PAGE, 'page', BLOCKS)
  return (await waitForCommentPanel(app)).panelId
}

/** Comment mode on through the bridge, and the overlay up in the page. */
async function enterCommentMode(preview: HtmlPreviewPage, page: Page, app: ElectronApplication, panelId: string): Promise<void> {
  expect(await setCommentMode(page, panelId, true)).toEqual({ ok: true, on: true, showIcons: true })
  await expect
    .poll(async () => (await commentPanelState(app, panelId))?.mode, { timeout: PREVIEW_BUDGET_MS })
    .toBe(true)
  await preview.withReadError(
    expect
      .poll(() => preview.eval(OVERLAY_HOSTS_EXPR, HtmlPreviewPage.target(PAGE)), {
        timeout: PREVIEW_BUDGET_MS,
        message: 'the overlay never came up in comment mode'
      })
      .toBe('[true]')
  )
}

/** Scroll `#low` to the middle of the view and return the page's scroll offset. */
async function scrollToLow(preview: HtmlPreviewPage): Promise<number> {
  const y = await preview.eval(
    "(() => { document.getElementById('low').scrollIntoView({ block: 'center' }); return String(Math.round(scrollY)) })()",
    HtmlPreviewPage.target(PAGE)
  )
  return Number(y)
}

/** Click `#low` in comment mode and save the draft main opens; returns the new thread's key. */
async function addOnLow(app: ElectronApplication, page: Page, panelId: string, draftNumber: number): Promise<string> {
  expect(await clickAt(app, 'low', HtmlPreviewPage.target(PAGE)), '#low not found').toBe(true)
  const draft = await waitForDraftOpened(page, draftNumber)
  expect(draft).toMatchObject({ panelId, kind: 'open', displayPath: PAGE, unsavedSource: false, target: { tag: 'p', elementId: 'low' } })
  if (draft.kind === 'icon' || draft.draftToken === undefined) throw new Error(`no draft token: ${JSON.stringify(draft)}`)
  const saved = await saveComment(page, { panelId, op: 'add', draftToken: draft.draftToken, text: NOTE })
  expect(saved).toMatchObject({ ok: true, threadKey: expect.stringMatching(/^t/) })
  return (saved as { threadKey: string }).threadKey
}

/**
 * Log lines that name the project folder on purpose, written by subsystems
 * other than comments – the full set a Windows run of this spec showed. Each
 * is matched by the fixed text its subsystem writes; a comment line is never
 * allowed, whatever it matches.
 */
const ALLOWED_PATH_LINES: readonly RegExp[] = [
  // Main: git status polling and its watcher, started when the project opens.
  /GitPollingService: Started polling \{"projectPath":/,
  /GitWatcherService: Starting watcher \{"projectPath":/,
  // Main: the project tree's directory watcher (it also reports the comment write's own change).
  / Starting directory watch for: /,
  / Directory watcher ready for: /,
  / Directory changed: /,
  // Renderer: project switch, git status and the panel the test opened.
  /\[RENDERER\] .*useProjectManagement: Project changed: \{"oldPath":/,
  /\[RENDERER\] \[useGitStatus\] (Git watcher start requested|Refresh completed) \| \{"projectPath":/,
  /\[RENDERER\] Opened new panel \| \{"filePath":/
]

/** Lines the comment feature writes: every one starts "Preview comments:" (`src/main/services/preview/comments/`). */
const COMMENT_LINE = /Preview comments:/

/** Every line of every file in the logs folder (`main.log`, `renderer.log`, `combined.log` and rotated files). */
async function readAllLogLines(dir: string): Promise<Array<{ file: string; line: string }>> {
  const names = (await fsp.readdir(dir)).filter(name => name.endsWith('.log'))
  const lines: Array<{ file: string; line: string }> = []
  for (const name of names) {
    const text = await fsp.readFile(path.join(dir, name), 'utf-8')
    for (const line of text.split(/\r?\n/)) if (line !== '') lines.push({ file: name, line })
  }
  return lines
}

/**
 * The ways a log could spell the project folder: as given, resolved (Windows
 * may hand out a short `MARCIN~1` form), with `/` separators, JSON-escaped,
 * and as a `file:` URL.
 */
async function pathSpellings(projectRoot: string): Promise<string[]> {
  const roots = new Set([projectRoot, await fsp.realpath(projectRoot)])
  const spellings = new Set<string>()
  for (const root of roots) {
    spellings.add(root)
    spellings.add(root.replace(/\\/g, '/'))
    spellings.add(root.replace(/\\/g, '\\\\'))
    spellings.add(pathToFileURL(root).href)
  }
  return [...spellings]
}

/**
 * A trusted click on the bubble of the pin of `#elementId` (§10.5: the tail tip
 * 4 px outside the element's top-right corner, the 24 px box above it, clamped
 * to the viewport); `false` when the element is missing.
 */
async function clickPinOf(app: ElectronApplication, preview: HtmlPreviewPage, elementId: string): Promise<boolean> {
  const raw = await preview.eval(
    `(() => {
      const el = document.getElementById(${JSON.stringify(elementId)})
      if (!el) return 'null'
      const r = el.getBoundingClientRect()
      const clamp = (v, max) => Math.min(Math.max(v, 0), max)
      const left = clamp(r.right + 4 - 2, document.documentElement.clientWidth - 24)
      const top = clamp(r.top - 4 - 22, document.documentElement.clientHeight - 24)
      return JSON.stringify({ x: Math.round(left + 12), y: Math.round(top + 10) })
    })()`,
    HtmlPreviewPage.target(PAGE)
  )
  const point = JSON.parse(raw ?? 'null') as { x: number; y: number } | null
  if (point === null) return false
  return app.evaluate(({ webContents }, { x, y }) => {
    const wc = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('erfana-preview://'))
    if (!wc) return false
    wc.sendInputEvent({ type: 'mouseMove', x, y })
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    return true
  }, point)
}

/** The thread with `threadKey` in main's list of the page's file. */
async function threadOf(page: Page, panelId: string, threadKey: string): Promise<{ fileKey: string; thread: CommentThreadView }> {
  const list = await listComments(page, panelId)
  if (!list.ok) throw new Error(`list refused: ${list.code}`)
  const file = list.files.find(f => f.displayPath === PAGE)
  const thread = file?.threads.find(t => t.threadKey === threadKey)
  if (file === undefined || thread === undefined) throw new Error(`thread ${threadKey} not listed`)
  return { fileKey: file.fileKey, thread }
}

test.describe('HTML Preview comments – service and IPC (P5 exit)', () => {
  test('M-040 M-058 save → one reload → the reader put back, the mode kept and the new pin drawn', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    await setGlobalSetting(page, 'comments', AUTHOR)
    const panelId = await openService(preview, app)
    await recordDraftsOpened(page)
    await enterCommentMode(preview, page, app, panelId)

    const scrolled = await scrollToLow(preview)
    expect(scrolled).toBeGreaterThan(1000)
    const before = (await commentPanelState(app, panelId))!
    const threadKey = await addOnLow(app, page, panelId, 1)

    // The file gained exactly one block: the note, by the identity in Settings.
    const text = await fsp.readFile(path.join(testProject.path, PAGE), 'utf-8')
    expect(text.split('erfana:comment v1').length - 1).toBe(BLOCKS + 1)
    expect(text).toContain(NOTE)
    expect(text).toContain(AUTHOR.authorName)

    // One reload of this view, its new load carrying the new block…
    await expect
      .poll(async () => (await commentPanelState(app, panelId))?.reloads, { timeout: PREVIEW_BUDGET_MS, message: 'the view never reloaded' })
      .toBe(before.reloads + 1)
    await waitForCommentLoad(app, PAGE, 'page', BLOCKS + 1)
    // …and the reader put back where they were.
    await expect
      .poll(async () => (await commentPanelState(app, panelId))?.lastRestore, { timeout: PREVIEW_BUDGET_MS, message: 'the scroll was never restored' })
      .toBe('restored')
    const target = HtmlPreviewPage.target(PAGE)
    await expect
      .poll(async () => Number(await preview.eval('String(Math.round(scrollY))', target)), { timeout: PREVIEW_BUDGET_MS })
      .toBe(scrolled)

    const after = (await commentPanelState(app, panelId))!
    expect(after).toMatchObject({ mode: true, drafts: 0, commentableFrames: 1 })
    // The own write's watcher echo did not reload the view a second time.
    expect(after.reloads).toBe(before.reloads + 1)
    await expect
      .poll(() => accentPixelsNear(app, 'low', target), { timeout: PREVIEW_BUDGET_MS, message: 'no pin drawn at #low' })
      .toBeGreaterThanOrEqual(40)

    const { thread } = await threadOf(page, panelId, threadKey)
    expect(thread).toMatchObject({ status: 'open', tag: 'p', elementId: 'low', attached: true, notVisible: false })
    expect(thread.messages).toEqual([expect.objectContaining({ text: NOTE, by: { name: AUTHOR.authorName, email: AUTHOR.authorEmail } })])
  })

  test('SEC-20 add, reply, edit and delete leave no text, author or absolute path in any log', async ({
    windowWithTestProject,
    appWithTestProject,
    testProject,
    homeDir
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const log = new LogTail(appMainLogPath(homeDir))
    await setGlobalSetting(page, 'logging', { level: 'debug' })
    await setGlobalSetting(page, 'comments', AUTHOR)
    await log.mark()

    const panelId = await openService(preview, app)
    await recordDraftsOpened(page)
    await enterCommentMode(preview, page, app, panelId)
    await scrollToLow(preview)
    const threadKey = await addOnLow(app, page, panelId, 1)
    await waitForCommentLoad(app, PAGE, 'page', BLOCKS + 1)

    let { fileKey, thread } = await threadOf(page, panelId, threadKey)
    const target = { panelId, fileKey, threadKey, rawHash: thread.rawHash }
    expect(await saveComment(page, { ...target, op: 'reply', text: REPLY })).toEqual({ ok: true, threadKey })
    // The list reads the file from disk, so it shows each write at once.
    await expect
      .poll(async () => (await threadOf(page, panelId, threadKey)).thread.messages.length, { timeout: PREVIEW_BUDGET_MS })
      .toBe(2)
    ;({ fileKey, thread } = await threadOf(page, panelId, threadKey))
    const reply = thread.messages[1]
    expect(
      await saveComment(page, { panelId, fileKey, threadKey, rawHash: thread.rawHash, op: 'editMessage', messageId: reply.id, text: EDITED })
    ).toEqual({ ok: true, threadKey })
    await expect
      .poll(async () => (await threadOf(page, panelId, threadKey)).thread.messages[1].text, { timeout: PREVIEW_BUDGET_MS })
      .toBe(EDITED)
    ;({ fileKey, thread } = await threadOf(page, panelId, threadKey))
    expect(await saveComment(page, { panelId, fileKey, threadKey, rawHash: thread.rawHash, op: 'deleteThread' })).toEqual({ ok: true, threadKey: null })
    await expect
      .poll(async () => (await fsp.readFile(path.join(testProject.path, PAGE), 'utf-8')).includes(NOTE), { timeout: PREVIEW_BUDGET_MS })
      .toBe(false)

    // A refused request carrying the text: its rejection is logged, the text is not.
    const refused = await page.evaluate(
      request => (window as unknown as { api: { previewComments: { save(r: unknown): Promise<unknown> } } }).api.previewComments.save(request),
      { panelId, op: 'add', draftToken: 'not-a-token', text: NOTE }
    )
    expect(refused).toMatchObject({ ok: false })
    await log.waitFor(/Preview comments: rejected an invalid request/, { timeout: PREVIEW_BUDGET_MS })

    // The markers are this spec's own: anywhere in the log, they are a leak.
    const appended = await log.appended()
    for (const marker of [NOTE, REPLY, EDITED, AUTHOR.authorName, AUTHOR.authorEmail]) {
      expect(appended, `main.log names ${marker}`).not.toContain(marker)
    }
    expect(appended.split(/\r?\n/).some(line => COMMENT_LINE.test(line)), 'no comment line was logged at all').toBe(true)

    // Paths: every line of every log file the worker's app has written, not
    // only this test's comment lines; a line another subsystem writes on
    // purpose is allowed by name, and nothing else may spell the project path.
    const logs = await readAllLogLines(appLogsDir(homeDir))
    for (const marker of [NOTE, REPLY, EDITED, AUTHOR.authorName, AUTHOR.authorEmail]) {
      expect(logs.filter(entry => entry.line.includes(marker)), `a log names ${marker}`).toEqual([])
    }
    const spellings = await pathSpellings(testProject.path)
    const leaks = logs.filter(
      ({ line }) => spellings.some(s => line.includes(s)) && (COMMENT_LINE.test(line) || !ALLOWED_PATH_LINES.some(allowed => allowed.test(line)))
    )
    expect(leaks, 'a log line names the project folder by its absolute path').toEqual([])
    // The panel id is built from the absolute path, so a comment line may not carry it either.
    const panelIdLines = logs.filter(({ line }) => COMMENT_LINE.test(line) && line.includes(panelId))
    expect(panelIdLines, 'a comment log line names the path-derived panel id').toEqual([])
  })

  test('SEC-09 a page that rewrites its URL still has its comments bound to the file it loaded', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    const panelId = await openService(preview, app)
    await recordDraftsOpened(page)
    await enterCommentMode(preview, page, app, panelId)
    const target = HtmlPreviewPage.target(PAGE)

    // Another path cannot even be named: Chromium refuses it in the preview's page.
    const otherPath = await preview.eval(
      "(() => { try { history.pushState({}, '', 'other.html'); return 'no-throw' } catch (error) { return error.name } })()",
      target
    )
    expect(otherPath).toBe('SecurityError')
    // A same-document step (query and fragment) is allowed; main keeps the file the load named.
    const moved = await preview.eval("(history.pushState({}, '', '?moved=1#elsewhere'), location.search + location.hash)", target)
    expect(moved).toBe('?moved=1#elsewhere')

    await scrollToLow(preview)
    expect(await clickAt(app, 'low', target), '#low not found').toBe(true)
    const draft = await waitForDraftOpened(page, 1)
    expect(draft).toMatchObject({ panelId, kind: 'open', displayPath: PAGE, target: { tag: 'p', elementId: 'low' } })
  })

  test('§10.4 a pin offers "New comment": its draft saves a second thread on the element, and the list carries the stored quote', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const app = appWithTestProject
    const page = windowWithTestProject
    const preview = new HtmlPreviewPage(page, app)
    await setGlobalSetting(page, 'comments', AUTHOR)
    const panelId = await openService(preview, app)
    await recordDraftsOpened(page)
    const target = HtmlPreviewPage.target(PAGE)
    // Pins are drawn outside comment mode too; the open thread on #cta has one.
    await expect
      .poll(() => accentPixelsNear(app, 'cta', target), { timeout: PREVIEW_BUDGET_MS, message: 'no pin drawn at #cta' })
      .toBeGreaterThanOrEqual(40)

    expect(await clickPinOf(app, preview, 'cta'), '#cta not found').toBe(true)
    const opened = await waitForDraftOpened(page, 1)
    if (opened.kind !== 'icon' || opened.draftToken === undefined) throw new Error(`the pin carried no draft: ${JSON.stringify(opened)}`)
    expect(opened).toMatchObject({ panelId, threadKeys: [expect.stringMatching(/^t/)], unsavedSource: false, target: { tag: 'button', elementId: 'cta' } })

    const saved = await saveComment(page, { panelId, op: 'add', draftToken: opened.draftToken, text: NOTE })
    expect(saved).toMatchObject({ ok: true, threadKey: expect.stringMatching(/^t/) })
    await waitForCommentLoad(app, PAGE, 'page', BLOCKS + 1)
    const list = await listComments(page, panelId)
    if (!list.ok) throw new Error(`list refused: ${list.code}`)
    const onCta = list.files.find(file => file.displayPath === PAGE)?.threads.filter(thread => thread.elementId === 'cta') ?? []
    expect(onCta.map(thread => [thread.messages[0].text === NOTE, thread.quote]).sort()).toEqual([
      [false, 'Buy now'],
      [true, 'Buy now']
    ])
  })

  test('SEC-23 residual S6: a page that fetches its own URL reads its own blocks', async ({
    windowWithTestProject,
    appWithTestProject
  }) => {
    const preview = new HtmlPreviewPage(windowWithTestProject, appWithTestProject)
    await openService(preview, appWithTestProject)
    const own = await preview.eval(
      "fetch(location.href).then(r => r.text()).then(t => JSON.stringify({ blocks: t.split('erfana:comment v1').length - 1, ada: t.includes('Ada Lovelace') }))",
      HtmlPreviewPage.target(PAGE)
    )
    // Documented, not closable (design §9.1 S6): the blocks live in the page's own file.
    expect(JSON.parse(own ?? '{}')).toEqual({ blocks: BLOCKS, ada: true })
  })
})
