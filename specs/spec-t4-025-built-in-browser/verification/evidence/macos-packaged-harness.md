# macOS packaged-lane harness (spec 025, 2026-11-03)

The evidence files `025-AC-022-macos.md`, `025-AC-052-macos.md` and `025-AC-079-macos.md` in this folder were produced with the Playwright script below. It is a one-off evidence harness, not part of the repository suite: it ran from a scratch folder with its own config, and `<worktree>` stands for the checkout it was run from (commit `b95ca4fc`). The full procedure, including how the bundles were built, is in each evidence file.

## How it drives a packaged app

- **Bundles.** A production bundle has `EnableNodeCliInspectArguments` off, so Playwright cannot attach to it. The script drives the documented test build instead (`ERFANA_TEST_BUILD=true`, bundle `Erfana (TEST BUILD).app`), whose fuse wire differs from production only in that inspector fuse (`scripts/fuses.js`, `buildFuseConfig`). The fuse-off control and the drivable v0.23.1 are copies with one fuse flipped by `flip.mjs` (below), then re-signed ad hoc the way `scripts/resign.js` does it (`codesign --force --deep --sign -`).
- **No test hooks.** The bundles come from a production-mode `electron-vite build`, so `__erfanaTestHooks` does not exist. The script uses the preload bridge (`window.api.browserTab`, `api.file`, `api.settings`, `api.transcription`, `api.projectLock`) and plain Electron main-process APIs through `app.evaluate` (`webContents.executeJavaScript`, `session.cookies`).
- **Isolation.** Every launch gets its own `--user-data-dir` and `HOME` under `<worktree>/.e2e-temp/` (Erfana refuses projects under `/private/tmp` and `/private/var` as system folders), the sealed-network `--host-resolver-rules` of the acceptance intro, and `--use-mock-keychain`.
- **Why `--use-mock-keychain`.** The machine already has the real `erfana Safe Storage` Keychain item of the installed, Developer ID-signed Erfana. An ad-hoc-signed bundle that reads it makes macOS show a Keychain access prompt, which blocks a headless run and would touch the user's real key. With the switch, Chromium's OSCrypt uses a fixed mock key: cookies are still encrypted (`v10` prefix) and `safeStorage` still works, but the key does not come from the Keychain. A run against the real Keychain needs the signed build.
- **Fixtures.** `startBrowserFixtureServers()` from `e2e/fixtures/browser/serve.ts` (ports assigned by the OS); `/__cookie-probe` from `e2e/fixtures/browser/server/commonRoutes.ts`; `/basic` from `stagingRoutes.ts`.

## Run

```sh
cd <worktree>
NODE_PATH=<worktree>/node_modules EVIDENCE_OUT=<scratch>/results \
  npx playwright test --config <scratch>/pw.config.cjs
# diagnostic only (not acceptance evidence): Chromium sandbox off
DIAG_ARGS=--no-sandbox EXTRA_ARGS=--no-sandbox RESULT_SUFFIX=-nosandbox-diagnostic NODE_PATH=… EVIDENCE_OUT=… \
  npx playwright test --config <scratch>/pw.config.cjs -g "diag|AC-052|AC-079"
```

## `pw.config.cjs`

```js
// Evidence harness for spec 025 packaged lanes (not part of the repo suite).
module.exports = {
  testDir: __dirname,
  testMatch: 'packaged.spec.ts',
  timeout: 240000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  outputDir: __dirname + '/test-results',
  reporter: [['list']]
}
```

## `flip.mjs`

