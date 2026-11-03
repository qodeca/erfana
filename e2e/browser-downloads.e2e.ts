// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Downloads ask first (spec 025, 025-FR-020): the parts of 025-AC-020 an e2e
 * build can show.
 *
 * Downloads start from `apps/static/downloads.html` (a link pressed through
 * main-side input, so it carries a user action) or from the fixture server's
 * `/__download*` endpoints, each with a name holding the test's own token. The
 * save dialog is stubbed with `stubDialog`; notices are read as main sends
 * them (`browser-tab:notice`); the several-files question is answered in the
 * browser panel's strip, as a user answers it.
 *
 * Every part of 025-AC-020 is shown here: the executable-type warning is
 * read from the stubbed save dialog's options, and the notices are read both
 * as main sends them and as the toasts the window draws. One part is
 * platform-bound: the AC drives the unwritable folder through a test hook,
 * and on macOS and Linux `chmod` makes one; Windows skips that test (see it).
 *
 * Two facts about the environment: Chromium already replaces path parts,
 * bidi and invisible characters with `_` before Erfana sees a name, so the
 * offered name is checked for their absence; and the OS Downloads folder is
 * the developer's real `~/Downloads` on macOS, so no test saves into it or
 * lists it. Condition-based waits only.
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { test, expect } from './fixtures/browserHarness'
import { E2E_TEMP_DIR, removeDirWithRetry } from './fixtures/isolation'
import { DownloadsDriver } from './pages/browser-downloads.page'
import { BrowserTabUiPage } from './pages/browser-tab-ui.page'
import type { BrowserPagePage } from './pages/browser-page.page'
import type { BrowserTabPage } from './pages/browser-tab.page'

const BYTES = 4096

/** A token unique to this test run, safe in a file name and a hold key. */
const tokenOf = (label: string): string => `${label}-${test.info().workerIndex}-${test.info().repeatEachIndex}-${Date.now()}`

