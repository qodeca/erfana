// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The served local folders of the process (spec 025, 025-FR-005 rule 1,
 * 025-FR-010; ADR 0012 option 4): which file opens, one server per project
 * per folder, the arms, the request gate, the address shown and when servers
 * close. Files are real; servers are fakes except where a test says so.
 */
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import type { AppAddresses } from '../browserNavigationPolicy'
import type { LocalFolderServerOptions } from './LocalFolderServer'
import { ARM_LIFETIME_MS, LocalFileServers, MAX_LOCAL_SERVERS, type LocalServerHandle } from './LocalFileServers'

let base: string
let project: string
let app: AppAddresses
let now: number
let started: Array<{ options: LocalFolderServerOptions; handle: LocalServerHandle & { closed: boolean } }>
let failStart: boolean
let servers: LocalFileServers

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'erfana-local-servers-')))
  project = join(base, 'proj')
  for (const dir of ['site', 'other', '.erfana/browser', 'site/.hidden', 'app/resources']) {
    await mkdir(join(project, dir), { recursive: true })
  }
  await mkdir(join(base, '.dotted'), { recursive: true })
  for (const file of ['site/index.html', 'site/page b.html', 'other/index.html', '.erfana/browser/x.html', 'site/.hidden/x.html', 'site/.env.html', 'app/resources/x.html', 'app/index.html']) {
    await writeFile(join(project, file), '<p>x</p>')
  }
  await writeFile(join(base, '.dotted', 'x.html'), '<p>x</p>')
})

afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

const itPosix = process.platform === 'win32' ? it.skip : it

let port = 40_000

function fakeServer(options: LocalFolderServerOptions): LocalServerHandle & { closed: boolean } {
  port += 1
  const token = String(port).padStart(32, '0')
  const handle = {
    realRoot: options.realRoot,
    token,
    origin: `http://127.0.0.1:${port}`,
    closed: false,
    start: vi.fn(async () => {
      if (failStart) throw new Error('EADDRINUSE')
    }),
    close: vi.fn(async () => {
      handle.closed = true
    }),
    addressOf: (segments: readonly string[]) => `http://127.0.0.1:${port}/${token}/${segments.map(encodeURIComponent).join('/')}`
  }
  started.push({ options, handle })
  return handle
}

beforeEach(() => {
  now = 1_000
  started = []
  failStart = false
  app = { rendererEntry: pathToFileURL(join(project, 'app', 'index.html')).href, resourcesDir: join(project, 'app', 'resources'), devServerOrigin: null }
  // The temporary folder is below /var or /tmp, which the default rule refuses to serve.
  servers = new LocalFileServers({ now: () => now, appAddresses: () => app, createServer: fakeServer, refusesFolder: () => false })
})

const request = (rel: string, tabId = 't1', projectRoot = project): Parameters<LocalFileServers['open']>[0] => ({
  tabId,
  projectRoot,
  caseSensitive: process.platform === 'linux',
  filePath: join(project, rel)
})

async function openOk(rel: string, tabId = 't1'): Promise<{ url: string; displayUrl: string }> {
  const result = await servers.open(request(rel, tabId))
  if (!result.ok) throw new Error(`refused: ${result.reason}`)
  return result
}

