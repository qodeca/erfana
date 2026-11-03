// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Electron half of a popup window (025-FR-011, ADR 0011 decision 9): a
 * sandboxed host with no preload and the dark background, the page view
 * adopting the popup's `webContents`, the `browserPopup` kind, the work area
 * of the opener's screen and the popup-kind CDP session.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { BrowserWindow, WebContentsView, screen, registerAppWebContents, cdp, CdpSession } = vi.hoisted(() => {
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
    })
  }
})
vi.mock('electron', () => ({ BrowserWindow, WebContentsView, screen }))
vi.mock('../../../ipc/appWebContents', () => ({ registerAppWebContents }))
vi.mock('../cdp/BrowserCdpSession', () => ({ BrowserCdpSession: CdpSession }))
vi.mock('../../LoggingService', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { electronPopupWindows } from './popupWindowElectron'

beforeEach(() => vi.clearAllMocks())

describe('electronPopupWindows', () => {
  it('builds a sandboxed host with no preload, Erfana’s background and the content size', () => {
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
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true }
      })
    )
    expect(windows.stripHeight).toBe(0)
    expect(windows.originMinWidth).toBe(0)
  })

  it('adopts the popup page into a view and registers the host as a browserPopup window', () => {
    const windows = electronPopupWindows(() => null)
    const page = { id: 1 }
    windows.createView(page as never)
    expect(WebContentsView).toHaveBeenCalledWith({ webContents: page })
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
    expect(CdpSession).toHaveBeenCalledWith({ kind: 'popup' })
    expect(cdp.hangProbe.setVisible).toHaveBeenCalledWith(true)
    expect(cdp.send).toHaveBeenCalledWith('Page.enable')
    link!.detach()
    expect(cdp.detach).toHaveBeenCalled()
    cdp.attach.mockImplementationOnce(() => {
      throw new Error('another client')
    })
    expect(windows.attachCdp!({ id: 2 } as never)).toBeNull()
  })
})
