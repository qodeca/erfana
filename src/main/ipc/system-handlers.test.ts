// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the system IPC handlers (screen-recording settings deep link +
 * graceful relaunch). Both handlers are sender-gated and the relaunch uses
 * `app.quit()` (not `app.exit`) so `before-quit` cleanup (project lock
 * release, watcher disposal) still runs.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { SYSTEM_CHANNELS } from '../../shared/ipc/system-channels'

const mockIpcMainHandle = vi.fn()
const mockOpenExternal = vi.fn((_url: string) => Promise.resolve())
const mockRelaunch = vi.fn()
const mockQuit = vi.fn()
const mockExit = vi.fn((_code?: number) => {})

vi.mock('electron', () => ({
  ipcMain: { handle: mockIpcMainHandle },
  shell: { openExternal: (url: string) => mockOpenExternal(url) },
  app: {
    relaunch: () => mockRelaunch(),
    quit: () => mockQuit(),
    exit: (code?: number) => mockExit(code)
  }
}))

const mockIsTrusted = vi.fn(() => true)
vi.mock('./senderValidation', () => ({ isTrustedSender: (e: unknown) => mockIsTrusted(e) }))

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
vi.mock('../services/LoggingService', () => ({ logger: mockLogger }))

const EVENT = {} as IpcMainInvokeEvent

async function getHandler(channel: string): Promise<(...a: unknown[]) => Promise<unknown> | unknown> {
  const { registerSystemHandlers } = await import('./system-handlers')
  registerSystemHandlers()
  const handler = mockIpcMainHandle.mock.calls.find((c) => c[0] === channel)?.[1]
  expect(handler).toBeDefined()
  return handler
}

describe('system-handlers', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockIsTrusted.mockReturnValue(true)
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  })

  it('registers both system channels', async () => {
    const { registerSystemHandlers } = await import('./system-handlers')
    registerSystemHandlers()
    expect(mockIpcMainHandle).toHaveBeenCalledWith(
      SYSTEM_CHANNELS.OPEN_SCREEN_RECORDING_SETTINGS,
      expect.any(Function)
    )
    expect(mockIpcMainHandle).toHaveBeenCalledWith(SYSTEM_CHANNELS.RELAUNCH_APP, expect.any(Function))
  })

  it('opens the Screen Recording pane on darwin for a trusted sender', async () => {
    const handler = await getHandler(SYSTEM_CHANNELS.OPEN_SCREEN_RECORDING_SETTINGS)
    await handler(EVENT)
    expect(mockOpenExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    )
  })

  it('does not open the pane off darwin', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const handler = await getHandler(SYSTEM_CHANNELS.OPEN_SCREEN_RECORDING_SETTINGS)
    await handler(EVENT)
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })

  it('rejects the deep link from an untrusted sender', async () => {
    mockIsTrusted.mockReturnValue(false)
    const handler = await getHandler(SYSTEM_CHANNELS.OPEN_SCREEN_RECORDING_SETTINGS)
    await handler(EVENT)
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })

  it('relaunches via app.relaunch() + app.quit() (never app.exit) for a trusted sender', async () => {
    const handler = await getHandler(SYSTEM_CHANNELS.RELAUNCH_APP)
    await handler(EVENT)
    expect(mockRelaunch).toHaveBeenCalledTimes(1)
    expect(mockQuit).toHaveBeenCalledTimes(1)
    expect(mockExit).not.toHaveBeenCalled()
  })

  it('rejects relaunch from an untrusted sender', async () => {
    mockIsTrusted.mockReturnValue(false)
    const handler = await getHandler(SYSTEM_CHANNELS.RELAUNCH_APP)
    await handler(EVENT)
    expect(mockRelaunch).not.toHaveBeenCalled()
    expect(mockQuit).not.toHaveBeenCalled()
  })

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })
})
