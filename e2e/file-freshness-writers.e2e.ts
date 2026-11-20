// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * #478 writers × tab type (plan § 5.3, § 5.6 C3, C5, L5): every way a real tool
 * changes a file reaches the tab that shows it.
 *
 * | Tab                 | Visible                                                       | Hidden (shown again) |
 * |---------------------|---------------------------------------------------------------|----------------------|
 * | Editor              | in place, temp + rename, stream, copy keeping mtime, `git checkout`, appender | in place, temp + rename, copy keeping mtime |
 * | Image viewer        | in place, temp + rename, stream, copy keeping mtime            | in place, temp + rename |
 * | HTML preview        | in place, temp + rename; its CSS, script and image (C3); a save from its source tab (L5) | – (an in-process owner: it follows while hidden, see deleted-tab-recover) |
 *
 * Each writer leaves a unique marker; the test waits for that marker in the
 * tab (condition-based waits only). Writers live in `utils/freshness-writers.ts`.
 */
import { mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { removeDirWithRetry } from './fixtures/isolation'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { MonacoPage } from './pages/monaco.page'
import { KeyboardHelper } from './pages/keyboard.helper'
import { ImageViewerPage } from './pages/image-viewer.page'
import { HtmlPreviewPage } from './pages/html-preview.page'
import { FileFreshnessPage } from './pages/file-freshness.page'
import { runGit } from './utils/git-helpers'
import {
  copyKeepingMtime,
  gitCheckout,
  startAppender,
  writeInPlace,
  writeStream,
  writeTempRename
} from './utils/freshness-writers'

/** One outside write reaching a tab (the P1 gate is ~0.25 s; this is the functional bound). */
const SHOW_BUDGET_MS = 10_000
/** Stream chunks and their pacing. */
const STREAM_CHUNKS = 5
const STREAM_GAP_MS = 20
/** How long the appender appends, and how often. */
const APPEND_FOR_MS = 2_000
const APPEND_EVERY_MS = 50

/** Markdown with a marker line. */
function doc(marker: string): string {
  return `# Doc\n\n${marker}\n`
}

/** An SVG carrying `marker` in `data-marker`, `width` px wide. */
function svg(marker: string, width = 64): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" data-marker="${marker}" width="${width}" height="64" viewBox="0 0 64 64">` +
    '<rect width="64" height="64" fill="#1f1f1f"/></svg>\n'
  )
}

/** A page titled `marker`, styled by `style.css`, scripted by `app.js`, showing `pic.svg`. */
function html(marker: string): string {
  return (
    `<!doctype html><html><head><title>${marker}</title><link rel="stylesheet" href="style.css">` +
    '<script src="app.js"></script></head>' +
    `<body><p>${marker}</p><img id="pic" src="pic.svg"></body></html>\n`
  )
}

test.use({
  testProjectFiles: {
    'a.md': doc('start-a'),
    'b.md': doc('start-b'),
    'pic.svg': svg('start', 10),
    'other.svg': svg('other'),
    'page.html': html('page-start'),
    'style.css': 'body { --version: "css-start"; }\n',
    'app.js': 'window.appVersion = "js-start"\n'
  }
})

/** Opens a project-relative file from the tree and waits for its tab. */
async function openFile(page: Page, name: string): Promise<void> {
  await new ProjectTreePage(page).fileRow(name).click()
  await new TabBarPage(page).waitForTab(name)
}

/** A folder outside the project for a copy's source file. */
async function scratchDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'erfana-478-writers-'))
}

/** Every writer of the editor rows, each leaving `marker`. */
type Writer = (file: string, marker: string) => Promise<void>

/** The writers every tab type follows; `content` builds the file's text for a marker. */
function writers(content: (marker: string) => string, scratch: string): Record<string, Writer> {
  return {
    'in place': (file, marker) => writeInPlace(file, content(marker)),
    'temp + rename': (file, marker) => writeTempRename(file, content(marker)),
    stream: async (file, marker) => {
      const text = content(marker)
      const size = Math.ceil(text.length / STREAM_CHUNKS)
      const parts = Array.from({ length: STREAM_CHUNKS }, (_, i) => text.slice(i * size, (i + 1) * size))
      await writeStream(file, parts, STREAM_GAP_MS)
    },
    'copy keeping mtime': async (file, marker) => {
      const source = join(scratch, `${marker}.src`)
      await writeFile(source, content(marker))
      await copyKeepingMtime(source, file)
    }
  }
}

