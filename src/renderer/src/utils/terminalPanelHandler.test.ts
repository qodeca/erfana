// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for TerminalPanelHandler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TerminalPanelHandler, createTerminalPanelHandler } from './terminalPanelHandler'
import type { PanelManagers } from './panelManager.types'
import { ErrorCode } from '../../../shared/errors'

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

// Mock toast helpers
vi.mock('./toastHelpers', () => ({
  showErrorToast: vi.fn()
}))

// Mock the factory to avoid Zustand imports
vi.mock('./panelManager.factory', () => ({
  createDefaultManagers: vi.fn(() => ({
    panelManager: {
      setActivePanel: vi.fn()
    },
    terminalManager: {
      isReady: vi.fn(() => true),
      sendToTerminal: vi.fn(() => Promise.resolve(true))
    }
  }))
}))

describe('TerminalPanelHandler', () => {
  let mockManagers: PanelManagers

  beforeEach(() => {
    mockManagers = {
      panelManager: {
        setActivePanel: vi.fn()
      },
      terminalManager: {
        isReady: vi.fn(() => true),
        sendToTerminal: vi.fn(() => Promise.resolve(true))
      }
    }
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should create handler with provided managers', () => {
      const handler = new TerminalPanelHandler(mockManagers)

      expect(handler.panelType).toBe('terminal')
      expect(handler.displayName).toBe('Terminal')
    })

    it('should use default managers when none provided', () => {
      const handler = new TerminalPanelHandler()

      expect(handler.panelType).toBe('terminal')
    })
  })

  describe('open()', () => {
    it('should open terminal panel at specified location', () => {
      const handler = new TerminalPanelHandler(mockManagers)

      handler.open('left')

      expect(mockManagers.panelManager.setActivePanel).toHaveBeenCalledWith('terminal', 'left')
    })

    it('should open terminal panel on the right', () => {
      const handler = new TerminalPanelHandler(mockManagers)

      handler.open('right')

      expect(mockManagers.panelManager.setActivePanel).toHaveBeenCalledWith('terminal', 'right')
    })
  })

  describe('waitForReady()', () => {
    it('should return true immediately when terminal is ready', async () => {
      mockManagers.terminalManager.isReady = vi.fn(() => true)
      const handler = new TerminalPanelHandler(mockManagers)

      const result = await handler.waitForReady()

      expect(result).toBe(true)
      expect(mockManagers.terminalManager.isReady).toHaveBeenCalled()
    })

    it('should poll until terminal becomes ready', async () => {
      let callCount = 0
      mockManagers.terminalManager.isReady = vi.fn(() => {
        callCount++
        return callCount >= 3 // Ready after 3 calls
      })
      const handler = new TerminalPanelHandler(mockManagers)

      const result = await handler.waitForReady(1000)

      expect(result).toBe(true)
      expect(callCount).toBeGreaterThanOrEqual(3)
    })

    it('should return false on timeout', async () => {
      mockManagers.terminalManager.isReady = vi.fn(() => false)
      const handler = new TerminalPanelHandler(mockManagers)
      mockLogger.warn.mockClear()

      const result = await handler.waitForReady(100)

      expect(result).toBe(false)
      expect(mockLogger.warn).toHaveBeenCalledWith('Terminal readiness timeout after 100 ms')
    })
  })

  describe('send()', () => {
    it('should send content to terminal successfully', async () => {
      const handler = new TerminalPanelHandler(mockManagers)

      const result = await handler.send({
        content: 'npm install',
        location: 'right'
      })

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
      expect(mockManagers.panelManager.setActivePanel).toHaveBeenCalledWith('terminal', 'right')
      expect(mockManagers.terminalManager.sendToTerminal).toHaveBeenCalledWith('npm install', false)
    })

    it('should send content with autoExecute', async () => {
      const handler = new TerminalPanelHandler(mockManagers)

      await handler.send({
        content: 'npm test',
        location: 'right',
        autoExecute: true
      })

      expect(mockManagers.terminalManager.sendToTerminal).toHaveBeenCalledWith('npm test', true)
    })

    it('should return error when terminal times out', async () => {
      mockManagers.terminalManager.isReady = vi.fn(() => false)
      const handler = new TerminalPanelHandler(mockManagers)
      mockLogger.error.mockClear()

      const result = await handler.send({
        content: 'npm install',
        location: 'right',
        timeout: 100,
        showToast: false
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(ErrorCode.PROMPT_TERMINAL_TIMEOUT)
    })

    it('should return error when send fails', async () => {
      mockManagers.terminalManager.sendToTerminal = vi.fn(() => Promise.resolve(false))
      const handler = new TerminalPanelHandler(mockManagers)
      mockLogger.error.mockClear()

      const result = await handler.send({
        content: 'npm install',
        location: 'right',
        showToast: false
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe(ErrorCode.PROMPT_SEND_FAILED)
    })

    it('should show toast on timeout error by default', async () => {
      const { showErrorToast } = await import('./toastHelpers')
      mockManagers.terminalManager.isReady = vi.fn(() => false)
      const handler = new TerminalPanelHandler(mockManagers)
      mockLogger.error.mockClear()

      await handler.send({
        content: 'npm install',
        location: 'right',
        timeout: 100
      })

      expect(showErrorToast).toHaveBeenCalled()
    })

    it('should not show toast when showToast is false', async () => {
      const { showErrorToast } = await import('./toastHelpers')
      mockManagers.terminalManager.isReady = vi.fn(() => false)
      const handler = new TerminalPanelHandler(mockManagers)
      mockLogger.error.mockClear()

      await handler.send({
        content: 'npm install',
        location: 'right',
        timeout: 100,
        showToast: false
      })

      expect(showErrorToast).not.toHaveBeenCalled()
    })
  })

  describe('isAvailable()', () => {
    it('should return true (terminal is always available)', () => {
      const handler = new TerminalPanelHandler(mockManagers)

      expect(handler.isAvailable()).toBe(true)
    })
  })
})

describe('createTerminalPanelHandler()', () => {
  it('should create a terminal panel handler', () => {
    const mockManagers: PanelManagers = {
      panelManager: { setActivePanel: vi.fn() },
      terminalManager: {
        isReady: vi.fn(() => true),
        sendToTerminal: vi.fn(() => Promise.resolve(true))
      }
    }

    const handler = createTerminalPanelHandler(mockManagers)

    expect(handler.panelType).toBe('terminal')
    expect(handler.displayName).toBe('Terminal')
  })
})
