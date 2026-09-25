// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Launch Erfana for a capture scene: the `visualTest` launch helpers (so the
 * app starts the way the visual-regression suite starts it), a 2× device
 * scale, a 1280×800 content area, and an environment reduced to the sandbox.
 *
 * The environment is built, not inherited: `HOME` is the sandbox home (which
 * also isolates `~/.erfana` and the context meter's `~/.claude`), and nothing
 * of the operator's own Claude Code configuration reaches the app. `SHELL`
 * is required, or the terminal never starts (spike Q4).
 */

import { _electron as electron, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildVisualLaunchOptions, forceCloseApp, resizeBrowserWindow } from '../../../e2e/fixtures/launch-helpers'
import { TEST_IDS } from '../../../src/renderer/src/constants/testids'
import { ProjectTreePage } from '../../../e2e/pages/project-tree.page'
import type { ViewMode } from '../../../e2e/pages/editor-panel.page'
import { installPtyRecorder, ensureTerminalOpen, waitForShellPrompt } from './terminal'

export const WIDTH = 1280
export const HEIGHT = 800
export const SCALE = 2

/** The sandbox's paths, as `run.mjs` prepared them (sandbox.mjs `layout`). */
export interface Sandbox {
  root: string
  home: string
  project: string
  userData: string
  raw: string
  marks: string
  stopLog: string
}

export interface Capture {
  app: ElectronApplication
  page: Page
  sandbox: Sandbox
  close: () => Promise<void>
}

export interface LaunchOptions {
  /** Recreate the sandbox project from the fixture first (default true). */
  resetProject?: boolean
  /** Extra Chromium switches (row 45 adds the fake camera). */
  extraArgs?: string[]
  /** Extra environment for Electron (row 52 adds the crash hook). */
  extraEnv?: Record<string, string>
  /** Record the window with Playwright's `recordVideo` into this folder. */
  recordVideoDir?: string
  /**
   * Capture-only Electron zoom factor (the README demo's terminal legibility,
   * design § Loop for #139). Set after launch and reset before the app
   * closes; the app's own defaults are untouched.
   */
  zoom?: number
  /** Test id that proves the window is up (default: the activity bar). */
  readyTestId?: string
}

export function sandbox(): Sandbox {
  const raw = process.env.ERFANA_CAPTURE_LAYOUT
  if (!raw) throw new Error('ERFANA_CAPTURE_LAYOUT is not set: run the capture through `npm run docs:screenshots`.')
  return JSON.parse(raw) as Sandbox
}

/** Recreate the sandbox project from the fixture (sandbox.mjs `resetProject`). */
export function resetProject(sb: Sandbox): void {
  execFileSync(process.execPath, [path.join(__dirname, '..', 'sandbox.mjs'), 'reset'], {
    env: { ...process.env, ERFANA_CAPTURE_SANDBOX: sb.root },
    stdio: 'inherit'
  })
}

/** The environment Electron gets: the sandbox, nothing personal. */
export function electronEnv(sb: Sandbox, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {
    HOME: sb.home,
    SHELL: '/bin/zsh',
    USER: os.userInfo().username,
    LOGNAME: os.userInfo().username,
    TMPDIR: os.tmpdir(),
    LANG: 'en_US.UTF-8',
    PATH: `${path.join(sb.home, '.local', 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`,
    NODE_ENV: 'development'
  }
  if (process.env.ERFANA_CAPTURE_CLAUDE_TOKEN_FILE) env.ERFANA_CAPTURE_CLAUDE_TOKEN_FILE = process.env.ERFANA_CAPTURE_CLAUDE_TOKEN_FILE
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  return { ...env, ...extra }
}

/** Launch the app for a scene, sized and ready at the start screen. */
export async function launch(opts: LaunchOptions = {}): Promise<Capture> {
  const sb = sandbox()
  if (opts.resetProject !== false) resetProject(sb)
  // A fresh app profile per scene: panel widths, the tree filter, recent
  // projects and window state persist in these folders, and one scene's
  // choices must not leak into the next one's pictures.
  for (const dir of [sb.userData, path.join(sb.home, '.erfana')]) {
    if (!dir.startsWith(sb.root + path.sep)) throw new Error(`refusing to reset ${dir}: outside the sandbox`)
    fs.rmSync(dir, { recursive: true, force: true })
  }
  fs.mkdirSync(sb.userData, { recursive: true })
  const base = buildVisualLaunchOptions(sb.userData)
  const args = base.args.map((a) => (a.startsWith('--force-device-scale-factor=') ? `--force-device-scale-factor=${SCALE}` : a))
  args.push('--force-color-profile=srgb', '--force-prefers-reduced-motion', ...(opts.extraArgs ?? []))
  const app = await electron.launch({
    args,
    env: electronEnv(sb, opts.extraEnv),
    ...(opts.recordVideoDir ? { recordVideo: { dir: opts.recordVideoDir, size: { width: WIDTH, height: HEIGHT } } } : {})
  })
  let closed = false
  const zoom = opts.zoom ?? 1
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    // Chromium keeps a zoom level per origin in the profile, and later scenes
    // share this user-data folder: put it back first.
    if (zoom !== 1) {
      await app
        .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1))
        .catch(() => undefined)
    }
    await forceCloseApp(app)
  }
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId(opts.readyTestId ?? TEST_IDS.ACTIVITY_BAR).first()).toBeVisible({ timeout: 20_000 })
    await resizeBrowserWindow(app, WIDTH, HEIGHT)
    if (zoom !== 1) {
      await app.evaluate(({ BrowserWindow }, z) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(z), zoom)
      // Reload so the layout is built for the zoomed viewport from the start.
      await page.reload()
      await expect(page.getByTestId(TEST_IDS.ACTIVITY_BAR)).toBeVisible({ timeout: 20_000 })
    }
    await installPtyRecorder(page)
    await page.waitForFunction(
      ({ w, h }) => Math.abs(window.innerWidth - w) <= 1 && Math.abs(window.innerHeight - h) <= 1,
      { w: WIDTH / zoom, h: HEIGHT / zoom }
    )
    return { app, page, sandbox: sb, close }
  } catch (e) {
    await close()
    throw e
  }
}

