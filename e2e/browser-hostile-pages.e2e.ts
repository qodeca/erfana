// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The built-in browser's hostile pages, part 2 (spec 025, 025-NFR-001,
 * 025-AC-046): local-file reads from the page, frames, a service worker and a
 * UNC path; a local folder opened by `file://`; navigations to refused
 * schemes and to Erfana's own addresses, from the page, from its frames and
 * from its popup; downloads the page tries to open; and the settings every
 * browser view and popup is built from. The first part (IPC,
 * `window.electron`, custom schemes, the renderer entry, a user-opened popup)
 * is `browser-tab-isolation.e2e.ts`; the terminal, pick and drag attacks are
 * `browser-hostile-terminal.e2e.ts`.
 *
 * Each page reports through its canary (`hostile/canary.js`); Erfana's side is
 * read too – the tab's committed address, the windows and browser-session
 * `webContents`, what `shell` was asked to open. Every "nothing happened"
 * waits for a sentinel click the page receives first. Condition-based waits
 * only.
 */
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from './fixtures/browserHarness'
import { HostileSuite, leaks } from './pages/browser-hostile.page'
import { DownloadsDriver } from './pages/browser-downloads.page'
import { BrowserTabUiPage } from './pages/browser-tab-ui.page'
import { HtmlPreviewPage } from './pages/html-preview.page'
import { testHook } from './pages/browser-page.page'
import { EXEC_ACTION_CAP_MS, installBoundedExec, type BoundedExecGlobal } from './utils/bounded-exec'
import { browserWebPreferencesFor } from '../src/main/services/browser/browserWebPreferences'
import { EXECUTABLE_WARNING_TITLE } from '../src/shared/browser/downloadNotice'
import { isExecutableDownload } from '../src/main/services/browser/downloads/downloadFileName'

/** The bundled renderer entry the e2e build loads (`out/renderer/index.html`). */
const RENDERER_ENTRY = pathToFileURL(path.join(__dirname, '..', 'out', 'renderer', 'index.html')).href

/** Write a file only this test knows into the test project; resolves its path and secret text. */
function plantSecret(projectPath: string): { file: string; secret: string } {
  const secret = `ERFANA-SECRET-${randomUUID()}`
  const file = path.join(fs.realpathSync(projectPath), `secret-${randomUUID()}.txt`)
  fs.writeFileSync(file, secret)
  return { file, secret }
}

/** The canary's attempts, as text, for "the secret never reached the page". */
function reportText(report: { attempts: Array<{ detail: string }> }): string {
  return report.attempts.map((a) => a.detail).join('\n')
}

/** Every iframe and object in `scope` shows nothing it could read: still its empty `about:blank`, or a document of another origin. */
const FRAMES_EMPTY = (scope: string): string =>
  `[...document.querySelectorAll(${JSON.stringify(scope)})].every((f) => { try { const d = f.contentDocument; return d === null || (d.URL === 'about:blank' && d.body !== null && d.body.textContent === '') } catch { return true } })`

/** Every iframe and object in `scope` has left its initial same-origin document (a refused load shows an error page). */
const FRAMES_SETTLED = (scope: string): string =>
  `[...document.querySelectorAll(${JSON.stringify(scope)})].every((f) => { try { return f.contentDocument === null } catch { return true } })`

