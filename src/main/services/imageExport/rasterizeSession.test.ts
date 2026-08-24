// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the harness session hardening.
 *
 * Two things are being proven, and both are invisible in a code review:
 *
 * 1. **Install order.** The request filter and the permission handlers must
 *    bind BEFORE the window that uses the partition exists. A control installed
 *    after the first request is a control that looks present and does nothing,
 *    which is worse than no control at all.
 * 2. **The allow-list really is an allow-list.** The packaged renderer
 *    directory is admitted as a PREFIX (the emitted chunk name is decided by
 *    the bundler), and everything else — the network included — is refused.
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'

const { calls, mockFromPartition, mockIs, mockLogger } = vi.hoisted(() => ({
  calls: [] as string[],
  mockFromPartition: vi.fn(),
  mockIs: { dev: false },
  mockLogger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))

vi.mock('electron', () => ({
  session: { fromPartition: (...args: unknown[]) => mockFromPartition(...args) }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: mockIs }))
vi.mock('../LoggingService', () => ({ logger: mockLogger }))

import {
  IMAGE_EXPORT_PARTITION,
  buildHarnessWebPreferences,
  hardenRasterizeWindow,
  harnessUrlContext,
  isAllowedHarnessUrl,
  prepareRasterizeSession
} from './rasterizeSession'

const RENDERER_DIR = resolve('/app/out/renderer')
const DEV_URL = 'http://localhost:5173'

/** A session stub that records the order its controls were installed in. */
function makeSession() {
  let filter: ((details: unknown, callback: (r: unknown) => void) => void) | null = null
  return {
    get filter() {
      return filter
    },
    webRequest: {
      onBeforeRequest: vi.fn((_filterSpec: unknown, handler: typeof filter) => {
        calls.push('onBeforeRequest')
        filter = handler
      })
    },
    setPermissionRequestHandler: vi.fn(
      (_handler: (a: unknown, b: unknown, cb: (v: boolean) => void) => void) => {
        calls.push('setPermissionRequestHandler')
      }
    ),
    setPermissionCheckHandler: vi.fn((_handler: () => boolean) => {
      calls.push('setPermissionCheckHandler')
    })
  }
}

beforeEach(() => {
  calls.length = 0
  vi.clearAllMocks()
  mockIs.dev = false
  delete process.env['ELECTRON_RENDERER_URL']
})

describe('prepareRasterizeSession', () => {
  it('uses an in-memory partition — no `persist:` prefix, so it dies with the run', () => {
    expect(IMAGE_EXPORT_PARTITION).toBe('image-export')
    expect(IMAGE_EXPORT_PARTITION.startsWith('persist:')).toBe(false)
  })

  it('installs the request filter and BOTH permission handlers', () => {
    mockFromPartition.mockReturnValue(makeSession())
    prepareRasterizeSession(RENDERER_DIR)
    expect(calls).toEqual([
      'onBeforeRequest',
      'setPermissionRequestHandler',
      'setPermissionCheckHandler'
    ])
  })

  it('installs every control BEFORE a window could be constructed', () => {
    mockFromPartition.mockReturnValue(makeSession())
    prepareRasterizeSession(RENDERER_DIR)
    // The caller constructs the BrowserWindow only after this returns, so
    // "before the window" reduces to "before this function returns".
    calls.push('new BrowserWindow')
    expect(calls.indexOf('onBeforeRequest')).toBeLessThan(calls.indexOf('new BrowserWindow'))
    expect(calls.indexOf('setPermissionCheckHandler')).toBeLessThan(
      calls.indexOf('new BrowserWindow')
    )
  })

  it('denies every permission, asked for or merely checked', () => {
    const session = makeSession()
    mockFromPartition.mockReturnValue(session)
    prepareRasterizeSession(RENDERER_DIR)

    const requestHandler = session.setPermissionRequestHandler.mock.calls[0][0]
    const granted = vi.fn()
    requestHandler(null, 'media', granted)
    expect(granted).toHaveBeenCalledWith(false)

    const checkHandler = session.setPermissionCheckHandler.mock.calls[0][0]
    expect(checkHandler()).toBe(false)
  })

  it('cancels a disallowed request and logs it with the path redacted', () => {
    const session = makeSession()
    mockFromPartition.mockReturnValue(session)
    prepareRasterizeSession(RENDERER_DIR)

    const callback = vi.fn()
    session.filter?.(
      { url: 'https://evil.example.com/beacon.js', resourceType: 'script' },
      callback
    )
    expect(callback).toHaveBeenCalledWith({ cancel: true })
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('lets the harness page itself through', () => {
    const session = makeSession()
    mockFromPartition.mockReturnValue(session)
    prepareRasterizeSession(RENDERER_DIR)

    const callback = vi.fn()
    const url = pathToFileURL(join(RENDERER_DIR, 'imageExport.html')).href
    session.filter?.({ url, resourceType: 'mainFrame' }, callback)
    expect(callback).toHaveBeenCalledWith({ cancel: false })
  })
})

describe('isAllowedHarnessUrl (production)', () => {
  const context = { devServerUrl: null, rendererDir: RENDERER_DIR }

  it('admits the harness page', () => {
    const url = pathToFileURL(join(RENDERER_DIR, 'imageExport.html')).href
    expect(isAllowedHarnessUrl(url, context)).toBe(true)
  })

  it('admits any emitted chunk under the renderer directory — a PREFIX, not one file', () => {
    const url = pathToFileURL(join(RENDERER_DIR, 'assets', 'imageExport-Ab12Cd.js')).href
    expect(isAllowedHarnessUrl(url, context)).toBe(true)
  })

  it('admits a chunk whose URL carries a query string', () => {
    const url = `${pathToFileURL(join(RENDERER_DIR, 'assets', 'x.js')).href}?v=1`
    expect(isAllowedHarnessUrl(url, context)).toBe(true)
  })

  it.each([
    ['https', 'https://example.com/x.js'],
    ['http', 'http://127.0.0.1:9/x.js'],
    ['data', 'data:text/javascript,alert(1)'],
    ['ws', 'ws://localhost:5173/']
  ])('refuses a %s URL', (_label, url) => {
    expect(isAllowedHarnessUrl(url, context)).toBe(false)
  })

  it('refuses a file outside the renderer directory', () => {
    const url = pathToFileURL(resolve('/app/out/main/index.js')).href
    expect(isAllowedHarnessUrl(url, context)).toBe(false)
  })

  it('refuses a traversal out of the renderer directory', () => {
    const url = `${pathToFileURL(RENDERER_DIR).href}/../main/index.js`
    expect(isAllowedHarnessUrl(url, context)).toBe(false)
  })

  it('refuses a sibling directory whose name merely starts the same way', () => {
    const url = pathToFileURL(resolve('/app/out/renderer-evil/x.js')).href
    expect(isAllowedHarnessUrl(url, context)).toBe(false)
  })

  it('refuses an unparseable URL', () => {
    expect(isAllowedHarnessUrl('not a url', context)).toBe(false)
  })
})

describe('isAllowedHarnessUrl (development)', () => {
  const context = { devServerUrl: DEV_URL, rendererDir: RENDERER_DIR }

  it.each([
    `${DEV_URL}/imageExport.html`,
    `${DEV_URL}/@vite/client`,
    `${DEV_URL}/@react-refresh`,
    `${DEV_URL}/src/imageExport/harness.ts`,
    `${DEV_URL}/node_modules/.vite/deps/x.js`
  ])('admits %s', (url) => {
    expect(isAllowedHarnessUrl(url, context)).toBe(true)
  })

  it('refuses the app entry, so the harness cannot navigate to it', () => {
    expect(isAllowedHarnessUrl(`${DEV_URL}/index.html`, context)).toBe(false)
  })

  it('refuses another origin even in development', () => {
    expect(isAllowedHarnessUrl('http://localhost:9999/x.js', context)).toBe(false)
  })
})

describe('harnessUrlContext', () => {
  it('uses the dev server only when the app itself would', () => {
    mockIs.dev = true
    process.env['ELECTRON_RENDERER_URL'] = DEV_URL
    expect(harnessUrlContext(RENDERER_DIR).devServerUrl).toBe(DEV_URL)
  })

  it('ignores a stray dev URL in a production build', () => {
    mockIs.dev = false
    process.env['ELECTRON_RENDERER_URL'] = DEV_URL
    expect(harnessUrlContext(RENDERER_DIR).devServerUrl).toBeNull()
  })
})

describe('buildHarnessWebPreferences', () => {
  const preferences = buildHarnessWebPreferences('/app/out/preload/imageExport.js', 'tok')

  it.each([
    ['contextIsolation', true],
    ['sandbox', true],
    ['nodeIntegration', false],
    ['webSecurity', true],
    ['allowRunningInsecureContent', false],
    ['experimentalFeatures', false],
    ['nodeIntegrationInSubFrames', false],
    ['webviewTag', false],
    ['webgl', false],
    ['enableWebSQL', false],
    ['spellcheck', false],
    ['offscreen', false]
  ])('pins %s to %s', (key, value) => {
    expect(preferences[key as keyof typeof preferences]).toBe(value)
  })

  it('binds the window to the hardened partition', () => {
    expect(preferences.partition).toBe(IMAGE_EXPORT_PARTITION)
  })

  it('passes the per-export token through additionalArguments', () => {
    expect(preferences.additionalArguments).toEqual(['--image-export-token=tok'])
  })
})

describe('hardenRasterizeWindow', () => {
  function makeWindow(currentUrl: string) {
    const listeners: Record<string, (...args: unknown[]) => void> = {}
    return {
      listeners,
      webContents: {
        setWindowOpenHandler: vi.fn(),
        getURL: () => currentUrl,
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          listeners[event] = handler
        })
      }
    }
  }

  it('denies every window-open attempt', () => {
    const win = makeWindow('file:///app/out/renderer/imageExport.html')
    hardenRasterizeWindow(win as never)
    const handler = win.webContents.setWindowOpenHandler.mock.calls[0][0]
    expect(handler()).toEqual({ action: 'deny' })
  })

  it('blocks a navigation away from the loaded URL', () => {
    const current = 'file:///app/out/renderer/imageExport.html'
    const win = makeWindow(current)
    hardenRasterizeWindow(win as never)

    const event = { preventDefault: vi.fn() }
    win.listeners['will-navigate'](event, 'https://evil.example.com')
    expect(event.preventDefault).toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('allows a re-navigation to the same URL', () => {
    const current = 'file:///app/out/renderer/imageExport.html'
    const win = makeWindow(current)
    hardenRasterizeWindow(win as never)

    const event = { preventDefault: vi.fn() }
    win.listeners['will-navigate'](event, current)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
