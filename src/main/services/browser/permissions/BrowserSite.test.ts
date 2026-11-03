// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Site requests routed from the session to the tab (spec 025, 025-FR-019,
 * 025-FR-020, 025-FR-054): classes, prompts, notices, withdrawal on
 * navigation, crash and close, screen sharing and downloads.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { createManualClock, type TestClock } from '../../../../shared/clock'
import type { NoticeEvent, StripEvent } from '../../../../shared/ipc/browser-tab-schema'
import { FakeContents } from '../__test-helpers__/fakeBrowserView'
import type { PurposeSigner } from '../browserProfileMarker'
import { BrowserSite, type BrowserSiteDeps, type TabSiteLink } from './BrowserSite'
import { STRIP_INPUT_GUARD_MS, STRIP_NOTICE_MS } from './tabStrip'

const MEMORY_ONLY: PurposeSigner = { hasKey: () => false, sign: () => undefined, verify: () => 'no-key' }
const PAGE = 'https://garden.test/news'
const ORIGIN = 'https://garden.test'

let clock: TestClock
let strip: StripEvent[]
let notices: NoticeEvent[]
let site: BrowserSite
let contents: FakeContents
let link: TabSiteLink
let deps: BrowserSiteDeps
let rows: number
let staging: string

function make(overrides: Partial<BrowserSiteDeps> = {}): void {
  deps = {
    clock,
    signer: MEMORY_ONLY,
    resolveDomain: (h) => h,
    downloads: {
      downloadsDir: () => staging,
      stagingRoot: () => staging,
      showSaveDialog: async () => null,
      showItemInFolder: vi.fn()
    },
    fromFrame: () => contents as never,
    newRowId: () => `row${++rows}`,
    ...overrides
  }
  site = new BrowserSite(deps)
  contents = new FakeContents()
  contents.url = PAGE
  link = site.attachTab(
    { id: 'browser-tab-1', windowId: 7, projectRoot: '/project', contents: contents as never },
    { strip: (e) => strip.push(e), notice: (e) => notices.push(e), parentWindow: () => null }
  )
}

beforeEach(() => {
  staging = mkdtempSync(join(tmpdir(), 'erfana-site-'))
  clock = createManualClock(0)
  strip = []
  notices = []
  rows = 0
  make()
})

afterEach(() => {
  rmSync(staging, { recursive: true, force: true })
})

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

function request(permission: string, details: Record<string, unknown> = { requestingUrl: PAGE }, from = contents): boolean[] {
  const results: boolean[] = []
  site.permissionRequest(from as never, permission, (granted) => results.push(granted), { ...details } as never)
  return results
}

function answerShown(answer: 'allow' | 'allowOnce' | 'block' | 'dismiss'): void {
  clock.advance(STRIP_INPUT_GUARD_MS)
  const shown = [...strip].reverse().find((e) => e.op === 'add')
  if (shown?.op !== 'add') throw new Error('no row')
  expect(link.answerStrip(shown.row.requestId, answer)).toBe('accepted')
}

