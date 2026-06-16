// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Project Switching Helper Functions
 *
 * Covers all helper functions extracted from ProjectTree for project switching:
 * - checkHasDirtyEditors: Dynamic store import for dirty editor detection
 * - checkTerminalBusy: Terminal activity checking
 * - needsSwitchConfirmation: Confirmation logic
 * - confirmProjectSwitch: Dialog invocation
 * - interruptActiveTerminalIfAny: Terminal signal handling
 * - openProjectWithTokenGuard: Race-guarded project opening
 * - closeProjectWithTokenGuard: Race-guarded project closing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MutableRefObject } from 'react'
import {
  checkHasDirtyEditors,
  checkTerminalBusy,
  needsSwitchConfirmation,
  confirmProjectSwitch,
  interruptActiveTerminalIfAny,
  openProjectWithTokenGuard,
  closeProjectWithTokenGuard,
  type ConfirmFn
} from './switchHelpers'
import { TERMINAL } from './constants'

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

vi.mock('../../utils/logger', () => ({ logger: mockLogger }))

// Mock stores with dynamic imports
vi.mock('../../stores/useProjectStore', async () => {
  const state = {
    hasDirtyEditors: vi.fn().mockReturnValue(false),
    setProjectChanging: vi.fn()
  }
  return {
    useProjectStore: {
      getState: vi.fn(() => state)
    }
  }
})

vi.mock('../../stores/useTerminalStore', async () => {
  const state = {
    hasUserInteracted: vi.fn().mockReturnValue(false),
    isRecentlyActive: vi.fn().mockReturnValue(false),
    getActiveTerminalId: vi.fn().mockReturnValue(null),
    isRecentlyActiveId: vi.fn().mockReturnValue(false),
    clearActivity: vi.fn()
  }
  return {
    useTerminalStore: {
      getState: vi.fn(() => state)
    }
  }
})

// Mock window.api
const mockWindowApi = {
  terminal: {
    write: vi.fn().mockResolvedValue(undefined)
  },
  file: {
    openProject: vi.fn().mockResolvedValue('/opened/project'),
    closeProject: vi.fn().mockResolvedValue(true),
    readDirectory: vi.fn().mockResolvedValue([])
  }
}

global.window = {
  ...global.window,
  api: mockWindowApi
} as unknown as Window & typeof globalThis

