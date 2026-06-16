// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Claude Code Status IPC Handlers Tests (#216)
 *
 * Covers: sender-frame rejection (untrusted → no registerPanel), register looks
 * up the main-owned pid + cwd and delegates to the service, unknown terminalId →
 * no register, and unregister/nudge delegation. A fake service and fake
 * terminalService are injected; electron's ipcMain/webContents/app are mocked
 * minimally, mirroring `clipboard-handlers.test.ts` / `git-watcher-handlers.test.ts`.
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see docs/designs/216-claude-status-bar.md §8, §10
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'
import { pathToFileURL } from 'url'
import type { IpcMainInvokeEvent } from 'electron'
import { ClaudeStatusChannels } from '../../shared/ipc/claude-status-channels'

// =============================================================================
// Capture registered handlers via a mocked ipcMain
// =============================================================================

const handlers: Record<string, (...args: unknown[]) => unknown> = {}
const removedHandlers: string[] = []

const mockIpcMainHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  handlers[channel] = handler
})
const mockIpcMainRemoveHandler = vi.fn((channel: string) => {
  removedHandlers.push(channel)
})
const mockGetAllWindows = vi.fn(() => [])
const mockAppOn = vi.fn()
const mockAppRemoveListener = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcMainHandle,
    removeHandler: mockIpcMainRemoveHandler
  },
  webContents: {
    fromId: vi.fn(() => null)
  },
  BrowserWindow: {
    getAllWindows: () => mockGetAllWindows()
  },
  app: {
    on: mockAppOn,
    removeListener: mockAppRemoveListener
  }
}))

// Controllable is.dev (mirrors index.ts trust gate)
const mockIs = { dev: false }
vi.mock('@electron-toolkit/utils', () => ({ is: mockIs }))

const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}
vi.mock('../services/LoggingService', () => ({ logger: mockLogger }))

// The handler pins production trust to the exact bundled renderer file URL.
const RENDERER_FILE_URL = pathToFileURL(join(__dirname, '../renderer/index.html')).href
const TRUSTED_FRAME = { url: RENDERER_FILE_URL, parent: null }

/** Build a mock invoke event with a given sender frame + sender id. */
function makeEvent(
  frame: { url: string; parent: unknown } | null,
  senderId = 99
): IpcMainInvokeEvent {
  return { senderFrame: frame, sender: { id: senderId } } as unknown as IpcMainInvokeEvent
}

/** Fake ClaudeStatusService recording delegated calls. */
function makeFakeService(): {
  registerPanel: ReturnType<typeof vi.fn>
  unregisterPanel: ReturnType<typeof vi.fn>
  nudge: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
} {
  return {
    registerPanel: vi.fn(),
    unregisterPanel: vi.fn(),
    nudge: vi.fn(),
    dispose: vi.fn(async () => {})
  }
}

/** Fake TerminalService exposing only what the handlers consult. */
function makeFakeTerminalService(
  records: Record<string, { cwd: string; pid?: number }>
): {
  getTerminalInfo: ReturnType<typeof vi.fn>
  getPid: ReturnType<typeof vi.fn>
} {
  return {
    getTerminalInfo: vi.fn((id: string) =>
      records[id] ? { id, cwd: records[id].cwd, title: id } : null
    ),
    getPid: vi.fn((id: string) => records[id]?.pid)
  }
}

// Imported lazily so the electron mock is in place first.
async function register(
  terminalService: unknown,
  service: unknown
): Promise<{ service: unknown; dispose: () => Promise<void> }> {
  const { registerClaudeStatusHandlers } = await import('./claude-status-handlers')
  return registerClaudeStatusHandlers(
    terminalService as never,
    service as never
  )
}

