// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Gap tests for #478 against the real app (plan steps S0 and S20, T1).
 *
 * At S0 each test stated the correct behaviour inside `expectGap(…, /<symptom>/)`
 * and passed only because the gap reproduced, with that symptom (evidence:
 * the S0 record on #478). Each step that closed a gap turned its test into
 * the plain assertion below – that conversion is the T1 proof: G1, G2, G8
 * and G9 (S10, S11), G6 (the real-path watch key, S9), G5 (the editor on the
 * shared tracker, S14). G4 did not reproduce at S0 and is a plain regression
 * test. G9 also asserts the watch-limit notice a waiting tab shows (owner
 * decision: never a silent queue). S20 added the closing-watch race. G7
 * (network drives, `\\wsl$`) is a manual check (plan § 5.5).
 *
 * | Gap | Driven by |
 * |-----|-----------|
 * | G1  | opening a project whose `.erfana/settings.json` is invalid (editor, image and HTML preview tabs open) |
 * | G2  | `holdNextWrite` + a page reload mid-save; 20 reloads with 3 files, re-subscribed by each reloaded page |
 * | G4  | an excluded (`dist`) and a hidden (`.hidden-dir`) folder, each deleted and created again 500 ms later (plain regression test: not reproduced at S0) |
 * | G5  | `failNextSubscribe('WATCH_FAILED')` when a deleted file comes back |
 * | G6  | a terminal link spelled another way (Windows): a lower-case drive (editor and image tab), a junction, a symlink (with an atomic save of its target), an 8.3 short name (of the file, and with the project folder shortened too) |
 * | G8  | `killWatchesSilently` + `simulateResume` |
 * | G9  | `setWatchLimit(2)`, three tabs, one closed (the third an editor, then an image) |
 * | race | a tab closed and its file reopened at once, while the old watch is still closing |
 *
 * Most tests first prove the path works (a control write that shows), so a
 * gap is never confused with a broken harness. Needs an e2e build
 * (`npm run build:e2e`) for the main-process freshness hook. Waits are
 * condition-based only.
 */
import { execFileSync } from 'child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures/index'
import { E2E_TEMP_DIR, removeDirWithRetry } from './fixtures/isolation'
import { ProjectTreePage } from './pages/project-tree.page'
import { TabBarPage } from './pages/tab-bar.page'
import { EditorPanelPage } from './pages/editor-panel.page'
import { MonacoPage } from './pages/monaco.page'
import { KeyboardHelper } from './pages/keyboard.helper'
import { FileFreshnessPage } from './pages/file-freshness.page'
import { ImageViewerPage } from './pages/image-viewer.page'
import { HtmlPreviewPage } from './pages/html-preview.page'
import { TEST_IDS } from '../src/renderer/src/constants/testids'
import { byTestId } from './utils/locators'
import { rebuildFolder, writeInPlace, writeTempRename } from './utils/freshness-writers'

/** A write reaching a tab that follows its file: today ~0.7 s; G1, G4 and G8 allow 1–3 s more. */
const SHOW_BUDGET_MS = 5_000
/** A delete reaching the tab: the write settle, the atomic-save window and the existence re-check. */
const DELETE_BUDGET_MS = 15_000
/** A returned file read back by the deleted tab's 2 s re-check. */
const RECOVER_BUDGET_MS = 10_000
/** How long a notice the gap should raise is given to appear. */
const NOTICE_BUDGET_MS = 3_000
const RELOADS = 20
/** The generator's pause between removing the folder and writing it again. */
const REBUILD_GAP_MS = 500
/** G4's folders: one on the default watcher ignore list, one hidden by its dot name (M2). */
const G4_FOLDERS = [
  { folderName: 'dist', imageName: 'logo.svg' },
  { folderName: '.hidden-dir', imageName: 'mark.svg' }
] as const

test.use({
  testProjectFiles: {
    'a.md': '# A\n\nstart a\n',
    'b.md': '# B\n\nstart b\n',
    'c.md': '# C\n\nstart c\n',
    // `dist` is on the default watcher ignore list; the tree still lists it
    'dist/notes.md': '# Notes\n\nstart notes\n',
    'dist/logo.svg': svg('logo-start'),
    // A hidden (dot) folder: G4 covers excluded and hidden folders alike
    '.hidden-dir/notes.md': '# Notes\n\nstart notes\n',
    '.hidden-dir/mark.svg': svg('logo-start'),
    // G6: the targets of a junction, a symlink and an 8.3 short name (names too long for 8.3)
    'junction-target/j.md': '# J\n\nstart j\n',
    'symlink-target.md': '# S\n\nstart s\n',
    'long-folder-name/long-file-name.md': '# L\n\nstart l\n',
    'pic.svg': svg('pic-start'),
    'page.html': htmlPage('page-start')
  }
})

/** An SVG carrying `marker` in `data-marker`. */
function svg(marker: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" data-marker="${marker}" width="64" height="64" viewBox="0 0 64 64">` +
    '<rect width="64" height="64" fill="#1f1f1f"/></svg>\n'
  )
}