describe('open', () => {
  it('serves the file\'s folder and answers the loopback address and the file:// address', async () => {
    const opened = await openOk('site/index.html')
    expect(opened.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/0+\d+\/index\.html$/)
    expect(opened.displayUrl).toBe(pathToFileURL(join(project, 'site', 'index.html')).href)
    expect(started).toHaveLength(1)
    expect(started[0]!.options.realRoot).toBe(join(project, 'site'))
    expect(servers.size).toBe(1)
  })

  it('shares one server per project per folder, and starts another for another folder', async () => {
    const [a, b] = await Promise.all([openOk('site/index.html', 't1'), openOk('site/page b.html', 't2')])
    expect(new URL(a.url).origin).toBe(new URL(b.url).origin)
    expect(b.url).toContain('/page%20b.html')
    const c = await openOk('other/index.html')
    expect(new URL(c.url).origin).not.toBe(new URL(a.url).origin)
    expect(started).toHaveLength(2)
  })

  it.each([
    ['a relative path', 'relative.html'],
    ['a missing file', join('site', 'missing.html')],
    ['a folder', 'site']
  ])('refuses %s', async (_label, rel) => {
    const filePath = rel === 'relative.html' ? rel : join(project, rel)
    expect(await servers.open({ ...request('x'), filePath })).toEqual({ ok: false, reason: 'local-file' })
    expect(started).toHaveLength(0)
  })

  it('refuses a file in a dot-folder of the project, a dot-file, and a dot-folder anywhere outside the project', async () => {
    for (const rel of ['.erfana/browser/x.html', 'site/.hidden/x.html', 'site/.env.html']) {
      expect(await servers.open(request(rel))).toEqual({ ok: false, reason: 'local-file' })
    }
    expect(await servers.open({ ...request('x'), filePath: join(base, '.dotted', 'x.html') })).toEqual({ ok: false, reason: 'local-file' })
    expect(started).toHaveLength(0)
  })

  it('opens a file of a project that itself lives below a dot-folder', async () => {
    const result = await servers.open({ ...request('x'), projectRoot: join(base, '.dotted'), filePath: join(base, '.dotted', 'x.html') })
    expect(result.ok).toBe(true)
  })

  it('refuses Erfana\'s renderer entry and its resources folder, and vetoes them for the server too', async () => {
    expect(await servers.open(request('app/index.html'))).toEqual({ ok: false, reason: 'app-entry' })
    expect(await servers.open(request('app/resources/x.html'))).toEqual({ ok: false, reason: 'app-entry' })
    await openOk('site/index.html')
    const veto = started[0]!.options.refusesTarget
    expect(veto(join(project, 'app', 'resources', 'x.html'))).toBe(true)
    expect(veto(join(project, 'app', 'index.html'))).toBe(true)
    expect(veto(join(project, 'site', 'index.html'))).toBe(false)
    app = { ...app, rendererEntry: 'not a url' }
    expect(veto(join(project, 'site', 'index.html'))).toBe(false)
  })

  it('refuses a system folder as the served folder by default, and asks the rule for the file\'s folder', async () => {
    const byDefault = new LocalFileServers({ now: () => now, appAddresses: () => app, createServer: fakeServer })
    const systemFile = process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/hosts'
    expect((await byDefault.open({ ...request('x'), filePath: systemFile })).ok).toBe(false)
    expect((await byDefault.open(request('site/index.html'))).ok).toBe(process.platform === 'win32')
    const asked: string[] = []
    const ruled = new LocalFileServers({
      now: () => now,
      appAddresses: () => app,
      createServer: fakeServer,
      refusesFolder: (folder) => asked.push(folder) > 0
    })
    expect(await ruled.open(request('site/index.html'))).toEqual({ ok: false, reason: 'local-file' })
    expect(asked).toEqual([join(project, 'site')])
  })

  it('refuses a user folder itself as the served folder (home, Downloads, …), not the folders below it (security review S1)', async () => {
    const users = new LocalFileServers({
      now: () => now,
      appAddresses: () => app,
      createServer: fakeServer,
      refusesFolder: () => false,
      // `site` stands for Downloads; a folder that does not exist is compared as named.
      userFolders: () => [join(base, 'no-such-folder'), join(project, 'site')]
    })
    expect(await users.open(request('site/index.html'))).toEqual({ ok: false, reason: 'local-file' })
    expect((await users.open(request('other/index.html'))).ok).toBe(true)
    expect(started).toHaveLength(1)
  })

  it('refuses a folder that holds a user folder, such as a sync root Documents lives in (security review round 2)', async () => {
    const users = new LocalFileServers({
      now: () => now,
      appAddresses: () => app,
      createServer: fakeServer,
      refusesFolder: () => false,
      // `site/Documents` stands for a user folder synced below `site` (a OneDrive root).
      userFolders: () => [join(project, 'site', 'Documents')]
    })
    expect(await users.open(request('site/index.html'))).toEqual({ ok: false, reason: 'local-file' })
    expect((await users.open(request('other/index.html'))).ok).toBe(true)
  })

  itPosix('compares a user folder by its real path, so a link to it is refused too', async () => {
    const link = join(base, 'downloads-link')
    await symlink(join(project, 'site'), link).catch(() => undefined)
    const users = new LocalFileServers({ now: () => now, appAddresses: () => app, createServer: fakeServer, refusesFolder: () => false, userFolders: () => [link] })
    expect(await users.open(request('site/index.html'))).toEqual({ ok: false, reason: 'local-file' })
  })

  it('refuses when the server cannot start, and starts one next time', async () => {
    failStart = true
    expect(await servers.open(request('site/index.html'))).toEqual({ ok: false, reason: 'local-file' })
    failStart = false
    expect((await servers.open(request('site/index.html'))).ok).toBe(true)
  })

  it(`serves at most ${MAX_LOCAL_SERVERS} folders`, async () => {
    for (let i = 0; i < MAX_LOCAL_SERVERS; i += 1) {
      await servers.open({ ...request('site/index.html'), projectRoot: join(base, `p${i}`) })
    }
    expect(servers.size).toBe(MAX_LOCAL_SERVERS)
    expect(await servers.open(request('other/index.html'))).toEqual({ ok: false, reason: 'local-file' })
  })

  it(`counts servers still starting against the ${MAX_LOCAL_SERVERS}-folder cap`, async () => {
    const opens = Array.from({ length: MAX_LOCAL_SERVERS + 3 }, (_, i) => servers.open({ ...request('site/index.html'), projectRoot: join(base, `q${i}`) }))
    const answers = await Promise.all(opens)
    expect(answers.filter((a) => !a.ok)).toHaveLength(3)
    expect(servers.size).toBe(MAX_LOCAL_SERVERS)
    expect(started).toHaveLength(MAX_LOCAL_SERVERS)
  })
})