```js
// Flip one Electron fuse on a COPY of a packaged app (evidence harness only).
// Usage: node flip.cjs <app path> <FuseV1Options name> <on|off>

const WT = '<worktree>'
const { flipFuses, FuseVersion, FuseV1Options } = await import(WT + '/node_modules/@electron/fuses/dist/index.js')

async function main() {
  const [appPath, name, state] = process.argv.slice(2)
  if (!appPath || !(name in FuseV1Options) || !['on', 'off'].includes(state)) {
    console.error('usage: node flip.cjs <app> <FuseV1Options name> <on|off>')
    process.exit(2)
  }
  await flipFuses(appPath, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: true,
    [FuseV1Options[name]]: state === 'on'
  })
  console.log(`flipped ${name} ${state} on ${appPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

## `packaged.spec.ts`

```ts
// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Evidence harness for the spec 025 `packaged` lanes on macOS:
 * 025-AC-052 (cookies at rest, with a fuse-off control), 025-AC-022 (basic
 * auth, packaged lane) and 025-AC-079 (update from v0.23.1 keeps data).
 *
 * Drives packaged bundles with Playwright `_electron.launch({ executablePath })`.
 * A production bundle has EnableNodeCliInspectArguments off, so the driven
 * bundles are the documented `ERFANA_TEST_BUILD=true` build (same fuses except
 * the inspector) and fuse-flipped copies of it / of v0.23.1. No test hooks
 * exist in these bundles (production electron-vite mode), so everything runs
 * through the preload bridge and plain Electron main-process APIs.
 *
 * Every launch gets its own --user-data-dir and HOME, and --use-mock-keychain
 * so the user's real "erfana Safe Storage" Keychain item is never read and no
 * Keychain prompt can appear.
 *
 * Writes a JSON result per case to $EVIDENCE_OUT.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import {
  BROWSER_CHROMIUM_ARGS,
  startBrowserFixtureServers,
  type BrowserFixtureServers
} from '<worktree>/e2e/fixtures/browser/serve'
import {
  BASIC_AUTH
} from '<worktree>/e2e/fixtures/browser/server/stagingRoutes'
import { COOKIE_PROBE_VALUE } from '<worktree>/e2e/fixtures/browser/server/commonRoutes'

const WT = '<worktree>'
const SCRATCH = __dirname
const APPS = {
  fuseOn: `${SCRATCH}/../src/release/test/0.24.0/mac-arm64/Erfana (TEST BUILD).app/Contents/MacOS/Erfana (TEST BUILD)`,
  fuseOff: `${SCRATCH}/apps/fuse-off-v2.app/Contents/MacOS/Erfana (TEST BUILD)`,
  v0231: `${SCRATCH}/apps/v0.23.1-inspect.app/Contents/MacOS/Erfana`
} as const
const OUT = process.env.EVIDENCE_OUT ?? path.join(SCRATCH, 'results')
// Erfana refuses projects under system folders (/private/tmp, /private/var), so sandboxes
// live in the worktree's gitignored .e2e-temp, as the e2e fixtures' own sandboxes do.
const E2E_TEMP = path.join(WT, '.e2e-temp')
fs.mkdirSync(E2E_TEMP, { recursive: true })
const RUN = fs.mkdtempSync(path.join(E2E_TEMP, `packaged-evidence-${os.hostname().length}-`))
/** Diagnostic only: extra Chromium switches for every launch (e.g. --no-sandbox), and a suffix for result files. */
const EXTRA_ARGS = process.env.EXTRA_ARGS ? process.env.EXTRA_ARGS.split(' ') : []
const SUFFIX = process.env.RESULT_SUFFIX ?? ''
const LOCAL_STORAGE_TOKEN ='erfana-localstorage-token-9c1e'
const INPUT_GUARD_MS = 500
const WAIT_MS = 20_000

let servers: BrowserFixtureServers

test.beforeAll(async () => {
  servers = await startBrowserFixtureServers()
  fs.mkdirSync(OUT, { recursive: true })
})
test.afterAll(async () => {
  await servers?.close()
})

function record(name: string, data: unknown): void {
  fs.writeFileSync(path.join(OUT, `${name}${SUFFIX}.json`), JSON.stringify({ extraArgs: EXTRA_ARGS, data }, null, 2))
}

interface Sandbox {
  root: string
  userData: string
  home: string
  project: string
}

function sandbox(name: string): Sandbox {
  const root = path.join(RUN, name)
  const s = { root, userData: path.join(root, 'userData'), home: path.join(root, 'home'), project: path.join(root, 'home', 'project') }
  for (const dir of [s.userData, s.home, s.project]) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(s.project, 'README.md'), '# packaged evidence project\n')
  return s
}

function appEnv(home: string): Record<string, string> {
  return {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: home,
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    USER: process.env.USER ?? '',
    LOGNAME: process.env.LOGNAME ?? '',
    SHELL: '/bin/zsh',
    LANG: 'en_US.UTF-8'
  }
}

interface Launched {
  app: ElectronApplication
  window: Page
  pid: number
}

async function launch(executablePath: string, box: Sandbox): Promise<Launched> {
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${box.userData}`, '--use-mock-keychain', ...EXTRA_ARGS, ...BROWSER_CHROMIUM_ARGS],
    env: appEnv(box.home),
    timeout: 60_000
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForFunction(() => !!(window as unknown as { api?: { file?: unknown } }).api?.file, null, { timeout: WAIT_MS })
  return { app, window, pid: app.process().pid ?? -1 }
}

