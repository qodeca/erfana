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
import type { FileNode } from '../../../../preload/index'
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

// Mock stores with dynamic imports
vi.mock('../../stores/useProjectStore', async () => {
  const state = { hasDirtyEditors: vi.fn().mockReturnValue(false) }
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

    it('should return false when store import fails', async () => {
      // Temporarily break the import
      const originalImport = await import('../../stores/useProjectStore')
      vi.doMock('../../stores/useProjectStore', () => {
        throw new Error('Import failed')
      })

      const result = await checkHasDirtyEditors()

      expect(result).toBe(false)

      // Restore
      vi.doMock('../../stores/useProjectStore', () => originalImport)
    })

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

    it('should return false when store import fails', async () => {
      const originalImport = await import('../../stores/useTerminalStore')
      vi.doMock('../../stores/useTerminalStore', () => {
        throw new Error('Import failed')
      })

      const result = await checkTerminalBusy(20000)

      expect(result).toBe(false)

      vi.doMock('../../stores/useTerminalStore', () => originalImport)
    })
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

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const promise = interruptActiveTerminalIfAny()
      await vi.runAllTimersAsync()
      await promise

      expect(consoleSpy).toHaveBeenCalledWith('Failed to signal terminal:', expect.any(Error))

      consoleSpy.mockRestore()
    })
  })

  describe('openProjectWithTokenGuard', () => {
    let switchTokenRef: MutableRefObject<number>
    let setProjectPath: ReturnType<typeof vi.fn>
    let setFiles: ReturnType<typeof vi.fn>

    beforeEach(() => {
      switchTokenRef = { current: 0 }
      setProjectPath = vi.fn()
      setFiles = vi.fn()
    })

    it('should increment token and open project successfully', async () => {
      const fileTree: FileNode[] = [
        { name: 'file.md', path: '/opened/project/file.md', type: 'file' }
      ]
      mockWindowApi.file.openProject.mockResolvedValue('/opened/project')
      mockWindowApi.file.readDirectory.mockResolvedValue(fileTree)

      const result = await openProjectWithTokenGuard(switchTokenRef, setProjectPath, setFiles)

      expect(switchTokenRef.current).toBe(1)
      expect(result).toBe('/opened/project')
      expect(setProjectPath).toHaveBeenCalledWith('/opened/project')
      expect(setFiles).toHaveBeenCalledWith(fileTree)
    })

    it('should return null when user cancels dialog', async () => {
      mockWindowApi.file.openProject.mockResolvedValue(null)

      const result = await openProjectWithTokenGuard(switchTokenRef, setProjectPath, setFiles)

      expect(result).toBeNull()
      expect(setProjectPath).not.toHaveBeenCalled()
      expect(setFiles).not.toHaveBeenCalled()
    })

    it('should return null when token mismatch (race condition)', async () => {
      mockWindowApi.file.openProject.mockResolvedValue('/opened/project')

      const promise = openProjectWithTokenGuard(switchTokenRef, setProjectPath, setFiles)

      // Simulate another operation incrementing the token
      switchTokenRef.current = 10

      const result = await promise

      expect(result).toBeNull()
      expect(setProjectPath).not.toHaveBeenCalled()
      expect(setFiles).not.toHaveBeenCalled()
    })

    it('should set project path and load files when successful', async () => {
      const fileTree: FileNode[] = [
        { name: 'file1.md', path: '/opened/project/file1.md', type: 'file' },
        { name: 'folder', path: '/opened/project/folder', type: 'directory', children: [] }
      ]
      mockWindowApi.file.openProject.mockResolvedValue('/opened/project')
      mockWindowApi.file.readDirectory.mockResolvedValue(fileTree)

      await openProjectWithTokenGuard(switchTokenRef, setProjectPath, setFiles)

      expect(mockWindowApi.file.openProject).toHaveBeenCalled()
      expect(mockWindowApi.file.readDirectory).toHaveBeenCalledWith('/opened/project')
      expect(setProjectPath).toHaveBeenCalledWith('/opened/project')
      expect(setFiles).toHaveBeenCalledWith(fileTree)
    })
  })

  describe('closeProjectWithTokenGuard', () => {
    let switchTokenRef: MutableRefObject<number>
    let setProjectPath: ReturnType<typeof vi.fn>
    let setFiles: ReturnType<typeof vi.fn>
    let setExpandedFolders: ReturnType<typeof vi.fn>

    beforeEach(() => {
      switchTokenRef = { current: 0 }
      setProjectPath = vi.fn()
      setFiles = vi.fn()
      setExpandedFolders = vi.fn()
    })

    it('should increment token and close project successfully', async () => {
      mockWindowApi.file.closeProject.mockResolvedValue(true)

      const result = await closeProjectWithTokenGuard(
        switchTokenRef,
        setProjectPath,
        setFiles,
        setExpandedFolders
      )

      expect(switchTokenRef.current).toBe(1)
      expect(result).toBe(true)
      expect(setProjectPath).toHaveBeenCalledWith(null)
      expect(setFiles).toHaveBeenCalledWith([])
      expect(setExpandedFolders).toHaveBeenCalledWith(new Set())
    })

    it('should return false when close operation fails', async () => {
      mockWindowApi.file.closeProject.mockResolvedValue(false)

      const result = await closeProjectWithTokenGuard(
        switchTokenRef,
        setProjectPath,
        setFiles,
        setExpandedFolders
      )

      expect(result).toBe(false)
      expect(setProjectPath).not.toHaveBeenCalled()
      expect(setFiles).not.toHaveBeenCalled()
      expect(setExpandedFolders).not.toHaveBeenCalled()
    })

    it('should return false when token mismatch', async () => {
      mockWindowApi.file.closeProject.mockResolvedValue(true)

      const promise = closeProjectWithTokenGuard(
        switchTokenRef,
        setProjectPath,
        setFiles,
        setExpandedFolders
      )

      // Simulate another operation incrementing the token
      switchTokenRef.current = 10

      const result = await promise

      expect(result).toBe(false)
      expect(setProjectPath).not.toHaveBeenCalled()
    })

    it('should clear all state (path, files, expanded folders)', async () => {
      mockWindowApi.file.closeProject.mockResolvedValue(true)

      await closeProjectWithTokenGuard(
        switchTokenRef,
        setProjectPath,
        setFiles,
        setExpandedFolders
      )

      expect(setProjectPath).toHaveBeenCalledWith(null)
      expect(setFiles).toHaveBeenCalledWith([])
      expect(setExpandedFolders).toHaveBeenCalledWith(expect.any(Set))
      const expandedSet = setExpandedFolders.mock.calls[0][0]
      expect(expandedSet.size).toBe(0)
    })
  })
})
