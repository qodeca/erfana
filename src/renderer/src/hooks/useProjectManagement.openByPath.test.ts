// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useProjectManagement.handleOpenProjectByPath
 *
 * Tests the new method that opens projects by direct path with safety checks.
 * This is used by WelcomePanel's Recent Projects feature.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useProjectManagement } from './useProjectManagement'

// Mock switchHelpers
const mockCheckHasDirtyEditors = vi.fn()
const mockCheckTerminalBusy = vi.fn()
const mockConfirmProjectSwitch = vi.fn()
const mockInterruptActiveTerminalIfAny = vi.fn()

vi.mock('../components/ProjectTree/switchHelpers', () => ({
  checkHasDirtyEditors: () => mockCheckHasDirtyEditors(),
  checkTerminalBusy: () => mockCheckTerminalBusy(),
  confirmProjectSwitch: (...args: unknown[]) => mockConfirmProjectSwitch(...args),
  interruptActiveTerminalIfAny: () => mockInterruptActiveTerminalIfAny(),
  openProjectWithTokenGuard: vi.fn(),
  closeProjectWithTokenGuard: vi.fn()
}))

// Mock useDialog
const mockShowConfirm = vi.fn()
vi.mock('../components/Dialog', () => ({
  useDialog: () => ({
    showConfirm: mockShowConfirm,
    showAlert: vi.fn(),
    showPrompt: vi.fn()
  })
}))

// Mock toastService
const mockShowGlobalToast = vi.fn()
vi.mock('../components/Toast/toastService', () => ({
  showGlobalToast: (options: unknown) => mockShowGlobalToast(options)
}))

// Mock window.api
const mockOpenProjectByPath = vi.fn()
const mockApi = {
  file: {
    openProject: vi.fn(),
    openProjectByPath: mockOpenProjectByPath,
    closeProject: vi.fn(),
    getLastProjectPath: vi.fn(),
    readDirectory: vi.fn().mockResolvedValue([]),
    onProjectChanged: vi.fn(() => vi.fn())
  },
  directoryWatch: {
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    onDirectoryChanged: vi.fn(() => vi.fn()),
    onProjectDeleted: vi.fn(() => vi.fn()),
    onDirectoryError: vi.fn(() => vi.fn())
  },
  terminal: {
    write: vi.fn()
  }
}

const originalApi = (window as unknown as { api?: typeof mockApi }).api