/** Graceful quit through Erfana's own quit sequence; waits for the process to exit. */
async function quit(launched: Launched): Promise<void> {
  const exited = new Promise<void>((resolve) => {
    const proc = launched.app.process()
    if (proc.exitCode !== null) resolve()
    else proc.once('exit', () => resolve())
  })
  await launched.app.evaluate(({ app }) => app.quit()).catch(() => undefined)
  await Promise.race([exited, new Promise((r) => setTimeout(r, 30_000))])
  await launched.app.close().catch(() => undefined)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- preload bridge, untyped here
type Api = any

async function openProject(window: Page, projectPath: string): Promise<unknown> {
  return window.evaluate((p) => (window as unknown as { api: Api }).api.file.openProjectByPath({ projectPath: p }), projectPath)
}

async function installRecorders(window: Page): Promise<void> {
  await window.evaluate(() => {
    const w = window as unknown as { api: Api; __states?: Record<string, unknown>; __rows?: Record<string, unknown[]> }
    if (w.__states) return
    w.__states = {}
    w.__rows = {}
    w.api.browserTab.onState((s: { tabId: string }) => {
      w.__states![s.tabId] = s
    })
    w.api.browserTab.onStrip((e: { tabId: string; op: string; row?: unknown }) => {
      if (e.op === 'add' && e.row) (w.__rows![e.tabId] ??= []).push(e.row)
    })
  })
}

async function openTab(window: Page, url: string): Promise<string> {
  await installRecorders(window)
  const created = await window.evaluate(
    (id) => (window as unknown as { api: Api }).api.browserTab.create(id),
    `packaged-${Date.now()}`
  )
  if (!created || 'error' in created) throw new Error(`browser-tab:create refused: ${JSON.stringify(created)}`)
  const tabId = created.tabId as string
  const bounds = { x: 320, y: 80, width: 860, height: 620 }
  await window.evaluate(
    ([id, b]) => (window as unknown as { api: Api }).api.browserTab.setBounds({ tabId: id, bounds: b, seq: 1, ack: false, visible: true, clip: b }),
    [tabId, bounds] as const
  )
  await window.evaluate(
    ([id, u]) => (window as unknown as { api: Api }).api.browserTab.navigate({ tabId: id, input: u, source: 'address' }),
    [tabId, url] as const
  )
  return tabId
}

async function signInRows(window: Page, tabId: string): Promise<Array<Record<string, unknown>>> {
  return window.evaluate(
    (id) => ((window as unknown as { __rows?: Record<string, Array<Record<string, unknown>>> }).__rows?.[id] ?? []).filter((r) => r.kind === 'signIn'),
    tabId
  )
}

/** Run `code` in the browser-tab page whose URL starts with `prefix` (main-side executeJavaScript). */
async function pageEval<T>(app: ElectronApplication, prefix: string, code: string): Promise<T | null> {
  return (await app.evaluate(
    async ({ webContents }, [p, c]) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(p as string))
      if (!wc) return null
      try {
        return await wc.executeJavaScript(c as string)
      } catch {
        return null
      }
    },
    [prefix, code] as const
  )) as T | null
}

async function waitForPage(app: ElectronApplication, prefix: string, code: string): Promise<void> {
  await expect.poll(() => pageEval<boolean>(app, prefix, code), { timeout: WAIT_MS }).toBe(true)
}

/** Flush cookies and storage of every session that a page under `prefix` uses. */
async function flushTabSession(app: ElectronApplication, prefix: string): Promise<boolean> {
  return app.evaluate(async ({ webContents }, p) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(p))
    if (!wc) return false
    await wc.session.cookies.flushStore()
    wc.session.flushStorageData()
    return true
  }, prefix)
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile()) out.push(full)
  }
  return out
}