test.describe('025-AC-020 downloads ask first', () => {
  let out = ''
  let downloads: DownloadsDriver

  test.beforeEach(async ({ appWithTestProject, windowWithTestProject }) => {
    await fs.mkdir(E2E_TEMP_DIR, { recursive: true })
    out = await fs.mkdtemp(path.join(E2E_TEMP_DIR, 'chosen-'))
    downloads = new DownloadsDriver(appWithTestProject, windowWithTestProject)
    await downloads.recordNotices()
    await downloads.recordShowInFolder()
  })

  test.afterEach(async () => {
    await fs.chmod(out, 0o755).catch(() => undefined)
    await removeDirWithRetry(out)
  })

  /** A tab on `downloads.html` whose page takes input. */
  async function openDownloadsPage(browserTabs: BrowserTabPage, url: string): Promise<BrowserPagePage> {
    const page = await browserTabs.open()
    await browserTabs.navigate(page.tabId, url)
    await page.waitForLoaded(url)
    return page
  }

  /** Start a download of `name` from the page by a pressed link (a user action). */
  async function pressDownload(page: BrowserPagePage, endpoint: string): Promise<void> {
    await page.eval(`(() => {
      const a = document.createElement('a')
      a.id = 'e2e-download'
      a.href = ${JSON.stringify(endpoint)}
      a.textContent = 'download'
      a.style.cssText = 'position:fixed;left:10px;top:10px;padding:20px;background:#fff'
      document.body.appendChild(a)
      return true
    })()`)
    await page.clickSelector('#e2e-download')
  }

  test('025-AC-020 the save dialog opens in the Downloads folder with a sanitised name and an executable warning; Cancel leaves no file', async ({
    browserTabs,
    browserServers
  }) => {
    const page = await openDownloadsPage(browserTabs, browserServers.sites.static.url('/downloads.html'))
    const downloadsDir = await downloads.downloadsDir()
    const token = tokenOf('cancel')

    // Path parts, Windows-reserved characters, a bidi override and an invisible character.
    const hostile = `..\\../${token}<a>:|?\u200B\u202Etxt.exe`
    await downloads.answerSaveDialog(null)
    await pressDownload(page, `/__download/${encodeURIComponent(hostile)}?bytes=${BYTES}`)
    const [offered] = await downloads.waitForDialogCount(1)
    expect(path.dirname(offered!)).toBe(downloadsDir)
    const name = path.basename(offered!)
    expect(name).toContain(token)
    expect(name).not.toMatch(/[\\/<>:|?*\u200B\u202E]/)
    expect(name.endsWith('txt.exe')).toBe(true)
    // An executable type carries a warning: the title (Windows, Linux) and the message (macOS) name the risk and the file.
    const [call] = await downloads.dialogCalls()
    expect(call!.title).toBe('This file can run programs on your computer')
    expect(call!.message).toBe(`${name} can run programs on your computer. Save it only if you trust the site it came from.`)

    // Cancel: no target was chosen, so the only place a file could be is staging – emptied – and no notice comes.
    // (The real ~/Downloads is never listed: macOS privacy protection would stall the read on a prompt.)
    await downloads.waitForNoLeftovers(token)
    expect((await downloads.notices()).filter((n) => n.download.fileName.includes(token))).toEqual([])
  })

  test('025-AC-020 Save writes the file, and the notice names it with Show in folder', async ({ browserTabs, browserServers }) => {
    const page = await openDownloadsPage(browserTabs, browserServers.sites.static.url('/downloads.html'))
    const token = tokenOf('saved')
    const name = `report-${token}.txt`
    const target = path.join(out, name)
    await downloads.answerSaveDialog(target)
    await pressDownload(page, `/__download/${name}?bytes=${BYTES}`)

    const notice = await downloads.waitForNotice('downloadDone', name)
    expect(notice.text).toBe(`Downloaded ${name}`)
    expect(notice.tabId).toBe(page.tabId)
    expect((await fs.stat(target)).size).toBe(BYTES)
    await downloads.waitForNoLeftovers(token)

    // A file that cannot run programs gets the plain dialog.
    const [call] = await downloads.dialogCalls()
    expect(call).toEqual({ defaultPath: path.join(await downloads.downloadsDir(), name), title: null, message: null })

    // The window's toast names the file; its Show in folder reveals the saved file and closes the toast.
    expect(notice.download.downloadId).not.toBeNull()
    await expect(downloads.doneToast(name)).toBeVisible()
    await downloads.showInFolderButton(name).click()
    await expect.poll(() => downloads.shownInFolder()).toEqual([target])
    await expect(downloads.doneToast(name)).toHaveCount(0)
  })

  test('025-AC-020 a save target under .erfana is refused with a notice, and nothing is written there (S-18)', async ({
    browserTabs,
    browserServers,
    testProject
  }) => {
    const page = await openDownloadsPage(browserTabs, browserServers.sites.static.url('/downloads.html'))
    const token = tokenOf('erfana')
    const name = `agent-${token}.txt`
    const target = path.join(testProject.path, '.erfana', name)
    await downloads.answerSaveDialog(target)
    await pressDownload(page, `/__download/${name}?bytes=${BYTES}`)

    const notice = await downloads.waitForNotice('downloadFailed', name)
    expect(notice.download.reason).toBe('refusedFolder')
    expect(notice.text).toContain(name)
    expect(notice.text).toContain('inside a .erfana folder')
    await expect(downloads.failedToast(name)).toContainText('Erfana doesn’t save downloads inside a .erfana folder')
    await downloads.waitForNoLeftovers(token)
    await expect(fs.access(target)).rejects.toThrow()
  })

  test('025-AC-020 the server drops the connection halfway: the error notice names the file and the reason, and neither the file nor a partial file remains', async ({
    browserTabs,
    browserServers
  }) => {
    const page = await openDownloadsPage(browserTabs, browserServers.sites.static.url('/downloads.html'))
    const token = tokenOf('dropped')
    const name = `dropped-${token}.bin`
    const target = path.join(out, name)
    await downloads.answerSaveDialog(target)
    await pressDownload(page, `/__download-drop/${name}?bytes=1048576`)

    const notice = await downloads.waitForNotice('downloadFailed', name)
    expect(notice.download.reason).toBe('interrupted')
    expect(notice.text).toBe(`Couldn’t download ${name}. The download was interrupted. The partial file was deleted.`)
    await expect(downloads.failedToast(name)).toContainText('The download was interrupted. The partial file was deleted.')
    await downloads.waitForNoLeftovers(token)
    expect(await fs.readdir(out)).toEqual([])
  })

  test('025-AC-020 the chosen folder cannot be written: the error notice names the file and the reason, and neither the file nor a partial file remains', async ({
    browserTabs,
    browserServers
  }) => {
    // The AC is platform-specific here: on Windows the unwritable folder comes from a test hook, and chmod cannot make one.
    test.skip(process.platform === 'win32', 'Windows needs the unwritable-folder test hook (025-AC-020); chmod does not make a Windows folder read-only')
    const page = await openDownloadsPage(browserTabs, browserServers.sites.static.url('/downloads.html'))
    const token = tokenOf('readonly')
    const name = `blocked-${token}.txt`
    const target = path.join(out, name)
    await fs.chmod(out, 0o555)
    await downloads.answerSaveDialog(target)
    await pressDownload(page, `/__download/${name}?bytes=${BYTES}`)

    const notice = await downloads.waitForNotice('downloadFailed', name)
    expect(notice.download.reason).toBe('folderNotWritable')
    expect(notice.text).toBe(`Couldn’t download ${name}. Erfana can’t write to that folder. The partial file was deleted.`)
    await expect(downloads.failedToast(name)).toContainText('Erfana can’t write to that folder. The partial file was deleted.')
    await downloads.waitForNoLeftovers(token)
    expect(await fs.readdir(out)).toEqual([])
  })

  test('025-AC-020 a download continues when its tab closes', async ({ browserTabs, browserServers }) => {
    const { held } = browserServers
    const page = await openDownloadsPage(browserTabs, browserServers.sites.static.url('/downloads.html'))
    const token = tokenOf('held')
    const name = `held-${token}.bin`
    const target = path.join(out, name)
    await downloads.answerSaveDialog(target)
    await pressDownload(page, `/__download-held/${name}?key=${token}&bytes=${BYTES}`)
    await held.waitForRequest(token)
    await downloads.waitForDialogCount(1)
    // Half the file is in staging under its own name while the rest is held.
    await expect.poll(() => downloads.leftovers(token), { message: 'the partial file in staging' }).not.toEqual([])

    await browserTabs.close(page.tabId)
    await expect.poll(async () => (await browserTabs.tabs()).some((t) => t.tabId === page.tabId)).toBe(false)
    held.release(token)

    const notice = await downloads.waitForNotice('downloadDone', name)
    expect(notice.tabId).toBeNull()
    await expect(downloads.doneToast(name)).toBeVisible()
    expect((await fs.stat(target)).size).toBe(BYTES)
    await downloads.waitForNoLeftovers(token)
  })

  test('025-AC-020 a second download without a user action asks "This site wants to download several files" with Allow and Block; Block starts nothing', async ({
    appWithTestProject,
    windowWithTestProject,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(appWithTestProject, windowWithTestProject)
    const panel = await ui.openWithButton()
    const url = browserServers.sites.static.url('/downloads.html')
    await panel.load(url)
    await panel.waitForState({ committedUrl: url, loading: false })
    const page = await panel.page()
    await page.waitForLoaded(url)

    // The page's first download, by a pressed link: the dialog opens (Cancel).
    const token = tokenOf('several')
    await downloads.answerSaveDialog(null)
    await pressDownload(page, `/__download/first-${token}.txt?bytes=${BYTES}`)
    await downloads.waitForDialogCount(1)

    // A second one with no user action: the strip asks first.
    const second = `second-${token}.txt`
    await page.eval(`window.__fixture.downloadWithoutGesture(${JSON.stringify(second)}); true`)
    const row = panel.stripRow('download')
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row).toContainText('This site wants to download several files')
    await expect(row.getByRole('button', { name: 'Allow', exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Block', exact: true })).toBeVisible()

    await panel.answerRow('download', 'Block')
    await expect(row).toHaveCount(0)
    // Nothing started: no second save dialog (so no target), nothing left in staging, no notice.
    await downloads.waitForNoLeftovers(second)
    expect(await downloads.dialogPaths()).toHaveLength(1)
    expect((await downloads.notices()).filter((n) => n.download.fileName.includes(token))).toEqual([])
  })
})
