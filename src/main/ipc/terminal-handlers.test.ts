// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import type { IpcMain, BrowserWindow } from 'electron'

// Mock Electron modules
const mockIpcMain = {
  handle: vi.fn(),
  on: vi.fn()
} as unknown as IpcMain

const mockBrowserWindow = {
  getAllWindows: vi.fn(() => [])
} as unknown as typeof BrowserWindow

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  BrowserWindow: mockBrowserWindow
}))

// Mock TerminalService
class MockTerminalService extends EventEmitter {
  private terminals: Map<string, { id: string }> = new Map()

  isAvailable = vi.fn(() => ({ available: true, initialized: true }))
  createTerminal = vi.fn(async () => 'terminal-1')
  write = vi.fn(() => true)
  resize = vi.fn(() => true)
  killTerminal = vi.fn(() => true)
  getTerminalInfo = vi.fn(() => ({ id: 'terminal-1', cwd: '/tmp', title: 'Terminal 1' }))
  listTerminals = vi.fn(() => [])
  markInitializationComplete = vi.fn()

  // Test helpers
  simulateTerminalCreation(id: string): void {
    this.terminals.set(id, { id })
  }

  simulateTerminalExit(id: string): void {
    this.terminals.delete(id)
  }
}

const mockTerminalService = new MockTerminalService()

vi.mock('../services/TerminalService', () => ({
  terminalService: mockTerminalService
}))

// Mock LoggingService
const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}
vi.mock('../services/LoggingService', () => ({
  logger: mockLogger
}))

// Skip tests in renderer environment
const isRendererEnv = typeof (globalThis as any).window !== 'undefined'