/** An HTML page titled `marker`. */
function htmlPage(marker: string): string {
  return `<!doctype html><html><head><title>${marker}</title></head><body><p>${marker}</p></body></html>\n`
}

/** The tabs, panel and freshness POMs of one window. */
function poms(page: Page, app: ElectronApplication) {
  return {
    tree: new ProjectTreePage(page),
    tabs: new TabBarPage(page),
    panel: new EditorPanelPage(page),
    fresh: new FileFreshnessPage(page, app)
  }
}

/** Opens a project-relative Markdown file (`/`-separated) from the tree and waits for its text. */
async function openEditor(page: Page, relPath: string, marker: string): Promise<void> {
  const tree = new ProjectTreePage(page)
  const tabs = new TabBarPage(page)
  const panel = new EditorPanelPage(page)
  const folders = relPath.split('/').slice(0, -1)
  if (folders.length > 0) await tree.expandTo(folders.map((_, i) => folders.slice(0, i + 1).join('/')))
  await tree.fileRow(relPath).click()
  await tabs.waitForTab(basename(relPath))
  await panel.waitForReady()
  await expect(byTestId(page, TEST_IDS.EDITOR_CONTENT).filter({ hasText: marker }).first()).toBeAttached()
}

/** Markdown with a marker line. */
function doc(title: string, marker: string): string {
  return `# ${title}\n\n${marker}\n`
}

/**
 * After a page reload, reopens `projectPath` – a reload closes the page's
 * project (#485), so the new page starts with none, as a user would find it –
 * then subscribes `filePaths` from the new page exactly as its tabs' trackers
 * do (`fileWatch.subscribe` with a fresh watch id and the tab's profile –
 * `editor` unless `profiles` names `image`) and records the change events the
 * page receives, by path. The bridge call is what those tabs would send.
 */
async function resubscribeFromPage(
  page: Page,
  projectPath: string,
  filePaths: readonly string[],
  profiles: Readonly<Record<string, 'editor' | 'image'>> = {}
): Promise<void> {
  await page.evaluate(async (root) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the preload bridge, as the fixtures call it
    await (window as any).api.file.openProjectByPath({ projectPath: root })
  }, projectPath)
  await expect(
    page.locator(`[data-testid^="${TEST_IDS.PROJECT_TREE_NODE_FILE}-"]`).first(),
    'setup: the reloaded page has the project open again'
  ).toBeVisible({ timeout: 15_000 })
  const started = await page.evaluate(async ({ paths, kinds }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the preload bridge, as the fixtures call it
    const api = (window as any).api
    const w = window as unknown as { __g2Changed?: string[]; __g2Paths?: Record<string, string> }
    if (!w.__g2Changed) {
      w.__g2Changed = []
      w.__g2Paths = {}
      api.fileWatch.onEvent((event: { watchId: string; kind: string }) => {
        const path = w.__g2Paths?.[event.watchId]
        if (event.kind === 'changed' && path !== undefined) w.__g2Changed?.push(path)
      })
    }
    const results: Array<{ status: string }> = []
    for (const p of paths) {
      const watchId = crypto.randomUUID()
      if (w.__g2Paths) w.__g2Paths[watchId] = p
      results.push(await api.fileWatch.subscribe({ watchId, filePath: p, profile: kinds[p] ?? 'editor' }))
    }
    return results.every((r) => r.status === 'started')
  }, { paths: filePaths, kinds: profiles })
  expect(started, 'setup: the reloaded page subscribes its files').toBe(true)
}