function percentEncodeAll(value: string, upper: boolean): string {
  return [...Buffer.from(value)].map((b) => `%${b.toString(16).padStart(2, '0')}`).map((s) => (upper ? s.toUpperCase() : s)).join('')
}

/** Byte search of every file under `roots` for the ASCII, UTF-16LE and percent-encoded forms of `value`. */
function byteSearch(roots: string[], value: string): { files: number; hits: Array<{ form: string; file: string }> } {
  const forms: Record<string, Buffer> = {
    ascii: Buffer.from(value, 'latin1'),
    utf16le: Buffer.from(value, 'utf16le'),
    encodeURIComponent: Buffer.from(encodeURIComponent(value), 'latin1'),
    percentAllUpper: Buffer.from(percentEncodeAll(value, true), 'latin1'),
    percentAllLower: Buffer.from(percentEncodeAll(value, false), 'latin1')
  }
  const hits: Array<{ form: string; file: string }> = []
  let files = 0
  for (const root of roots) {
    for (const file of walk(root)) {
      files += 1
      const bytes = fs.readFileSync(file)
      for (const [form, needle] of Object.entries(forms)) {
        if (bytes.includes(needle)) hits.push({ form, file })
      }
    }
  }
  return { files, hits }
}

function findFiles(root: string, name: string): string[] {
  return walk(root).filter((f) => path.basename(f) === name)
}

interface CookieRow {
  host_key: string
  name: string
  value: string
  encrypted_len: number
  encrypted_prefix: string
}

function cookieRows(dbFile: string, name: string): CookieRow[] {
  const db = new DatabaseSync(dbFile, { readOnly: true })
  try {
    return db
      .prepare(
        "SELECT host_key, name, value, length(encrypted_value) AS encrypted_len, CAST(substr(encrypted_value, 1, 3) AS TEXT) AS encrypted_prefix FROM cookies WHERE name = ?"
      )
      .all(name) as unknown as CookieRow[]
  } finally {
    db.close()
  }
}

async function fuses(app: ElectronApplication): Promise<unknown> {
  return app.evaluate(({ app: a, safeStorage }) => ({
    version: a.getVersion(),
    isPackaged: a.isPackaged,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    exe: process.execPath
  }))
}

/** 025-AC-052: set the probe cookie and a localStorage token in a browser tab, quit, inspect disk. */
async function cookieProbe(label: 'fuse-on' | 'fuse-off', exe: string): Promise<Record<string, unknown>> {
  const box = sandbox(`ac052-${label}`)
  const launched = await launch(exe, box)
  const info = await fuses(launched.app)
  const opened = await openProject(launched.window, box.project)
  const url = servers.sites.static.url('/__cookie-probe')
  const origin = servers.sites.static.http
  await openTab(launched.window, url)
  await waitForPage(launched.app, origin, `document.cookie.includes(${JSON.stringify(COOKIE_PROBE_VALUE)})`)
  await pageEval(launched.app, origin, `localStorage.setItem('erfana-ls', ${JSON.stringify(LOCAL_STORAGE_TOKEN)}); true`)
  const flushed = await flushTabSession(launched.app, origin)
  await quit(launched)

  const cookieDbs = findFiles(path.join(box.project, '.erfana'), 'Cookies')
  const rows = cookieDbs.map((db) => ({ db: path.relative(box.root, db), rows: cookieRows(db, 'probe') }))
  const roots = [box.project, box.userData, box.home]
  const cookieSearch = byteSearch(roots, COOKIE_PROBE_VALUE)
  const tokenSearch = byteSearch(roots, LOCAL_STORAGE_TOKEN)
  const rel = (s: { files: number; hits: Array<{ form: string; file: string }> }) => ({
    files: s.files,
    hits: s.hits.map((h) => ({ form: h.form, file: path.relative(box.root, h.file) }))
  })
  return { label, exe, sandbox: box.root, info, opened, url, flushed, cookieDbs: rows, cookieSearch: rel(cookieSearch), localStorageSearch: rel(tokenSearch) }
}