describe('arms and the request gate', () => {
  it('arms a served address once, for its lifetime; the server uses it up', async () => {
    const { url } = await openOk('site/index.html')
    const consume = started[0]!.options.consumeArm
    expect(consume(url)).toBe(false)
    servers.arm(`${url}#frag`)
    expect(consume(url)).toBe(true)
    expect(consume(url)).toBe(false)
    servers.arm(url)
    now += ARM_LIFETIME_MS
    expect(consume(url)).toBe(false)
  })

  it('ignores an arm for an address no server owns, or not a URL', () => {
    servers.arm('https://a.test/')
    servers.arm('not a url')
    expect(servers.allowsRequest({ url: 'https://a.test/', resourceType: 'mainFrame', topUrl: null })).toBe(true)
  })

  it('keeps at most 64 arms, dropping the oldest', async () => {
    const { url } = await openOk('site/index.html')
    servers.arm(`${url}?first`)
    for (let i = 0; i < 64; i += 1) servers.arm(`${url}?n=${i}`)
    const consume = started[0]!.options.consumeArm
    expect(consume(`${url}?first`)).toBe(false)
    expect(consume(`${url}?n=63`)).toBe(true)
  })

  it('lets a top-level load through only when armed or from a page of the same folder', async () => {
    const { url } = await openOk('site/index.html')
    const sibling = url.replace('index.html', 'page%20b.html')
    const mainFrame = (topUrl: string | null): boolean => servers.allowsRequest({ url: sibling, resourceType: 'mainFrame', topUrl })
    expect(mainFrame(null)).toBe(false)
    expect(mainFrame('https://a.test/')).toBe(false)
    expect(mainFrame(url)).toBe(true)
    servers.arm(sibling)
    expect(mainFrame(null)).toBe(true)
  })

  it('lets a subresource through only from a page of the same folder', async () => {
    const site = await openOk('site/index.html')
    const other = await openOk('other/index.html')
    const image = site.url.replace('index.html', 'image.svg')
    const from = (topUrl: string | null, resourceType = 'image'): boolean => servers.allowsRequest({ url: image, resourceType, topUrl })
    expect(from(site.url)).toBe(true)
    expect(from(other.url)).toBe(false)
    expect(from('https://a.test/')).toBe(false)
    expect(from(null)).toBe(false)
    servers.arm(image)
    expect(from(null, 'subFrame')).toBe(false)
  })

  it('refuses an address on a served port without the token, and passes every other address', async () => {
    const { url } = await openOk('site/index.html')
    const origin = new URL(url).origin
    expect(servers.allowsRequest({ url: `${origin}/guess/canary.txt`, resourceType: 'image', topUrl: url })).toBe(false)
    expect(servers.allowsRequest({ url: 'http://127.0.0.1:1/x', resourceType: 'image', topUrl: null })).toBe(true)
    expect(servers.allowsRequest({ url: 'not a url', resourceType: 'image', topUrl: null })).toBe(true)
    expect(servers.isLocalAddress(url)).toBe(true)
    expect(servers.isLocalAddress(`${origin}/guess/x`)).toBe(false)
    expect(servers.isLocalAddress('https://a.test/')).toBe(false)
  })
})

