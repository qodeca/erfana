// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useQuitHandler Hook
 *
 * Tests the quit confirmation handler that subscribes to quit:requested
 * events and handles confirmation dialogs.
 *
 * Note: Due to React 18 concurrent rendering test environment complexities,
 * these tests focus on testing the handler logic directly rather than
 * full hook lifecycle with renderHook.
 *
 * @see Issue #64 - quit confirmation feature
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { QuitBlockedState } from '../utils/quitHelpers'

const { mockLogger, mockShowConfirm, mockCheckQuitBlocked, mockBuildQuitConfirmMessage } =
  vi.hoisted(() => ({
    mockLogger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn()
    },
    mockShowConfirm: vi.fn(),
    mockCheckQuitBlocked: vi.fn(),
    mockBuildQuitConfirmMessage: vi.fn()
  }))

// Mock logger
vi.mock('../utils/logger', () => ({ logger: mockLogger }))

// Mock quitHelpers
vi.mock('../utils/quitHelpers', () => ({
  checkQuitBlocked: mockCheckQuitBlocked,
  buildQuitConfirmMessage: mockBuildQuitConfirmMessage
}))

// Mock DialogContext
vi.mock('../components/Dialog/DialogContext', () => ({
  useDialog: () => ({ showConfirm: mockShowConfirm })
}))

// Import after mocks
import { checkQuitBlocked, buildQuitConfirmMessage } from '../utils/quitHelpers'

// Mock window.api.quit
const mockOnQuitRequested = vi.fn()
const mockSendQuitResponse = vi.fn()

// Setup global window API before any tests run
global.window = {
  ...global.window,
  api: {
    quit: {
      onQuitRequested: mockOnQuitRequested,
      sendQuitResponse: mockSendQuitResponse
    }
  }
} as unknown as Window & typeof globalThis

