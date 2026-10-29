// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Scene `readme-demo`: the README showcase video (spec 023,
 * specs/spec-t3-023-readme-video). One continuous take of the real app, real
 * Claude Code and real macOS dialogs, recorded from the screen (023-FR-012).
 *
 * The scene records and logs; `run.mjs` plans the edit (demo-story.mjs),
 * checks it and encodes. The log has, on the wall clock: every step's start
 * and end, every wait that may be sped up, the per-step results, the layout,
 * the edit-to-preview latency and the screenshot's size. A one-colour sync
 * flash at the start puts those times on the recording's own timeline.
 *
 * Off camera, before the recording starts – none of it changes the app:
 * - the window goes to a screen that holds 1920 × 1080 with its title bar, at
 *   that screen's own scale (the owner declined switching a screen's mode for
 *   2×, 2026-10-29);
 * - the speech model is downloaded (the only download spec 023 allows), and
 *   kept in .local/capture/whisper for later runs;
 * - the panel widths are set as a user drags them, and the transcription
 *   backend and reviewer name as a user picks them in Settings;
 * - one import is answered with a stub, so the app remembers the project
 *   folder for its dialogs (Electron otherwise opens them in the operator's
 *   Downloads); the real Open and Save dialogs are shown once and set to list
 *   view with no sidebar, which they remember – the sidebar and the column
 *   view would show the operator's own folders;
 * - the screenshot's temporary folder is /tmp, so its path names no user.
 *
 * On camera, a finished import is closed with Escape and the file opened from
 * the tree: Done would also hand the file to the agent with the Organize
 * Import prompt, a conversation of its own that is not this story's.
 */

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { TEST_IDS, getDynamicTestId } from '../../../src/renderer/src/constants/testids'
import { HtmlPreviewPage } from '../../../e2e/pages/html-preview.page'
import { CommentChrome, clickElement, expectPin } from '../../../e2e/pages/html-preview.comments-ui'
import { commentPanels } from '../../../e2e/pages/html-preview.comments'
import { ProjectTreePage } from '../../../e2e/pages/project-tree.page'
import { speechModelProblem } from '../demo-story.mjs'
import { blurAll, launch, openProject, visible } from '../lib/app'
import { anySelected, clearToasts } from '../lib/shots'
import { ensureTerminalOpen, focusTerminal, installPtyRecorder, ptyLength, readPty, stopHookCount, waitForPty, waitForShellPrompt } from '../lib/terminal'
import { KEY, clickAt, deviceShowing, focusApp, movePointer, pressKey, startRecording, tidyOpenDialog, tidySaveDialog, typeKeys, waitForDialog, waitForDialogClosed, type Recorder } from '../lib/macos'

const ROWS = ['readme/demo-webp', 'readme/demo-still']

/** The window's content; with its 32 px title bar the window is 1920 × 1080. */
const CONTENT = { width: 1920, height: 1048 }
/**
 * Panel widths of 1920 (023-FR-002): tree ≈ 12.5 %, preview ≈ 50 %, terminal
 * ≈ 33 % (at least 80 columns). The two activity bars take the rest.
 */
const TREE_WIDTH = 240
const TERMINAL_WIDTH = 626

const PDF = 'inbox/seed-order.pdf'
const IMPORTED = 'import/seed-order.md'
const TRANSCRIPT = 'import/committee-voice-note.md'
const PAGE = 'site/index.html'
const PAGE_TITLE = 'Open day 2026 – Harbour Street Community Garden'
const AGENT_PROMPT = 'Tidy import/seed-order.md: a one-line summary on top, then the order as a Markdown table.'
const COMMENT = 'Make this button bigger on phones.'
const REVIEWER = 'Sam'

const REPO = path.resolve(__dirname, '..', '..', '..')
const WHISPER_CACHE = path.join(REPO, '.local', 'capture', 'whisper')

interface Span {
  from: number
  to: number
}

interface DemoLog {
  syncWall: number
  recording: string
  window: { width: number; height: number }
  steps: Array<{ id: string; start: number; end: number }>
  waits: Span[]
  results: Record<string, string>
  layout: Array<{ step: string; window: number; tree: number; preview: number; terminal: number; editorVisible: boolean }>
  columns: number
  editLatencyMs: number | null
  screenshot: { width: number; height: number; expected: { width: number; height: number } } | null
  terminalRect: { x: number; y: number; width: number; height: number }
  zoom: number
}

