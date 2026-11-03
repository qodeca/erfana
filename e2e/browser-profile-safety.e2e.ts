// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The project's browser folder keeps itself out of git and out of reach
 * (spec 025, 025-FR-016, 025-FR-039; 025-AC-016, 025-AC-069), end to end.
 *
 * The unit tests (`BrowserProfileService.test.ts`, `browserProfileGuards.test.ts`)
 * record the order of file-system calls; these tests read the result on a real
 * disk, with a real git, and a refusal where the user sees it – the error
 * toast after **New browser tab**. Specs that plant something before the
 * project opens, or restart the app, launch it themselves on the worker's user
 * data and sandbox home. Condition-based waits only.
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { test, expect, launchBrowserApp, type BrowserFixtureServers, type LaunchedBrowserApp } from './fixtures/browserHarness'
import { E2E_TEMP_DIR, removeDirWithRetry } from './fixtures/isolation'
import { LogTail, appMainLogPath } from './fixtures/logTail'
import { BrowserTabUiPage } from './pages/browser-tab-ui.page'
import { BrowserProfileFolder, OLD_CAPTURE_NAME, entriesOf, waitForRefusal, type GuardedLevel } from './pages/browser-profile.page'
import { initRepoWithCommit, runGit } from './utils/git-helpers'

/** The project's own ignore rules: Erfana must never touch them. */
const PROJECT_GITIGNORE = 'node_modules/\n# keep this byte-identical\ndist\n'

/** Remove a tree whose folders a test made read-only. */
async function makeWritable(dirs: readonly string[]): Promise<void> {
  for (const dir of dirs) await fs.chmod(dir, 0o755).catch(() => undefined)
}

test.describe('025-FR-016 the browser folder ignores itself in git', () => {
  test('025-AC-016 the first tab in a git project writes .gitignore holding * before anything else; git shows nothing under .erfana/browser and the project .gitignore is byte-identical; a deleted or edited file is written again before the next page loads', async ({
    browserTabs,
    browserServers,
    testProject
  }) => {
    const folder = new BrowserProfileFolder(testProject.path)
    initRepoWithCommit(testProject.path, { '.gitignore': PROJECT_GITIGNORE, 'notes.md': '# Notes\n' })
    const projectIgnore = path.join(testProject.path, '.gitignore')
    const projectIgnoreBytes = await fs.readFile(projectIgnore)
    expect(await folder.exists()).toBe(false)

    // The first tab: the folder exists, the self-ignore file holds exactly `*`.
    const first = await browserTabs.open()
    expect(await folder.gitignore()).toBe('*')

    // Chromium writes its own files once a page loads.
    const url = browserServers.sites.static.url('/index.html')
    await browserTabs.navigate(first.tabId, url)
    await first.waitForLoaded(url)
    expect(await folder.exists('profile')).toBe(true)

    // `.gitignore` was born before every other entry of the folder.
    const births = await folder.birthTimes()
    if (births !== null) {
      const ignoreBorn = births.get('.gitignore')!
      for (const [rel, born] of births) {
        if (rel !== '.gitignore') expect(born >= ignoreBorn, `${rel} was created before .gitignore`).toBe(true)
      }
    } else {
      test.info().annotations.push({ type: 'note', description: 'this file system keeps no birth time; order is proven by the unit test' })
    }

    // Git sees nothing of it; the project's own ignore file is untouched.
    expect(folder.gitStatusUnderBrowser()).toEqual([])
    expect(runGit(testProject.path, 'check-ignore', '--no-index', '.erfana/browser/profile')).toBe('.erfana/browser/profile')
    expect(await fs.readFile(projectIgnore)).toEqual(projectIgnoreBytes)

    // Deleted: a new tab writes it again before any page loads in it.
    await fs.rm(folder.at('.gitignore'))
    expect(folder.gitStatusUnderBrowser()).not.toEqual([])
    const second = await browserTabs.create()
    expect(await folder.gitignore()).toBe('*')
    await browserTabs.show(second)
    const plain = browserServers.sites.static.url('/plain.html')
    await browserTabs.navigate(second, plain)
    await browserTabs.page(second).waitForLoaded(plain)

    // Other content (S-20): rewritten to exactly `*` by the next tab.
    await fs.writeFile(folder.at('.gitignore'), '!profile\n!captures\n', 'utf8')
    await browserTabs.create()
    expect(await folder.gitignore()).toBe('*')
    expect(folder.gitStatusUnderBrowser()).toEqual([])
    expect(await fs.readFile(projectIgnore)).toEqual(projectIgnoreBytes)
  })

  test('025-AC-016 a read-only project folder: no tab opens and the toast names the reason', async ({
    appWithTestProject,
    windowWithTestProject,
    testProject
  }) => {
    // The AC itself is platform-specific here: on Windows the read-only folder comes from a test hook, and chmod cannot make one.
    test.skip(process.platform === 'win32', 'Windows needs the read-only test hook (025-AC-016); chmod does not make a Windows folder read-only')
    const folder = new BrowserProfileFolder(testProject.path)
    const erfana = path.join(testProject.path, '.erfana')
    const locked = (await fs.lstat(erfana).then(() => true, () => false)) ? [testProject.path, erfana] : [testProject.path]
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    try {
      for (const dir of locked) await fs.chmod(dir, 0o555)
      await ui.newTabButton.click()
      const text = await waitForRefusal(windowWithTestProject)
      // The folder that could not be made, and why.
      expect(text).toMatch(/\.erfana(\/browser)?: Creating the folder failed \((EACCES|EPERM|EROFS)\)/)
      expect(await ui.tabs.tabs()).toEqual([])
      await expect(ui.editorTabs).toHaveCount(0)
      expect(await folder.exists()).toBe(false)
    } finally {
      await makeWritable(locked)
    }
  })
})