test('diag cookie store', async () => {
  const box = sandbox('diag')
  const app = await electron.launch({
    executablePath: process.env.DIAG_EXE_PATH ?? (process.env.DIAG_EXE === 'off' ? APPS.fuseOff : APPS.fuseOn),
    args: [`--user-data-dir=${box.userData}`, ...(process.env.DIAG_MOCK === '0' ? [] : ['--use-mock-keychain']), '--enable-logging=stderr', '--v=1', ...(process.env.DIAG_ARGS ? process.env.DIAG_ARGS.split(' ') : []), ...BROWSER_CHROMIUM_ARGS],
    env: appEnv(box.home),
    timeout: 60_000
  })
  const lines: string[] = []
  app.process().stderr?.on('data', (d) => lines.push(String(d)))
  const window = await app.firstWindow()
  await window.waitForFunction(() => !!(window as unknown as { api?: { file?: unknown } }).api?.file, null, { timeout: WAIT_MS })
  await openProject(window, box.project)
  const origin = servers.sites.static.http
  await openTab(window, servers.sites.static.url('/__cookie-probe'))
  await waitForPage(app, origin, `document.cookie.includes(${JSON.stringify(COOKIE_PROBE_VALUE)})`)
  const info = await app.evaluate(async ({ webContents, session }, p) => {
    const fsm = process.getBuiltinModule('fs')
    const pathm = process.getBuiltinModule('path')
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(p))!
    const s = wc.session
    await s.cookies.set({ url: p + '/', name: 'diag', value: 'diag-value-1', expirationDate: Date.now() / 1000 + 3600 })
    await s.cookies.flushStore()
    await session.defaultSession.cookies.set({ url: p + '/', name: 'diagdef', value: 'diag-default-1', expirationDate: Date.now() / 1000 + 3600 })
    await session.defaultSession.cookies.flushStore()
    await new Promise((r) => setTimeout(r, 2000))
    const list = (dir: string | null): string[] => {
      if (!dir || !fsm.existsSync(dir)) return []
      return fsm.readdirSync(dir, { recursive: true }).map(String).filter((f) => /cookie|network/i.test(f))
    }
    return {
      tabStorage: s.storagePath,
      tabIsPersistent: s.isPersistent(),
      tabCookies: (await s.cookies.get({})).map((c) => `${c.name}=${c.value} session=${c.session}`),
      tabFiles: list(s.storagePath),
      defaultStorage: session.defaultSession.storagePath,
      defaultFiles: list(session.defaultSession.storagePath),
      pathSep: pathm.sep
    }
  }, origin)
  await app.close()
  const stderr = lines.join('')
  fs.writeFileSync(path.join(OUT, `diag-stderr${SUFFIX}.txt`), stderr)
  record('diag-cookie-store', {
    diagArgs: process.env.DIAG_ARGS ?? '',
    info,
    relevant: stderr
      .split('\n')
      .filter((l) => /Failed to create directory|ErrorInitializeDB|Open\.FailureReason|GrantSandboxResult|Unable to create cache/.test(l))
      .map((l) => l.replace(box.root, '<sandbox>'))
  })
})

test('025-AC-052 cookies at rest: fuse on (candidate) vs fuse off (control)', async () => {
  const on = await cookieProbe('fuse-on', APPS.fuseOn)
  record('ac052-fuse-on', on)
  const off = await cookieProbe('fuse-off', APPS.fuseOff)
  record('ac052-fuse-off', off)

  const onRows = (on.cookieDbs as Array<{ rows: CookieRow[] }>).flatMap((d) => d.rows)
  expect(onRows).toHaveLength(1)
  expect(onRows[0].value).toBe('')
  expect(onRows[0].encrypted_len).toBeGreaterThan(0)
  expect((on.cookieSearch as { hits: unknown[] }).hits).toEqual([])
  expect((on.localStorageSearch as { hits: unknown[] }).hits.length).toBeGreaterThan(0)

  const offRows = (off.cookieDbs as Array<{ rows: CookieRow[] }>).flatMap((d) => d.rows)
  expect(offRows).toHaveLength(1)
  expect(offRows[0].value).toBe(COOKIE_PROBE_VALUE)
  expect((off.cookieSearch as { hits: unknown[] }).hits.length).toBeGreaterThan(0)
})

