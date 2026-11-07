// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Local files in a built-in browser tab (spec 025 commit 11, 025-FR-005
 * rule 1, 025-FR-010; ADR 0012 option 4 – the per-folder loopback server,
 * working assumption pending the owner's Q4).
 *
 * A hostile local folder lives in the test project: `site/index.html` tries
 * every script read of a sibling (`fetch`, `XMLHttpRequest`, a frame's
 * document, a text file in a frame), of a file outside its folder and of a
 * dot-folder, registers a service worker, and opens a window; a second
 * folder, `other/`, is its own origin. The page records how each attempt
 * ended in `window.__local`; the test reads it through the main-process
 * hook. Condition-based waits only.
 */
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { test, expect } from './fixtures/browserHarness'
import type { BrowserTabPage } from './pages/browser-tab.page'
import type { BrowserPagePage } from './pages/browser-page.page'

const CANARY = 'ERFANA-LOCAL-FILES-CANARY-91c4'
const OUTSIDE_CANARY = 'ERFANA-OUTSIDE-CANARY-5d02'
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#1565c0"/></svg>'

/** How `site/index.html` records each attempt: `ok <detail>` or `failed <detail>`. */
const SITE_INDEX = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Local site</title>
<link rel="stylesheet" href="style.css">
<script src="script.js"></script>
<script type="module" src="module.mjs"></script>
</head>
<body>
<img id="sibling" src="image.svg" alt="">
<img id="outside" src="../outside/secret.svg" alt="">
<img id="dotted" src=".hidden/x.svg" alt="">
<a id="blank" href="frame.html" target="_blank">new tab</a>
<script>
  var local = { attempts: {}, frameImage: null, done: false }
  window.__local = local
  function settle(name, promise) {
    return Promise.resolve().then(function () { return promise() }).then(
      function (v) { local.attempts[name] = 'ok ' + v },
      function (e) { local.attempts[name] = 'failed ' + (e && (e.name || e.message)) }
    )
  }
  function readFrame(src) {
    return new Promise(function (resolve, reject) {
      var frame = document.createElement('iframe')
      frame.onload = function () {
        try {
          var text = frame.contentDocument && frame.contentDocument.documentElement.textContent
          text ? resolve(text) : reject(new Error('no document'))
        } catch (error) { reject(error) }
      }
      frame.src = src
      document.body.appendChild(frame)
    })
  }
  function xhr(src) {
    return new Promise(function (resolve, reject) {
      var r = new XMLHttpRequest()
      r.open('GET', src)
      r.onload = function () { r.status === 200 ? resolve(r.responseText) : reject(new Error('status ' + r.status)) }
      r.onerror = function () { reject(new Error('xhr')) }
      r.send()
    })
  }
  function shown(id) {
    var img = document.getElementById(id)
    return img.decode().then(function () { return img.naturalWidth })
  }
  window.addEventListener('message', function (event) {
    if (event.data && event.data.frameImage !== undefined) local.frameImage = event.data.frameImage
  })
  Promise.all([
    settle('fetch', function () { return fetch('canary.txt').then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('status ' + r.status)) }) }),
    settle('xhr', function () { return xhr('canary.txt') }),
    settle('frameDocument', function () { return readFrame('frame.html') }),
    settle('textFrame', function () { return readFrame('canary.txt') }),
    settle('outsideFetch', function () { return fetch('../outside/canary.txt').then(function (r) { return r.text() }) }),
    settle('outsideFrame', function () { return readFrame('../outside/canary.txt') }),
    settle('serviceWorker', function () { return navigator.serviceWorker.register('script.js').then(function () { return 'registered' }) }),
    settle('windowOpen', function () { var w = window.open('frame.html'); return w ? 'opened' : Promise.reject(new Error('null')) }),
    settle('siblingImage', function () { return shown('sibling') }),
    settle('outsideImage', function () { return shown('outside') }),
    settle('dottedImage', function () { return shown('dotted') })
  ]).then(function () { local.done = true })
</script>
</body>
</html>
`

/** Framed sandboxed: reports to its parent whether its own image displayed. */
const SITE_FRAME = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Local frame</title></head>
<body><p>local frame</p><img id="i" src="image.svg" alt="">
<script>
  var img = document.getElementById('i')
  img.decode().then(function () { parent.postMessage({ frameImage: img.naturalWidth }, '*') },
    function () { parent.postMessage({ frameImage: 0 }, '*') })
</script></body></html>
`

const PAGE_B = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Page B</title><link rel="stylesheet" href="style.css"></head>
<body><p>page b</p><script>window.__pageB = true</script></body></html>
`

const OTHER_INDEX = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Other folder</title></head>
<body><p>other folder</p><img id="mine" src="image.svg" alt=""><script>window.__other = true</script></body></html>
`