describe('the pending top-level load (ADR 0012 amendment 2026-11-04)', () => {
  const TAB = 7
  const OTHER_TAB = 8

  /** A request of tab `contentsId` whose `getURL()` still answers the previous, web page. */
  const beforeCommit = (url: string, resourceType = 'script', contentsId: number = TAB): boolean =>
    servers.allowsRequest({ url, resourceType, topUrl: 'https://previous.test/', contentsId })

  it('lets the pending folder\'s subresources and frames through from that tab before the commit', async () => {
    const { url } = await openOk('site/index.html')
    const canary = url.replace('index.html', 'canary.js')
    expect(beforeCommit(canary)).toBe(false)
    servers.setPendingLoad(TAB, url)
    expect(beforeCommit(canary)).toBe(true)
    expect(beforeCommit(url.replace('index.html', 'a.png'), 'image')).toBe(true)
    expect(beforeCommit(url.replace('index.html', 'page%20b.html'), 'subFrame')).toBe(true)
  })

  it('never lets a top-level load through on the pending load alone', async () => {
    const { url } = await openOk('site/index.html')
    servers.setPendingLoad(TAB, url)
    expect(beforeCommit(url.replace('index.html', 'page%20b.html'), 'mainFrame')).toBe(false)
  })

  it('still refuses another folder, and a request with no tab id', async () => {
    const site = await openOk('site/index.html')
    const other = await openOk('other/index.html')
    servers.setPendingLoad(TAB, site.url)
    expect(beforeCommit(other.url.replace('index.html', 'canary.js'))).toBe(false)
    const canary = site.url.replace('index.html', 'canary.js')
    expect(servers.allowsRequest({ url: canary, resourceType: 'script', topUrl: 'https://previous.test/' })).toBe(false)
  })

  it('leaves other tabs to the committed-page rule', async () => {
    const { url } = await openOk('site/index.html')
    const canary = url.replace('index.html', 'canary.js')
    servers.setPendingLoad(TAB, url)
    expect(beforeCommit(canary, 'script', OTHER_TAB)).toBe(false)
    servers.setPendingLoad(OTHER_TAB, null)
    expect(beforeCommit(canary)).toBe(true)
  })

  it('is cleared by its end, by a newer load and by null or an address no server owns', async () => {
    const site = await openOk('site/index.html')
    const other = await openOk('other/index.html')
    const canary = site.url.replace('index.html', 'canary.js')
    servers.setPendingLoad(TAB, site.url)
    servers.endPendingLoad(TAB)
    expect(beforeCommit(canary)).toBe(false)
    servers.setPendingLoad(TAB, site.url)
    servers.setPendingLoad(TAB, other.url)
    expect(beforeCommit(canary)).toBe(false)
    expect(beforeCommit(other.url.replace('index.html', 'canary.js'))).toBe(true)
    servers.setPendingLoad(TAB, 'https://a.test/')
    expect(beforeCommit(other.url.replace('index.html', 'canary.js'))).toBe(false)
    servers.setPendingLoad(TAB, site.url)
    servers.setPendingLoad(TAB, null)
    expect(beforeCommit(canary)).toBe(false)
  })

  it('ends on a named failure only when that address is the pending one (fragment ignored)', async () => {
    const { url } = await openOk('site/index.html')
    const canary = url.replace('index.html', 'canary.js')
    servers.setPendingLoad(TAB, url)
    servers.endPendingLoad(TAB, 'https://older.test/')
    expect(beforeCommit(canary)).toBe(true)
    servers.endPendingLoad(TAB, `${url}#top`)
    expect(beforeCommit(canary)).toBe(false)
  })

  it('is dropped with its server, and on quit', async () => {
    const site = await openOk('site/index.html')
    servers.setPendingLoad(TAB, site.url)
    servers.releaseTab('t1')
    const again = await openOk('site/index.html')
    expect(beforeCommit(again.url.replace('index.html', 'canary.js'))).toBe(false)
    servers.setPendingLoad(TAB, again.url)
    await servers.closeAll()
    const third = await openOk('site/index.html')
    expect(beforeCommit(third.url.replace('index.html', 'canary.js'))).toBe(false)
  })
})