test('025-AC-022 packaged: basic auth with Remember, restart signs in with no box, nothing in plain text', async () => {
  const box = sandbox('ac022')
  const url = servers.sites.staging.url('/basic', { host: 'localhost' })
  const origin = new URL(url).origin
  const result: Record<string, unknown> = { sandbox: box.root, url }

  let launched = await launch(APPS.fuseOn, box)
  result.info = await fuses(launched.app)
  result.opened = await openProject(launched.window, box.project)
  const tabId = await openTab(launched.window, url)
  await expect.poll(async () => (await signInRows(launched.window, tabId)).length, { timeout: WAIT_MS }).toBeGreaterThan(0)
  const row = (await signInRows(launched.window, tabId))[0]
  result.firstBox = row
  expect(row.takesFocus).toBe(true)
  expect((row.signIn as { remember: string }).remember).toBe('available')
  // Main's input guard is 500 ms on the real clock in a packaged build (no test clock).
  await new Promise((r) => setTimeout(r, INPUT_GUARD_MS + 300))
  result.answer = await launched.window.evaluate(
    ([id, requestId, u, p]) =>
      (window as unknown as { api: Api }).api.browserTab.answerStrip({
        tabId: id,
        requestId,
        answer: 'signIn',
        fields: { username: u, password: p, remember: true }
      }),
    [tabId, row.requestId as string, BASIC_AUTH.username, BASIC_AUTH.password] as const
  )
  await waitForPage(launched.app, origin, `!!document.getElementById('basic-ok')`)
  const credentialsFile = path.join(box.project, '.erfana', 'browser', 'profile', 'Erfana', 'credentials.json')
  await expect.poll(() => fs.existsSync(credentialsFile), { timeout: WAIT_MS }).toBe(true)
  await quit(launched)

  const secretForms = [BASIC_AUTH.password, JSON.stringify(BASIC_AUTH.username), Buffer.from(`${BASIC_AUTH.username}:${BASIC_AUTH.password}`).toString('base64')]
  result.plainTextSearch = secretForms.map((needle) => {
    const s = byteSearch([box.project, box.userData], needle)
    return { needle: needle === BASIC_AUTH.password ? '<password>' : needle.startsWith('"') ? '<"username">' : '<base64 user:pass>', files: s.files, hits: s.hits.map((h) => ({ form: h.form, file: path.relative(box.root, h.file) })) }
  })
  result.credentialsFileBytes = fs.statSync(credentialsFile).size

  launched = await launch(APPS.fuseOn, box)
  result.reopened = await openProject(launched.window, box.project)
  const again = await openTab(launched.window, url)
  await waitForPage(launched.app, origin, `!!document.getElementById('basic-ok')`)
  result.boxesAfterRestart = await signInRows(launched.window, again)
  await quit(launched)
  record('ac022-packaged', result)

  for (const s of result.plainTextSearch as Array<{ hits: unknown[] }>) expect(s.hits).toEqual([])
  expect(result.boxesAfterRestart).toEqual([])
})

