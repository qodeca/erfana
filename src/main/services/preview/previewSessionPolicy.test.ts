// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { Session, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  PREVIEW_WEB_PREFERENCES,
  buildPreviewWebPreferences,
  hardenPreviewSession,
  nextPartitionName
} from './previewSessionPolicy'

type PermReqHandler = Parameters<Session['setPermissionRequestHandler']>[0]
type PermCheckHandler = Parameters<Session['setPermissionCheckHandler']>[0]
type WillDownloadListener = (
  event: Electron.Event,
  item: Electron.DownloadItem,
  webContents: WebContents
) => void

interface SessionMock {
  session: Session
  setPermissionRequestHandler: ReturnType<typeof vi.fn<(h: PermReqHandler) => void>>
  setPermissionCheckHandler: ReturnType<typeof vi.fn<(h: PermCheckHandler) => void>>
  on: ReturnType<typeof vi.fn<(event: string, listener: WillDownloadListener) => void>>
  removeListener: ReturnType<typeof vi.fn<(event: string, listener: WillDownloadListener) => void>>
  onHeadersReceived: ReturnType<typeof vi.fn>
  onBeforeSendHeaders: ReturnType<typeof vi.fn>
}

function makeSessionMock(): SessionMock {
  const setPermissionRequestHandler = vi.fn<(h: PermReqHandler) => void>()
  const setPermissionCheckHandler = vi.fn<(h: PermCheckHandler) => void>()
  const on = vi.fn<(event: string, listener: WillDownloadListener) => void>()
  const removeListener = vi.fn<(event: string, listener: WillDownloadListener) => void>()
  const onHeadersReceived = vi.fn()
  const onBeforeSendHeaders = vi.fn()

  const session = {
    setPermissionRequestHandler,
    setPermissionCheckHandler,
    on,
    removeListener,
    webRequest: { onHeadersReceived, onBeforeSendHeaders }
  } as unknown as Session

  return {
    session,
    setPermissionRequestHandler,
    setPermissionCheckHandler,
    on,
    removeListener,
    onHeadersReceived,
    onBeforeSendHeaders
  }
}

function makeWebContentsMock(): {
  webContents: WebContents
  setWebRTCIPHandlingPolicy: ReturnType<typeof vi.fn<(policy: string) => void>>
} {
  const setWebRTCIPHandlingPolicy = vi.fn<(policy: string) => void>()
  const webContents = { setWebRTCIPHandlingPolicy } as unknown as WebContents
  return { webContents, setWebRTCIPHandlingPolicy }
}

describe('buildPreviewWebPreferences', () => {
  it('equals the frozen literal once `session` is omitted', () => {
    const session = {} as unknown as Session
    const prefs = buildPreviewWebPreferences(session)

    const { session: _omitted, ...withoutSession } = prefs
    void _omitted
    expect(withoutSession).toStrictEqual(PREVIEW_WEB_PREFERENCES)
  })

  it('adds `session` as the sole runtime addition when no preload is supplied', () => {
    const session = { marker: true } as unknown as Session
    const prefs = buildPreviewWebPreferences(session)
    expect(prefs.session).toBe(session)
    expect(Object.prototype.hasOwnProperty.call(prefs, 'preload')).toBe(false)
  })

  it('adds the preview-page preload when the composition root supplies one', () => {
    // sd-074b §5.1: the sealed page gains a ONE-WAY reporter, wired at the
    // composition root because the path is environment-dependent.
    const session = { marker: true } as unknown as Session
    const prefs = buildPreviewWebPreferences(session, '/out/preload/previewPage.js')
    expect(prefs.preload).toBe('/out/preload/previewPage.js')
    // Everything else stays pinned.
    expect(prefs.sandbox).toBe(true)
    expect(prefs.contextIsolation).toBe(true)
    expect(prefs.nodeIntegration).toBe(false)
  })

  it('omits the preload when the bundle was not found', () => {
    // Missing bundle degrades to inert links, never to a preview that fails.
    const session = { marker: true } as unknown as Session
    expect(
      Object.prototype.hasOwnProperty.call(buildPreviewWebPreferences(session, null), 'preload')
    ).toBe(false)
  })

  it('pins the security-critical prefs and omits `preload`', () => {
    // A regression that flipped a default would change this frozen literal.
    expect(PREVIEW_WEB_PREFERENCES.sandbox).toBe(true)
    expect(PREVIEW_WEB_PREFERENCES.contextIsolation).toBe(true)
    expect(PREVIEW_WEB_PREFERENCES.nodeIntegration).toBe(false)
    expect(PREVIEW_WEB_PREFERENCES.nodeIntegrationInSubFrames).toBe(false)
    expect(PREVIEW_WEB_PREFERENCES.webSecurity).toBe(true)
    expect(PREVIEW_WEB_PREFERENCES.webviewTag).toBe(false)
    expect(PREVIEW_WEB_PREFERENCES.experimentalFeatures).toBe(false)
    expect(PREVIEW_WEB_PREFERENCES.devTools).toBe(false)
    // `preload` is still absent from the FROZEN LITERAL: it is environment
    // dependent, so it is supplied per call instead (sd-074b §5.2).
    expect(Object.prototype.hasOwnProperty.call(PREVIEW_WEB_PREFERENCES, 'preload')).toBe(false)
  })

  it('freezes the literal so it cannot be mutated at runtime', () => {
    expect(Object.isFrozen(PREVIEW_WEB_PREFERENCES)).toBe(true)
  })
})