test.describe('025-FR-016 an untrusted profile is set aside (S-12)', () => {
  let launched: LaunchedBrowserApp | null = null

  test.afterEach(async () => {
    await launched?.close()
    launched = null
  })

  /**
   * Give the project a profile with a live service worker, a cached response
   * and stored data, on a secure origin (`localhost`), then quit so it is on
   * disk. Returns the cached address.
   */
  async function seedOldProfile(app: LaunchedBrowserApp, servers: BrowserFixtureServers, token: string): Promise<string> {
    const url = servers.sites.static.url('/plain.html', { host: 'localhost' })
    const cached = servers.sites.static.url(`/__bytes/2048?v=${token}`, { host: 'localhost' })
    const page = await app.tabs.open()
    await app.tabs.navigate(page.tabId, url)
    await page.waitForLoaded(url)
    await page.eval(`(async () => {
      localStorage.setItem('ac016', ${JSON.stringify(token)})
      await navigator.serviceWorker.register('/profile-sw.js')
      await navigator.serviceWorker.ready
      return true
    })()`)
    await page.waitFor('navigator.serviceWorker.controller !== null', 'the service worker controls the page')
    // The control: in the old profile the worker answers, and the response is cached.
    expect(await page.eval<string>(`fetch('/__sw-probe').then(r => r.text())`)).toBe('from-old-service-worker')
    expect(await page.eval<number>(`fetch(${JSON.stringify(cached)}).then(r => r.status)`)).toBe(200)
    expect(await page.eval<number>(`fetch(${JSON.stringify(cached)}).then(r => r.status)`)).toBe(200)
    return cached
  }

  /** Open a tab on the same origin in the fresh profile and prove none of the old profile runs. */
  async function expectFreshProfile(app: LaunchedBrowserApp, servers: BrowserFixtureServers, folder: BrowserProfileFolder, token: string, cached: string): Promise<void> {
    const url = servers.sites.static.url('/plain.html', { host: 'localhost' })
    const page = await app.tabs.open()
    const [aside] = await folder.setAsideFolders()
    expect(aside).toMatch(/^profile\.untrusted-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-\d+)?$/)
    // The old data really was there: it moved with the folder.
    expect(await folder.exists(aside!, 'Erfana', 'marker.json')).toBe(true)
    for (const store of ['Service Worker', 'Local Storage', 'Cache']) {
      expect(await folder.exists(aside!, store), `the old profile kept its ${store} on disk`).toBe(true)
    }
    expect(await folder.exists('profile', 'Erfana', 'marker.json')).toBe(true)

    await app.tabs.navigate(page.tabId, url)
    await page.waitForLoaded(url)
    expect(await page.eval<number>('navigator.serviceWorker.getRegistrations().then(r => r.length)')).toBe(0)
    expect(await page.eval<boolean>('navigator.serviceWorker.controller === null')).toBe(true)
    expect(await page.eval<string | null>(`localStorage.getItem('ac016')`)).toBeNull()
    // No old worker answers: the request reaches the server, which has no such path.
    expect(await page.eval<number>(`fetch('/__sw-probe').then(r => r.status)`)).toBe(404)
    // No old cache answers: the server sees the request again.
    const seen = (): number => servers.requests.filter((r) => r.path.includes(`v=${token}`)).length
    const before = seen()
    expect(await page.eval<number>(`fetch(${JSON.stringify(cached)}).then(r => r.status)`)).toBe(200)
    expect(seen()).toBe(before + 1)
  }

  test('025-AC-016 a profile whose marker is invalid is renamed profile.untrusted-<UTC time>; a fresh one is created and none of the old service workers, cache or storage runs', async ({
    userDataDir,
    homeDir,
    testProject,
    browserServers
  }) => {
    const folder = new BrowserProfileFolder(testProject.path)
    const token = `marker-${test.info().repeatEachIndex}-${Date.now()}`
    launched = await launchBrowserApp({ userDataDir, homeDir, projectPath: testProject.path })
    const cached = await seedOldProfile(launched, browserServers, token)
    await launched.close()
    launched = null
    expect(await folder.setAsideFolders()).toEqual([])

    await fs.writeFile(folder.at('profile', 'Erfana', 'marker.json'), '{"version":1,"projectPath":"/somewhere/else"}', 'utf8')
    launched = await launchBrowserApp({ userDataDir, homeDir, projectPath: testProject.path })
    await expectFreshProfile(launched, browserServers, folder, token, cached)
  })

  test('025-AC-016 a profile that git tracks is renamed profile.untrusted-<UTC time>; a fresh one is created and none of the old service workers, cache or storage runs', async ({
    userDataDir,
    homeDir,
    testProject,
    browserServers
  }) => {
    const folder = new BrowserProfileFolder(testProject.path)
    const token = `tracked-${test.info().repeatEachIndex}-${Date.now()}`
    launched = await launchBrowserApp({ userDataDir, homeDir, projectPath: testProject.path })
    const cached = await seedOldProfile(launched, browserServers, token)
    await launched.close()
    launched = null

    // A valid marker – but the profile came with the repository.
    initRepoWithCommit(testProject.path, { 'notes.md': '# Notes\n' })
    runGit(testProject.path, 'add', '-f', '.erfana/browser/profile/Erfana/marker.json')
    runGit(testProject.path, 'commit', '-m', 'a committed profile')
    expect(runGit(testProject.path, 'ls-files', '.erfana/browser')).toContain('.erfana/browser/profile/Erfana/marker.json')

    launched = await launchBrowserApp({ userDataDir, homeDir, projectPath: testProject.path })
    await expectFreshProfile(launched, browserServers, folder, token, cached)
  })
})