describe('useProjectManagement.handleOpenProjectByPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as unknown as { api: typeof mockApi }).api = mockApi

    // Default: no dirty editors, no terminal activity
    mockCheckHasDirtyEditors.mockResolvedValue(false)
    mockCheckTerminalBusy.mockResolvedValue(false)
    mockConfirmProjectSwitch.mockResolvedValue(true)
    mockOpenProjectByPath.mockResolvedValue('/test/project')
  })

  afterEach(() => {
    ;(window as unknown as { api?: typeof mockApi }).api = originalApi
  })

  describe('Success scenarios', () => {
    it('should open project successfully when no safety issues', async () => {
      const { result } = renderHook(() => useProjectManagement())

      let opened: boolean | undefined
      await act(async () => {
        opened = await result.current.handleOpenProjectByPath('/test/project')
      })

      expect(opened).toBe(true)
      expect(mockOpenProjectByPath).toHaveBeenCalledWith('/test/project')
    })

    it('should check dirty editors and terminal activity in parallel', async () => {
      const { result } = renderHook(() => useProjectManagement())

      await act(async () => {
        await result.current.handleOpenProjectByPath('/test/project')
      })

      expect(mockCheckHasDirtyEditors).toHaveBeenCalledTimes(1)
      expect(mockCheckTerminalBusy).toHaveBeenCalledTimes(1)
    })

    it('should not show confirmation when no safety issues', async () => {
      mockCheckHasDirtyEditors.mockResolvedValue(false)
      mockCheckTerminalBusy.mockResolvedValue(false)

      const { result } = renderHook(() => useProjectManagement())

      await act(async () => {
        await result.current.handleOpenProjectByPath('/test/project')
      })

      // confirmProjectSwitch is called but with hasDirty=false and terminalBusy=false
      expect(mockConfirmProjectSwitch).toHaveBeenCalledWith(
        false, // hasDirty
        false, // terminalBusy
        'switch',
        expect.any(Function) // showConfirm
      )
    })

    it('should set isSwitchingProject to false after operation completes', async () => {
      const { result } = renderHook(() => useProjectManagement())

      expect(result.current.isSwitchingProject).toBe(false)

      await act(async () => {
        await result.current.handleOpenProjectByPath('/test/project')
      })

      // After completion, should be false
      expect(result.current.isSwitchingProject).toBe(false)
    })
  })

  describe('Dirty editors confirmation', () => {
    it('should show confirmation when dirty editors exist', async () => {
      mockCheckHasDirtyEditors.mockResolvedValue(true)
      mockConfirmProjectSwitch.mockResolvedValue(true)

      const { result } = renderHook(() => useProjectManagement())

      await act(async () => {
        await result.current.handleOpenProjectByPath('/test/project')
      })

      expect(mockConfirmProjectSwitch).toHaveBeenCalledWith(
        true, // hasDirty
        false, // terminalBusy
        'switch',
        expect.any(Function)
      )
    })

    it('should return false when user cancels confirmation for dirty editors', async () => {
      mockCheckHasDirtyEditors.mockResolvedValue(true)
      mockConfirmProjectSwitch.mockResolvedValue(false)

      const { result } = renderHook(() => useProjectManagement())

      let opened: boolean | undefined
      await act(async () => {
        opened = await result.current.handleOpenProjectByPath('/test/project')
      })

      expect(opened).toBe(false)
      expect(mockOpenProjectByPath).not.toHaveBeenCalled()
    })
  })

  describe('Terminal activity confirmation', () => {
    it('should show confirmation when terminal is busy', async () => {
      mockCheckTerminalBusy.mockResolvedValue(true)
      mockConfirmProjectSwitch.mockResolvedValue(true)

      const { result } = renderHook(() => useProjectManagement())

      await act(async () => {
        await result.current.handleOpenProjectByPath('/test/project')
      })

      expect(mockConfirmProjectSwitch).toHaveBeenCalledWith(
        false, // hasDirty
        true, // terminalBusy
        'switch',
        expect.any(Function)
      )
    })

    it('should interrupt terminal before opening when terminal was busy', async () => {
      mockCheckTerminalBusy.mockResolvedValue(true)
      mockConfirmProjectSwitch.mockResolvedValue(true)

      const { result } = renderHook(() => useProjectManagement())

      await act(async () => {
        await result.current.handleOpenProjectByPath('/test/project')
      })

      expect(mockInterruptActiveTerminalIfAny).toHaveBeenCalledTimes(1)
    })

    it('should not interrupt terminal when terminal was not busy', async () => {
      mockCheckTerminalBusy.mockResolvedValue(false)

      const { result } = renderHook(() => useProjectManagement())

      await act(async () => {
        await result.current.handleOpenProjectByPath('/test/project')
      })

      expect(mockInterruptActiveTerminalIfAny).not.toHaveBeenCalled()
    })

    it('should return false when user cancels confirmation for terminal activity', async () => {
      mockCheckTerminalBusy.mockResolvedValue(true)
      mockConfirmProjectSwitch.mockResolvedValue(false)

      const { result } = renderHook(() => useProjectManagement())

      let opened: boolean | undefined
      await act(async () => {
        opened = await result.current.handleOpenProjectByPath('/test/project')
      })

      expect(opened).toBe(false)
      expect(mockOpenProjectByPath).not.toHaveBeenCalled()
      expect(mockInterruptActiveTerminalIfAny).not.toHaveBeenCalled()
    })
  })

  describe('Both dirty and terminal busy', () => {
    it('should show confirmation with both flags', async () => {
      mockCheckHasDirtyEditors.mockResolvedValue(true)
      mockCheckTerminalBusy.mockResolvedValue(true)
      mockConfirmProjectSwitch.mockResolvedValue(true)

      const { result } = renderHook(() => useProjectManagement())

      await act(async () => {
        await result.current.handleOpenProjectByPath('/test/project')
      })

      expect(mockConfirmProjectSwitch).toHaveBeenCalledWith(
        true, // hasDirty
        true, // terminalBusy
        'switch',
        expect.any(Function)
      )
    })

    it('should interrupt terminal when both conditions and user confirms', async () => {
      mockCheckHasDirtyEditors.mockResolvedValue(true)
      mockCheckTerminalBusy.mockResolvedValue(true)
      mockConfirmProjectSwitch.mockResolvedValue(true)

      const { result } = renderHook(() => useProjectManagement())

      await act(async () => {
        await result.current.handleOpenProjectByPath('/test/project')
      })

      expect(mockInterruptActiveTerminalIfAny).toHaveBeenCalledTimes(1)
      expect(mockOpenProjectByPath).toHaveBeenCalled()
    })
  })

  describe('Error handling', () => {
    it('should throw error and set error state on failure', async () => {
      mockOpenProjectByPath.mockRejectedValue(new Error('Failed to open'))

      const { result } = renderHook(() => useProjectManagement())

      await act(async () => {
        await expect(
          result.current.handleOpenProjectByPath('/test/project')
        ).rejects.toThrow('Failed to open')
      })

      expect(result.current.error).toBe('Failed to open')
    })

    it('should reset isSwitchingProject on error', async () => {
      mockOpenProjectByPath.mockRejectedValue(new Error('Test error'))

      const { result } = renderHook(() => useProjectManagement())

      await act(async () => {
        try {
          await result.current.handleOpenProjectByPath('/test/project')
        } catch {
          // Expected to throw
        }
      })

      expect(result.current.isSwitchingProject).toBe(false)
    })

    it('should allow caller to handle specific errors', async () => {
      const specificError = new Error('PROJECT_NOT_FOUND')
      mockOpenProjectByPath.mockRejectedValue(specificError)

      const { result } = renderHook(() => useProjectManagement())

      let caughtError: Error | undefined
      await act(async () => {
        try {
          await result.current.handleOpenProjectByPath('/test/project')
        } catch (err) {
          caughtError = err as Error
        }
      })

      expect(caughtError).toBe(specificError)
    })
  })

  describe('Integration with API', () => {
    it('should use the provided api from options', async () => {
      const customApi = {
        ...mockApi,
        file: {
          ...mockApi.file,
          openProjectByPath: vi.fn().mockResolvedValue('/custom/path')
        }
      }

      const { result } = renderHook(() =>
        useProjectManagement({ api: customApi as never })
      )

      await act(async () => {
        await result.current.handleOpenProjectByPath('/custom/path')
      })

      expect(customApi.file.openProjectByPath).toHaveBeenCalledWith('/custom/path')
    })
  })
})