test.use({
  testProjectFiles: {
    'site/index.html': SITE_INDEX,
    'site/frame.html': SITE_FRAME,
    'site/page-b.html': PAGE_B,
    'site/canary.txt': CANARY,
    'site/image.svg': SVG,
    'site/style.css': 'body { background: rgb(1, 2, 3); }',
    'site/script.js': 'window.__classicScriptRan = true',
    'site/module.mjs': 'window.__moduleScriptRan = true',
    'site/.hidden/x.svg': SVG,
    'outside/secret.svg': SVG,
    'outside/canary.txt': OUTSIDE_CANARY,
    'other/index.html': OTHER_INDEX,
    'other/image.svg': SVG
  }
})

/** The file:// address the bar shows for a project file. */
function fileUrl(projectPath: string, rel: string): string {
  return pathToFileURL(fs.realpathSync(path.join(projectPath, rel))).href
}

/** Open `rel` from the address bar's `file://` input and wait until it committed and its script ran. */
async function openLocal(browserTabs: BrowserTabPage, projectPath: string, rel: string, ready: string): Promise<BrowserPagePage> {
  const page = await browserTabs.open()
  const shown = fileUrl(projectPath, rel)
  expect(await browserTabs.navigate(page.tabId, shown)).toEqual({ ok: true })
  await browserTabs.waitForState(page.tabId, { committedUrl: shown, loading: false })
  await page.waitFor(ready, `${rel} ready`)
  return page
}

/** The served (loopback) address a tab is on, from main. */
async function servedUrl(browserTabs: BrowserTabPage, tabId: string): Promise<string> {
  const tab = (await browserTabs.tabs()).find((t) => t.tabId === tabId)
  if (tab === undefined) throw new Error(`no tab ${tabId}`)
  return tab.url
}

/** A raw request from this process – another local program – to a served folder. */
function rawGet(url: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
  })
}