test('025-AC-079 update from v0.23.1 keeps data; a cookie written afterwards is encrypted', async () => {
  const box = sandbox('ac079')
  const result: Record<string, unknown> = { sandbox: box.root }
  const legacyCookie = { name: 'legacy', value: 'erfana-legacy-cookie-0231' }
  const legacyUrl = servers.sites.static.http + '/'
  const apiKey = 'sk-erfana-ac079-probe-key'

  // Phase A: v0.23.1 (fuse off) writes Erfana's own data and a plain-text default-session cookie.
  let launched = await launch(APPS.v0231, box)
  result.before = await fuses(launched.app)
  result.beforeOpen = await openProject(launched.window, box.project)
  const api = (member: string, ...args: unknown[]): Promise<unknown> =>
    launched.window.evaluate(
      ([m, a]) => {
        const [group, method] = (m as string).split('.')
        return (window as unknown as { api: Api }).api[group][method](...(a as unknown[]))
      },
      [member, args] as const
    )
  const snapshot = async (): Promise<Record<string, unknown>> => ({
    hasApiKey: await api('transcription.hasApiKey'),
    lock: await api('projectLock.check', box.project),
    watchDepth: await api('settings.getDirectoryWatchDepth'),
    filterMode: await api('settings.getProjectFilterMode'),
    recents: await api('settings.getRecentProjects')
  })
  await api('settings.setDirectoryWatchDepth', 7)
  await api('settings.setProjectFilterMode', 'all')
  result.beforeSetKey = await api('transcription.setApiKey', apiKey)
  result.beforeState = await snapshot()
  result.beforeCookieSet = await launched.app.evaluate(async ({ session }, [u, c]) => {
    await session.defaultSession.cookies.set({ url: u as string, name: (c as { name: string }).name, value: (c as { value: string }).value, expirationDate: Date.now() / 1000 + 86400 })
    await session.defaultSession.cookies.flushStore()
    return session.defaultSession.storagePath
  }, [legacyUrl, legacyCookie] as const)
  await quit(launched)
  const userDataCookies = findFiles(box.userData, 'Cookies')
  result.beforeDisk = {
    cookieDbs: userDataCookies.map((db) => ({ db: path.relative(box.root, db), rows: cookieRows(db, legacyCookie.name) })),
    erfanaHomeFiles: walk(path.join(box.home, '.erfana')).map((f) => path.relative(box.root, f)),
    legacyPlainText: byteSearch([box.userData], legacyCookie.value).hits.map((h) => path.relative(box.root, h.file))
  }

  // Phase B: the candidate (fuse on) starts on the same user data and HOME.
  launched = await launch(APPS.fuseOn, box)
  result.after = await fuses(launched.app)
  result.afterOpen = await openProject(launched.window, box.project)
  result.afterState = await snapshot()
  result.afterLegacyCookieRead = await launched.app.evaluate(async ({ session }, n) => {
    const found = await session.defaultSession.cookies.get({ name: n })
    return found.map((c) => ({ name: c.name, value: c.value, domain: c.domain }))
  }, legacyCookie.name)
  // A cookie written afterwards: re-write the legacy one and add a new one in the default
  // session, and set the probe cookie in a project browser tab.
  await launched.app.evaluate(async ({ session }, u) => {
    const s = session.defaultSession
    await s.cookies.set({ url: u, name: 'legacy', value: 'erfana-legacy-cookie-0231', expirationDate: Date.now() / 1000 + 86400 })
    await s.cookies.set({ url: u, name: 'fresh', value: 'erfana-fresh-cookie-0240', expirationDate: Date.now() / 1000 + 86400 })
    await s.cookies.flushStore()
  }, legacyUrl)
  const probeOrigin = servers.sites.static.http
  await openTab(launched.window, servers.sites.static.url('/__cookie-probe'))
  await waitForPage(launched.app, probeOrigin, `document.cookie.includes(${JSON.stringify(COOKIE_PROBE_VALUE)})`)
  await flushTabSession(launched.app, probeOrigin)
  await quit(launched)

  const logDir = path.join(box.home, '.erfana', 'logs')
  const logText = walk(logDir).map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  result.afterDisk = {
    defaultSession: findFiles(box.userData, 'Cookies').map((db) => ({
      db: path.relative(box.root, db),
      legacy: cookieRows(db, 'legacy'),
      fresh: cookieRows(db, 'fresh')
    })),
    projectProfile: findFiles(path.join(box.project, '.erfana'), 'Cookies').map((db) => ({ db: path.relative(box.root, db), probe: cookieRows(db, 'probe') })),
    plainText: {
      legacy: byteSearch([box.userData], 'erfana-legacy-cookie-0231').hits.map((h) => path.relative(box.root, h.file)),
      fresh: byteSearch([box.userData], 'erfana-fresh-cookie-0240').hits.map((h) => path.relative(box.root, h.file)),
      probe: byteSearch([box.project], COOKIE_PROBE_VALUE).hits.map((h) => path.relative(box.root, h.file))
    },
    logLinesMentioningLockHmacOrDecrypt: logText.split('\n').filter((l) => /lockHmac|decrypt|safeStorage|Keychain|\[error\]/i.test(l)).slice(0, 40)
  }
  record('ac079-update', result)

  const before = result.beforeState as Record<string, unknown>
  const after = result.afterState as Record<string, unknown>
  expect(before.hasApiKey).toBe(true)
  expect(after.hasApiKey).toBe(true)
  expect(after.watchDepth).toEqual(before.watchDepth)
  expect(after.filterMode).toEqual(before.filterMode)
  expect(result.afterLegacyCookieRead).toEqual([expect.objectContaining({ value: 'erfana-legacy-cookie-0231' })])
})
```
