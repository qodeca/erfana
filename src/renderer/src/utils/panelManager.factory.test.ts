// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for panelManager.factory.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))

vi.mock('./logger', () => ({ logger: mockLogger }))

// Create mock state that can be modified during tests
const mockState = {
  activeTerminalId: null as string | null,
  setActivePanel: vi.fn(),
  sendToTerminal: vi.fn(() => Promise.resolve(true)),
  subscribeCallback: null as ((state: { activeTerminalId: string | null }) => void) | null,
  unsubscribe: vi.fn()
}

vi.mock('../stores/useActivityBarStore', () => ({
  useActivityBarStore: {
    getState: () => ({
      setActivePanel: (...args: unknown[]) => mockState.setActivePanel(...args)
    })
  }
}))

vi.mock('../stores/useTerminalStore', () => ({
  useTerminalStore: {
    getState: () => ({
      activeTerminalId: mockState.activeTerminalId,
      sendToTerminal: (...args: unknown[]) => mockState.sendToTerminal(...args)
    }),
    subscribe: (callback: (state: { activeTerminalId: string | null }) => void) => {
      mockState.subscribeCallback = callback
      return mockState.unsubscribe
    }
  }
}))

// Import after mocks are set up
import { createPanelManager, createTerminalManager, createDefaultManagers } from './panelManager.factory'

describe('panelManager.factory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.activeTerminalId = null
    mockState.subscribeCallback = null
  })

  describe('createPanelManager()', () => {
    it('should create panel manager', () => {
      const manager = createPanelManager()

      expect(manager.setActivePanel).toBeDefined()
    })

    it('should call store setActivePanel', () => {
      const manager = createPanelManager()

      manager.setActivePanel('terminal', 'right')

      expect(mockState.setActivePanel).toHaveBeenCalledWith('terminal', 'right')
    })

    it('should call store setActivePanel for left location', () => {
      const manager = createPanelManager()

      manager.setActivePanel('terminal', 'left')

      expect(mockState.setActivePanel).toHaveBeenCalledWith('terminal', 'left')
    })
  })

  describe('createTerminalManager()', () => {
    it('should create terminal manager with all methods', () => {
      const manager = createTerminalManager()

      expect(manager.isReady).toBeDefined()
      expect(manager.sendToTerminal).toBeDefined()
      expect(manager.waitForReady).toBeDefined()
    })

    describe('isReady()', () => {
      it('should return false when no active terminal', () => {
        mockState.activeTerminalId = null
        const manager = createTerminalManager()

        expect(manager.isReady()).toBe(false)
      })

      it('should return true when terminal is active', () => {
        mockState.activeTerminalId = 'terminal-1'
        const manager = createTerminalManager()

        expect(manager.isReady()).toBe(true)
      })
    })

    describe('sendToTerminal()', () => {
      it('should call store sendToTerminal', async () => {
        const manager = createTerminalManager()

        await manager.sendToTerminal('npm install', false)

        expect(mockState.sendToTerminal).toHaveBeenCalledWith('npm install', false)
      })

      it('should pass autoExecute flag', async () => {
        const manager = createTerminalManager()

        await manager.sendToTerminal('npm test', true)

        expect(mockState.sendToTerminal).toHaveBeenCalledWith('npm test', true)
      })

      it('should return result from store', async () => {
        mockState.sendToTerminal.mockResolvedValueOnce(true)
        const manager = createTerminalManager()

        const result = await manager.sendToTerminal('echo hello')

        expect(result).toBe(true)
      })

      it('should return false on failure', async () => {
        mockState.sendToTerminal.mockResolvedValueOnce(false)
        const manager = createTerminalManager()

        const result = await manager.sendToTerminal('echo hello')

        expect(result).toBe(false)
      })
    })

    describe('waitForReady()', () => {
      it('should resolve immediately if terminal is already ready', async () => {
        mockState.activeTerminalId = 'terminal-1'
        const manager = createTerminalManager()

        const result = await manager.waitForReady!(1000)

        expect(result).toBe(true)
        // Should not subscribe because already ready
        expect(mockState.subscribeCallback).toBeNull()
      })

      it('should subscribe to store changes when not ready', async () => {
        mockState.activeTerminalId = null
        const manager = createTerminalManager()

        // Start waiting
        const waitPromise = manager.waitForReady!(1000)

        // Simulate terminal becoming ready via callback
        setTimeout(() => {
          if (mockState.subscribeCallback) {
            mockState.subscribeCallback({ activeTerminalId: 'terminal-1' })
          }
        }, 10)

        const result = await waitPromise

        expect(result).toBe(true)
        expect(mockState.unsubscribe).toHaveBeenCalled()
      })

      it('should timeout if terminal never becomes ready', async () => {
        mockState.activeTerminalId = null
        mockLogger.warn.mockClear()

        const manager = createTerminalManager()

        const result = await manager.waitForReady!(100)

        expect(result).toBe(false)
        expect(mockLogger.warn).toHaveBeenCalledWith('Terminal readiness timeout after 100 ms')
      })

      it('should use default timeout of 5000ms', async () => {
        mockState.activeTerminalId = 'terminal-1'
        const manager = createTerminalManager()

        // Should resolve immediately, but function should accept no args
        const result = await manager.waitForReady!()

        expect(result).toBe(true)
      })

      it('should unsubscribe on success', async () => {
        mockState.activeTerminalId = null
        const manager = createTerminalManager()

        // Start waiting
        const waitPromise = manager.waitForReady!(1000)

        // Simulate terminal becoming ready via callback
        setTimeout(() => {
          if (mockState.subscribeCallback) {
            mockState.subscribeCallback({ activeTerminalId: 'terminal-1' })
          }
        }, 10)

        await waitPromise

        expect(mockState.unsubscribe).toHaveBeenCalled()
      })

      it('should unsubscribe on timeout', async () => {
        mockState.activeTerminalId = null
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        const manager = createTerminalManager()
        await manager.waitForReady!(100)

        expect(mockState.unsubscribe).toHaveBeenCalled()
      })
    })
  })

  describe('createDefaultManagers()', () => {
    it('should create both managers', () => {
      const managers = createDefaultManagers()

      expect(managers.panelManager).toBeDefined()
      expect(managers.terminalManager).toBeDefined()
    })

    it('should create functional panel manager', () => {
      const managers = createDefaultManagers()

      managers.panelManager.setActivePanel('terminal', 'right')

      expect(mockState.setActivePanel).toHaveBeenCalledWith('terminal', 'right')
    })

    it('should create functional terminal manager', () => {
      mockState.activeTerminalId = 'terminal-1'
      const managers = createDefaultManagers()

      expect(managers.terminalManager.isReady()).toBe(true)
    })
  })
})