/** Wall-clock time once the current frame has been painted (two animation frames). */
async function painted(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(Date.now())))))
}

/** A pause for the viewer to take in what changed: real time, part of the video. */
const beat = (ms = 900): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Show (or hide) a full-window magenta cover; returns when it is painted. */
async function magenta(page: Page, on: boolean): Promise<number> {
  return page.evaluate(
    (show) =>
      new Promise<number>((resolve) => {
        const id = '__capture_sync'
        if (show) {
          const d = document.createElement('div')
          d.id = id
          d.style.cssText = 'position:fixed;inset:0;background:#ff00ff;z-index:2147483647'
          document.body.appendChild(d)
        } else document.getElementById(id)?.remove()
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(Date.now())))
      }),
    on
  )
}

/** The window's outer bounds (title bar included) and its main title. */
async function windowState(app: ElectronApplication): Promise<{ bounds: { x: number; y: number; width: number; height: number }; title: string }> {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    return { bounds: w.getBounds(), title: w.getTitle() }
  })
}

/** Speech model and binary in the sandbox's app data, from the cache or downloaded once. */
async function prepareSpeech(page: Page, userData: string): Promise<void> {
  const target = path.join(userData, 'whisper')
  if (fs.existsSync(WHISPER_CACHE)) fs.cpSync(WHISPER_CACHE, target, { recursive: true })
  const ok = await page.evaluate(async () => {
    const api = (window as unknown as { api: { whisper: { ensureBinary: () => Promise<unknown>; ensureModel: (m: string) => Promise<unknown>; listModels: () => Promise<unknown> } } }).api
    try {
      await api.whisper.ensureBinary()
      await api.whisper.ensureModel('tiny')
      return JSON.stringify(await api.whisper.listModels())
    } catch (e) {
      return `error: ${(e as Error).message}`
    }
  })
  const speech = speechModelProblem(ok)
  if (speech) throw new Error(speech)
  if (!fs.existsSync(WHISPER_CACHE)) {
    fs.mkdirSync(path.dirname(WHISPER_CACHE), { recursive: true })
    fs.cpSync(target, WHISPER_CACHE, { recursive: true })
  }
}

/** Set a global setting as Settings would. */
async function setSetting(page: Page, key: string, value: unknown): Promise<void> {
  await page.evaluate(
    ([k, v]) => (window as unknown as { api: { globalSettings: { set: (k: string, v: unknown) => Promise<unknown> } } }).api.globalSettings.set(k as string, v),
    [key, value] as const
  )
}

/** Panel widths as a user leaves them after dragging the sashes; the app reads them on load. */
async function setPanelWidths(page: Page): Promise<void> {
  await page.evaluate(
    ({ left, right }) => {
      const key = 'erfana-activity-bar-state'
      const saved = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":0}')
      saved.state = { ...saved.state, leftWidth: left, rightWidth: right }
      localStorage.setItem(key, JSON.stringify(saved))
    },
    { left: TREE_WIDTH, right: TERMINAL_WIDTH }
  )
  await page.reload()
  await expect(page.getByTestId(TEST_IDS.ACTIVITY_BAR).first()).toBeVisible({ timeout: 20_000 })
  await installPtyRecorder(page)
}

/**
 * Drag the two splitter bars until the tree and the terminal have their
 * widths, as a user would. The saved widths alone do not hold: the layout
 * shares out the space again when the terminal panel appears.
 */
async function dragPanelWidths(page: Page): Promise<void> {
  const box = async (id: string): Promise<{ x: number; width: number }> => {
    const b = await page.getByTestId(id).first().boundingBox()
    if (!b) throw new Error(`${id} has no box`)
    return b
  }
  const drag = async (atX: number, by: number): Promise<void> => {
    const sashes = await page.locator('.dv-sash').evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 300).map((r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 }))
    )
    const sash = sashes.sort((a, b) => Math.abs(a.x - atX) - Math.abs(b.x - atX))[0]
    if (!sash || Math.abs(sash.x - atX) > 12) throw new Error(`no splitter bar near x = ${Math.round(atX)}`)
    await page.mouse.move(sash.x, sash.y)
    await page.mouse.down()
    await page.mouse.move(sash.x + by / 2, sash.y, { steps: 5 })
    await page.mouse.move(sash.x + by, sash.y, { steps: 5 })
    await page.mouse.up()
  }
  await expect(async () => {
    const tree = await box(TEST_IDS.PROJECT_TREE)
    if (Math.abs(tree.width - TREE_WIDTH) > 4) await drag(tree.x + tree.width, TREE_WIDTH - tree.width)
    const term = await box(TEST_IDS.TERMINAL_PANEL)
    if (Math.abs(term.width - TERMINAL_WIDTH) > 4) await drag(term.x, term.width - TERMINAL_WIDTH)
    expect(Math.abs((await box(TEST_IDS.PROJECT_TREE)).width - TREE_WIDTH)).toBeLessThanOrEqual(4)
    expect(Math.abs((await box(TEST_IDS.TERMINAL_PANEL)).width - TERMINAL_WIDTH)).toBeLessThanOrEqual(4)
  }).toPass({ timeout: 20_000 })
}