test.describe('025-FR-016 planted symlinks are refused', () => {
  let launched: LaunchedBrowserApp | null = null
  let outside = ''
  let other = ''

  test.beforeEach(async () => {
    await fs.mkdir(E2E_TEMP_DIR, { recursive: true })
    outside = await fs.mkdtemp(path.join(E2E_TEMP_DIR, 'outside-'))
    other = await fs.mkdtemp(path.join(E2E_TEMP_DIR, 'other-project-'))
    await fs.writeFile(path.join(other, 'other.md'), '# Other\n', 'utf8')
  })

  test.afterEach(async () => {
    await launched?.close()
    launched = null
    await removeDirWithRetry(outside)
    await removeDirWithRetry(other)
  })

  /**
   * Open the project with `level` planted as a link, and press New browser
   * tab: no tab opens, the toast names the path, nothing is written through
   * the link. A plain project opens first, so the capture sweep logged after
   * the mark is the planted project's own (025-FR-039 runs when a project opens).
   */
  async function openAndRefuse(
    level: GuardedLevel,
    options: { userDataDir: string; homeDir: string; projectPath: string },
    target: string
  ): Promise<{ text: string; sweepLine: string }> {
    const folder = new BrowserProfileFolder(options.projectPath)
    await folder.plantLink(level, target)
    const targetBefore = level === '.gitignore' ? null : await entriesOf(target)

    launched = await launchBrowserApp({ ...options, projectPath: other })
    const log = new LogTail(appMainLogPath(options.homeDir))
    await log.mark()
    await launched.openProject(options.projectPath)
    const sweepLine = level === 'captures' ? await log.waitFor(/Browser capture expiry could not read the captures folder/) : ''

    const ui = new BrowserTabUiPage(launched.app, launched.window)
    await ui.newTabButton.click()
    const text = await waitForRefusal(launched.window)
    expect(text).toContain(`.erfana/browser/${level}`)
    expect(text).toContain('A symlink or junction is not allowed here')
    // No tab: main holds none, and no browser editor tab stays in the editor area.
    expect(await ui.tabs.tabs()).toEqual([])
    await expect(ui.editorTabs).toHaveCount(0)

    // Still the planted link; nothing written through it.
    expect((await fs.lstat(folder.at(level))).isSymbolicLink()).toBe(true)
    if (targetBefore !== null) expect(await entriesOf(target)).toEqual(targetBefore)
    return { text, sweepLine }
  }

  test('025-AC-069 a symlinked captures folder: the open-project sweep leaves the outside 7-day-old file, and no tab opens with a toast naming the path', async ({
    userDataDir,
    homeDir,
    testProject
  }) => {
    await fs.writeFile(path.join(outside, OLD_CAPTURE_NAME), 'outside', 'utf8')
    const { sweepLine } = await openAndRefuse('captures', { userDataDir, homeDir, projectPath: testProject.path }, outside)
    expect(sweepLine).not.toBe('')
    expect(await entriesOf(outside)).toEqual([OLD_CAPTURE_NAME])
    expect(await fs.readFile(path.join(outside, OLD_CAPTURE_NAME), 'utf8')).toBe('outside')
  })

  test('025-AC-069 a symlinked profile folder: no tab opens, the toast names the path, and nothing is written into the outside folder', async ({
    userDataDir,
    homeDir,
    testProject
  }) => {
    await fs.writeFile(path.join(outside, 'keep.txt'), 'outside', 'utf8')
    await openAndRefuse('profile', { userDataDir, homeDir, projectPath: testProject.path }, outside)
    expect(await entriesOf(outside)).toEqual(['keep.txt'])
    expect(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('outside')
  })

  test('025-AC-069 a symlinked .gitignore: no tab opens, the toast names the path, and the outside file is not rewritten', async ({
    userDataDir,
    homeDir,
    testProject
  }) => {
    const outsideFile = path.join(outside, 'gitignore-target')
    await fs.writeFile(outsideFile, 'outside\n', 'utf8')
    await openAndRefuse('.gitignore', { userDataDir, homeDir, projectPath: testProject.path }, outsideFile)
    expect(await fs.readFile(outsideFile, 'utf8')).toBe('outside\n')
    expect(await entriesOf(outside)).toEqual(['gitignore-target'])
    expect(await new BrowserProfileFolder(testProject.path).exists('profile')).toBe(false)
  })
})
