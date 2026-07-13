// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the screenshot IPC handlers — focused on the advisory
 * screen-recording permission channel added for the grant-and-relaunch UX.
 *
 * Mirrors the sender-validation harness in `clipboard-handlers.test.ts`:
 * mock `ipcMain.handle` to capture handler fns, mock a controllable `is.dev`,
 * and pin the trusted frame to the exact bundled renderer file URL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'
import { pathToFileURL } from 'url'
import type { IpcMainInvokeEvent } from 'electron'
import { SCREENSHOT_CHANNELS } from '../../shared/ipc/screenshot-channels'
import type { IScreenshotService } from '../services/ScreenshotService'

const mockIpcMainHandle = vi.fn()

vi.mock('electron', () => ({
  ipcMain: { handle: mockIpcMainHandle },
  systemPreferences: { getMediaAccessStatus: vi.fn(() => 'granted') }
}))

const mockIs = { dev: false }
vi.mock('@electron-toolkit/utils', () => ({ is: mockIs }))

const RENDERER_FILE_URL = pathToFileURL(join(__dirname, '../renderer/index.html')).href

const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}
vi.mock('../services/LoggingService', () => ({ logger: mockLogger }))

function makeEvent(frame: { url: string; parent: unknown } | null): IpcMainInvokeEvent {
  return { senderFrame: frame } as unknown as IpcMainInvokeEvent
}

const TRUSTED_FRAME = { url: RENDERER_FILE_URL, parent: null }

function stubService(overrides: Partial<IScreenshotService> = {}): IScreenshotService {
  return {
    getDisplays: vi.fn(() => []),
    getCapabilities: vi.fn(() => ({
      supported: true,
      hasNativeWindowPicker: true,
      areaCaptureMode: 'native' as const
    })),
    getScreenRecordingPermission: vi.fn(() => 'granted' as const),
    enumerateWindows: vi.fn(async () => ({
      availability: 'native-picker' as const,
      sources: [] as [],
      truncated: false
    })),
    capture: vi.fn(async () => ({ success: true, filePath: '/tmp/x.png' })),
    ...overrides
  }
}

async function getHandler(
  channel: string,
  service: IScreenshotService
): Promise<(...args: unknown[]) => Promise<unknown>> {
  const { registerScreenshotHandlers } = await import('./screenshot-handlers')
  registerScreenshotHandlers(service)
  const handler = mockIpcMainHandle.mock.calls.find((call) => call[0] === channel)?.[1]
  expect(handler).toBeDefined()
  return handler as (...args: unknown[]) => Promise<unknown>
}

describe('screenshot-handlers — getScreenPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    delete process.env['ELECTRON_RENDERER_URL']
    mockIs.dev = false
  })

  it('registers the getScreenPermission channel', async () => {
    const { registerScreenshotHandlers } = await import('./screenshot-handlers')
    registerScreenshotHandlers(stubService())
    expect(mockIpcMainHandle).toHaveBeenCalledWith(
      SCREENSHOT_CHANNELS.GET_SCREEN_PERMISSION,
      expect.any(Function)
    )
  })

  it('returns the service permission value for a trusted sender', async () => {
    const service = stubService({
      getScreenRecordingPermission: vi.fn(() => 'denied' as const)
    })
    const handler = await getHandler(SCREENSHOT_CHANNELS.GET_SCREEN_PERMISSION, service)

    const result = await handler(makeEvent(TRUSTED_FRAME))

    expect(result).toBe('denied')
    expect(service.getScreenRecordingPermission).toHaveBeenCalledTimes(1)
  })

  it('returns "unknown" and does not query the service for an untrusted sender', async () => {
    const service = stubService()
    const handler = await getHandler(SCREENSHOT_CHANNELS.GET_SCREEN_PERMISSION, service)

    const result = await handler(makeEvent({ url: 'https://evil.example', parent: null }))

    expect(result).toBe('unknown')
    expect(service.getScreenRecordingPermission).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalled()
  })
})