test.describe('built-in browser hostile pages: local files', () => {
  test('025-AC-046 hostile page: fetch and XMLHttpRequest of file:// addresses read nothing', async ({ browserTabs, browserServers, testProject }) => {
    const hostile = new HostileSuite(browserTabs, browserServers)
    const { file, secret } = plantSecret(testProject.path)
    const page = await hostile.open(hostile.url(`/file-read-page.html?path=${encodeURIComponent(file)}`))
    const report = await hostile.report(page)

    expect(report.attempts.length).toBeGreaterThanOrEqual(10)
    expect(report.attempts.some((a) => a.name.startsWith('fetch ') && a.name.includes(path.basename(file)))).toBe(true)
    expect(leaks(report)).toEqual([])
    expect(report.status).toBe('blocked')
    expect(reportText(report)).not.toContain(secret)
  })

  test('025-AC-046 hostile page: frames, objects and images of file:// addresses show and read nothing', async ({ browserTabs, browserServers, testProject }) => {
    const hostile = new HostileSuite(browserTabs, browserServers)
    const { file, secret } = plantSecret(testProject.path)
    const page = await hostile.open(hostile.url(`/file-read-frame.html?path=${encodeURIComponent(file)}`))
    // Every image answered (load or error). A file: frame from a web page never starts loading – the
    // renderer refuses it – so it stays on its empty about:blank; the sentinel orders the read after the refusals.
    await page.waitFor(`window.__fileTargets.every((u) => window.__canary.results.some((r) => r.name === 'img ' + u))`, 'images answered')
    await hostile.sentinel(page)
    expect(await page.eval(FRAMES_EMPTY('#frames iframe, #frames object'))).toBe(true)
    const report = await hostile.finish(page, 'true', 'frames read')

    expect(report.attempts.filter((a) => a.name.startsWith('iframe '))).toHaveLength(await page.eval<number>('window.__fileTargets.length'))
    expect(leaks(report)).toEqual([])
    expect(reportText(report)).not.toContain(secret)
    // No frame of the tab is on a file: address in main either.
    const frameUrls = await browserTabs.app.evaluate(({ webContents }, id) => {
      const contents = webContents.fromId(id)
      return contents ? contents.mainFrame.framesInSubtree.map((f) => f.origin) : []
    }, (await browserTabs.tabs()).find((t) => t.tabId === page.tabId)!.webContentsId)
    expect(frameUrls.filter((origin) => origin.startsWith('file:'))).toEqual([])
  })

  test('025-AC-046 hostile page: a service worker fetching file:// addresses gets nothing', async ({ browserTabs, browserServers, testProject }) => {
    const hostile = new HostileSuite(browserTabs, browserServers)
    await browserTabs.open()
    await hostile.trustTestCa()
    const { file, secret } = plantSecret(testProject.path)
    const url = hostile.url(`/file-read-sw.html?path=${encodeURIComponent(file)}`, { secure: true })
    const page = await hostile.open(url)
    const report = await hostile.report(page)

    // Positive control: the worker ran and answered – a registration that failed would also read "blocked".
    expect(report.attempts).toContainEqual({ name: 'service worker file reads', outcome: 'blocked', detail: 'nothing' })
    expect(await page.eval('navigator.serviceWorker.getRegistration().then((r) => Boolean(r && r.active))')).toBe(true)
    expect(leaks(report)).toEqual([])
    expect(reportText(report)).not.toContain(secret)
  })

  test('025-AC-046 hostile page: UNC paths load, fetch and open nothing', async ({ browserTabs, browserServers }) => {
    const hostile = new HostileSuite(browserTabs, browserServers)
    const url = hostile.url('/unc.html')
    const page = await hostile.open(url)
    const report = await hostile.report(page)
    expect(report.attempts.filter((a) => a.name.startsWith('img ') || a.name.startsWith('fetch '))).toHaveLength(6)
    expect(leaks(report)).toEqual([])

    // The share frame shows nothing of the share.
    await hostile.sentinel(page)
    expect(await page.eval(FRAMES_EMPTY('iframe'))).toBe(true)
    // A click on a UNC link (a user gesture) leaves the page where it is.
    const token = await hostile.mark(page)
    await page.clickSelector('#unc-link')
    await hostile.expectStayed(page, url, token, 'the UNC link is refused')
    // Typed into the address bar: refused, nothing committed.
    expect(await browserTabs.navigate(page.tabId, 'file://127.0.0.1/share/link.html')).not.toEqual({ ok: true })
    await hostile.expectStayed(page, url, token, 'the typed UNC address is refused')
  })

  test.describe('a local folder opened by file://', () => {
    const FIXTURE = path.join(__dirname, 'fixtures', 'browser', 'hostile', 'file-confined')
    const files: Record<string, string> = {}
    for (const rel of fs.readdirSync(FIXTURE, { recursive: true, encoding: 'utf8' })) {
      const full = path.join(FIXTURE, rel)
      if (fs.statSync(full).isFile()) files[`confined/${rel.split(path.sep).join('/')}`] = fs.readFileSync(full, 'utf8')
    }
    // The page's canary sits in its own folder: nothing outside the folder is served.
    files['confined/site/canary.js'] = fs.readFileSync(path.join(FIXTURE, '..', 'canary.js'), 'utf8')
    const SECRETS = ['ERFANA-FILE-SIBLING-7f3a', 'ERFANA-FILE-NESTED-7f3a', 'ERFANA-FILE-OUTSIDE-7f3a', 'ERFANA-FILE-OUTSIDE-HTML-7f3a']
    test.use({ testProjectFiles: files })

    test('025-AC-046 hostile local page: siblings, a subfolder and a file outside its folder are unreadable, and no service worker registers', async ({
      browserTabs,
      browserServers,
      testProject
    }) => {
      const hostile = new HostileSuite(browserTabs, browserServers)
      const page = await browserTabs.open()
      const shown = pathToFileURL(fs.realpathSync(path.join(testProject.path, 'confined', 'site', 'index.html'))).href
      expect(await browserTabs.navigate(page.tabId, shown)).toEqual({ ok: true })
      await browserTabs.waitForState(page.tabId, { committedUrl: shown, loading: false })
      const report = await hostile.finish(
        page,
        `window.__canary && document.getElementById('sibling-image').textContent !== '' && document.getElementById('outside-image').textContent !== ''
          && window.__canary.results.some((r) => r.name === 'service worker') && ${FRAMES_SETTLED('iframe')}`,
        'images and frames settled'
      )

      expect(report.attempts.map((a) => a.name)).toEqual(
        expect.arrayContaining(['fetch sibling', 'xhr subfolder', 'iframe contentDocument outside', 'service worker'])
      )
      expect(leaks(report)).toEqual([])
      for (const secret of SECRETS) expect(reportText(report)).not.toContain(secret)
      // The folder's own image shows; one outside it does not.
      expect(await page.eval(`document.getElementById('sibling-image').textContent`)).toBe('loaded')
      expect(await page.eval(`document.getElementById('outside-image').textContent`)).toBe('error')
    })

    test('025-AC-046 hostile local page: two folders cannot read each other\'s localStorage', async ({ browserTabs, testProject }) => {
      const open = async (folder: string): Promise<string> => {
        const page = await browserTabs.open()
        const shown = pathToFileURL(fs.realpathSync(path.join(testProject.path, 'confined', folder, 'storage.html'))).href
        expect(await browserTabs.navigate(page.tabId, shown)).toEqual({ ok: true })
        await browserTabs.waitForState(page.tabId, { committedUrl: shown, loading: false })
        await page.waitFor(`document.getElementById('keys').textContent !== ''`, `${folder} reported`)
        return page.eval<string>(`document.getElementById('keys').textContent`)
      }
      expect(await open('a')).toBe('probe-a')
      // b runs after a wrote: it sees only its own key.
      expect(await open('b')).toBe('probe-b')
    })
  })
})