describe('claude-status-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    for (const k of Object.keys(handlers)) delete handlers[k]
    removedHandlers.length = 0
    mockIs.dev = false
    delete process.env['ELECTRON_RENDERER_URL']
    mockGetAllWindows.mockReturnValue([])
  })

  it('registers all three invoke handlers', async () => {
    const service = makeFakeService()
    const terminalService = makeFakeTerminalService({})
    await register(terminalService, service)

    expect(mockIpcMainHandle).toHaveBeenCalledWith(
      ClaudeStatusChannels.REGISTER,
      expect.any(Function)
    )
    expect(mockIpcMainHandle).toHaveBeenCalledWith(
      ClaudeStatusChannels.UNREGISTER,
      expect.any(Function)
    )
    expect(mockIpcMainHandle).toHaveBeenCalledWith(
      ClaudeStatusChannels.NUDGE,
      expect.any(Function)
    )
  })

  describe('register', () => {
    it('looks up pid + cwd and delegates to service.registerPanel', async () => {
      const service = makeFakeService()
      const terminalService = makeFakeTerminalService({
        'term-1': { cwd: '/Users/x/proj', pid: 4321 }
      })
      await register(terminalService, service)

      await handlers[ClaudeStatusChannels.REGISTER](
        makeEvent(TRUSTED_FRAME, 77),
        { terminalId: 'term-1' }
      )

      expect(terminalService.getTerminalInfo).toHaveBeenCalledWith('term-1')
      expect(terminalService.getPid).toHaveBeenCalledWith('term-1')
      expect(service.registerPanel).toHaveBeenCalledWith('term-1', 4321, '/Users/x/proj', 77)
    })

    it('rejects an untrusted sender (no registerPanel)', async () => {
      const service = makeFakeService()
      const terminalService = makeFakeTerminalService({
        'term-1': { cwd: '/Users/x/proj', pid: 4321 }
      })
      await register(terminalService, service)

      await handlers[ClaudeStatusChannels.REGISTER](
        makeEvent({ url: 'https://evil.example/', parent: null }),
        { terminalId: 'term-1' }
      )

      expect(service.registerPanel).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Rejected claude-status:register from untrusted sender',
        expect.objectContaining({ url: 'https://evil.example/' })
      )
    })

    it('rejects a sub-frame sender (no registerPanel)', async () => {
      const service = makeFakeService()
      const terminalService = makeFakeTerminalService({
        'term-1': { cwd: '/Users/x/proj', pid: 4321 }
      })
      await register(terminalService, service)

      await handlers[ClaudeStatusChannels.REGISTER](
        makeEvent({ url: RENDERER_FILE_URL, parent: {} }),
        { terminalId: 'term-1' }
      )

      expect(service.registerPanel).not.toHaveBeenCalled()
    })

    it('does not register an unknown terminalId (no cwd)', async () => {
      const service = makeFakeService()
      const terminalService = makeFakeTerminalService({})
      await register(terminalService, service)

      await handlers[ClaudeStatusChannels.REGISTER](
        makeEvent(TRUSTED_FRAME),
        { terminalId: 'ghost' }
      )

      expect(service.registerPanel).not.toHaveBeenCalled()
    })

    it('ignores an invalid payload (empty terminalId)', async () => {
      const service = makeFakeService()
      const terminalService = makeFakeTerminalService({})
      await register(terminalService, service)

      await handlers[ClaudeStatusChannels.REGISTER](makeEvent(TRUSTED_FRAME), { terminalId: '' })

      expect(service.registerPanel).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Rejected claude-status:register with invalid payload',
        expect.objectContaining({ error: expect.any(String) })
      )
    })

    it('passes pid undefined when the terminal has no recorded pid', async () => {
      const service = makeFakeService()
      const terminalService = makeFakeTerminalService({ 'term-1': { cwd: '/p' } })
      await register(terminalService, service)

      await handlers[ClaudeStatusChannels.REGISTER](
        makeEvent(TRUSTED_FRAME, 5),
        { terminalId: 'term-1' }
      )

      expect(service.registerPanel).toHaveBeenCalledWith('term-1', undefined, '/p', 5)
    })
  })

  describe('unregister', () => {
    it('delegates to service.unregisterPanel for a trusted sender', async () => {
      const service = makeFakeService()
      const terminalService = makeFakeTerminalService({})
      await register(terminalService, service)

      await handlers[ClaudeStatusChannels.UNREGISTER](
        makeEvent(TRUSTED_FRAME),
        { terminalId: 'term-1' }
      )

      expect(service.unregisterPanel).toHaveBeenCalledWith('term-1')
    })

    it('rejects an untrusted sender (no unregisterPanel)', async () => {
      const service = makeFakeService()
      const terminalService = makeFakeTerminalService({})
      await register(terminalService, service)

      await handlers[ClaudeStatusChannels.UNREGISTER](
        makeEvent({ url: 'https://evil.example/', parent: null }),
        { terminalId: 'term-1' }
      )

      expect(service.unregisterPanel).not.toHaveBeenCalled()
    })
  })

  describe('nudge', () => {
    it('delegates to service.nudge for a trusted sender', async () => {
      const service = makeFakeService()
      const terminalService = makeFakeTerminalService({})
      await register(terminalService, service)

      await handlers[ClaudeStatusChannels.NUDGE](
        makeEvent(TRUSTED_FRAME),
        { terminalId: 'term-1' }
      )

      expect(service.nudge).toHaveBeenCalledWith('term-1')
    })

    it('rejects an untrusted sender (no nudge)', async () => {
      const service = makeFakeService()
      const terminalService = makeFakeTerminalService({})
      await register(terminalService, service)

      await handlers[ClaudeStatusChannels.NUDGE](
        makeEvent({ url: 'https://evil.example/', parent: null }),
        { terminalId: 'term-1' }
      )

      expect(service.nudge).not.toHaveBeenCalled()
    })
  })

  describe('dispose', () => {
    it('removes all three handlers and disposes the service', async () => {
      const service = makeFakeService()
      const terminalService = makeFakeTerminalService({})
      const { dispose } = await register(terminalService, service)

      await dispose()

      expect(removedHandlers).toContain(ClaudeStatusChannels.REGISTER)
      expect(removedHandlers).toContain(ClaudeStatusChannels.UNREGISTER)
      expect(removedHandlers).toContain(ClaudeStatusChannels.NUDGE)
      expect(service.dispose).toHaveBeenCalledTimes(1)
      expect(mockAppRemoveListener).toHaveBeenCalledWith(
        'browser-window-created',
        expect.any(Function)
      )
    })

    it("removes per-window 'destroyed' listeners on dispose for still-alive windows", async () => {
      // A live window present at registration: its webContents gets a
      // `once('destroyed', handler)`; dispose() must detach that exact handler.
      const wc = {
        id: 42,
        isDestroyed: vi.fn(() => false),
        once: vi.fn(),
        removeListener: vi.fn()
      }
      mockGetAllWindows.mockReturnValue([
        { isDestroyed: () => false, webContents: wc }
      ] as never)

      const service = makeFakeService()
      const terminalService = makeFakeTerminalService({})
      const { dispose } = await register(terminalService, service)

      // The handler registered at wire time is the one that must be removed.
      expect(wc.once).toHaveBeenCalledWith('destroyed', expect.any(Function))
      const subscribedHandler = wc.once.mock.calls[0][1]

      await dispose()

      expect(wc.removeListener).toHaveBeenCalledWith('destroyed', subscribedHandler)
    })

    it('does not touch the listener of an already-destroyed window on dispose', async () => {
      const wc = {
        id: 7,
        isDestroyed: vi.fn(() => true), // destroyed by dispose time
        once: vi.fn(),
        removeListener: vi.fn()
      }
      mockGetAllWindows.mockReturnValue([
        { isDestroyed: () => false, webContents: wc }
      ] as never)

      const service = makeFakeService()
      const terminalService = makeFakeTerminalService({})
      const { dispose } = await register(terminalService, service)

      await dispose()

      expect(wc.removeListener).not.toHaveBeenCalled()
    })
  })
})
