// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Electron half of a popup window (025-FR-011, ADR 0011 decision 9): a
 * sandboxed host with the popup strip's own preload and the dark background,
 * the strip's renderer loaded on its route, the page view
 * adopting the popup's `webContents`, the `browserPopup` kind, the work area
 * of the opener's screen and the popup-kind CDP session.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { BrowserWindow, WebContentsView, screen, registerAppWebContents, cdp, CdpSession, toolkit } = vi.hoisted(() => {
  const cdp = { attach: vi.fn(), detach: vi.fn(), send: vi.fn(async () => ({})), hangProbe: { setVisible: vi.fn() } }
  return {
    BrowserWindow: Object.assign(vi.fn(), { fromId: vi.fn() }),
    WebContentsView: vi.fn(),
    screen: {
      getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1280, height: 800 } })),
      getDisplayMatching: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 2560, height: 1400 } }))
    },
    registerAppWebContents: vi.fn(),
    cdp,
    CdpSession: vi.fn(function () {
      return cdp
    }),
    toolkit: { is: { dev: false } }
  }
})
vi.mock('electron', () => ({ BrowserWindow, WebContentsView, screen }))
vi.mock('@electron-toolkit/utils', () => toolkit)
vi.mock('../../../ipc/appWebContents', () => ({ registerAppWebContents }))
vi.mock('../cdp/BrowserCdpSession', () => ({ BrowserCdpSession: CdpSession }))
vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { electronPopupWindows, POPUP_HOST_ROUTE, POPUP_STRIP_HEIGHT_PX } from './popupWindowElectron'
import { electronPrintsSecurityWarnings } from '../cdp/cdpLogCollector'
import { browserWebPreferencesFor } from '../browserWebPreferences'

beforeEach(() => vi.clearAllMocks())

describe('electronPopupWindows', () => {
  it('builds a sandboxed host with the popup preload, Erfana’s background and the content size', () => {
    const windows = electronPopupWindows(() => null)
    windows.createHost({ contentSize: { width: 500, height: 600 }, title: 'about:blank – opened by app.test' })
    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 500,
        height: 600,
        useContentSize: true,
        show: false,
        title: 'about:blank – opened by app.test',
        backgroundColor: '#161312',
        webPreferences: {
          preload: expect.stringMatching(/preload[\\/]browserPopup\.js$/),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true
        }
      })
    )
    expect(windows.stripHeight).toBe(POPUP_STRIP_HEIGHT_PX)
    expect(windows.originMinWidth).toBe(0)
  })

  it('adopts the popup page into a view with the frozen settings again, and registers the host as a browserPopup window', () => {
    const windows = electronPopupWindows(() => null)
    const page = { id: 1 }
    windows.createView(page as never)
    // A view around an existing page resets its settings to Electron's defaults unless they are given (safeDialogs).
    expect(WebContentsView).toHaveBeenCalledWith({ webContents: page, webPreferences: { ...browserWebPreferencesFor(process.platform) } })
    const host = { webContents: { id: 9 } }
    windows.registerHost(host as never)
    expect(registerAppWebContents).toHaveBeenCalledWith(host.webContents, 'browserPopup')
  })

  it('takes the work area of the opener window’s screen, or the primary screen', () => {
    BrowserWindow.fromId.mockReturnValueOnce({ isDestroyed: () => false, getBounds: () => ({ x: 0, y: 0, width: 10, height: 10 }) })
    expect(electronPopupWindows(() => 4).workArea('browser-tab-1')).toEqual({ width: 2560, height: 1400 })
    expect(BrowserWindow.fromId).toHaveBeenCalledWith(4)
    BrowserWindow.fromId.mockReturnValueOnce(null)
    expect(electronPopupWindows(() => 4).workArea('browser-tab-1')).toEqual({ width: 1280, height: 800 })
    expect(electronPopupWindows(() => null).workArea('browser-tab-1')).toEqual({ width: 1280, height: 800 })
  })

  it('attaches a popup-kind CDP session with the probe on and dialog events, or none when refused', () => {
    const windows = electronPopupWindows(() => null)
    const link = windows.attachCdp!({ id: 1 } as never)
    // A packaged run (is.dev false): Electron prints no security warnings, so none are dropped.
    expect(CdpSession).toHaveBeenCalledWith({ kind: 'popup', dropElectronSecurityWarnings: electronPrintsSecurityWarnings(true, process.env) })
    expect(cdp.hangProbe.setVisible).toHaveBeenCalledWith(true)
    expect(cdp.send).toHaveBeenCalledWith('Page.enable')
    link!.detach()
    expect(cdp.detach).toHaveBeenCalled()
    cdp.attach.mockImplementationOnce(() => {
      throw new Error('another client')
    })
    expect(windows.attachCdp!({ id: 2 } as never)).toBeNull()
  })

  it('loads the strip renderer on its route and refuses every other navigation of the host', async () => {
    const windows = electronPopupWindows(() => null)
    const handlers = new Map<string, (event: { preventDefault: () => void }) => void>()
    const host = {
      loadFile: vi.fn(async () => undefined),
      loadURL: vi.fn(async () => undefined),
      webContents: { on: vi.fn((name: string, h: (event: { preventDefault: () => void }) => void) => handlers.set(name, h)) }
    }
    windows.loadHost?.(host as never)
    expect(host.loadFile).toHaveBeenCalledWith(expect.stringMatching(/renderer[\\/]index\.html$/), { hash: POPUP_HOST_ROUTE })
    expect(host.loadURL).not.toHaveBeenCalled()
    const preventDefault = vi.fn()
    handlers.get('will-navigate')?.({ preventDefault })
    expect(preventDefault).toHaveBeenCalled()
  })

  it('logs, never throws, when the strip renderer fails to load', async () => {
    const windows = electronPopupWindows(() => null)
    const host = { loadFile: vi.fn(async () => Promise.reject(new Error('gone'))), webContents: { on: vi.fn() } }
    expect(() => windows.loadHost?.(host as never)).not.toThrow()
    await Promise.resolve()
  })

  it('loads the dev server route in development, and the bundle when no dev URL is set', () => {
    const windows = electronPopupWindows(() => null)
    const host = () => ({ loadFile: vi.fn(async () => undefined), loadURL: vi.fn(async () => undefined), webContents: { on: vi.fn() } })
    toolkit.is.dev = true
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    try {
      const dev = host()
      windows.loadHost?.(dev as never)
      expect(dev.loadURL).toHaveBeenCalledWith(`http://localhost:5173#${POPUP_HOST_ROUTE}`)
      vi.stubEnv('ELECTRON_RENDERER_URL', '')
      const noUrl = host()
      windows.loadHost?.(noUrl as never)
      expect(noUrl.loadFile).toHaveBeenCalled()
    } finally {
      toolkit.is.dev = false
      vi.unstubAllEnvs()
    }
  })

  it('logs a load failure that is not an Error by its text', async () => {
    const windows = electronPopupWindows(() => null)
    const host = { loadFile: vi.fn(async () => Promise.reject('gone')), webContents: { on: vi.fn() } }
    expect(() => windows.loadHost?.(host as never)).not.toThrow()
    await Promise.resolve()
  })

  it('falls back to the default content size when the page asked for none', () => {
    electronPopupWindows(() => null).createHost({ contentSize: { width: 0, height: 0 }, title: 't' })
    const options = vi.mocked(BrowserWindow).mock.calls[0]![0] as { width: number; height: number }
    expect(options.width).toBeGreaterThan(0)
    expect(options.height).toBeGreaterThan(0)
  })
})