;(isRendererEnv ? describe.skip : describe)('terminal-handlers - Issue #59: Listener Cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTerminalService.removeAllListeners()
    mockTerminalService.listTerminals.mockReturnValue([])
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('registerTerminalHandlers listener safety', () => {
    it('preserves listeners when terminals are active (does not cleanup)', async () => {
      // Simulate active terminals
      mockTerminalService.listTerminals.mockReturnValue([
        { id: 'terminal-1', title: 'Terminal 1' },
        { id: 'terminal-2', title: 'Terminal 2' }
      ])

      // Import and register handlers
      const { registerTerminalHandlers } = await import('./terminal-handlers')

      // First registration
      registerTerminalHandlers()
      const listenersAfterFirst = mockTerminalService.listenerCount('data')

      // Second registration (simulating HMR reload)
      registerTerminalHandlers()
      const listenersAfterSecond = mockTerminalService.listenerCount('data')

      // Listeners should accumulate (not be cleaned up) when terminals are active
      expect(listenersAfterSecond).toBeGreaterThanOrEqual(listenersAfterFirst)

      // Logger warning should be logged
      mockLogger.warn.mockClear()
      registerTerminalHandlers()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Terminals still active during handler registration')
      )
    })

    it('cleans up listeners when no terminals exist', async () => {
      // No active terminals
      mockTerminalService.listTerminals.mockReturnValue([])

      // Import and register handlers
      const { registerTerminalHandlers } = await import('./terminal-handlers')

      // First registration
      registerTerminalHandlers()
      const listenersAfterFirst = mockTerminalService.listenerCount('data')
      expect(listenersAfterFirst).toBeGreaterThan(0)

      // Second registration (simulating HMR reload)
      registerTerminalHandlers()
      const listenersAfterSecond = mockTerminalService.listenerCount('data')

      // Listeners should be cleaned up and re-registered (count should be same)
      expect(listenersAfterSecond).toBe(1) // Only one listener (fresh registration)
    })

    it('tracks listeners in registeredListeners map', async () => {
      mockTerminalService.listTerminals.mockReturnValue([])

      // Import and register handlers
      const { registerTerminalHandlers } = await import('./terminal-handlers')

      registerTerminalHandlers()

      // All event types should have listeners registered
      expect(mockTerminalService.listenerCount('data')).toBe(1)
      expect(mockTerminalService.listenerCount('exit')).toBe(1)
      expect(mockTerminalService.listenerCount('error')).toBe(1)
      expect(mockTerminalService.listenerCount('clearTerminal')).toBe(1)
    })

    it('removes all tracked listeners on cleanup', async () => {
      mockTerminalService.listTerminals.mockReturnValue([])

      // Import and register handlers
      const { registerTerminalHandlers } = await import('./terminal-handlers')

      // First registration
      registerTerminalHandlers()
      expect(mockTerminalService.listenerCount('data')).toBe(1)
      expect(mockTerminalService.listenerCount('exit')).toBe(1)
      expect(mockTerminalService.listenerCount('error')).toBe(1)
      expect(mockTerminalService.listenerCount('clearTerminal')).toBe(1)

      // Second registration should clean up all previous listeners
      registerTerminalHandlers()
      expect(mockTerminalService.listenerCount('data')).toBe(1)
      expect(mockTerminalService.listenerCount('exit')).toBe(1)
      expect(mockTerminalService.listenerCount('error')).toBe(1)
      expect(mockTerminalService.listenerCount('clearTerminal')).toBe(1)
    })

    it('handles race condition: terminal exits between check and cleanup', async () => {
      // Simulate terminals active during check
      mockTerminalService.listTerminals.mockReturnValueOnce([
        { id: 'terminal-1', title: 'Terminal 1' }
      ])

      const { registerTerminalHandlers } = await import('./terminal-handlers')

      // First registration with terminal active
      registerTerminalHandlers()

      // Simulate terminal exit
      mockTerminalService.listTerminals.mockReturnValue([])

      // Second registration should now allow cleanup
      expect(() => registerTerminalHandlers()).not.toThrow()
    })

    it('prevents listener accumulation during development HMR cycles', async () => {
      mockTerminalService.listTerminals.mockReturnValue([])

      const { registerTerminalHandlers } = await import('./terminal-handlers')

      // Simulate multiple HMR reloads
      for (let i = 0; i < 10; i++) {
        registerTerminalHandlers()
      }

      // Should have exactly 1 listener per event type (not 10)
      expect(mockTerminalService.listenerCount('data')).toBe(1)
      expect(mockTerminalService.listenerCount('exit')).toBe(1)
      expect(mockTerminalService.listenerCount('error')).toBe(1)
      expect(mockTerminalService.listenerCount('clearTerminal')).toBe(1)
    })

    it('logs registration message on each call', async () => {
      mockTerminalService.listTerminals.mockReturnValue([])

      mockLogger.info.mockClear()
      const { registerTerminalHandlers } = await import('./terminal-handlers')

      registerTerminalHandlers()

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Registering Terminal IPC handlers')
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Terminal IPC handlers registered')
      )
    })
  })

  describe('IPC handler registration', () => {
    it('registers all required IPC handlers', async () => {
      mockTerminalService.listTerminals.mockReturnValue([])

      const { registerTerminalHandlers } = await import('./terminal-handlers')
      registerTerminalHandlers()

      // Verify all handlers are registered
      expect(mockIpcMain.handle).toHaveBeenCalledWith('terminal:isAvailable', expect.any(Function))
      expect(mockIpcMain.handle).toHaveBeenCalledWith('terminal:create', expect.any(Function))
      expect(mockIpcMain.handle).toHaveBeenCalledWith('terminal:write', expect.any(Function))
      expect(mockIpcMain.on).toHaveBeenCalledWith('terminal:resize', expect.any(Function))
      expect(mockIpcMain.handle).toHaveBeenCalledWith('terminal:kill', expect.any(Function))
      expect(mockIpcMain.handle).toHaveBeenCalledWith('terminal:getInfo', expect.any(Function))
      expect(mockIpcMain.handle).toHaveBeenCalledWith('terminal:list', expect.any(Function))
      expect(mockIpcMain.on).toHaveBeenCalledWith('terminal:clearComplete', expect.any(Function))
    })

    it('passes webContentsId to createTerminal for cleanup tracking', async () => {
      mockTerminalService.listTerminals.mockReturnValue([])

      const { registerTerminalHandlers } = await import('./terminal-handlers')
      registerTerminalHandlers()

      // Get the registered create handler
      const createHandlerCall = (mockIpcMain.handle as any).mock.calls.find(
        (call: any[]) => call[0] === 'terminal:create'
      )
      expect(createHandlerCall).toBeTruthy()

      const createHandler = createHandlerCall[1]

      // Simulate IPC call with webContentsId
      const mockEvent = { sender: { id: 123 } }
      await createHandler(mockEvent, { cwd: '/tmp' })

      // createTerminal should be called with webContentsId
      expect(mockTerminalService.createTerminal).toHaveBeenCalledWith(
        { cwd: '/tmp' },
        123
      )
    })
  })

  describe('Event forwarding', () => {
    it('forwards data events to renderer', async () => {
      mockTerminalService.listTerminals.mockReturnValue([])

      const mockWindow = {
        isDestroyed: () => false,
        webContents: {
          send: vi.fn()
        }
      }
      ;(mockBrowserWindow.getAllWindows as any).mockReturnValue([mockWindow])

      const { registerTerminalHandlers } = await import('./terminal-handlers')
      registerTerminalHandlers()

      // Emit data event
      mockTerminalService.emit('data', { terminalId: 'terminal-1', data: 'test output' })

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('terminal:data', {
        terminalId: 'terminal-1',
        data: 'test output'
      })
    })

    it('forwards exit events to renderer', async () => {
      mockTerminalService.listTerminals.mockReturnValue([])

      const mockWindow = {
        isDestroyed: () => false,
        webContents: {
          send: vi.fn()
        }
      }
      ;(mockBrowserWindow.getAllWindows as any).mockReturnValue([mockWindow])

      const { registerTerminalHandlers } = await import('./terminal-handlers')
      registerTerminalHandlers()

      // Emit exit event
      mockTerminalService.emit('exit', { terminalId: 'terminal-1', exitCode: 0, signal: undefined })

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('terminal:exit', {
        terminalId: 'terminal-1',
        exitCode: 0,
        signal: undefined
      })
    })

    it('forwards clearTerminal events to renderer', async () => {
      mockTerminalService.listTerminals.mockReturnValue([])

      const mockWindow = {
        isDestroyed: () => false,
        webContents: {
          send: vi.fn()
        }
      }
      ;(mockBrowserWindow.getAllWindows as any).mockReturnValue([mockWindow])

      const { registerTerminalHandlers } = await import('./terminal-handlers')
      registerTerminalHandlers()

      // Emit clearTerminal event
      mockTerminalService.emit('clearTerminal', { terminalId: 'terminal-1' })

      expect(mockWindow.webContents.send).toHaveBeenCalledWith('terminal:clear', {
        terminalId: 'terminal-1'
      })
    })

    it('handles destroyed windows gracefully', async () => {
      mockTerminalService.listTerminals.mockReturnValue([])

      const mockWindow = {
        isDestroyed: () => true,
        webContents: {
          send: vi.fn()
        }
      }
      ;(mockBrowserWindow.getAllWindows as any).mockReturnValue([mockWindow])

      const { registerTerminalHandlers } = await import('./terminal-handlers')
      registerTerminalHandlers()

      // Emit event - should not send to destroyed window
      expect(() => {
        mockTerminalService.emit('data', { terminalId: 'terminal-1', data: 'test' })
      }).not.toThrow()

      expect(mockWindow.webContents.send).not.toHaveBeenCalled()
    })

    it('handles empty window list gracefully', async () => {
      mockTerminalService.listTerminals.mockReturnValue([])
      ;(mockBrowserWindow.getAllWindows as any).mockReturnValue([])

      const { registerTerminalHandlers } = await import('./terminal-handlers')
      registerTerminalHandlers()

      // Emit event - should not crash
      expect(() => {
        mockTerminalService.emit('data', { terminalId: 'terminal-1', data: 'test' })
      }).not.toThrow()
    })
  })
})