describe('nextPartitionName', () => {
  it('produces an in-memory partition name (no `persist:` prefix) and is unique', () => {
    const a = nextPartitionName()
    const b = nextPartitionName()
    expect(a.startsWith('persist:')).toBe(false)
    expect(a).not.toBe(b)
  })
})

describe('hardenPreviewSession', () => {
  it('denies every permission request and check', () => {
    const mock = makeSessionMock()
    const { webContents } = makeWebContentsMock()

    hardenPreviewSession(mock.session, webContents)

    // Request path: the installed handler answers false.
    const requestHandler = mock.setPermissionRequestHandler.mock.calls[0][0]
    expect(requestHandler).not.toBeNull()
    const grant = vi.fn<(granted: boolean) => void>()
    requestHandler?.(
      {} as WebContents,
      'media',
      grant,
      {} as Electron.PermissionRequest
    )
    expect(grant).toHaveBeenCalledWith(false)

    // Check path: the installed handler returns false.
    const checkHandler = mock.setPermissionCheckHandler.mock.calls[0][0]
    expect(checkHandler).not.toBeNull()
    const result = checkHandler?.(
      null,
      'media',
      'https://example.com',
      {} as Electron.PermissionCheckHandlerHandlerDetails
    )
    expect(result).toBe(false)
  })

  it('blocks downloads by preventing the will-download event', () => {
    const mock = makeSessionMock()
    const { webContents } = makeWebContentsMock()

    hardenPreviewSession(mock.session, webContents)

    const [event, listener] = mock.on.mock.calls[0]
    expect(event).toBe('will-download')

    const preventDefault = vi.fn()
    listener(
      { preventDefault } as unknown as Electron.Event,
      {} as Electron.DownloadItem,
      {} as WebContents
    )
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('narrows WebRTC via setWebRTCIPHandlingPolicy', () => {
    const mock = makeSessionMock()
    const wc = makeWebContentsMock()

    hardenPreviewSession(mock.session, wc.webContents)

    expect(wc.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith('disable_non_proxied_udp')
  })

  it('does NOT touch response headers (CSP has a single owner)', () => {
    const mock = makeSessionMock()
    const { webContents } = makeWebContentsMock()

    hardenPreviewSession(mock.session, webContents)

    expect(mock.onHeadersReceived).not.toHaveBeenCalled()
    expect(mock.onBeforeSendHeaders).not.toHaveBeenCalled()
  })

  it('the disposer resets the handlers and removes the download listener', () => {
    const mock = makeSessionMock()
    const { webContents } = makeWebContentsMock()

    const dispose = hardenPreviewSession(mock.session, webContents)
    dispose()

    expect(mock.setPermissionRequestHandler).toHaveBeenLastCalledWith(null)
    expect(mock.setPermissionCheckHandler).toHaveBeenLastCalledWith(null)
    expect(mock.removeListener).toHaveBeenCalledWith('will-download', expect.any(Function))
  })
})