/** The change events the reloaded page received for `filePath`. */
async function changesSeen(page: Page, filePath: string): Promise<number> {
  return page.evaluate(
    (p) => ((window as unknown as { __g2Changed?: string[] }).__g2Changed ?? []).filter((c) => c === p).length,
    filePath
  )
}

/** Polls until the editor tab shows `marker` with no stopped notice: the tab still follows its file. */
async function expectFollowed(fresh: FileFreshnessPage, marker: string, message: string): Promise<void> {
  await expect
    .poll(
      async () => ({
        shown: (await fresh.contentWith(marker).count()) > 0,
        stopped: await fresh.watchStoppedNotice().isVisible()
      }),
      { timeout: SHOW_BUDGET_MS, message }
    )
    .toEqual({ shown: true, stopped: false })
}

/** `filePath` with its drive letter in lower case (Windows). */
function lowerDrive(filePath: string): string {
  return filePath.charAt(0).toLowerCase() + filePath.slice(1)
}

/**
 * `longPath` with every folder and the file spelled by its 8.3 short name, or
 * null when the volume made no short name for the file (8.3 names off) or the
 * lookup is unavailable. Asked of Windows itself
 * (`Scripting.FileSystemObject`); the path travels in an environment variable,
 * so it is never parsed as part of a command.
 */
function shortSpelling(longPath: string): string | null {
  try {
    const short = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(New-Object -ComObject Scripting.FileSystemObject).GetFile($env:ERFANA_E2E_LONG_PATH).ShortPath'
      ],
      { env: { ...process.env, ERFANA_E2E_LONG_PATH: longPath }, encoding: 'utf8', timeout: 30_000 }
    ).trim()
    // Only a short name for the file itself makes a second spelling worth testing
    if (short === '' || basename(short) === basename(longPath)) return null
    return short
  } catch {
    return null
  }
}

/**
 * The project file at `relParts` spelled with the 8.3 short names of its
 * in-project folders and file, under the project root as opened – or null
 * when it has none (see {@link shortSpelling}).
 */
function shortSpellingInProject(root: string, relParts: readonly string[]): string | null {
  const short = shortSpelling(join(root, ...relParts))
  return short === null ? null : join(root, ...short.split(/[\\/]/).slice(-relParts.length))
}

/** Creates a file symlink, or answers why it cannot (Windows needs Developer Mode or admin rights for one). */
async function trySymlink(target: string, linkPath: string): Promise<string | null> {
  try {
    await symlink(target, linkPath, 'file')
    return null
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error'
    return `cannot create a file symlink on this host (${code}): Windows needs Developer Mode or admin rights for one`
  }
}