/**
 * Open the sandbox project the way the e2e suite does (the preload bridge,
 * never the native folder dialog), then wait for the tree and for the
 * terminal's shell prompt.
 */
export async function openProject(cap: Capture, { waitForShell = true } = {}): Promise<void> {
  const { page, sandbox: sb } = cap
  await page.evaluate((p) => (window as unknown as { api: { file: { openProjectByPath: (p: string) => Promise<string> } } }).api.file.openProjectByPath(p), sb.project)
  await expect(page.getByTestId(TEST_IDS.PROJECT_TREE)).toBeVisible({ timeout: 20_000 })
  if (waitForShell) {
    await ensureTerminalOpen(page)
    await waitForShellPrompt(page)
  }
}

/**
 * Close the project with the project panel's own Close button, as a user
 * would; the app returns to its start screen with the project in Recent
 * projects.
 */
export async function closeProject(cap: Capture): Promise<void> {
  const { page } = cap
  await page.getByTestId(TEST_IDS.PROJECT_TREE_BTN_CLOSE).click()
  await expect(page.getByTestId(TEST_IDS.WELCOME_RECENT_PROJECTS)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId(TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL)).toHaveCount(0, { timeout: 20_000 })
}

/** Move focus off every input so no caret or terminal cursor blinks. */
export async function blurAll(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
}

/** The visible one of several mounted elements (dockview keeps every tab mounted). */
export function visible(page: Page, testId: string): Locator {
  return page.getByTestId(testId).filter({ visible: true })
}

/**
 * Open a project file from the tree, as a user would: expand its folders,
 * click it, and wait for its panel. A Markdown file opens in Preview; pass a
 * view mode to switch.
 */
export async function openFile(cap: Capture, rel: string, mode?: ViewMode): Promise<void> {
  const { page } = cap
  const tree = new ProjectTreePage(page)
  // A folded project panel is opened for the click and folded again after.
  const treeEl = page.getByTestId(TEST_IDS.PROJECT_TREE)
  const folded = !(await treeEl.isVisible())
  const toggle = async (): Promise<void> => {
    await page.getByTestId(TEST_IDS.ACTIVITY_BAR_BTN_FILES).first().click()
  }
  if (folded) {
    await toggle()
    await expect(treeEl).toBeVisible()
  }
  const parts = rel.split('/')
  // The tree re-renders when the file watcher reports a change, so the
  // expand-and-click is retried as a whole.
  await expect(async () => {
    await tree.expandTo(parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/')))
    await tree.fileRow(rel).click({ timeout: 5_000 })
  }).toPass({ timeout: 30_000 })
  if (folded) {
    await toggle()
    await expect(treeEl).toBeHidden()
  }
  if (rel.endsWith('.md')) {
    await expect(visible(page, TEST_IDS.MARKDOWN_TOOLBAR)).toBeVisible({ timeout: 15_000 })
    if (mode) await setViewMode(page, mode)
  }
}

const VIEW_MODE_IDS: Record<ViewMode, string> = {
  editor: TEST_IDS.VIEW_MODE_BTN_EDITOR,
  preview: TEST_IDS.VIEW_MODE_BTN_PREVIEW,
  split: TEST_IDS.VIEW_MODE_BTN_SPLIT,
  'split-horizontal': TEST_IDS.VIEW_MODE_BTN_SPLIT_HORIZONTAL
}

/** Switch the active Markdown panel's view mode and wait for its panes. */
export async function setViewMode(page: Page, mode: ViewMode): Promise<void> {
  await visible(page, VIEW_MODE_IDS[mode]).click()
  const editor = visible(page, TEST_IDS.EDITOR_MONACO)
  const preview = visible(page, TEST_IDS.EDITOR_PREVIEW)
  if (mode !== 'preview') await expect(editor).toBeVisible({ timeout: 15_000 })
  if (mode !== 'editor') await expect(preview).toBeVisible({ timeout: 15_000 })
  if (mode !== 'preview') await expect(editor.locator('.view-lines')).toBeVisible({ timeout: 15_000 })
}

/**
 * Select text in the visible Monaco editor with the mouse: from the start of
 * the (visual) line holding `start` to the end of the line holding `end`.
 */
export async function selectInEditor(page: Page, start: RegExp, end: RegExp): Promise<Locator> {
  const editor = visible(page, TEST_IDS.EDITOR_MONACO)
  const first = editor.locator('.view-line', { hasText: start }).first()
  const last = editor.locator('.view-line', { hasText: end }).last()
  await first.click({ position: { x: 1, y: 4 } })
  // The line's text span, not the full-width line: its right edge can sit
  // under the editor's scrollbar.
  const text = last.locator('span').first()
  const box = await text.boundingBox()
  if (!box) throw new Error('selection end line is not visible')
  await text.click({ position: { x: box.width - 1, y: box.height / 2 }, modifiers: ['Shift'] })
  await expect(editor.locator('.selected-text').first()).toBeVisible()
  return first
}

/**
 * Answer the next native Open dialog with this file, without showing it. The
 * native dialog would show the operator's own folders, so it is never opened.
 */
export async function stubOpenDialog(cap: Capture, file: string): Promise<void> {
  await cap.app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as typeof dialog.showOpenDialog
  }, file)
}
