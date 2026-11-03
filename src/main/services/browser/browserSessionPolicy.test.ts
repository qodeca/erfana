// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Deny-by-default hardening of the browser session (spec 025, 025-FR-019,
 * 025-FR-024; solution design § 3.3 step 3).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import {
  BROWSER_PERMISSION_CLASSES,
  browserUserAgent,
  hardenBrowserContents,
  hardenBrowserSession,
  isPermissionGranted,
  permissionClass,
  type HardenableSession
} from './browserSessionPolicy'

/** The permission names Electron's own typings list for `setPermissionRequestHandler`. */
function electronPermissionNames(): string[] {
  const dts = readFileSync(join(process.cwd(), 'node_modules/electron/electron.d.ts'), 'utf8')
  const signature = /setPermissionRequestHandler\(handler: \(\(webContents: WebContents, permission: ([^,]*(?:'[^']*'[^,]*)*?), callback:/.exec(
    dts
  )
  if (!signature) throw new Error('setPermissionRequestHandler signature not found in electron.d.ts')
  return [...signature[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
}

type Listener = (...args: unknown[]) => void

function fakeSession() {
  const listeners = new Map<string, Listener>()
  const handlers: Record<string, unknown> = {}
  const session = {
    setPermissionRequestHandler: vi.fn((h: unknown) => (handlers.request = h)),
    setPermissionCheckHandler: vi.fn((h: unknown) => (handlers.check = h)),
    setDevicePermissionHandler: vi.fn((h: unknown) => (handlers.device = h)),
    setDisplayMediaRequestHandler: vi.fn((h: unknown) => (handlers.display = h)),
    setUserAgent: vi.fn(),
    setSpellCheckerEnabled: vi.fn(),
    on: vi.fn((event: string, listener: Listener) => {
      listeners.set(event, listener)
      return session
    })
  }
  return { session, listeners, handlers, asSession: session as unknown as HardenableSession }
}

const OPTIONS = { platform: 'darwin' as const, chromeVersion: '146.0.7680.31' }

describe('permission table', () => {
  it('classes exactly the permission names of the installed Electron (a new one fails here)', () => {
    expect(Object.keys(BROWSER_PERMISSION_CLASSES).sort()).toEqual(electronPermissionNames())
  })

  it('denies a permission name the table does not know (fail closed)', () => {
    expect(permissionClass('some-future-permission')).toBe('deny')
    expect(isPermissionGranted('some-future-permission')).toBe(false)
    expect(permissionClass('toString')).toBe('deny')
    expect(permissionClass('__proto__')).toBe('deny')
  })

  it('grants only clipboard writes and persistent storage today', () => {
    const granted = Object.keys(BROWSER_PERMISSION_CLASSES).filter(isPermissionGranted).sort()
    expect(granted).toEqual(['clipboard-sanitized-write', 'persistent-storage'])
  })

  it('classes prompts and notices, and grants neither without the site hooks', () => {
    expect(permissionClass('media')).toBe('ask')
    expect(permissionClass('fullscreen')).toBe('allowWithNotice')
    for (const name of ['notifications', 'keyboardLock', 'openExternal', 'hid', 'serial', 'usb']) {
      expect(permissionClass(name)).toBe('deny')
    }
    for (const name of ['media', 'fullscreen', 'pointerLock', 'geolocation', 'clipboard-read', 'display-capture']) {
      expect(isPermissionGranted(name)).toBe(false)
    }
  })
})

describe('browserUserAgent (025-FR-024)', () => {
  it.each([
    ['darwin', 'Macintosh; Intel Mac OS X 10_15_7'],
    ['win32', 'Windows NT 10.0; Win64; x64'],
    ['linux', 'X11; Linux x86_64']
  ] as const)('is a reduced Chrome user agent on %s', (platform, token) => {
    expect(browserUserAgent(platform, '146.0.7680.31')).toBe(
      `Mozilla/5.0 (${token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36`
    )
  })

  it('carries no Electron or Erfana token', () => {
    const ua = browserUserAgent('darwin', process.versions.chrome ?? '146.0.0.0')
    expect(ua).not.toMatch(/electron|erfana/i)
  })

  it('falls back to major 0 for an unreadable version', () => {
    expect(browserUserAgent('linux', 'x')).toContain('Chrome/0.0.0.0')
  })
})

describe('hardenBrowserSession', () => {
  let fake: ReturnType<typeof fakeSession>
  beforeEach(() => {
    fake = fakeSession()
    hardenBrowserSession(fake.asSession, OPTIONS)
  })

  it('answers permission requests and checks from the table', () => {
    const request = fake.handlers.request as (wc: unknown, p: string, cb: (g: boolean) => void) => void
    const check = fake.handlers.check as (wc: unknown, p: string) => boolean
    const cb = vi.fn()
    request(null, 'media', cb)
    request(null, 'persistent-storage', cb)
    request(null, 'brand-new', cb)
    expect(cb.mock.calls).toEqual([[false], [true], [false]])
    expect(check(null, 'clipboard-sanitized-write')).toBe(true)
    expect(check(null, 'notifications')).toBe(false)
    expect(check(null, 'brand-new')).toBe(false)
  })

  it('refuses every device and every screen-sharing request', () => {
    expect((fake.handlers.device as () => boolean)()).toBe(false)
    const callback = vi.fn()
    ;(fake.handlers.display as (r: unknown, cb: (s: unknown) => void) => void)({}, callback)
    expect(callback).toHaveBeenCalledWith(null)
    expect(fake.session.setDisplayMediaRequestHandler).toHaveBeenCalledWith(expect.any(Function), { useSystemPicker: false })
  })

  it.each([
    ['select-hid-device', [{}], []],
    ['select-serial-port', [[], {}], ['']],
    ['select-usb-device', [{}], []]
  ] as const)('cancels the %s chooser before Electron picks a device', (event, middle, cancelArgs) => {
    const preventDefault = vi.fn()
    const callback = vi.fn()
    fake.listeners.get(event)!({ preventDefault }, ...middle, callback)
    expect(preventDefault).toHaveBeenCalled()
    expect(callback).toHaveBeenCalledWith(...cancelArgs)
  })

  it('cancels downloads when hardened without the site hooks', () => {
    const preventDefault = vi.fn()
    fake.listeners.get('will-download')!({ preventDefault })
    expect(preventDefault).toHaveBeenCalled()
  })

  it('sets the user agent and keeps spell check on outside Linux', () => {
    expect(fake.session.setUserAgent).toHaveBeenCalledWith(browserUserAgent('darwin', OPTIONS.chromeVersion))
    expect(fake.session.setSpellCheckerEnabled).toHaveBeenCalledWith(true)
  })

  it('turns spell check off on Linux (S-4)', () => {
    const linux = fakeSession()
    hardenBrowserSession(linux.asSession, { ...OPTIONS, platform: 'linux' })
    expect(linux.session.setSpellCheckerEnabled).toHaveBeenCalledWith(false)
  })

  it('hardens a session once', () => {
    hardenBrowserSession(fake.asSession, OPTIONS)
    expect(fake.session.setPermissionRequestHandler).toHaveBeenCalledTimes(1)
    expect(fake.session.on.mock.calls.filter(([e]) => e === 'will-download')).toHaveLength(1)
  })
})

describe('hardenBrowserSession with the site hooks (025-FR-019, 025-FR-020)', () => {
  function hooks() {
    return {
      permissionRequest: vi.fn(),
      permissionCheck: vi.fn(() => true),
      displayMediaRequest: vi.fn(),
      willDownload: vi.fn()
    }
  }

  it('sends permission requests and checks, screen sharing and downloads to the site', () => {
    const site = hooks()
    const fake = fakeSession()
    hardenBrowserSession(fake.asSession, { ...OPTIONS, site })
    const contents = { id: 1 }
    const callback = vi.fn()
    const details = { requestingUrl: 'https://a.test/' }
    ;(fake.handlers.request as (...a: unknown[]) => void)(contents, 'media', callback, details)
    expect(site.permissionRequest).toHaveBeenCalledWith(contents, 'media', callback, details)
    expect((fake.handlers.check as (...a: unknown[]) => boolean)(contents, 'geolocation', 'https://a.test', {})).toBe(true)
    expect(site.permissionCheck).toHaveBeenCalledWith(contents, 'geolocation', 'https://a.test', {})
    const request = { frame: null, securityOrigin: 'https://a.test' }
    ;(fake.handlers.display as (...a: unknown[]) => void)(request, callback)
    expect(site.displayMediaRequest).toHaveBeenCalledWith(request, callback)
    const event = { preventDefault: vi.fn() }
    const item = {}
    fake.listeners.get('will-download')!(event, item, contents)
    expect(site.willDownload).toHaveBeenCalledWith(event, item, contents)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('still refuses every device and chooser with the site hooks', () => {
    const fake = fakeSession()
    hardenBrowserSession(fake.asSession, { ...OPTIONS, site: hooks() })
    expect((fake.handlers.device as () => boolean)()).toBe(false)
    const preventDefault = vi.fn()
    fake.listeners.get('select-usb-device')!({ preventDefault }, {}, vi.fn())
    expect(preventDefault).toHaveBeenCalled()
  })
})

describe('hardenBrowserContents', () => {
  it('cancels the Bluetooth chooser', () => {
    let listener: Listener | undefined
    hardenBrowserContents({ on: (_e, l) => (listener = l as Listener) })
    const preventDefault = vi.fn()
    const callback = vi.fn()
    listener!({ preventDefault }, [{ deviceId: 'a' }], callback)
    expect(preventDefault).toHaveBeenCalled()
    expect(callback).toHaveBeenCalledWith('')
  })
})
