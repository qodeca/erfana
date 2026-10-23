// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal screen-reader support IPC (lens review [23]): the payload-free,
 * sender-gated query and the app-wide change broadcast.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { TERMINAL_CHANNELS, TERMINAL_EVENTS } from '../../shared/ipc/terminal-channels'

const mockIpcMainHandle = vi.fn()
const appListeners = new Map<string, Array<(...args: unknown[]) => void>>()
const mockIsAccessibilitySupportEnabled = vi.fn(() => false)
const windows: Array<{ isDestroyed: () => boolean; webContents: { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> } }> = []

vi.mock('electron', () => ({
  ipcMain: { handle: mockIpcMainHandle },
  app: {
    isAccessibilitySupportEnabled: () => mockIsAccessibilitySupportEnabled(),
    on: (event: string, listener: (...args: unknown[]) => void) => {
      appListeners.set(event, [...(appListeners.get(event) ?? []), listener])
    },
    removeListener: (event: string, listener: (...args: unknown[]) => void) => {
      appListeners.set(event, (appListeners.get(event) ?? []).filter((l) => l !== listener))
    }
  },
  BrowserWindow: { getAllWindows: () => windows }
}))

const mockIsTrusted = vi.fn(() => true)
vi.mock('./senderValidation', () => ({
  isTrustedSender: (e: unknown) => mockIsTrusted(e),
  isTrustedAppSender: () => true
}))

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
vi.mock('../services/LoggingService', () => ({ logger: mockLogger }))

const EVENT = {} as IpcMainInvokeEvent

function makeWindow(destroyed = false) {
  return {
    isDestroyed: () => destroyed,
    webContents: { isDestroyed: () => destroyed, send: vi.fn() }
  }
}

async function register(): Promise<(event: IpcMainInvokeEvent, ...args: unknown[]) => unknown> {
  const { registerTerminalScreenReaderHandlers } = await import('./terminal-screen-reader-handlers')
  registerTerminalScreenReaderHandlers()
  const call = mockIpcMainHandle.mock.calls.find((c) => c[0] === TERMINAL_CHANNELS.getScreenReaderSupport)
  expect(call).toBeDefined()
  return call![1]
}

function emitSupportChanged(enabled: boolean): void {
  for (const listener of appListeners.get('accessibility-support-changed') ?? []) listener({}, enabled)
}

describe('terminal-screen-reader-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    appListeners.clear()
    windows.length = 0
    mockIsTrusted.mockReturnValue(true)
    mockIsAccessibilitySupportEnabled.mockReturnValue(false)
  })

  it('answers the OS state to a trusted sender', async () => {
    const handler = await register()
    mockIsAccessibilitySupportEnabled.mockReturnValue(true)
    expect(await handler(EVENT)).toEqual({ enabled: true })
    mockIsAccessibilitySupportEnabled.mockReturnValue(false)
    expect(await handler(EVENT)).toEqual({ enabled: false })
  })

  it('ignores any payload: the answer comes from main alone', async () => {
    const handler = await register()
    mockIsAccessibilitySupportEnabled.mockReturnValue(false)
    expect(await handler(EVENT, { enabled: true })).toEqual({ enabled: false })
  })

  it('answers "no" to an untrusted sender without reading the OS state', async () => {
    const handler = await register()
    mockIsTrusted.mockReturnValue(false)
    mockIsAccessibilitySupportEnabled.mockReturnValue(true)

    expect(await handler(EVENT)).toEqual({ enabled: false })
    expect(mockIsAccessibilitySupportEnabled).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith('Rejected terminal:getScreenReaderSupport from untrusted sender')
  })

  it('reads a throwing API as "no screen reader"', async () => {
    const handler = await register()
    mockIsAccessibilitySupportEnabled.mockImplementation(() => {
      throw new Error('not supported on this platform')
    })
    expect(await handler(EVENT)).toEqual({ enabled: false })
  })

  it('pushes a change to every live window', async () => {
    const live = makeWindow()
    const gone = makeWindow(true)
    windows.push(live, gone)
    await register()

    emitSupportChanged(true)

    expect(live.webContents.send).toHaveBeenCalledWith(TERMINAL_EVENTS.screenReaderSupportChanged, { enabled: true })
    expect(gone.webContents.send).not.toHaveBeenCalled()
  })

  it('keeps a single OS listener across re-registration', async () => {
    const live = makeWindow()
    windows.push(live)
    const { registerTerminalScreenReaderHandlers } = await import('./terminal-screen-reader-handlers')
    registerTerminalScreenReaderHandlers()
    registerTerminalScreenReaderHandlers()

    expect(appListeners.get('accessibility-support-changed')).toHaveLength(1)
    emitSupportChanged(false)
    expect(live.webContents.send).toHaveBeenCalledTimes(1)
  })
})