describe('BrowserSite permission requests', () => {
  it('grants allow-class and refuses deny-class names without a prompt or a tab', () => {
    const other = new FakeContents()
    expect(request('clipboard-sanitized-write', {}, other)).toEqual([true])
    expect(request('persistent-storage')).toEqual([true])
    for (const name of ['midi', 'usb', 'hid', 'keyboardLock', 'notifications', 'brand-new']) {
      expect(request(name)).toEqual([false])
    }
    expect(strip).toEqual([])
  })

  it('025-AC-019 prompts for the camera, and Allow grants it and is checked as granted afterwards', async () => {
    const result = request('media', { mediaTypes: ['video'], securityOrigin: ORIGIN, requestingUrl: PAGE })
    await flush()
    expect(strip[0]).toMatchObject({ tabId: 'browser-tab-1', op: 'add', row: { text: 'garden.test wants to use your camera' } })
    expect(link.answerStrip('row1', 'allow')).toBe('guarded')
    answerShown('allow')
    expect(result).toEqual([true])
    expect(site.permissionCheck(contents as never, 'media', ORIGIN, { mediaType: 'video' })).toBe(true)
    expect(site.permissionCheck(contents as never, 'media', ORIGIN, { mediaType: 'audio' })).toBe(false)
    expect(site.permissionCheck(contents as never, 'media', ORIGIN, { mediaType: 'unknown' })).toBe(false)
  })

  it('refuses an ask-class request from a page no tab owns, or with an opaque origin', async () => {
    expect(request('geolocation', { requestingUrl: PAGE }, new FakeContents())).toEqual([false])
    expect(request('geolocation', { requestingUrl: 'data:text/html,x' })).toEqual([false])
    contents.url = 'about:blank'
    expect(request('geolocation', { requestingUrl: PAGE })).toEqual([false])
    expect(request('media', { mediaTypes: [], requestingUrl: PAGE })).toEqual([false])
    await flush()
    expect(strip).toEqual([])
  })

  it('025-AC-019 grants fullscreen and pointer lock with a 4 s notice naming the origin', () => {
    expect(request('fullscreen', { requestingUrl: PAGE })).toEqual([true])
    expect(strip[0]).toMatchObject({ op: 'add', row: { kind: 'fullscreen', text: 'garden.test is now full screen. Press Esc to exit.', requester: { origin: { registrableDomain: 'garden.test' } } } })
    expect(request('pointerLock', {})).toEqual([true])
    expect(strip[1]).toMatchObject({ op: 'add', row: { kind: 'pointerLock', text: 'garden.test has hidden your pointer. Press Esc to exit.' } })
    clock.advance(STRIP_NOTICE_MS)
    expect(strip.filter((e) => e.op === 'withdraw')).toHaveLength(2)
    expect(request('fullscreen', {}, new FakeContents())).toEqual([false])
  })

  it('grants a notice-class request even when no origin can be named, without a notice', () => {
    contents.url = 'about:blank'
    expect(request('fullscreen', {})).toEqual([true])
    expect(strip).toEqual([])
  })

  it('025-AC-019 withdraws a pending prompt when the page navigates, and Allow once ends with the load', async () => {
    const pending = request('geolocation')
    await flush()
    contents.emit('did-navigate', {}, PAGE)
    expect(pending).toEqual([false])
    expect(strip.at(-1)).toEqual({ tabId: 'browser-tab-1', op: 'withdraw', requestId: 'row1' })

    const camera = { mediaTypes: ['video'], securityOrigin: ORIGIN }
    request('media', camera)
    await flush()
    answerShown('allowOnce')
    expect(request('media', camera)).toEqual([])
    await flush()
    expect(strip.at(-1)?.op).not.toBe('add')
    contents.emit('did-navigate', {}, PAGE)
    expect(site.permissionCheck(contents as never, 'media', ORIGIN, { mediaType: 'video' })).toBe(false)
  })

  it('withdraws pending prompts when the page crashes', async () => {
    const pending = request('clipboard-read')
    await flush()
    contents.emit('render-process-gone', {}, { reason: 'crashed' })
    expect(pending).toEqual([false])
  })

  it('025-AC-019 withdraws pending prompts when the tab closes, and refuses everything after', async () => {
    const pending = request('geolocation')
    await flush()
    contents.destroy()
    expect(pending).toEqual([false])
    expect(request('geolocation')).toEqual([false])
    expect(request('fullscreen')).toEqual([false])
    expect(link.answerStrip('row1', 'allow')).toBe('unknown')
    expect(site.permissionCheck(contents as never, 'fullscreen', ORIGIN, {})).toBe(false)
  })

  it('detach removes its listeners from the page', () => {
    link.detach()
    expect(contents.listenerCount('did-navigate')).toBe(0)
    expect(contents.listenerCount('render-process-gone')).toBe(0)
    expect(contents.listenerCount('destroyed')).toBe(0)
    link.detach()
  })

  it('checks: allow and deny classes, notices for tabs only, nothing before the store is ready', () => {
    expect(site.permissionCheck(contents as never, 'geolocation', ORIGIN, {})).toBe(false)
    expect(site.permissionCheck(null, 'persistent-storage', ORIGIN, {})).toBe(true)
    expect(site.permissionCheck(null, 'midi', ORIGIN, {})).toBe(false)
    expect(site.permissionCheck(null, 'fullscreen', ORIGIN, {})).toBe(false)
    expect(site.permissionCheck(contents as never, 'fullscreen', ORIGIN, {})).toBe(true)
    expect(site.permissionCheck(contents as never, 'geolocation', 'data:x', {})).toBe(false)
  })

  it('025-AC-019 checks a frame against its embedding origin', async () => {
    request('geolocation', { requestingUrl: 'https://maps.test/embed' })
    await flush()
    expect(strip[0]).toMatchObject({ row: { text: 'maps.test, inside garden.test, wants to know your location' } })
    answerShown('allow')
    expect(site.permissionCheck(contents as never, 'geolocation', 'https://maps.test', { embeddingOrigin: ORIGIN })).toBe(true)
    expect(site.permissionCheck(contents as never, 'geolocation', 'https://maps.test', { embeddingOrigin: 'https://other.test' })).toBe(false)
  })

  it('clears saved permissions of a project (025-FR-023)', async () => {
    request('geolocation')
    await flush()
    answerShown('allow')
    await site.clearPermissions('/elsewhere')
    expect(site.permissionCheck(contents as never, 'geolocation', ORIGIN, {})).toBe(true)
    await site.clearPermissions('/project')
    expect(site.permissionCheck(contents as never, 'geolocation', ORIGIN, {})).toBe(false)
  })
})

