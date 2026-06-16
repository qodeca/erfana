// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for AreaSelectOverlay.selectArea().
 *
 * Mocks BrowserWindow + screen + crypto + fs to verify the promise lifecycle:
 * - resolves with the area selection when the renderer posts
 *   `screenshot:areaSelected` with a matching nonce token via the frame-
 *   scoped `mainFrame.ipc.on` listener.
 * - resolves with null on `screenshot:areaCancelled`, on `closed`, on
 *   the configured timeout, on malformed payloads, on token mismatches,
 *   and on sender-frame URL mismatches.
 * - rejects when the overlay preload is missing or when every per-overlay
 *   load attempt fails.
 * - guards against concurrent overlays.
 *
 * #164 round-2 F#21: `vi.resetAllMocks` keeps `mockResolvedValueOnce` queues
 * from leaking. F#22: explicit `vi.waitFor` replaces the prior
 * `await Promise.resolve(); await Promise.resolve()` microtask flushing.
 * F#23: a per-overlay window-instances list supports multi-display tests.
 *
 * @see Issue #164 - Windows Phase 3 screenshot parity (Phase 2/9 hardening)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSetAlwaysOnTop = vi.fn()
const mockSetVisibleOnAllWorkspaces = vi.fn()
const mockSetFullScreen = vi.fn()
const mockDestroy = vi.fn()
const mockShow = vi.fn()
const mockFocus = vi.fn()
const mockLoadURL = vi.fn(async () => undefined)
const mockLoadFile = vi.fn(async () => undefined)
const mockRemoveAllListeners = vi.fn()
const mockOn = vi.fn()
const mockGetURL = vi.fn(() => 'http://localhost:5173/#overlay/screenshot?displayId=1')
const mockExistsSync = vi.fn(() => true)
const FIXED_TOKEN = '00000000-0000-0000-0000-000000000000'
const mockRandomUUID = vi.fn(() => FIXED_TOKEN)

/**
 * One entry per BrowserWindow created during a test — round-2 F#23 swapped
 * the prior single `windowInstance` for a list so multi-display cases can
 * address the right overlay.
 */
const windowInstances: ReturnType<typeof makeWindow>[] = []

type FrameIpcListener = (event: Electron.IpcMainEvent, payload?: unknown) => void

function makeWindow() {
  const frameIpcListeners: Record<string, FrameIpcListener[]> = {}
  const frameIpc = {
    on: vi.fn((channel: string, listener: FrameIpcListener) => {
      frameIpcListeners[channel] = frameIpcListeners[channel] ?? []
      frameIpcListeners[channel].push(listener)
    }),
    removeListener: vi.fn((channel: string, listener: FrameIpcListener) => {
      frameIpcListeners[channel] = (frameIpcListeners[channel] ?? []).filter((l) => l !== listener)
    })
  }
  const webContents = {
    getURL: mockGetURL,
    on: vi.fn(),
    mainFrame: { ipc: frameIpc }
  }
  const win = {
    webContents,
    setAlwaysOnTop: mockSetAlwaysOnTop,
    setVisibleOnAllWorkspaces: mockSetVisibleOnAllWorkspaces,
    setFullScreen: mockSetFullScreen,
    destroy: mockDestroy,
    show: mockShow,
    focus: mockFocus,
    loadURL: mockLoadURL,
    loadFile: mockLoadFile,
    on: mockOn,
    removeAllListeners: mockRemoveAllListeners,
    isDestroyed: vi.fn(() => false),
    /** Helper: invoke a wired frame-scoped listener as if the renderer sent. */
    emitFrameMessage(channel: string, payload?: unknown, options?: { senderUrl?: string }): void {
      const listeners = frameIpcListeners[channel] ?? []
      const senderUrl = options?.senderUrl ?? webContents.getURL()
      const event = {
        sender: webContents,
        senderFrame: { url: senderUrl }
      } as unknown as Electron.IpcMainEvent
      for (const listener of listeners) {
        listener(event, payload)
      }
    }
  }
  windowInstances.push(win)
  return win
}

const BrowserWindowCtor = vi.fn().mockImplementation(() => makeWindow())