test.describe('built-in browser hostile pages: navigations and escapes', () => {
  test('025-AC-046 hostile page: navigating itself to chrome:, devtools:, a top-level data:, file:, view-source: and javascript: leaves it in place', async ({
    browserTabs,
    browserServers
  }) => {
    const hostile = new HostileSuite(browserTabs, browserServers)
    const url = hostile.url('/scheme-escape.html')
    const page = await hostile.open(url)
    const windows = await hostile.windowCount()
    const targets = await page.eval<string[]>('TARGETS')
    expect(targets).toHaveLength(7)
    // The last target is javascript:, which runs in the page itself; it goes last (below).
    const refused = targets.slice(0, 6)
    // window.open of javascript: with no user action (before any click below) opens nothing.
    await page.eval('window.__canary.openJavascript(); 0')

    for (let i = 0; i < refused.length; i += 1) {
      const token = await hostile.mark(page)
      await page.eval(`window.__canary.navigate(${i}); 0`)
      await hostile.expectStayed(page, url, token, `navigate to ${refused[i]!.slice(0, 40)}`)
    }
    // The same by a user click on each button.
    for (let i = 0; i < refused.length; i += 1) {
      const token = await hostile.mark(page)
      await page.clickSelector(`#navigate-${i}`)
      await hostile.expectStayed(page, url, token, `click to ${refused[i]!.slice(0, 40)}`)
    }
    const report = await hostile.report(page)
    expect(leaks(report)).toEqual([])
    await hostile.sentinel(page)
    expect(await hostile.windowCount()).toBe(windows)
    expect(await browserTabs.tabs()).toHaveLength(1)

    // javascript: is the page's own script on its own document, as in any browser: the
    // tab stays on the same address and origin, and nothing else opens.
    await page.eval('window.__canary.navigate(6); 0')
    // The URL's string result replaces the page's own document (standard javascript: URL behaviour).
    await page.waitFor(`document.title === 'ERFANA-HOSTILE-JS-7f3a' || (document.body !== null && document.body.textContent.includes('ERFANA-HOSTILE-JS-7f3a'))`, 'javascript: ran in the page')
    await browserTabs.waitForState(page.tabId, { committedUrl: url, pendingUrl: null, loading: false })
    expect(await page.eval('location.href')).toBe(url)
    expect(await hostile.windowCount()).toBe(windows)
    expect(await browserTabs.tabs()).toHaveLength(1)
    await hostile.expectOnlyTabsInBrowserSession()
  })

  test('025-AC-046 hostile page: a cross-site and a sandboxed frame reach nothing of the page or Erfana, and cannot move the tab to app addresses', async ({
    browserTabs,
    browserServers
  }) => {
    const hostile = new HostileSuite(browserTabs, browserServers)
    const url = hostile.url('/frame-escape.html')
    const page = await hostile.open(url)
    const windows = await hostile.windowCount()
    const crossOrigin = new URL(hostile.url('', { host: 'hostile-other.test' })).origin

    // Each frame runs eight attacks and posts every result here.
    await page.waitFor(
      `window.__canary.results.filter((r) => r.name.startsWith(${JSON.stringify(`frame ${crossOrigin}: `)})).length === 8
        && window.__canary.results.filter((r) => r.name.startsWith('frame null: ')).length === 8`,
      'both frames reported'
    )
    const report = await hostile.report(page)
    expect(leaks(report)).toEqual([])
    for (const origin of [crossOrigin, 'null']) {
      for (const attack of ['own window.electron', 'parent.document', 'parent.electron', 'top.document', 'top.electron', 'window.open javascript:', 'window.open chrome://gpu']) {
        expect(report.attempts.map((a) => `${a.name}=${a.outcome}`)).toContain(`frame ${origin}: ${attack}=blocked`)
      }
    }

    // Top-level navigations from inside each frame, with a user gesture there: refused, the page stays.
    for (const frame of ['hostile-other.test', 'sandboxed=1']) {
      for (const target of ['chrome://gpu', 'file:///etc/hosts', RENDERER_ENTRY, 'erfana://terminal/new']) {
        const token = await hostile.mark(page)
        await hostile.frameExec(page.tabId, frame, `window.__escape.navigate('top', ${JSON.stringify(target)}); 0`)
        await hostile.expectStayed(page, url, token, `${frame} → top ${target}`)
      }
    }
    expect(await hostile.windowCount()).toBe(windows)
    await hostile.expectOnlyTabsInBrowserSession()
  })

  test('025-AC-046 hostile popup: it cannot move its opener or itself to app addresses, and opens no popup of its own without a user action', async ({
    browserTabs,
    browserServers
  }) => {
    const hostile = new HostileSuite(browserTabs, browserServers)
    const url = hostile.url('/popup-escape.html')
    const page = await hostile.open(url)
    await page.clickSelector('#open-popups')
    await expect.poll(async () => (await hostile.popups()).length, { timeout: 15_000 }).toBe(1)
    const popup = (await hostile.popups())[0]!
    const popupUrl = hostile.url('/popup-escape-child.html?chain=1')
    await expect.poll(async () => (await hostile.popups())[0]?.committedUrl, { timeout: 15_000 }).toBe(popupUrl)
    await expect
      .poll(() => hostile.popupExec<boolean>(popup.pageWebContentsId, `window.__canary.results.some((r) => r.name === 'chained popup 2')`), { timeout: 15_000 })
      .toBe(true)
    // The chain: the popup's own popup, with no user action, was blocked.
    expect(await hostile.popupExec<string>(popup.pageWebContentsId, `window.__canary.results.find((r) => r.name === 'chained popup 2').detail`)).toBe('false')
    expect(await hostile.popups()).toHaveLength(1)

    const windows = await hostile.windowCount()
    for (const target of ['chrome://gpu', 'file:///etc/hosts', RENDERER_ENTRY, 'erfana://terminal/new']) {
      // The opener, from the popup.
      const token = await hostile.mark(page)
      await hostile.popupExec(popup.pageWebContentsId, `window.__escape.navigate('opener', ${JSON.stringify(target)}); 0`)
      await hostile.expectStayed(page, url, token, `popup → opener ${target}`)
      // The popup itself.
      await hostile.popupExec(popup.pageWebContentsId, `window.__e2eStay = 'popup'; location.href = ${JSON.stringify(target)}; 0`)
      await hostile.sentinel(page)
      await expect
        .poll(() => hostile.popupExec<boolean>(popup.pageWebContentsId, `window.__e2eStay === 'popup' && location.href === ${JSON.stringify(popupUrl)}`), {
          timeout: 15_000
        })
        .toBe(true)
      expect((await hostile.popups())[0]?.committedUrl, `popup → ${target}`).toBe(popupUrl)
    }
    expect(await hostile.windowCount()).toBe(windows)
    await hostile.expectOnlyTabsInBrowserSession()
  })

  test('025-AC-046 hostile page: downloads of runnable files open nothing and save nothing without the save dialog', async ({
    browserTabs,
    browserServers
  }) => {
    const hostile = new HostileSuite(browserTabs, browserServers)
    const downloads = new DownloadsDriver(browserTabs.app, browserTabs.window)
    const folder = test.info().outputPath('downloads')
    fs.mkdirSync(folder, { recursive: true })
    await hostile.recordShellOpens()
    await downloads.answerSaveDialog(null)

    const page = await hostile.open(hostile.url(`/open-downloads.html?downloads=${encodeURIComponent(folder)}`))
    const report = await hostile.report(page)
    expect(report.attempts.filter((a) => a.name.startsWith('open ') || a.name.startsWith('fetch '))).toHaveLength(8)
    expect(leaks(report)).toEqual([])

    // The first download of the load asks where to save, with the warning; the rest, with no user action, do not reach a dialog.
    const calls = await downloads.waitForDialogCount(1)
    const first = path.basename(calls[0]!)
    expect(['evil.command', 'evil.html', 'evil.desktop', 'evil.exe']).toContain(first)
    expect((await downloads.dialogCalls())[0]!.title).toBe(isExecutableDownload(first) ? EXECUTABLE_WARNING_TITLE : null)
    await hostile.sentinel(page)
    expect(await downloads.dialogPaths()).toHaveLength(1)
    expect(await hostile.shellOpens()).toEqual({ external: [], paths: [], shown: [] })
    expect(fs.readdirSync(folder)).toEqual([])
    await hostile.expectOnlyTabsInBrowserSession()
  })
})