describe('switchHelpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('checkHasDirtyEditors', () => {
    it('should return true when editors have unsaved changes', async () => {
      const { useProjectStore } = await import('../../stores/useProjectStore')
      const state = useProjectStore.getState()
      vi.mocked(state.hasDirtyEditors).mockReturnValue(true)

      const result = await checkHasDirtyEditors()

      expect(result).toBe(true)
    })

    it('should return false when no dirty editors', async () => {
      const { useProjectStore } = await import('../../stores/useProjectStore')
      const state = useProjectStore.getState()
      vi.mocked(state.hasDirtyEditors).mockReturnValue(false)

      const result = await checkHasDirtyEditors()

      expect(result).toBe(false)
    })

    // Note: Import failure test removed - vi.doMock doesn't work reliably with
    // dynamic imports in Vitest due to module caching. The try/catch in the
    // actual code is trivial error handling that returns false.

    it('should return false when hasDirtyEditors throws', async () => {
      const { useProjectStore } = await import('../../stores/useProjectStore')
      const state = useProjectStore.getState()
      vi.mocked(state.hasDirtyEditors).mockImplementation(() => {
        throw new Error('Method failed')
      })

      const result = await checkHasDirtyEditors()

      expect(result).toBe(false)
    })
  })

  describe('checkTerminalBusy', () => {
    it('should return true when terminal has user interaction + recent activity', async () => {
      const { useTerminalStore } = await import('../../stores/useTerminalStore')
      const state = useTerminalStore.getState()
      vi.mocked(state.hasUserInteracted).mockReturnValue(true)
      vi.mocked(state.isRecentlyActive).mockReturnValue(true)

      const result = await checkTerminalBusy(20000)

      expect(result).toBe(true)
      expect(state.isRecentlyActive).toHaveBeenCalledWith(20000)
    })

    it('should return false when no user interaction', async () => {
      const { useTerminalStore } = await import('../../stores/useTerminalStore')
      const state = useTerminalStore.getState()
      vi.mocked(state.hasUserInteracted).mockReturnValue(false)
      vi.mocked(state.isRecentlyActive).mockReturnValue(true)

      const result = await checkTerminalBusy(20000)

      expect(result).toBe(false)
    })

    it('should return false when no recent activity within window', async () => {
      const { useTerminalStore } = await import('../../stores/useTerminalStore')
      const state = useTerminalStore.getState()
      vi.mocked(state.hasUserInteracted).mockReturnValue(true)
      vi.mocked(state.isRecentlyActive).mockReturnValue(false)

      const result = await checkTerminalBusy(20000)

      expect(result).toBe(false)
    })

    it('should respect custom time window parameter', async () => {
      const { useTerminalStore } = await import('../../stores/useTerminalStore')
      const state = useTerminalStore.getState()
      vi.mocked(state.hasUserInteracted).mockReturnValue(true)
      vi.mocked(state.isRecentlyActive).mockReturnValue(true)

      await checkTerminalBusy(5000)

      expect(state.isRecentlyActive).toHaveBeenCalledWith(5000)
    })

    // Note: Import failure test removed - vi.doMock doesn't work reliably with
    // dynamic imports in Vitest due to module caching.
  })

  describe('needsSwitchConfirmation', () => {
    it('should return true when hasDirty is true', () => {
      expect(needsSwitchConfirmation(true, false)).toBe(true)
    })

    it('should return true when terminalBusy is true', () => {
      expect(needsSwitchConfirmation(false, true)).toBe(true)
    })

    it('should return true when both are true', () => {
      expect(needsSwitchConfirmation(true, true)).toBe(true)
    })

    it('should return false when both are false', () => {
      expect(needsSwitchConfirmation(false, false)).toBe(false)
    })
  })

  describe('confirmProjectSwitch', () => {
    let mockConfirm: ConfirmFn

    beforeEach(() => {
      mockConfirm = vi.fn().mockResolvedValue(true)
    })

    it('should return true immediately when no confirmation needed', async () => {
      const result = await confirmProjectSwitch(false, false, 'switch', mockConfirm)

      expect(result).toBe(true)
      expect(mockConfirm).not.toHaveBeenCalled()
    })

    it('should show "Unsaved Changes" dialog when hasDirty=true', async () => {
      await confirmProjectSwitch(true, false, 'switch', mockConfirm)

      expect(mockConfirm).toHaveBeenCalledWith({
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Discard and switch project?',
        confirmLabel: 'Switch Anyway',
        danger: true
      })
    })

    it('should show "Active Terminal Session" dialog when terminalBusy=true', async () => {
      await confirmProjectSwitch(false, true, 'switch', mockConfirm)

      expect(mockConfirm).toHaveBeenCalledWith({
        title: 'Active Terminal Session',
        message: 'Terminal shows recent activity. Stop it and switch project?',
        confirmLabel: 'Switch Anyway',
        danger: true
      })
    })

    it('should use correct labels for "switch" action', async () => {
      await confirmProjectSwitch(true, false, 'switch', mockConfirm)

      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('switch project'),
          confirmLabel: 'Switch Anyway'
        })
      )
    })

    it('should use correct labels for "close" action', async () => {
      await confirmProjectSwitch(true, false, 'close', mockConfirm)

      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('close project'),
          confirmLabel: 'Close Anyway'
        })
      )
    })

    it('should return true when user confirms', async () => {
      mockConfirm = vi.fn().mockResolvedValue(true)

      const result = await confirmProjectSwitch(true, false, 'switch', mockConfirm)

      expect(result).toBe(true)
    })

    it('should return false when user cancels', async () => {
      mockConfirm = vi.fn().mockResolvedValue(false)

      const result = await confirmProjectSwitch(true, false, 'switch', mockConfirm)

      expect(result).toBe(false)
    })
  })

  describe('interruptActiveTerminalIfAny', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should do nothing when no active terminal', async () => {
      const { useTerminalStore } = await import('../../stores/useTerminalStore')
      const state = useTerminalStore.getState()
      vi.mocked(state.getActiveTerminalId).mockReturnValue(null)

      await interruptActiveTerminalIfAny()

      expect(mockWindowApi.terminal.write).not.toHaveBeenCalled()
    })

    it('should send Ctrl+C signal to active terminal', async () => {
      const { useTerminalStore } = await import('../../stores/useTerminalStore')
      const state = useTerminalStore.getState()
      vi.mocked(state.getActiveTerminalId).mockReturnValue('term-1')
      vi.mocked(state.isRecentlyActiveId).mockReturnValue(false)

      const promise = interruptActiveTerminalIfAny()
      await vi.runAllTimersAsync()
      await promise

      expect(mockWindowApi.terminal.write).toHaveBeenCalledWith('term-1', TERMINAL.INTERRUPT_SIGNAL)
    })

    it('should wait for signal delay (300ms)', async () => {
      const { useTerminalStore } = await import('../../stores/useTerminalStore')
      const state = useTerminalStore.getState()
      vi.mocked(state.getActiveTerminalId).mockReturnValue('term-1')
      vi.mocked(state.isRecentlyActiveId).mockReturnValue(false)

      const promise = interruptActiveTerminalIfAny()

      // Should not check activity immediately
      expect(state.isRecentlyActiveId).not.toHaveBeenCalled()

      // Advance timer by delay
      await vi.advanceTimersByTimeAsync(TERMINAL.SIGNAL_DELAY)
      await promise

      expect(state.isRecentlyActiveId).toHaveBeenCalled()
    })

    it('should clear activity when terminal becomes idle', async () => {
      const { useTerminalStore } = await import('../../stores/useTerminalStore')
      const state = useTerminalStore.getState()
      vi.mocked(state.getActiveTerminalId).mockReturnValue('term-1')
      vi.mocked(state.isRecentlyActiveId).mockReturnValue(false) // Terminal idle

      const promise = interruptActiveTerminalIfAny()
      await vi.runAllTimersAsync()
      await promise

      expect(state.clearActivity).toHaveBeenCalledWith('term-1')
    })

    it('should not clear activity when terminal still active', async () => {
      const { useTerminalStore } = await import('../../stores/useTerminalStore')
      const state = useTerminalStore.getState()
      vi.mocked(state.getActiveTerminalId).mockReturnValue('term-1')
      vi.mocked(state.isRecentlyActiveId).mockReturnValue(true) // Still active

      const promise = interruptActiveTerminalIfAny()
      await vi.runAllTimersAsync()
      await promise

      expect(state.clearActivity).not.toHaveBeenCalled()
    })

    it('should handle terminal write errors gracefully', async () => {
      const { useTerminalStore } = await import('../../stores/useTerminalStore')
      const state = useTerminalStore.getState()
      vi.mocked(state.getActiveTerminalId).mockReturnValue('term-1')
      mockWindowApi.terminal.write.mockRejectedValueOnce(new Error('Write failed'))

      mockLogger.warn.mockClear()

      const promise = interruptActiveTerminalIfAny()
      await vi.runAllTimersAsync()
      await promise

      expect(mockLogger.warn).toHaveBeenCalledWith('Failed to signal terminal', { error: expect.any(Error) })
    })
  })

  describe('openProjectWithTokenGuard', () => {
    let switchTokenRef: MutableRefObject<number>
    let setProjectPath: ReturnType<typeof vi.fn>

    beforeEach(() => {
      switchTokenRef = { current: 0 }
      setProjectPath = vi.fn()
    })

    it('should increment token and open project successfully', async () => {
      mockWindowApi.file.openProject.mockResolvedValue('/opened/project')

      const result = await openProjectWithTokenGuard(switchTokenRef, setProjectPath)

      expect(switchTokenRef.current).toBe(1)
      expect(result).toBe('/opened/project')
      expect(setProjectPath).toHaveBeenCalledWith('/opened/project')
    })

    it('should return null when user cancels dialog', async () => {
      mockWindowApi.file.openProject.mockResolvedValue(null)

      const result = await openProjectWithTokenGuard(switchTokenRef, setProjectPath)

      expect(result).toBeNull()
      expect(setProjectPath).not.toHaveBeenCalled()
    })

    it('should return null when token mismatch (race condition)', async () => {
      // Mock that simulates another operation changing the token during the async wait
      mockWindowApi.file.openProject.mockImplementation(async () => {
        // This happens DURING the await, simulating a concurrent operation
        switchTokenRef.current = 10
        return '/opened/project'
      })

      const result = await openProjectWithTokenGuard(switchTokenRef, setProjectPath)

      expect(result).toBeNull()
      expect(setProjectPath).not.toHaveBeenCalled()
    })

    it('should only update project path, not load files (IPC event handles files)', async () => {
      mockWindowApi.file.openProject.mockResolvedValue('/opened/project')

      await openProjectWithTokenGuard(switchTokenRef, setProjectPath)

      expect(mockWindowApi.file.openProject).toHaveBeenCalled()
      expect(mockWindowApi.file.readDirectory).not.toHaveBeenCalled()
      expect(setProjectPath).toHaveBeenCalledWith('/opened/project')
    })
  })

  describe('closeProjectWithTokenGuard', () => {
    let switchTokenRef: MutableRefObject<number>
    let setProjectPath: ReturnType<typeof vi.fn>

    beforeEach(() => {
      switchTokenRef = { current: 0 }
      setProjectPath = vi.fn()
    })

    it('should increment token and close project successfully', async () => {
      mockWindowApi.file.closeProject.mockResolvedValue(true)

      const result = await closeProjectWithTokenGuard(switchTokenRef, setProjectPath)

      expect(switchTokenRef.current).toBe(1)
      expect(result).toBe(true)
      expect(setProjectPath).toHaveBeenCalledWith(null)
    })

    it('should return false when close operation fails', async () => {
      mockWindowApi.file.closeProject.mockResolvedValue(false)

      const result = await closeProjectWithTokenGuard(switchTokenRef, setProjectPath)

      expect(result).toBe(false)
      expect(setProjectPath).not.toHaveBeenCalled()
    })

    it('should return false when token mismatch', async () => {
      mockWindowApi.file.closeProject.mockResolvedValue(true)

      const promise = closeProjectWithTokenGuard(switchTokenRef, setProjectPath)

      // Simulate another operation incrementing the token
      switchTokenRef.current = 10

      const result = await promise

      expect(result).toBe(false)
      expect(setProjectPath).not.toHaveBeenCalled()
    })

    it('should only update project path, not clear files/UI state (IPC event handles that)', async () => {
      mockWindowApi.file.closeProject.mockResolvedValue(true)

      await closeProjectWithTokenGuard(switchTokenRef, setProjectPath)

      expect(setProjectPath).toHaveBeenCalledWith(null)
      // Files and UI state are cleared by IPC event listener, not here
    })
  })
})