describe('displayAddress', () => {
  it('shows a served address as its file:// address, query and fragment kept', async () => {
    const { url } = await openOk('site/page b.html')
    const shown = servers.displayAddress(`${url}?q=1#top`)
    expect(shown).toBe(`${pathToFileURL(join(project, 'site', 'page b.html')).href}?q=1#top`)
    expect(servers.displayAddress(url.replace('page%20b.html', 'sub/a.css'))).toBe(pathToFileURL(join(project, 'site', 'sub', 'a.css')).href)
  })

  it('answers null for any other address and a broken escape', async () => {
    const { url } = await openOk('site/index.html')
    expect(servers.displayAddress('https://a.test/')).toBeNull()
    expect(servers.displayAddress('nonsense')).toBeNull()
    expect(servers.displayAddress(url.replace('index.html', '%E0%A4%A'))).toBeNull()
  })
})

describe('closing', () => {
  it('closes a server when the last tab holding it closes', async () => {
    await openOk('site/index.html', 't1')
    await openOk('site/index.html', 't2')
    servers.releaseTab('t1')
    expect(started[0]!.handle.closed).toBe(false)
    servers.releaseTab('t2')
    expect(started[0]!.handle.closed).toBe(true)
    expect(servers.size).toBe(0)
    servers.releaseTab('t3')
  })

  it('closes every server of a project on project switch, and only those', async () => {
    await openOk('site/index.html')
    await servers.open({ ...request('other/index.html'), projectRoot: join(base, 'elsewhere') })
    await servers.closeProject(project)
    expect(started.map((s) => s.handle.closed)).toEqual([true, false])
    expect(servers.size).toBe(1)
  })

  it('closes everything on quit, logging a server that fails to close', async () => {
    const a = await openOk('site/index.html')
    await openOk('other/index.html')
    started[1]!.handle.close = vi.fn(async () => {
      throw new Error('stuck')
    })
    servers.arm(a.url)
    await expect(servers.closeAll()).resolves.toBeUndefined()
    expect(servers.size).toBe(0)
    expect(servers.isLocalAddress(a.url)).toBe(false)
  })
})

describe('with the real server', () => {
  it('starts a loopback server and closes it', async () => {
    const real = new LocalFileServers({ now: () => now, appAddresses: () => app, refusesFolder: () => false })
    const result = await real.open(request('site/index.html'))
    expect(result.ok && result.url.startsWith('http://127.0.0.1:')).toBe(true)
    await real.closeAll()
    expect(real.size).toBe(0)
  })
})