/** Open a file from the tree, as a user would. */
async function openFromTree(page: Page, rel: string): Promise<void> {
  const tree = new ProjectTreePage(page)
  const parts = rel.split('/')
  await expect(async () => {
    await tree.expandTo(parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/')))
    await tree.fileRow(rel).click({ timeout: 5_000 })
  }).toPass({ timeout: 30_000 })
}

/** The widths of the three areas now, for 023-FR-002. */
async function measureLayout(page: Page, step: string): Promise<DemoLog['layout'][number]> {
  const width = async (l: ReturnType<Page['locator']>): Promise<number> => (await l.first().boundingBox())?.width ?? 0
  const preview = page.locator(`[data-testid="${TEST_IDS.EDITOR_PREVIEW}"], .html-preview-panel`).filter({ visible: true })
  return {
    step,
    window: CONTENT.width,
    tree: await width(page.getByTestId(TEST_IDS.PROJECT_TREE)),
    preview: (await preview.count()) ? await width(preview) : 0,
    terminal: await width(page.getByTestId(TEST_IDS.TERMINAL_PANEL)),
    editorVisible: (await visible(page, TEST_IDS.EDITOR_MONACO).count()) > 0
  }
}

/** Type into the terminal at a reader's pace, without Enter. */
async function typeSlowly(page: Page, text: string, delay = 35): Promise<void> {
  await focusTerminal(page)
  await page.keyboard.type(text, { delay })
}

test('readme-demo', async () => {
  test.skip(!anySelected(ROWS), 'no row of this scene selected')
  test.setTimeout(30 * 60_000)
  const cap = await launch({ scale: 1, size: CONTENT, onLargeScreen: true, extraEnv: { TMPDIR: '/tmp/', ERFANA_E2E_TEST_HOOKS: '1' } })
  const { app, page, sandbox: sb } = cap
  const log: DemoLog = {
    syncWall: 0,
    recording: path.join(sb.root, 'video', 'readme-demo.mkv'),
    window: { width: 0, height: 0 },
    steps: [],
    waits: [],
    results: {},
    layout: [],
    columns: 0,
    zoom: 0,
    editLatencyMs: null,
    screenshot: null,
    terminalRect: { x: 0, y: 0, width: 0, height: 0 }
  }
  let recorder: Recorder | null = null
  const step = async (id: string, body: () => Promise<string>): Promise<void> => {
    const start = await painted(page)
    log.results[id] = await body()
    log.steps.push({ id, start, end: await painted(page) })
    if (id !== 'open') log.layout.push(await measureLayout(page, id))
  }
  const wait = async (body: () => Promise<void>): Promise<void> => {
    const from = Date.now()
    await body()
    log.waits.push({ from, to: Date.now() })
  }
  try {
    // ---- Off camera ----
    await setSetting(page, 'transcription', { backend: 'local', openaiApiKeyStored: false, whisperModel: 'tiny' })
    await setSetting(page, 'comments', { authorName: REVIEWER, identityNoticeSeen: true })
    await prepareSpeech(page, sb.userData)
    await setPanelWidths(page)

    await openProject(cap)
    await dragPanelWidths(page)
    const tree = page.getByTestId(TEST_IDS.PROJECT_TREE)
    // The terminal's width in columns, while only the shell runs.
    let from = await ptyLength(page)
    await focusTerminal(page)
    await page.keyboard.type('tput cols')
    await page.keyboard.press('Enter')
    await waitForShellPrompt(page, { from })
    log.columns = Number(/(\d+)\s*[\r\n]/.exec((await readPty(page)).slice(from).replace(/tput cols/, ''))?.[1] ?? 0)

    // The app remembers the project folder for its dialogs: one import, answered by a stub.
    await app.evaluate(({ dialog }, file) => {
      const g = globalThis as unknown as { __captureRealOpen?: typeof dialog.showOpenDialog }
      g.__captureRealOpen = dialog.showOpenDialog
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
    }, path.join(sb.project, ...PDF.split('/')))
    await page.getByTestId(TEST_IDS.PROJECT_TREE_BTN_IMPORT).click()
    await expect(page.getByTestId(TEST_IDS.DOCUMENT_IMPORT_DIALOG)).toBeVisible({ timeout: 20_000 })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId(TEST_IDS.DOCUMENT_IMPORT_DIALOG)).toHaveCount(0)
    await app.evaluate(({ dialog }) => {
      const g = globalThis as unknown as { __captureRealOpen?: typeof dialog.showOpenDialog }
      if (g.__captureRealOpen) dialog.showOpenDialog = g.__captureRealOpen
    })
    // The real dialogs, once each: list view, no sidebar.
    let { title: mainTitle } = await windowState(app)
    await focusApp(app)
    await page.getByTestId(TEST_IDS.PROJECT_TREE_BTN_IMPORT).click()
    await waitForDialog(mainTitle)
    await tidyOpenDialog()
    pressKey(KEY.ESCAPE)
    await waitForDialogClosed(mainTitle)
    await openFromTree(page, 'handbook/compost-guide.md')
    await expect(visible(page, TEST_IDS.MARKDOWN_TOOLBAR)).toBeVisible({ timeout: 15_000 })
    await focusApp(app)
    await visible(page, TEST_IDS.TOOLBAR_BTN_EXPORT_PDF).click()
    await waitForDialog(mainTitle)
    await tidySaveDialog()
    pressKey(KEY.ESCAPE)
    await waitForDialogClosed(mainTitle)
    await page.getByRole('button', { name: 'Close compost-guide.md' }).first().click()

    // The project becomes the only Recent projects entry; the story opens it from there.
    // The `tput cols` above counts as recent terminal activity, so the app asks first.
    await page.getByTestId(TEST_IDS.PROJECT_TREE_BTN_CLOSE).click()
    await page.getByRole('button', { name: 'Close Anyway' }).click({ timeout: 10_000 })
    await expect(page.getByTestId(TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL)).toHaveCount(0, { timeout: 20_000 })
    const recent = page.getByTestId(getDynamicTestId(TEST_IDS.WELCOME_RECENT_PROJECT, sb.project))
    await expect(recent).toBeVisible()
    await clearToasts(page)
    await blurAll(page)

    // Which screen input shows the window, then record its area.
    const { bounds } = await windowState(app)
    const place = cap.placement
    if (!place) throw new Error('the window was not placed on a screen')
    const k = place.scaleFactor
    const rect = {
      x: Math.round((bounds.x - place.bounds.x) * k),
      y: Math.round((bounds.y - place.bounds.y) * k),
      width: Math.round(bounds.width * k),
      height: Math.round(bounds.height * k)
    }
    log.window = { width: rect.width, height: rect.height }
    log.zoom = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())
    // The pointer waits below the window, in the screen's corner, until the window picker needs it.
    const parkPointer = (): void => movePointer(place.bounds.x + 8, place.bounds.y + place.bounds.height - 8)
    parkPointer()
    await magenta(page, true)
    let device: number
    try {
      device = await deviceShowing({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
    } catch (e) {
      throw new Error(`${(e as Error).message} (window ${JSON.stringify(bounds)} on display ${JSON.stringify(place)})`)
    }
    await magenta(page, false)
    fs.mkdirSync(path.dirname(log.recording), { recursive: true })
    recorder = await startRecording(device, rect, log.recording)
    await beat(500)
    log.syncWall = await magenta(page, true)
    await beat(350)
    await magenta(page, false)
    await beat(600)

    // ---- On camera: the nine steps (023-FR-001) ----
    await step('open', async () => {
      from = await ptyLength(page)
      await recent.click()
      await expect(tree).toBeVisible({ timeout: 20_000 })
      await ensureTerminalOpen(page)
      // Reopening shares the space out again; the splitter bars go back where they were.
      await dragPanelWidths(page)
      await waitForShellPrompt(page, { from })
      await expect(new ProjectTreePage(page).fileRow('README.md')).toBeVisible()
      // A document in the preview from step 2 on (023-FR-002).
      await openFromTree(page, 'README.md')
      await expect(visible(page, TEST_IDS.EDITOR_PREVIEW)).toBeVisible({ timeout: 15_000 })
      await beat(1200)
      return 'the tree lists the project; its README is in the preview'
    })

    await step('agent', async () => {
      from = await ptyLength(page)
      await typeSlowly(page, 'claude', 110)
      await beat(300)
      await wait(async () => {
        await page.keyboard.press('Enter')
        await waitForPty(page, ['accept edits on', '? for shortcuts'], { from, timeout: 90_000 })
      })
      await beat(1500)
      return 'Claude Code is at its prompt'
    })

    await step('import', async () => {
      ;({ title: mainTitle } = await windowState(app))
      await focusApp(app)
      await page.getByTestId(TEST_IDS.PROJECT_TREE_BTN_IMPORT).click()
      await waitForDialog(mainTitle)
      await beat(900)
      typeKeys('seed-order')
      await beat(700)
      pressKey(KEY.RETURN)
      const dialog = page.getByTestId(TEST_IDS.DOCUMENT_IMPORT_DIALOG)
      await expect(dialog).toBeVisible({ timeout: 20_000 })
      await beat(1000)
      await wait(async () => {
        await page.getByTestId(TEST_IDS.DOCUMENT_IMPORT_BTN_START).click()
        await expect(page.getByTestId(TEST_IDS.DOCUMENT_IMPORT_BTN_DONE)).toBeVisible({ timeout: 120_000 })
      })
      await beat(800)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await openFromTree(page, IMPORTED)
      await expect(visible(page, TEST_IDS.EDITOR_PREVIEW)).toBeVisible({ timeout: 15_000 })
      await beat(1200)
      return `${IMPORTED} is in the tree and open in the preview`
    })

    await step('edit', async () => {
      const file = path.join(sb.project, ...IMPORTED.split('/'))
      // When the table lands in the file: polled, as the agent may write by rename.
      let writtenAt = 0
      const poll = setInterval(() => {
        if (!writtenAt && /\n\|[ :-]*-{3}/.test(fs.readFileSync(file, 'utf8'))) writtenAt = Date.now()
      }, 50)
      const turns = stopHookCount(sb.stopLog)
      from = await ptyLength(page)
      await typeSlowly(page, AGENT_PROMPT, 22)
      await beat(400)
      const preview = visible(page, TEST_IDS.EDITOR_PREVIEW)
      await wait(async () => {
        await page.keyboard.press('Enter')
        // The preview shows the table: measured from the write before it, in real time (023-FR-004).
        // Not the front matter, which the preview also draws as a table.
        await expect(preview.locator('table', { hasText: 'Variety' }).first()).toBeVisible({ timeout: 5 * 60_000 })
        log.editLatencyMs = writtenAt ? Date.now() - writtenAt : null
        await expect.poll(() => stopHookCount(sb.stopLog), { timeout: 5 * 60_000, intervals: [100] }).toBeGreaterThan(turns)
      })
      clearInterval(poll)
      if (!fs.readFileSync(file, 'utf8').includes('|')) throw new Error(`the agent did not write a table into ${IMPORTED}`)
      expect(await readPty(page).then((p) => p.slice(from).includes('Do you want to'))).toBe(false)
      await blurAll(page)
      await beat(2000)
      return 'the preview shows the table the agent wrote'
    })

    await step('transcribe', async () => {
      ;({ title: mainTitle } = await windowState(app))
      await focusApp(app)
      await page.getByTestId(TEST_IDS.PROJECT_TREE_BTN_IMPORT).click()
      await waitForDialog(mainTitle)
      await beat(700)
      // The dialog opens in inbox/ (the last folder); up one, into recordings/.
      pressKey(KEY.UP, ['command'])
      await beat(600)
      typeKeys('recordings')
      await beat(400)
      pressKey(KEY.DOWN, ['command'])
      await beat(600)
      typeKeys('committee')
      await beat(600)
      pressKey(KEY.RETURN)
      const dialog = page.getByTestId(TEST_IDS.TRANSCRIPTION_DIALOG)
      await expect(dialog).toBeVisible({ timeout: 20_000 })
      await beat(1000)
      await wait(async () => {
        await page.getByTestId(TEST_IDS.TRANSCRIPTION_BTN_START).click()
        await expect(dialog.getByText('Transcription complete')).toBeVisible({ timeout: 5 * 60_000 })
      })
      await beat(1000)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await openFromTree(page, TRANSCRIPT)
      await expect(visible(page, TEST_IDS.EDITOR_PREVIEW)).toBeVisible({ timeout: 15_000 })
      await beat(1500)
      return `Transcription complete; ${TRANSCRIPT} is open`
    })

    const preview = new HtmlPreviewPage(page, app)
    const target = HtmlPreviewPage.target(PAGE)
    let panelId = ''
    await step('html', async () => {
      await preview.open(PAGE)
      await expect.poll(async () => (await preview.snapshot(target))?.docTitle, { timeout: 30_000 }).toBe(PAGE_TITLE)
      await expect
        .poll(async () => {
          const panels = await commentPanels(app)
          panelId = panels.length === 1 ? panels[0].panelId : ''
          return panelId
        }, { timeout: 20_000 })
        .not.toBe('')
      await beat(1500)
      return `${PAGE} renders in the HTML preview`
    })

    await step('comment', async () => {
      const chrome = new CommentChrome(page, preview, 'index.html')
      await chrome.modeOn(app, panelId, target)
      await beat(900)
      await clickElement(app, 'toggle-hours', 'left', target)
      const win = chrome.window()
      await expect(win).toHaveAttribute('data-view', 'new', { timeout: 20_000 })
      await beat(600)
      await page.getByTestId('comment-new-field').click()
      await page.keyboard.type(COMMENT, { delay: 30 })
      await beat(500)
      await page.getByTestId('comment-save').click()
      await expect(win).toHaveCount(0, { timeout: 20_000 })
      await expectPin(app, 'toggle-hours', true, target)
      await beat(1500)
      return 'a pin marks the commented button'
    })

    await step('export', async () => {
      await page.locator('.dv-tab', { hasText: 'seed-order.md' }).first().click()
      await expect(visible(page, TEST_IDS.MARKDOWN_TOOLBAR)).toBeVisible({ timeout: 15_000 })
      await expect(visible(page, TEST_IDS.EDITOR_PREVIEW)).toBeVisible()
      await beat(900)
      ;({ title: mainTitle } = await windowState(app))
      await focusApp(app)
      await visible(page, TEST_IDS.TOOLBAR_BTN_EXPORT_PDF).click()
      await waitForDialog(mainTitle)
      await beat(1200)
      await wait(async () => {
        pressKey(KEY.RETURN)
        await expect(page.getByText('PDF exported').first()).toBeVisible({ timeout: 60_000 })
      })
      await beat(1500)
      return 'PDF exported'
    })

    await step('screenshot', async () => {
      from = await ptyLength(page)
      const { bounds: b } = await windowState(app)
      await visible(page, TEST_IDS.TERMINAL_BTN_CAPTURE_WINDOW).click()
      await beat(1000)
      await wait(async () => {
        clickAt(b.x + b.width / 2, b.y + b.height / 2)
        await waitForPty(page, 'erfana-screenshot', { from, timeout: 30_000 })
      })
      parkPointer()
      const shotPath = /\/tmp\/erfana-screenshot-\d+\.png/.exec((await readPty(page)).slice(from).replace(/\s+/g, ''))?.[0]
      if (shotPath && fs.existsSync(shotPath)) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const meta = await require('sharp')(shotPath).metadata()
        log.screenshot = { width: meta.width, height: meta.height, expected: { width: Math.round(b.width * k), height: Math.round(b.height * k) } }
      }
      const box = await page.getByTestId(TEST_IDS.TERMINAL_INSTANCE).boundingBox()
      if (box) log.terminalRect = { x: box.x * k, y: (box.y + (bounds.height - CONTENT.height)) * k, width: box.width * k, height: box.height * k }
      await beat(2200)
      return `the screenshot's path is in the terminal`
    })
  } finally {
    await recorder?.stop()
    const dom = await page.evaluate(() => document.body.innerText).catch(() => '')
    fs.writeFileSync(path.join(sb.raw, 'readme-demo.dom.txt'), dom)
    fs.writeFileSync(path.join(sb.raw, 'readme-demo.pty.txt'), await readPty(page).catch(() => ''))
    fs.writeFileSync(path.join(sb.raw, 'readme-demo.json'), `${JSON.stringify(log, null, 2)}\n`)
    await cap.close()
  }
})