describe('BrowserSite screen sharing', () => {
  const frame = {} as never

  it('refuses with no stream and no prompt while no source chooser exists', () => {
    const callback = vi.fn()
    site.displayMediaRequest({ frame, securityOrigin: ORIGIN }, callback)
    expect(callback).toHaveBeenCalledWith(null)
    expect(strip).toEqual([])
  })

  it('025-AC-019 asks first, then shows the source chooser; never saved', async () => {
    const streams = { video: { id: 'screen:1', name: 'Screen' } }
    const chooseScreenSource = vi.fn(async () => streams as never)
    make({ chooseScreenSource })
    const callback = vi.fn()
    site.displayMediaRequest({ frame, securityOrigin: ORIGIN }, callback)
    await flush()
    expect(strip[0]).toMatchObject({ row: { text: 'garden.test wants to see your screen', remembered: 'never' } })
    answerShown('allow')
    await flush()
    expect(chooseScreenSource).toHaveBeenCalledWith('browser-tab-1', { securityOrigin: ORIGIN })
    expect(callback).toHaveBeenCalledWith(streams)
  })

  it('answers no stream on Block, a failing chooser, a gone frame or a page no tab owns', async () => {
    make({ chooseScreenSource: vi.fn(async () => Promise.reject(new Error('picker failed'))) })
    const blocked = vi.fn()
    site.displayMediaRequest({ frame, securityOrigin: ORIGIN }, blocked)
    await flush()
    answerShown('block')
    await flush()
    expect(blocked).toHaveBeenCalledWith(null)

    contents.emit('did-navigate', {}, PAGE)
    const failed = vi.fn()
    site.displayMediaRequest({ frame, securityOrigin: ORIGIN }, failed)
    await flush()
    clock.advance(1000)
    answerShown('allow')
    await vi.waitFor(() => expect(failed).toHaveBeenCalledWith(null))

    const gone = vi.fn()
    site.displayMediaRequest({ frame: null, securityOrigin: ORIGIN }, gone)
    expect(gone).toHaveBeenCalledWith(null)
    make({ chooseScreenSource: vi.fn(), fromFrame: () => null })
    const stranger = vi.fn()
    site.displayMediaRequest({ frame, securityOrigin: ORIGIN }, stranger)
    expect(stranger).toHaveBeenCalledWith(null)
  })
})

describe('BrowserSite downloads', () => {
  it('cancels a download from a page no tab owns', () => {
    const event = { preventDefault: vi.fn() }
    const item = { getFilename: () => 'a.pdf', setSavePath: vi.fn() }
    site.willDownload(event, item as never, new FakeContents() as never)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(item.setSavePath).not.toHaveBeenCalled()
  })

  it('025-AC-020 hands a tab\'s download to the downloads module, and counts downloads per page load', async () => {
    const make = () => ({
      getFilename: () => 'a.pdf',
      setSavePath: vi.fn(),
      hasUserGesture: () => false,
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      getState: () => 'progressing' as const,
      once: vi.fn()
    })
    const first = make()
    site.willDownload({ preventDefault: vi.fn() }, first, contents as never)
    expect(first.setSavePath).toHaveBeenCalled()
    const second = make()
    site.willDownload({ preventDefault: vi.fn() }, second, contents as never)
    expect(second.pause).toHaveBeenCalled()
    contents.emit('did-navigate', {}, PAGE)
    const third = make()
    site.willDownload({ preventDefault: vi.fn() }, third, contents as never)
    expect(third.pause).not.toHaveBeenCalled()
    expect(site.showDownload(7, 'unknown')).toBe(false)
  })
})

describe('BrowserSite certificates and sign-in (025-FR-021, 025-FR-022)', () => {
  it('025-AC-021 shows the certificate decision through the tab and takes its answer while the tab is open', async () => {
    const results: boolean[] = []
    contents.emit('certificate-error', { preventDefault: vi.fn() }, PAGE, 'net::ERR_CERT_AUTHORITY_INVALID', { data: 'x' }, (t: boolean) => results.push(t), true)
    await flush()
    expect(results).toEqual([false])
    expect(link.answerCertificate('row1', false)).toBe('accepted')
    link.detach()
    expect(link.answerCertificate('row1', false)).toBe('unknown')
  })

  it('025-AC-022 passes a sign-in answer\'s fields to the box, and a finished request to the tab', async () => {
    const calls: unknown[] = []
    contents.emit(
      'login',
      { preventDefault: vi.fn() },
      { url: 'https://garden.test/basic', firstAuthAttempt: true, isRequestForNavigation: false },
      { isProxy: false, scheme: 'basic', host: 'garden.test', port: 443, realm: 'R' },
      (...a: unknown[]) => calls.push(a)
    )
    await flush()
    const row = strip.find((e) => e.op === 'add')
    if (row?.op !== 'add') throw new Error('no row')
    expect(row.row).toMatchObject({ kind: 'signIn', remembered: 'session', signIn: { remember: 'noKeyring' } })
    clock.advance(STRIP_INPUT_GUARD_MS)
    expect(link.answerStrip(row.row.requestId, 'signIn', { username: 'u', password: 'p' })).toBe('accepted')
    expect(calls).toEqual([['u', 'p']])
    site.requestCompleted(contents.id, 'https://garden.test/basic', 200)
    site.requestCompleted(999_999, 'https://garden.test/basic', 200)
  })

  it('025-AC-023 clears certificate exceptions and saved sign-ins per project without throwing', async () => {
    await expect(site.clearCertificates('/project')).resolves.toBeUndefined()
    await expect(site.clearCredentials('/project')).resolves.toBeUndefined()
  })
})