test.describe('#478 writers: an editor tab', () => {
  test('visible: every writer, git checkout and an appender reach it', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const fresh = new FileFreshnessPage(page, app)
    const file = join(testProject.path, 'a.md')
    const scratch = await scratchDir()
    try {
      await openFile(page, 'a.md')
      await fresh.waitForContent('start-a')
      for (const [name, write] of Object.entries(writers(doc, scratch))) {
        const marker = `edv-${name.replace(/\W+/g, '-')}`
        await write(file, marker)
        await fresh.waitForContent(marker, SHOW_BUDGET_MS, `editor (visible) never showed the ${name} write`)
      }

      // git checkout: commit one version, change it, check the commit out again
      runGit(testProject.path, 'init', '-q')
      await writeInPlace(file, doc('edv-committed'))
      await fresh.waitForContent('edv-committed', SHOW_BUDGET_MS)
      runGit(testProject.path, 'add', 'a.md')
      runGit(testProject.path, '-c', 'user.email=e2e@example.invalid', '-c', 'user.name=e2e', 'commit', '-q', '-m', 'v')
      await writeInPlace(file, doc('edv-worktree'))
      await fresh.waitForContent('edv-worktree', SHOW_BUDGET_MS)
      gitCheckout(testProject.path, 'a.md')
      await expect(fresh.contentWith('edv-worktree')).toHaveCount(0, { timeout: SHOW_BUDGET_MS })
      await fresh.waitForContent('edv-committed', SHOW_BUDGET_MS, 'editor never showed the git checkout')

      // An agent appending a line every 50 ms: the last line shows
      const lines = await startAppender(file, APPEND_EVERY_MS, APPEND_FOR_MS, 'edv-append').done
      await fresh.waitForContent(lines[lines.length - 1], SHOW_BUDGET_MS, 'editor never showed the last appended line')
    } finally {
      await removeDirWithRetry(scratch)
    }
  })

  test('hidden behind another tab: shown when switched back to', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const fresh = new FileFreshnessPage(page, app)
    const tabs = new TabBarPage(page)
    const file = join(testProject.path, 'a.md')
    const scratch = await scratchDir()
    try {
      await openFile(page, 'a.md')
      await openFile(page, 'b.md')
      const all = writers(doc, scratch)
      for (const name of ['in place', 'temp + rename', 'copy keeping mtime']) {
        const marker = `edh-${name.replace(/\W+/g, '-')}`
        await tabs.activate('b.md')
        await all[name](file, marker)
        await tabs.activate('a.md')
        await fresh.waitForContent(marker, SHOW_BUDGET_MS, `editor (hidden) never showed the ${name} write`)
      }
    } finally {
      await removeDirWithRetry(scratch)
    }
  })
})

test.describe('#478 writers: an image tab', () => {
  test('visible: every writer reaches it', async ({ windowWithTestProject: page, testProject }) => {
    const viewer = new ImageViewerPage(page, SHOW_BUDGET_MS)
    const file = join(testProject.path, 'pic.svg')
    const scratch = await scratchDir()
    try {
      await viewer.openFromTree('pic.svg')
      for (const [name, write] of Object.entries(writers((m) => svg(m), scratch))) {
        const marker = `imv-${name.replace(/\W+/g, '-')}`
        await write(file, marker)
        await viewer.waitForMarker(marker)
      }
      await viewer.expectNoBanner()
    } finally {
      await removeDirWithRetry(scratch)
    }
  })

  test('hidden behind another tab: shown when switched back to', async ({ windowWithTestProject: page, testProject }) => {
    const viewer = new ImageViewerPage(page, SHOW_BUDGET_MS)
    const file = join(testProject.path, 'pic.svg')
    const scratch = await scratchDir()
    try {
      await viewer.openFromTree('pic.svg')
      await viewer.openFromTree('other.svg')
      const all = writers((m) => svg(m), scratch)
      for (const name of ['in place', 'temp + rename']) {
        const marker = `imh-${name.replace(/\W+/g, '-')}`
        // Image tabs are dockview's own tabs: brought forward through the tree
        await viewer.openFromTree('other.svg')
        await viewer.waitForMarker('other')
        await all[name](file, marker)
        await viewer.openFromTree('pic.svg')
        await viewer.waitForMarker(marker)
      }
    } finally {
      await removeDirWithRetry(scratch)
    }
  })
})

test.describe('#478 writers: an HTML preview tab', () => {
  test('its page, stylesheet, script and image reach it; so does a save from its source tab (C3, L5)', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const preview = new HtmlPreviewPage(page, app)
    const at = (name: string): string => join(testProject.path, name)
    const evalUntil = async (expr: string, expected: string, what: string): Promise<void> => {
      await expect
        .poll(async () => preview.eval(expr), { timeout: SHOW_BUDGET_MS, message: `the HTML preview never showed ${what}` })
        .toBe(expected)
    }
    await preview.open('page.html')
    await preview.waitForTitled('page-start')

    await writeInPlace(at('page.html'), html('page-in-place'))
    await preview.waitForTitled('page-in-place')
    await writeTempRename(at('page.html'), html('page-renamed'))
    await preview.waitForTitled('page-renamed')

    await writeInPlace(at('style.css'), 'body { --version: "css-new"; }\n')
    await evalUntil(`getComputedStyle(document.body).getPropertyValue('--version').trim()`, '"css-new"', 'its new stylesheet')
    await writeTempRename(at('app.js'), 'window.appVersion = "js-new"\n')
    await evalUntil('String(window.appVersion)', 'js-new', 'its new script')
    await writeInPlace(at('pic.svg'), svg('pic-new', 20))
    await evalUntil(`String(document.getElementById('pic').naturalWidth)`, '20', 'its new image')

    // L5: a save from the page's own source tab reloads the preview; the source tab has no conflict
    const tree = new ProjectTreePage(page)
    await tree.runContextMenuAction(tree.fileRow('page.html'), 'Open as source')
    const monaco = new MonacoPage(page, new KeyboardHelper(page))
    await monaco.waitForReady()
    await monaco.setContent(html('page-saved-from-source'))
    await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+KeyS`)
    await preview.waitForTitled('page-saved-from-source')
    await expect(new EditorPanelPage(page).conflictNotification()).toHaveCount(0)
    await expect(new FileFreshnessPage(page, app).conflictNotice()).toHaveCount(0)
  })
})