test.describe('built-in browser local files', () => {
  test('025-AC-005 a local page shows its folder\'s files and reads none by script', async ({ browserTabs, testProject }) => {
    const page = await openLocal(browserTabs, testProject.path, 'site/index.html', 'window.__local && window.__local.done')
    const attempts = await page.eval<Record<string, string>>('window.__local.attempts')

    // Shown from the folder: an image, a style, a classic and a module script.
    expect(attempts['siblingImage']).toBe('ok 16')
    expect(await page.eval('getComputedStyle(document.body).backgroundColor')).toBe('rgb(1, 2, 3)')
    expect(await page.eval('window.__classicScriptRan === true && window.__moduleScriptRan === true')).toBe(true)

    // Read by script: never – a sibling by fetch, XHR and through frames.
    for (const name of ['fetch', 'xhr', 'frameDocument', 'textFrame']) {
      expect(attempts[name], name).toMatch(/^failed/)
    }
    // Outside the folder, a dot-folder, a service worker: nothing.
    for (const name of ['outsideFetch', 'outsideFrame', 'outsideImage', 'dottedImage', 'serviceWorker']) {
      expect(attempts[name], name).toMatch(/^failed/)
    }
    expect(JSON.stringify(attempts)).not.toContain(CANARY)
    expect(JSON.stringify(attempts)).not.toContain(OUTSIDE_CANARY)
    // A frame shows its own images from the folder, sandboxed.
    await page.waitFor('window.__local.frameImage !== null', 'frame reported its image')
    expect(await page.eval('window.__local.frameImage')).toBe(16)
  })

  test('025-AC-005 two folders are two origins: neither reads the other\'s localStorage', async ({ browserTabs, testProject }) => {
    const site = await openLocal(browserTabs, testProject.path, 'site/index.html', 'window.__local && window.__local.done')
    const other = await openLocal(browserTabs, testProject.path, 'other/index.html', 'window.__other === true')
    await site.eval(`localStorage.setItem('who', 'site'); 0`)
    await other.eval(`localStorage.setItem('who', 'other'); 0`)
    expect(await site.eval(`localStorage.getItem('who')`)).toBe('site')
    expect(await other.eval(`localStorage.getItem('who')`)).toBe('other')
    expect(new URL(await servedUrl(browserTabs, site.tabId)).origin).not.toBe(new URL(await servedUrl(browserTabs, other.tabId)).origin)
  })

  test('hostile local folder: another folder\'s server, a popup and a new tab are refused', async ({ browserTabs, testProject }) => {
    const site = await openLocal(browserTabs, testProject.path, 'site/index.html', 'window.__local && window.__local.done')
    const other = await openLocal(browserTabs, testProject.path, 'other/index.html', 'window.__other === true')
    const otherUrl = await servedUrl(browserTabs, other.tabId)
    const otherImage = otherUrl.replace('index.html', 'image.svg')
    const tabsBefore = (await browserTabs.tabs()).length
    const contentsBefore = (await browserTabs.browserSessionContents()).length

    // The page knows the other folder's secret address and still gets nothing from it.
    const reads = await site.eval<Record<string, string>>(`(async () => {
      const out = {}
      const img = new Image(); img.src = ${JSON.stringify(otherImage)}
      out.image = await img.decode().then(() => 'ok', () => 'failed')
      out.fetch = await fetch(${JSON.stringify(otherUrl)}).then(r => 'ok ' + r.status, () => 'failed')
      // A refused frame never fires load: it is read after the sentinel below, not awaited.
      const f = document.createElement('iframe')
      f.id = 'otherFrame'
      f.src = ${JSON.stringify(otherUrl)}
      document.body.appendChild(f)
      return out
    })()`)
    expect(reads.image).toBe('failed')
    expect(reads.fetch).toBe('failed')

    // A popup and a new tab to a file of its own folder: refused, and nothing opened.
    expect(await site.eval('window.__local.attempts.windowOpen')).toMatch(/^failed/)
    await site.clickSelector('#blank')
    await site.eval(`window.__sentinel = true; 0`)
    await site.waitFor('window.__sentinel === true')
    expect((await browserTabs.tabs()).length).toBe(tabsBefore)
    expect((await browserTabs.browserSessionContents()).length).toBe(contentsBefore)
    const frameText = await site.eval<string>(`(() => {
      try { const d = document.getElementById('otherFrame').contentDocument; return d ? 'readable ' + d.documentElement.textContent : 'unreadable' } catch { return 'unreadable' }
    })()`)
    expect(frameText).not.toContain('other folder')

    // Navigating itself to the other folder: refused, the page stays.
    const siteShown = fileUrl(testProject.path, 'site/index.html')
    await site.eval(`window.__stay = true; location.href = ${JSON.stringify(otherUrl)}; 0`)
    await browserTabs.waitForState(site.tabId, { loading: false })
    await site.waitFor('window.__stay === true', 'still the site page')
    expect((await browserTabs.lastState(site.tabId))?.committedUrl).toBe(siteShown)
  })

  test('a link to a page of the same folder opens it sandboxed (S-7)', async ({ browserTabs, testProject }) => {
    const site = await openLocal(browserTabs, testProject.path, 'site/index.html', 'window.__local && window.__local.done')
    await site.eval(`location.href = 'page-b.html'; 0`)
    await browserTabs.waitForState(site.tabId, { committedUrl: fileUrl(testProject.path, 'site/page-b.html'), loading: false })
    await site.waitFor('window.__pageB === true', 'page b ran')
    // Opaque origin: no storage; its style still loads from the folder.
    expect(await site.eval('self.origin')).toBe('null')
    expect(await site.eval(`(() => { try { localStorage.length; return 'storage' } catch { return 'no storage' } })()`)).toBe('no storage')
    expect(await site.eval('getComputedStyle(document.body).backgroundColor')).toBe('rgb(1, 2, 3)')
  })

  test('025-AC-010 Open in browser tab loads the file\'s file:// address (main part)', async ({ browserTabs, testProject }) => {
    const page = await browserTabs.open()
    const filePath = path.join(testProject.path, 'other', 'index.html')
    expect(await browserTabs.openLocalFile(page.tabId, filePath)).toEqual({ ok: true })
    await browserTabs.waitForState(page.tabId, { committedUrl: fileUrl(testProject.path, 'other/index.html'), loading: false })
    await page.waitFor('window.__other === true')
    // Reload keeps the folder's origin: the load is armed again.
    await page.eval(`localStorage.setItem('kept', '1'); 0`)
    await browserTabs.history(page.tabId, 'reload')
    await page.waitFor(`window.__other === true && localStorage.getItem('kept') === '1'`, 'reloaded with storage')
  })

  test('a served folder answers no other program, and closes with its last tab', async ({ browserTabs, testProject }) => {
    const page = await openLocal(browserTabs, testProject.path, 'site/index.html', 'window.__local && window.__local.done')
    const served = await servedUrl(browserTabs, page.tabId)
    const origin = new URL(served).origin
    // Without the token, and without a browser's fetch metadata, nothing is served.
    expect(await rawGet(`${origin}/canary.txt`, { 'Sec-Fetch-Dest': 'image', 'Sec-Fetch-Site': 'same-origin' })).toBe(404)
    expect(await rawGet(served.replace('index.html', 'canary.txt'))).toBe(403)

    await browserTabs.close(page.tabId)
    await expect.poll(() => rawGet(served).then(() => 'open', () => 'closed'), { timeout: 15_000 }).toBe('closed')
  })
})