const defaultDisplays = [
  { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
]
let mockDisplays = defaultDisplays

vi.mock('electron', () => ({
  BrowserWindow: BrowserWindowCtor,
  screen: {
    getAllDisplays: () => mockDisplays,
    getPrimaryDisplay: () => mockDisplays[0]
  }
}))

vi.mock('fs', () => ({
  existsSync: mockExistsSync
}))

vi.mock('crypto', () => ({
  randomUUID: mockRandomUUID
}))

/** Mutable so individual tests can flip dev vs production behaviour. */
let isDev = true

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    get dev() {
      return isDev
    }
  }
}))

vi.mock('../LoggingService', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

function emitSelected(
  win: ReturnType<typeof makeWindow>,
  selection: { displayId: number; x: number; y: number; width: number; height: number }
): void {
  win.emitFrameMessage('screenshot:areaSelected', { token: FIXED_TOKEN, selection })
}

function emitCancelled(win: ReturnType<typeof makeWindow>): void {
  win.emitFrameMessage('screenshot:areaCancelled', { token: FIXED_TOKEN })
}

describe('AreaSelectOverlay.selectArea', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    BrowserWindowCtor.mockImplementation(() => makeWindow())
    mockLoadURL.mockResolvedValue(undefined)
    mockLoadFile.mockResolvedValue(undefined)
    mockExistsSync.mockReturnValue(true)
    mockRandomUUID.mockReturnValue(FIXED_TOKEN)
    mockGetURL.mockReturnValue('http://localhost:5173/#overlay/screenshot?displayId=1')
    mockDisplays = defaultDisplays
    windowInstances.length = 0
    isDev = true
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
  })

  it('resolves with the selection when renderer posts a valid token + payload', async () => {
    const { AreaSelectOverlay } = await import('./ScreenshotOverlayWindow')
    const overlay = new AreaSelectOverlay()

    const promise = overlay.selectArea()
    await vi.waitFor(() => expect(BrowserWindowCtor).toHaveBeenCalled())
    await vi.waitFor(() => expect(mockShow).toHaveBeenCalled())

    emitSelected(windowInstances[0], { displayId: 1, x: 10, y: 20, width: 100, height: 50 })
    await expect(promise).resolves.toEqual({ displayId: 1, x: 10, y: 20, width: 100, height: 50 })
    expect(mockDestroy).toHaveBeenCalled()
  })

  it('resolves with null on areaCancelled', async () => {
    const { AreaSelectOverlay } = await import('./ScreenshotOverlayWindow')
    const overlay = new AreaSelectOverlay()

    const promise = overlay.selectArea()
    await vi.waitFor(() => expect(mockShow).toHaveBeenCalled())

    emitCancelled(windowInstances[0])
    await expect(promise).resolves.toBeNull()
  })

  it('resolves with null on malformed selection payload', async () => {
    const { AreaSelectOverlay } = await import('./ScreenshotOverlayWindow')
    const overlay = new AreaSelectOverlay()

    const promise = overlay.selectArea()
    await vi.waitFor(() => expect(mockShow).toHaveBeenCalled())

    emitSelected(windowInstances[0], { displayId: 1, x: -1, y: 0, width: 0, height: 0 })
    await expect(promise).resolves.toBeNull()
  })

  it('ignores selection payload with mismatched token', async () => {
    const { AreaSelectOverlay } = await import('./ScreenshotOverlayWindow')
    const overlay = new AreaSelectOverlay()

    const promise = overlay.selectArea()
    await vi.waitFor(() => expect(mockShow).toHaveBeenCalled())

    windowInstances[0].emitFrameMessage('screenshot:areaSelected', {
      token: 'forged-token',
      selection: { displayId: 1, x: 10, y: 20, width: 100, height: 50 }
    })

    emitCancelled(windowInstances[0])
    await expect(promise).resolves.toBeNull()
  })

  it('ignores payloads whose senderFrame URL does not match the loaded URL (#164 round-2 F#13)', async () => {
    const { AreaSelectOverlay } = await import('./ScreenshotOverlayWindow')
    const overlay = new AreaSelectOverlay()

    const promise = overlay.selectArea()
    await vi.waitFor(() => expect(mockShow).toHaveBeenCalled())

    windowInstances[0].emitFrameMessage(
      'screenshot:areaSelected',
      { token: FIXED_TOKEN, selection: { displayId: 1, x: 10, y: 20, width: 100, height: 50 } },
      { senderUrl: 'http://evil.test/' }
    )

    emitCancelled(windowInstances[0])
    await expect(promise).resolves.toBeNull()
  })

  it('rejects when the overlay preload is missing', async () => {
    mockExistsSync.mockReturnValueOnce(false)
    const { AreaSelectOverlay } = await import('./ScreenshotOverlayWindow')

    await expect(new AreaSelectOverlay().selectArea()).rejects.toThrow(
      'Screenshot overlay preload not found'
    )
  })

  it('rejects when every overlay fails to load (#164 round-2 F#5)', async () => {
    mockLoadURL.mockRejectedValue(new Error('Failed to load'))
    const { AreaSelectOverlay } = await import('./ScreenshotOverlayWindow')

    await expect(new AreaSelectOverlay().selectArea()).rejects.toThrow(
      'All area-select overlays failed to load'
    )
  })

  it('does not allow concurrent overlays (second call resolves null)', async () => {
    const { AreaSelectOverlay } = await import('./ScreenshotOverlayWindow')
    const overlay = new AreaSelectOverlay()

    const first = overlay.selectArea()
    await vi.waitFor(() => expect(mockShow).toHaveBeenCalled())
    const second = await overlay.selectArea()

    expect(second).toBeNull()

    emitCancelled(windowInstances[0])
    await first
  })

  it('uses loadFile with the route hash in production (no dev URL)', async () => {
    isDev = false
    delete process.env['ELECTRON_RENDERER_URL']

    const { AreaSelectOverlay } = await import('./ScreenshotOverlayWindow')
    const overlay = new AreaSelectOverlay()

    const promise = overlay.selectArea()
    await vi.waitFor(() => expect(mockLoadFile).toHaveBeenCalled())

    const [, opts] = mockLoadFile.mock.calls[0]
    expect((opts as { hash: string }).hash).toBe('overlay/screenshot?displayId=1')

    await vi.waitFor(() => expect(mockShow).toHaveBeenCalled())
    emitCancelled(windowInstances[0])
    await promise
  })

  it('resolves null when the overlay window emits `closed`', async () => {
    const { AreaSelectOverlay } = await import('./ScreenshotOverlayWindow')
    const overlay = new AreaSelectOverlay()

    const promise = overlay.selectArea()
    await vi.waitFor(() => expect(windowInstances[0]?.on).toHaveBeenCalled())

    const closedCall = (windowInstances[0].on as ReturnType<typeof vi.fn>).mock.calls.find(
      ([channel]) => channel === 'closed'
    )
    expect(closedCall).toBeDefined()
    const closedListener = closedCall![1] as () => void
    closedListener()

    await expect(promise).resolves.toBeNull()
  })

  it('does not call setFullScreen on Windows (#164 round-2 F#5/F#15 — dropped to keep the overlay transparent)', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      const { AreaSelectOverlay } = await import('./ScreenshotOverlayWindow')
      const overlay = new AreaSelectOverlay()

      const promise = overlay.selectArea()
      await vi.waitFor(() => expect(mockShow).toHaveBeenCalled())

      expect(mockSetFullScreen).not.toHaveBeenCalled()

      emitCancelled(windowInstances[0])
      await promise
    } finally {
      if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  it('passes hardened webPreferences when creating an overlay BrowserWindow (#164 round-2 F#20)', async () => {
    const { AreaSelectOverlay } = await import('./ScreenshotOverlayWindow')
    const overlay = new AreaSelectOverlay()

    const promise = overlay.selectArea()
    await vi.waitFor(() => expect(BrowserWindowCtor).toHaveBeenCalled())

    const [opts] = BrowserWindowCtor.mock.calls[0]
    const prefs = (opts as { webPreferences: Record<string, unknown> }).webPreferences
    expect(prefs).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      nodeIntegrationInSubFrames: false
    })

    emitCancelled(windowInstances[0])
    await promise
  })

  it('handles multi-display rounds — token-matched send from one overlay resolves the round (#164 round-2 F#23)', async () => {
    mockDisplays = [
      { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }
    ]
    mockGetURL.mockImplementation(() => 'http://localhost:5173/#overlay/screenshot?displayId=1')

    const { AreaSelectOverlay } = await import('./ScreenshotOverlayWindow')
    const overlay = new AreaSelectOverlay()

    const promise = overlay.selectArea()
    await vi.waitFor(() => expect(BrowserWindowCtor).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(mockShow).toHaveBeenCalledTimes(2))

    emitSelected(windowInstances[0], { displayId: 1, x: 5, y: 5, width: 10, height: 10 })
    await expect(promise).resolves.toEqual({ displayId: 1, x: 5, y: 5, width: 10, height: 10 })
  })
})