test.describe('#478 gaps: an open tab stops following its file', () => {
  test('G1: after a failed project open, a write to an open file is shown', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const { fresh } = poms(page, app)
    const viewer = new ImageViewerPage(page, SHOW_BUDGET_MS)
    const preview = new HtmlPreviewPage(page, app)
    const file = join(testProject.path, 'a.md')
    await preview.open('page.html')
    await preview.waitForTitled('page-start')
    await viewer.openFromTree('pic.svg')
    await openEditor(page, 'a.md', 'start a')
    await writeInPlace(file, doc('A', 'g1-control'))
    await fresh.waitForContent('g1-control', SHOW_BUDGET_MS)

    // Project B's settings are invalid: the open fails and project A stays
    await mkdir(E2E_TEMP_DIR, { recursive: true })
    const projectB = await mkdtemp(join(E2E_TEMP_DIR, 'g1-invalid-'))
    try {
      await mkdir(join(projectB, '.erfana'))
      await writeFile(join(projectB, '.erfana', 'settings.json'), '{')
      const opened = await page.evaluate(async (p) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the preload bridge, as the fixtures call it
          const result = (await (window as any).api.file.openProjectByPath({ projectPath: p })) as { success: boolean }
          return result.success
        } catch {
          return false // the handler rejects on invalid settings JSON
        }
      }, projectB)
      expect(opened, 'setup: the open of project B must fail').toBe(false)
      await expect(new ProjectTreePage(page).fileRow('a.md'), 'setup: project A stays open').toBeVisible()

      await writeInPlace(file, doc('A', 'g1-after'))
      await fresh.waitForContent('g1-after', SHOW_BUDGET_MS, 'G1: write not shown after a failed project open')
      // The image tab (renderer-owned) and the HTML preview (main-owned) follow too
      await writeInPlace(join(testProject.path, 'page.html'), htmlPage('page-g1-after'))
      await preview.waitForTitled('page-g1-after')
      // The image tab is shown before the write, so only its live watch can bring the
      // new picture: the check a tab makes when it is shown cannot mask a dead watch (H1)
      await viewer.activateTab('pic.svg')
      await viewer.waitForMarker('pic-start')
      await writeInPlace(join(testProject.path, 'pic.svg'), svg('pic-g1-after'))
      await viewer.waitForMarker('pic-g1-after')
      await viewer.expectNoBanner()
    } finally {
      await removeDirWithRetry(projectB)
    }
  })

  test('G2: a reload during a save does not mute the file for the reloaded page', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const { panel, fresh } = poms(page, app)
    const keyboard = new KeyboardHelper(page)
    const monaco = new MonacoPage(page, keyboard)
    const file = join(testProject.path, 'a.md')
    await openEditor(page, 'a.md', 'start a')
    await writeInPlace(file, doc('A', 'g2-control'))
    await fresh.waitForContent('g2-control', SHOW_BUDGET_MS)

    // Type, so autosave writes – and hold that write in main
    await panel.setViewMode('editor')
    await monaco.waitForReady()
    await monaco.focus()
    await fresh.holdNextWrite()
    await page.keyboard.type('typed ')
    await fresh.waitForHeldWrite()

    // Reload while the save is in flight, then let the write finish
    await page.reload()
    await fresh.releaseWrite()
    await expect.poll(() => fresh.writeHeld(), { message: 'setup: the held write finished' }).toBe(false)
    await resubscribeFromPage(page, testProject.path, [file])

    await writeInPlace(file, doc('A', 'g2-after'))
    await expect
      .poll(() => changesSeen(page, file), {
        timeout: SHOW_BUDGET_MS,
        message: 'G2: change not delivered to the page reloaded mid-save'
      })
      .toBeGreaterThan(0)
  })

  test('G2: after 20 reloads with 3 files subscribed, the app holds exactly 3 watch subscriptions', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    test.setTimeout(300_000)
    const { fresh } = poms(page, app)
    // One of the three tabs is an image (plan § 5.6: G2 × image viewer)
    for (const name of ['a.md', 'b.md']) await openEditor(page, name, `start ${name[0]}`)
    await new ImageViewerPage(page).openFromTree('pic.svg')
    await expect.poll(async () => (await fresh.watchStats()).tabSubscriptions).toBe(3)

    const paths = ['a.md', 'b.md', 'pic.svg'].map((name) => join(testProject.path, name))
    const profiles = { [paths[2]]: 'image' } as const
    for (let i = 0; i < RELOADS; i++) {
      await page.reload()
      await resubscribeFromPage(page, testProject.path, paths, profiles)
    }

    const stats = await fresh.watchStats()
    expect(stats.tabWatches).toBe(3)
    expect(stats.tabSubscriptions, 'G2: watch subscriptions after 20 reloads').toBe(3)
  })

  // G4 is "inferred" in the issue and did NOT reproduce on Windows 11 at S0
  // (rebuild gaps of 0, 500 and 1500 ms all followed the later write – see the
  // S0 evidence). It is kept as a plain regression assertion, not a gap test.
  for (const { folderName, imageName } of G4_FOLDERS) {
    test(`G4: after an ${folderName === 'dist' ? 'excluded' : 'hidden'} folder (${folderName}) is deleted and created again, a later write is shown`, async ({
      windowWithTestProject: page,
      appWithTestProject: app,
      testProject
    }) => {
      const { fresh } = poms(page, app)
      const folder = join(testProject.path, folderName)
      const file = join(folder, 'notes.md')
      const viewer = new ImageViewerPage(page, SHOW_BUDGET_MS)
      const logo = join(folder, imageName)
      await openEditor(page, `${folderName}/notes.md`, 'start notes')
      await viewer.openFromTree(imageName)
      await new TabBarPage(page).activate('notes.md')
      await writeInPlace(file, doc('Notes', 'g4-control'))
      await fresh.waitForContent('g4-control', SHOW_BUDGET_MS)

      // A generator's `rm -rf` and rebuild: the folder is back long before the 2 s re-check looks twice
      await rebuildFolder(folder, { 'notes.md': doc('Notes', 'g4-back'), [imageName]: svg('logo-back') }, REBUILD_GAP_MS)
      await writeInPlace(file, doc('Notes', 'g4-later'))
      await writeInPlace(logo, svg('logo-later'))

      await fresh.waitForContent('g4-later', SHOW_BUDGET_MS, 'G4: write not shown after the folder came back')
      await expect(fresh.deletedTabMark('notes.md'), 'no deleted banner for a folder that came back').toHaveCount(0)
      // The image tab in the same folder (plan § 5.6: G4 × image viewer). Shown first,
      // then written: only its live watch can bring the new picture (H1)
      await viewer.activateTab(imageName)
      await viewer.waitForMarker('logo-later')
      await writeInPlace(logo, svg('logo-visible'))
      await viewer.waitForMarker('logo-visible')
      await viewer.expectNoBanner()
    })
  }

  test('G5: a returned file whose watch cannot restart shows the stopped notice', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const { fresh } = poms(page, app)
    const file = join(testProject.path, 'a.md')
    await openEditor(page, 'a.md', 'start a')

    await rm(file)
    await expect(fresh.deletedTabMark('a.md')).toBeVisible({ timeout: DELETE_BUDGET_MS })

    // The file comes back, and its watch refuses to start again
    await fresh.failNextSubscribe('WATCH_FAILED')
    await writeFile(file, doc('A', 'g5-back'))
    await fresh.waitForContent('g5-back', RECOVER_BUDGET_MS)
    await expect.poll(() => fresh.pendingSubscribeFailure(), { message: 'setup: the tab never re-subscribed' }).toBeNull()

    await expect(fresh.watchStoppedNotice(), 'G5: no stopped notice after a failed restart').toBeVisible({
      timeout: NOTICE_BUDGET_MS
    })
    await expect(fresh.watchStoppedReload()).toBeVisible()
  })

  test('G6: a file opened through a lower-case drive path keeps auto-refresh', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    test.skip(process.platform !== 'win32', 'drive letters exist on Windows only')
    const { tabs, fresh } = poms(page, app)
    const file = join(testProject.path, 'a.md')
    expect(lowerDrive(file), 'setup: the project path starts with an upper-case drive letter').not.toBe(file)

    await fresh.openThroughTerminalLink(lowerDrive(file), tabs.tab('a.md'))
    await expect(fresh.contentWith('start a').first()).toBeAttached()

    await writeInPlace(file, doc('A', 'g6-after'))
    await expectFollowed(fresh, 'g6-after', 'G6: not followed through a lower-case drive path')
  })

  test('G6: an image opened through a lower-case drive path keeps auto-refresh', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    test.skip(process.platform !== 'win32', 'drive letters exist on Windows only')
    const { fresh } = poms(page, app)
    const viewer = new ImageViewerPage(page, SHOW_BUDGET_MS)
    const pic = join(testProject.path, 'pic.svg')
    expect(lowerDrive(pic), 'setup: the project path starts with an upper-case drive letter').not.toBe(pic)

    await fresh.openThroughTerminalLink(lowerDrive(pic), viewer.image())
    await viewer.waitForMarker('pic-start')

    // The image tab is on screen before the write: only its live watch can bring the new picture
    await writeInPlace(pic, svg('pic-g6-after'))
    await viewer.waitForMarker('pic-g6-after')
    await viewer.expectNoBanner()
  })

  test('G6: a file opened through a junction keeps auto-refresh', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    test.skip(process.platform !== 'win32', 'junctions exist on Windows only')
    const { fresh } = poms(page, app)
    const target = join(testProject.path, 'junction-target')
    const junction = join(testProject.path, 'via-junction')
    // A junction needs neither admin rights nor Developer Mode
    await symlink(target, junction, 'junction')

    await fresh.openThroughTerminalLink(join(junction, 'j.md'), fresh.contentWith('start j').first())

    await writeInPlace(join(target, 'j.md'), doc('J', 'g6-junction-after'))
    await expectFollowed(fresh, 'g6-junction-after', 'G6: not followed through a junction')
  })

  test('G6: a file opened through a symlink keeps auto-refresh, across an atomic save of its target', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    test.skip(process.platform !== 'win32', 'the Windows spelling cases (plan § 5.6 G6)')
    const { fresh } = poms(page, app)
    const target = join(testProject.path, 'symlink-target.md')
    const link = join(testProject.path, 'via-symlink.md')
    const refused = await trySymlink(target, link)
    test.skip(refused !== null, refused ?? '')

    await fresh.openThroughTerminalLink(link, fresh.contentWith('start s').first())

    // An agent's atomic save replaces the target: the re-armed watch keeps following it (N2)
    await writeTempRename(target, doc('S', 'g6-symlink-atomic'))
    await expectFollowed(fresh, 'g6-symlink-atomic', 'G6: not followed through a symlink after an atomic save')
    await writeInPlace(target, doc('S', 'g6-symlink-after'))
    await expectFollowed(fresh, 'g6-symlink-after', 'G6: not followed through a symlink')
  })

  test('G6: a file opened through its 8.3 short name keeps auto-refresh', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    test.skip(process.platform !== 'win32', '8.3 short names exist on Windows only')
    const { fresh } = poms(page, app)
    const file = join(testProject.path, 'long-folder-name', 'long-file-name.md')
    const short = shortSpellingInProject(testProject.path, ['long-folder-name', 'long-file-name.md'])
    test.skip(short === null, '8.3 short names are off on this volume (fsutil 8dot3name), so the file has no second spelling')

    await fresh.openThroughTerminalLink(short ?? file, fresh.contentWith('start l').first())

    await writeInPlace(file, doc('L', 'g6-short-after'))
    await expectFollowed(fresh, 'g6-short-after', 'G6: not followed through an 8.3 short name')
  })

  test('G6: a file opened through a path that shortens the project folder too keeps auto-refresh', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    test.skip(process.platform !== 'win32', '8.3 short names exist on Windows only')
    const { fresh } = poms(page, app)
    const file = join(testProject.path, 'long-folder-name', 'long-file-name.md')
    // A terminal prints this spelling: the project folder and every folder above it shortened
    const short = shortSpelling(file)
    test.skip(short === null, '8.3 short names are off on this volume (fsutil 8dot3name), so the file has no second spelling')
    const projectShortened = !(short ?? '').toLowerCase().startsWith(`${testProject.path.toLowerCase()}\\`)
    test.skip(!projectShortened, 'the project folder has no 8.3 short name on this volume')

    await fresh.openThroughTerminalLink(short ?? file, fresh.contentWith('start l').first())

    await writeInPlace(file, doc('L', 'g6-short-root-after'))
    await expectFollowed(fresh, 'g6-short-root-after', 'G6: not followed through a shortened project folder')
  })

  test('G8: after a wake, a write to a file whose watch died silently is shown', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const { fresh } = poms(page, app)
    const file = join(testProject.path, 'a.md')
    await openEditor(page, 'a.md', 'start a')
    await writeInPlace(file, doc('A', 'g8-control'))
    await fresh.waitForContent('g8-control', SHOW_BUDGET_MS)

    // Sleep killed the native watch without an error; then the PC wakes
    expect(await fresh.killWatchesSilently(), 'setup: one watch to kill').toBe(1)
    await fresh.simulateResume()

    await writeInPlace(file, doc('A', 'g8-after'))
    await fresh.waitForContent('g8-after', SHOW_BUDGET_MS, 'G8: write after wake not shown live')
  })

  test('G9: a tab past the watch limit waits, and follows its file when a slot frees', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const { tabs, fresh } = poms(page, app)
    expect(await fresh.setWatchLimit(2)).toBe(100)
    await openEditor(page, 'a.md', 'start a')
    await openEditor(page, 'b.md', 'start b')
    await openEditor(page, 'c.md', 'start c')
    // The third tab waits in line: two watches, one waiting, no stopped notice –
    // and never silently: it shows the watch-limit notice, with no Reload
    await expect.poll(async () => (await fresh.watchStats()).tabWatches).toBe(2)
    await expect(fresh.watchStoppedNotice()).toHaveCount(0)
    await expect(fresh.watchQueuedNotice(), 'G9: a queued tab shows the watch-limit notice').toBeVisible({
      timeout: NOTICE_BUDGET_MS
    })
    await expect(fresh.watchQueuedNotice()).toContainText('Too many files are open to follow this one live.')
    await expect(fresh.watchQueuedNotice().getByRole('button')).toHaveCount(0)

    // A slot frees: the waiting tab takes it
    await tabs.closeButton('a.md').click()
    await tabs.waitForTabGone('a.md')
    await expect.poll(async () => (await fresh.watchStats()).tabWatches).toBe(2)
    await tabs.activate('c.md')
    // Cleared quietly once the tab follows again
    await expect(fresh.watchQueuedNotice()).toHaveCount(0, { timeout: NOTICE_BUDGET_MS })

    await writeInPlace(join(testProject.path, 'c.md'), doc('C', 'g9-after'))
    await fresh.waitForContent('g9-after', SHOW_BUDGET_MS, 'G9: waiting tab not following after a slot freed')
  })

  test('G9: an image tab past the watch limit waits, and follows its file when a slot frees', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const { tabs, fresh } = poms(page, app)
    const viewer = new ImageViewerPage(page, SHOW_BUDGET_MS)
    expect(await fresh.setWatchLimit(2)).toBe(100)
    await openEditor(page, 'a.md', 'start a')
    await openEditor(page, 'b.md', 'start b')
    await viewer.openFromTree('pic.svg')
    await expect.poll(async () => (await fresh.watchStats()).tabWatches).toBe(2)
    // The image viewer shows the same watch-limit words in its banner (plan § 3.6)
    await expect(viewer.banner()).toContainText('Too many files are open to follow this one live.', {
      timeout: NOTICE_BUDGET_MS
    })

    await tabs.closeButton('a.md').click()
    await tabs.waitForTabGone('a.md')
    await expect.poll(async () => (await fresh.watchStats()).tabWatches).toBe(2)
    await viewer.openFromTree('pic.svg')
    await viewer.expectNoBanner(NOTICE_BUDGET_MS)
    await writeInPlace(join(testProject.path, 'pic.svg'), svg('pic-g9-after'))
    await viewer.waitForMarker('pic-g9-after')
  })

  test('closing-watch race: a file reopened while its old watch is still closing is followed', async ({
    windowWithTestProject: page,
    appWithTestProject: app,
    testProject
  }) => {
    const { tabs, fresh } = poms(page, app)
    const file = join(testProject.path, 'a.md')
    await openEditor(page, 'a.md', 'start a')
    await expect.poll(async () => (await fresh.watchStats()).tabWatches).toBe(1)

    // Close the tab and open the file again at once: no wait for the old watch to close
    await tabs.closeButton('a.md').click()
    await tabs.waitForTabGone('a.md')
    await openEditor(page, 'a.md', 'start a')

    await expect.poll(async () => (await fresh.watchStats()).tabWatches, { message: 'race: reopened file left unwatched' }).toBe(1)
    await writeInPlace(file, doc('A', 'race-after'))
    await fresh.waitForContent('race-after', SHOW_BUDGET_MS, 'race: write to the reopened file not shown')
  })
})