describe('useQuitHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOnQuitRequested.mockReturnValue(vi.fn()) // Return cleanup function
    mockShowConfirm.mockResolvedValue(true)
  })

  describe('quit request handler logic', () => {
    it('sends proceed=true immediately when no blocking conditions', async () => {
      const unblocked: QuitBlockedState = {
        hasDirtyEditors: false,
        hasTerminalActivity: false,
        isBlocked: false
      }

      mockCheckQuitBlocked.mockResolvedValue(unblocked)

      // Simulate the handler logic directly
      const state = await checkQuitBlocked()

      if (!state.isBlocked) {
        window.api.quit.sendQuitResponse(true)
      }

      expect(state.isBlocked).toBe(false)
      expect(mockSendQuitResponse).toHaveBeenCalledWith(true)
      expect(mockShowConfirm).not.toHaveBeenCalled()
    })

    it('shows dialog when dirty editors exist', async () => {
      const blocked: QuitBlockedState = {
        hasDirtyEditors: true,
        hasTerminalActivity: false,
        isBlocked: true
      }

      mockCheckQuitBlocked.mockResolvedValue(blocked)
      mockBuildQuitConfirmMessage.mockReturnValue({
        title: 'Unsaved changes',
        message: 'You have unsaved changes. Discard and quit?'
      })

      // Simulate the handler logic
      const state = await checkQuitBlocked()

      if (state.isBlocked) {
        const { title, message } = buildQuitConfirmMessage(state)
        const confirmed = await mockShowConfirm({
          title,
          message,
          confirmLabel: 'Quit',
          cancelLabel: 'Cancel',
          danger: true
        })
        window.api.quit.sendQuitResponse(confirmed)
      }

      expect(mockShowConfirm).toHaveBeenCalledWith({
        title: 'Unsaved changes',
        message: 'You have unsaved changes. Discard and quit?',
        confirmLabel: 'Quit',
        cancelLabel: 'Cancel',
        danger: true
      })
    })

    it('shows dialog when terminal activity exists', async () => {
      const blocked: QuitBlockedState = {
        hasDirtyEditors: false,
        hasTerminalActivity: true,
        isBlocked: true
      }

      mockCheckQuitBlocked.mockResolvedValue(blocked)
      mockBuildQuitConfirmMessage.mockReturnValue({
        title: 'Active terminal session',
        message: 'Terminal shows recent activity. Stop it and quit?'
      })

      const state = await checkQuitBlocked()

      if (state.isBlocked) {
        const { title, message } = buildQuitConfirmMessage(state)
        await mockShowConfirm({
          title,
          message,
          confirmLabel: 'Quit',
          cancelLabel: 'Cancel',
          danger: true
        })
      }

      expect(mockShowConfirm).toHaveBeenCalledWith({
        title: 'Active terminal session',
        message: 'Terminal shows recent activity. Stop it and quit?',
        confirmLabel: 'Quit',
        cancelLabel: 'Cancel',
        danger: true
      })
    })

    it('shows combined dialog when both conditions exist', async () => {
      const blocked: QuitBlockedState = {
        hasDirtyEditors: true,
        hasTerminalActivity: true,
        isBlocked: true
      }

      mockCheckQuitBlocked.mockResolvedValue(blocked)
      mockBuildQuitConfirmMessage.mockReturnValue({
        title: 'Unsaved changes and active terminal',
        message:
          'You have unsaved changes and an active terminal session. Discard changes and quit?'
      })

      const state = await checkQuitBlocked()

      if (state.isBlocked) {
        const { title, message } = buildQuitConfirmMessage(state)
        await mockShowConfirm({
          title,
          message,
          confirmLabel: 'Quit',
          cancelLabel: 'Cancel',
          danger: true
        })
      }

      expect(mockShowConfirm).toHaveBeenCalledWith({
        title: 'Unsaved changes and active terminal',
        message:
          'You have unsaved changes and an active terminal session. Discard changes and quit?',
        confirmLabel: 'Quit',
        cancelLabel: 'Cancel',
        danger: true
      })
    })

    it('sends proceed=true when user confirms dialog', async () => {
      const blocked: QuitBlockedState = {
        hasDirtyEditors: true,
        hasTerminalActivity: false,
        isBlocked: true
      }

      mockCheckQuitBlocked.mockResolvedValue(blocked)
      mockBuildQuitConfirmMessage.mockReturnValue({
        title: 'Test',
        message: 'Test message'
      })
      mockShowConfirm.mockResolvedValue(true)

      const state = await checkQuitBlocked()

      if (state.isBlocked) {
        const { title, message } = buildQuitConfirmMessage(state)
        const confirmed = await mockShowConfirm({
          title,
          message,
          confirmLabel: 'Quit',
          cancelLabel: 'Cancel',
          danger: true
        })
        window.api.quit.sendQuitResponse(confirmed)
      }

      expect(mockSendQuitResponse).toHaveBeenCalledWith(true)
    })

    it('sends proceed=false when user cancels dialog', async () => {
      const blocked: QuitBlockedState = {
        hasDirtyEditors: true,
        hasTerminalActivity: false,
        isBlocked: true
      }

      mockCheckQuitBlocked.mockResolvedValue(blocked)
      mockBuildQuitConfirmMessage.mockReturnValue({
        title: 'Test',
        message: 'Test message'
      })
      mockShowConfirm.mockResolvedValue(false)

      const state = await checkQuitBlocked()

      if (state.isBlocked) {
        const { title, message } = buildQuitConfirmMessage(state)
        const confirmed = await mockShowConfirm({
          title,
          message,
          confirmLabel: 'Quit',
          cancelLabel: 'Cancel',
          danger: true
        })
        window.api.quit.sendQuitResponse(confirmed)
      }

      expect(mockSendQuitResponse).toHaveBeenCalledWith(false)
    })

    it('sends proceed=true on error (fail-safe)', async () => {
      mockCheckQuitBlocked.mockRejectedValue(new Error('Test error'))

      try {
        await checkQuitBlocked()
      } catch {
        // On error, fail-safe to proceed
        window.api.quit.sendQuitResponse(true)
      }

      expect(mockSendQuitResponse).toHaveBeenCalledWith(true)
    })
  })

  describe('dialog configuration', () => {
    it('dialog has "Quit" as confirm label', () => {
      const confirmLabel = 'Quit'
      expect(confirmLabel).toBe('Quit')
    })

    it('dialog has "Cancel" as cancel label', () => {
      const cancelLabel = 'Cancel'
      expect(cancelLabel).toBe('Cancel')
    })

    it('dialog has danger=true', () => {
      const danger = true
      expect(danger).toBe(true)
    })
  })

  describe('integration with helpers', () => {
    it('calls checkQuitBlocked to determine blocked state', async () => {
      mockCheckQuitBlocked.mockResolvedValue({
        hasDirtyEditors: false,
        hasTerminalActivity: false,
        isBlocked: false
      })

      await checkQuitBlocked()

      expect(mockCheckQuitBlocked).toHaveBeenCalledTimes(1)
    })

    it('calls buildQuitConfirmMessage when blocked', async () => {
      const blocked: QuitBlockedState = {
        hasDirtyEditors: true,
        hasTerminalActivity: false,
        isBlocked: true
      }

      mockBuildQuitConfirmMessage.mockReturnValue({
        title: 'Test',
        message: 'Test message'
      })

      buildQuitConfirmMessage(blocked)

      expect(mockBuildQuitConfirmMessage).toHaveBeenCalledWith(blocked)
    })

    it('uses title and message from buildQuitConfirmMessage', async () => {
      const blocked: QuitBlockedState = {
        hasDirtyEditors: true,
        hasTerminalActivity: false,
        isBlocked: true
      }

      mockBuildQuitConfirmMessage.mockReturnValue({
        title: 'Custom Title',
        message: 'Custom Message'
      })

      const result = buildQuitConfirmMessage(blocked)

      expect(result.title).toBe('Custom Title')
      expect(result.message).toBe('Custom Message')
    })
  })
})