/** What `session-probe.html`'s `__probe.read()` reports. */
interface ProbeSeen {
  cookie: string
  localStorage: string[]
  notification: string
}

/** The page's location permission as the engine reports it (`granted`, `prompt`, `denied` or an error name). */
const GEOLOCATION = `navigator.permissions.query({ name: 'geolocation' }).then((s) => s.state, (e) => e.name)`

/** The HTML Preview's half of the session probe: it writes its own cookie and storage entry. */
const PREVIEW_PROBE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>preview probe</title></head>
<body><p>preview probe</p><script>
  var out = {}
  try { localStorage.setItem('erfana_preview_probe', '1'); out.storage = 'written' } catch (e) { out.storage = e.name }
  try { document.cookie = 'erfana_preview_probe=1; Max-Age=600; path=/'; out.cookie = document.cookie } catch (e) { out.cookie = e.name }
  window.__previewProbe = out
  document.title = 'PREVIEW-PROBE-READY'
</script></body></html>
`

test.describe('built-in browser hostile pages: sessions', () => {
  test.use({ testProjectFiles: { 'preview-probe.html': PREVIEW_PROBE } })

  test('025-AC-046 hostile page: a cookie, a storage entry and a permission set in a browser tab are absent from Erfana\'s session and the HTML Preview\'s, and the reverse', async ({
    appWithTestProject: app,
    windowWithTestProject: window,
    browserServers
  }) => {
    const ui = new BrowserTabUiPage(app, window)
    const panel = await ui.openWithButton()
    // Over HTTPS: a site permission is asked only in a secure context.
    expect(await testHook<number>(app, 'site', 'trustTestCa', browserServers.tls.caPem)).toBeGreaterThan(0)
    const url = browserServers.sites.hostile.url('/session-probe.html', { secure: true })
    await panel.load(url)
    await panel.waitForState({ committedUrl: url, loading: false })
    const page = await panel.page()
    await page.waitForLoaded(url)

    // The browser tab writes a cookie, localStorage and IndexedDB (`__probe.write()`), and is granted
    // location in the strip. (Notifications are not used: the page reads them as denied without a prompt.)
    await page.eval('window.__probe.write().then((p) => { window.__written = p }); 0')
    await page.waitFor(`window.__written !== undefined`, 'probe written')
    await testHook(app, 'browserInput', 'execWithGesture', page.tabId, 'navigator.geolocation.getCurrentPosition(() => {}, () => {}); 0')
    await panel.answerRow('permission', 'Allow')
    await page.waitFor(`navigator.permissions.query({ name: 'geolocation' }).then((s) => s.state === 'granted')`, 'location granted')
    const inTab = await page.eval<ProbeSeen>('window.__probe.read()')
    // Positive control: the tab itself sees all three.
    expect(inTab.cookie).toContain('erfana_isolation_probe=7f3a')
    expect(inTab.localStorage).toContain('erfana_isolation_probe=7f3a')
    expect(await page.eval(GEOLOCATION)).toBe('granted')

    // Erfana's own session: the same origin in a hidden window there sees none of it; it then writes its own.
    await installBoundedExec(app)
    const inDefault = await app.evaluate(async ({ BrowserWindow, session }, [probeUrl, geolocation, capMs]) => {
      const { __erfanaE2eExec: exec } = globalThis as unknown as BoundedExecGlobal
      const run = <T>(code: string): Promise<T> => exec<T>(probe.webContents, code, capMs as number, 'default-session probe')
      const probe = new BrowserWindow({ show: false, webPreferences: { session: session.defaultSession, sandbox: true, contextIsolation: true } })
      // The test CA is trusted only in browser sessions: accept it for this window alone.
      probe.webContents.on('certificate-error', (event, _url, _error, _certificate, callback) => {
        event.preventDefault()
        callback(true)
      })
      try {
        await probe.loadURL(probeUrl as string)
        const seen = await run<{ cookie: string; localStorage: string[] }>('window.__probe.read()')
        const location = await run<string>(geolocation as string)
        await run(`document.cookie = 'erfana_default_probe=1; Max-Age=600; path=/'; localStorage.setItem('erfana_default_probe', '1'); 0`)
        const own = await run<{ cookie: string; localStorage: string[] }>('window.__probe.read()')
        const cookies = (await session.defaultSession.cookies.get({})).map((c) => c.name)
        return { seen, location, own, cookies }
      } finally {
        probe.destroy()
      }
    }, [url, GEOLOCATION, EXEC_ACTION_CAP_MS] as const)
    expect(inDefault.seen.cookie).not.toContain('erfana_isolation_probe')
    expect(inDefault.seen.localStorage.join()).not.toContain('erfana_isolation_probe')
    expect(inDefault.location).not.toBe('granted')
    expect(inDefault.cookies).not.toContain('erfana_isolation_probe')
    // Positive control for the reverse: Erfana's session holds its own entries.
    expect(inDefault.own.cookie).toContain('erfana_default_probe=1')
    expect(inDefault.own.localStorage).toContain('erfana_default_probe=1')

    // The HTML Preview's session: none of the tab's entries; its own cookie (also one for the hostile origin) and storage stay there.
    // Read now: the preview takes the editor area, and the browser panel is no longer the one drawn.
    const tabContentsId = (await panel.hookTab()).webContentsId
    const preview = new HtmlPreviewPage(window, app)
    await preview.open('preview-probe.html')
    await expect.poll(() => preview.eval('document.title'), { timeout: 20_000 }).toBe('PREVIEW-PROBE-READY')
    const previewSeen = JSON.parse(
      (await preview.eval(`(async () => JSON.stringify({ probe: window.__previewProbe, location: await ${GEOLOCATION},
        storage: (() => { try { return Object.keys(localStorage) } catch (e) { return [e.name] } })() }))()`))!
    ) as { probe: { storage: string }; location: string; storage: string[] }
    expect(previewSeen.storage).not.toContain('erfana_isolation_probe')
    // The preview page is an opaque origin with no storage at all; its session's cookie jar is
    // reached from main instead (a cookie for the hostile origin is set there below).
    expect(previewSeen.probe).toEqual({ storage: 'SecurityError', cookie: 'SecurityError' })
    expect(previewSeen.location).not.toBe('granted')
    const sessions = await app.evaluate(async ({ webContents, session }, [tabId, probeUrl]) => {
      const tab = webContents.fromId(tabId as number)!
      const previewContents = webContents.getAllWebContents().find((c) => c.getURL().startsWith('erfana-preview://'))!
      await previewContents.session.cookies.set({ url: probeUrl as string, name: 'erfana_preview_probe', value: '1' })
      return {
        distinct: tab.session !== session.defaultSession && tab.session !== previewContents.session && previewContents.session !== session.defaultSession,
        previewCookies: (await previewContents.session.cookies.get({})).map((c) => c.name),
        tabCookies: (await tab.session.cookies.get({})).map((c) => c.name)
      }
    }, [tabContentsId, url] as const)
    expect(sessions.distinct).toBe(true)
    expect(sessions.previewCookies).not.toContain('erfana_isolation_probe')
    expect(sessions.previewCookies).toContain('erfana_preview_probe')

    // The reverse, in the tab after a reload: neither Erfana's nor the Preview's entries.
    await page.eval('location.reload(); 0')
    await page.waitFor(`document.readyState === 'complete' && typeof window.__probe === 'object' && window.__written === undefined`, 'reloaded')
    const after = await page.eval<ProbeSeen>('window.__probe.read()')
    expect(after.cookie).toContain('erfana_isolation_probe=7f3a')
    expect(after.cookie).not.toContain('erfana_default_probe')
    expect(after.cookie).not.toContain('erfana_preview_probe')
    expect(after.localStorage).toEqual(['erfana_isolation_probe=7f3a'])
    expect(sessions.tabCookies).not.toContain('erfana_default_probe')
    expect(sessions.tabCookies).not.toContain('erfana_preview_probe')
  })
})

/**
 * Keys of `BROWSER_WEB_PREFERENCES` that Electron's `getLastWebPreferences()`
 * does not report back (Electron 44): they cannot be read from a live view, so
 * the unit test `browserWebPreferences.test.ts` is their only check. Should
 * Electron start reporting one, the test below compares it too and this list
 * must shrink.
 */
const UNREPORTED_KEYS = [
  'autoplayPolicy',
  'backgroundThrottling',
  'devTools',
  'disableHtmlFullscreenWindowResize',
  'focusOnNavigation',
  'images',
  'navigateOnDragDrop',
  'spellcheck'
]

test.describe('built-in browser hostile pages: view settings', () => {
  // Not titled 025-AC-046: eight keys of the literal are not readable from a live view (UNREPORTED_KEYS).
  // A popup and a target=_blank tab are page-opened: Electron wraps their webContents in a view, which
  // resets every setting unless the frozen ones are given again (adoptedBrowserViewOptions).
  test('hostile isolation: a browser tab, its popup and a target=_blank tab report BROWSER_WEB_PREFERENCES for every key Electron reads back, and no preload', async ({
    browserTabs,
    browserServers
  }) => {
    const hostile = new HostileSuite(browserTabs, browserServers)
    const page = await hostile.open(hostile.url('/popup-escape.html'))
    await page.clickSelector('#open-popups')
    await expect.poll(async () => (await hostile.popups()).length, { timeout: 15_000 }).toBe(1)
    await page.eval(`(() => {
      const a = document.createElement('a')
      a.id = 'e2e-blank'
      a.target = '_blank'
      a.href = '/popup-escape.html?via=blank'
      a.textContent = 'new tab'
      a.style.cssText = 'position:fixed;left:8px;top:8px;width:96px;height:32px;z-index:2147483647'
      document.body.appendChild(a)
      return true
    })()`)
    await page.clickSelector('#e2e-blank')
    await expect.poll(async () => (await browserTabs.tabs()).some((t) => t.url.includes('via=blank')), { timeout: 15_000 }).toBe(true)
    const expected: Record<string, unknown> = { ...browserWebPreferencesFor(process.platform) }
    const tabs = await browserTabs.tabs()
    const ids = [
      tabs.find((t) => !t.url.includes('via=blank'))!.webContentsId,
      (await hostile.popups())[0]!.pageWebContentsId,
      tabs.find((t) => t.url.includes('via=blank'))!.webContentsId
    ]

    for (const id of ids) {
      const seen = await browserTabs.app.evaluate(({ webContents }, contentsId) => {
        const prefs = (webContents.fromId(contentsId) as unknown as { getLastWebPreferences(): Record<string, unknown> }).getLastWebPreferences()
        const plain: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(prefs)) if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) plain[k] = v
        return plain
      }, id)
      const reported = Object.keys(expected).filter((k) => seen[k] !== undefined)
      expect(Object.keys(expected).filter((k) => !reported.includes(k)).sort(), `webContents ${id}: keys not read back`).toEqual(UNREPORTED_KEYS)
      expect(Object.fromEntries(reported.map((k) => [k, seen[k]])), `webContents ${id}`).toEqual(Object.fromEntries(reported.map((k) => [k, expected[k]])))
      expect(seen['preload'] ?? null, `webContents ${id}: preload`).toBeNull()
      expect(seen['enableBlinkFeatures'] ?? '', `webContents ${id}: enableBlinkFeatures`).toBe('')
      expect(seen['nodeIntegration'], `webContents ${id}`).toBe(false)
    }
  })
})
