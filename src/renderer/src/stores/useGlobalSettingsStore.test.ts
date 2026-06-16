// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useGlobalSettingsStore Tests
 *
 * @see Issue #50 - global settings service
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useGlobalSettingsStore } from './useGlobalSettingsStore'
import type { GlobalSettings } from '../../../shared/ipc/global-settings-schema'

// Mock window.api.globalSettings
const mockGlobalSettingsAPI = {
  get: vi.fn(),
  set: vi.fn(),
  reset: vi.fn(),
  onSettingsChanged: vi.fn()
}

// Define window.api in global scope
Object.defineProperty(window, 'api', {
  writable: true,
  value: {
    globalSettings: mockGlobalSettingsAPI
  }
})

describe('useGlobalSettingsStore', () => {
  const mockSettings: GlobalSettings = {
    logging: { level: 'info' }
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset store state
    useGlobalSettingsStore.setState({
      settings: null,
      isLoading: false,
      error: null,
      isInitialized: false,
      wasCorruptionRecovered: false
    })
  })

  describe('Initial state', () => {
    it('has null settings', () => {
      const state = useGlobalSettingsStore.getState()
      expect(state.settings).toBeNull()
    })

    it('has isInitialized false', () => {
      const state = useGlobalSettingsStore.getState()
      expect(state.isInitialized).toBe(false)
    })

    it('has isLoading false', () => {
      const state = useGlobalSettingsStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('has no error', () => {
      const state = useGlobalSettingsStore.getState()
      expect(state.error).toBeNull()
    })

    it('has wasCorruptionRecovered false', () => {
      const state = useGlobalSettingsStore.getState()
      expect(state.wasCorruptionRecovered).toBe(false)
    })
  })

  describe('loadSettings()', () => {
    it('fetches settings via IPC and updates state', async () => {
      mockGlobalSettingsAPI.get.mockResolvedValue({
        success: true,
        settings: mockSettings
      })

      const { loadSettings } = useGlobalSettingsStore.getState()
      await loadSettings()

      const state = useGlobalSettingsStore.getState()
      expect(state.settings).toEqual(mockSettings)
      expect(state.isInitialized).toBe(true)
      expect(state.error).toBeNull()
    })

    it('sets isLoading true during fetch', async () => {
      let resolvePromise: (value: any) => void = () => {}
      const promise = new Promise((resolve) => {
        resolvePromise = resolve
      })

      mockGlobalSettingsAPI.get.mockReturnValue(promise)

      const { loadSettings } = useGlobalSettingsStore.getState()
      const loadPromise = loadSettings()

      // Check loading state during fetch
      expect(useGlobalSettingsStore.getState().isLoading).toBe(true)

      // Resolve the promise
      resolvePromise({ success: true, settings: mockSettings })
      await loadPromise

      // Loading should be false after completion
      expect(useGlobalSettingsStore.getState().isLoading).toBe(false)
    })

    it('handles IPC errors from result.error', async () => {
      mockGlobalSettingsAPI.get.mockResolvedValue({
        success: false,
        error: 'Settings file corrupted'
      })

      const { loadSettings } = useGlobalSettingsStore.getState()
      await loadSettings()

      const state = useGlobalSettingsStore.getState()
      expect(state.error).toBe('Settings file corrupted')
      expect(state.settings).toBeNull()
    })

    it('handles IPC errors from exceptions', async () => {
      const testError = new Error('Network error')
      mockGlobalSettingsAPI.get.mockRejectedValue(testError)

      const { loadSettings } = useGlobalSettingsStore.getState()
      await loadSettings()

      const state = useGlobalSettingsStore.getState()
      expect(state.error).toBe('Network error')
      expect(state.settings).toBeNull()
    })

    it('handles non-Error exceptions', async () => {
      mockGlobalSettingsAPI.get.mockRejectedValue('String error')

      const { loadSettings } = useGlobalSettingsStore.getState()
      await loadSettings()

      const state = useGlobalSettingsStore.getState()
      expect(state.error).toBe('Unknown error')
    })

    it('prevents concurrent calls (guard)', async () => {
      mockGlobalSettingsAPI.get.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ success: true, settings: mockSettings }), 10)
          })
      )

      const { loadSettings } = useGlobalSettingsStore.getState()

      // Start two concurrent loads
      const promise1 = loadSettings()
      const promise2 = loadSettings()

      await Promise.all([promise1, promise2])

      // Should only call IPC once due to guard
      expect(mockGlobalSettingsAPI.get).toHaveBeenCalledTimes(1)
    })

    it('handles missing settings in success response', async () => {
      mockGlobalSettingsAPI.get.mockResolvedValue({
        success: true
        // settings is undefined
      })

      const { loadSettings } = useGlobalSettingsStore.getState()
      await loadSettings()

      const state = useGlobalSettingsStore.getState()
      expect(state.error).toBe('Failed to load settings')
    })
  })

  describe('updateLoggingLevel()', () => {
    beforeEach(() => {
      // Initialize with settings
      useGlobalSettingsStore.setState({
        settings: mockSettings,
        isInitialized: true
      })
    })

    it('optimistically updates state', async () => {
      mockGlobalSettingsAPI.set.mockResolvedValue({ success: true })

      const { updateLoggingLevel } = useGlobalSettingsStore.getState()
      const promise = updateLoggingLevel('debug')

      // Check optimistic update (before IPC completes)
      const stateBeforeIPC = useGlobalSettingsStore.getState()
      expect(stateBeforeIPC.settings?.logging.level).toBe('debug')

      await promise
    })

    it('sends correct IPC call', async () => {
      mockGlobalSettingsAPI.set.mockResolvedValue({ success: true })

      const { updateLoggingLevel } = useGlobalSettingsStore.getState()
      await updateLoggingLevel('warn')

      expect(mockGlobalSettingsAPI.set).toHaveBeenCalledWith('logging', {
        level: 'warn'
      })
    })

    it('rolls back on IPC failure (error result)', async () => {
      mockGlobalSettingsAPI.set.mockResolvedValue({
        success: false,
        error: 'Write failed'
      })

      const { updateLoggingLevel } = useGlobalSettingsStore.getState()
      await updateLoggingLevel('error')

      const state = useGlobalSettingsStore.getState()
      expect(state.settings?.logging.level).toBe('info') // Rolled back
      expect(state.error).toBe('Write failed')
    })

    it('rolls back on IPC exception', async () => {
      const testError = new Error('IPC timeout')
      mockGlobalSettingsAPI.set.mockRejectedValue(testError)

      const { updateLoggingLevel } = useGlobalSettingsStore.getState()
      await updateLoggingLevel('debug')

      const state = useGlobalSettingsStore.getState()
      expect(state.settings?.logging.level).toBe('info') // Rolled back
      expect(state.error).toBe('IPC timeout')
    })

    it('handles non-Error exceptions', async () => {
      mockGlobalSettingsAPI.set.mockRejectedValue('String error')

      const { updateLoggingLevel } = useGlobalSettingsStore.getState()
      await updateLoggingLevel('warn')

      const state = useGlobalSettingsStore.getState()
      expect(state.error).toBe('Unknown error')
    })

    it('does nothing if settings not loaded', async () => {
      useGlobalSettingsStore.setState({ settings: null })

      const { updateLoggingLevel } = useGlobalSettingsStore.getState()
      await updateLoggingLevel('debug')

      expect(mockGlobalSettingsAPI.set).not.toHaveBeenCalled()
    })
  })

  describe('updatePreserveLineBreaks()', () => {
    beforeEach(() => {
      // Initialize with settings
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false }
        },
        isInitialized: true
      })
    })

    it('optimistically updates state', async () => {
      mockGlobalSettingsAPI.set.mockResolvedValue({ success: true })

      const { updatePreserveLineBreaks } = useGlobalSettingsStore.getState()
      const promise = updatePreserveLineBreaks(true)

      // Check optimistic update (before IPC completes)
      const stateBeforeIPC = useGlobalSettingsStore.getState()
      expect(stateBeforeIPC.settings?.editor.preserveLineBreaks).toBe(true)

      await promise
    })

    it('sends correct IPC call', async () => {
      mockGlobalSettingsAPI.set.mockResolvedValue({ success: true })

      const { updatePreserveLineBreaks } = useGlobalSettingsStore.getState()
      await updatePreserveLineBreaks(true)

      expect(mockGlobalSettingsAPI.set).toHaveBeenCalledWith('editor', {
        preserveLineBreaks: true
      })
    })

    it('rolls back on IPC failure (error result)', async () => {
      mockGlobalSettingsAPI.set.mockResolvedValue({
        success: false,
        error: 'Write failed'
      })

      const { updatePreserveLineBreaks } = useGlobalSettingsStore.getState()
      await updatePreserveLineBreaks(true)

      const state = useGlobalSettingsStore.getState()
      expect(state.settings?.editor.preserveLineBreaks).toBe(false) // Rolled back
      expect(state.error).toBe('Write failed')
    })

    it('rolls back on IPC exception', async () => {
      const testError = new Error('IPC timeout')
      mockGlobalSettingsAPI.set.mockRejectedValue(testError)

      const { updatePreserveLineBreaks } = useGlobalSettingsStore.getState()
      await updatePreserveLineBreaks(true)

      const state = useGlobalSettingsStore.getState()
      expect(state.settings?.editor.preserveLineBreaks).toBe(false) // Rolled back
      expect(state.error).toBe('IPC timeout')
    })

    it('handles non-Error exceptions', async () => {
      mockGlobalSettingsAPI.set.mockRejectedValue('String error')

      const { updatePreserveLineBreaks } = useGlobalSettingsStore.getState()
      await updatePreserveLineBreaks(true)

      const state = useGlobalSettingsStore.getState()
      expect(state.error).toBe('Unknown error')
    })

    it('does nothing if settings not loaded', async () => {
      useGlobalSettingsStore.setState({ settings: null })

      const { updatePreserveLineBreaks } = useGlobalSettingsStore.getState()
      await updatePreserveLineBreaks(true)

      expect(mockGlobalSettingsAPI.set).not.toHaveBeenCalled()
    })
  })

  describe('updateGitStatusPollingEnabled()', () => {
    beforeEach(() => {
      // Initialize with settings including gitStatus
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 30000 }
        },
        isInitialized: true
      })
    })

    it('optimistically updates state', async () => {
      mockGlobalSettingsAPI.set.mockResolvedValue({ success: true })

      const { updateGitStatusPollingEnabled } = useGlobalSettingsStore.getState()
      const promise = updateGitStatusPollingEnabled(false)

      // Check optimistic update (before IPC completes)
      const stateBeforeIPC = useGlobalSettingsStore.getState()
      expect(stateBeforeIPC.settings?.gitStatus.pollingEnabled).toBe(false)

      await promise
    })

    it('sends correct IPC call', async () => {
      mockGlobalSettingsAPI.set.mockResolvedValue({ success: true })

      const { updateGitStatusPollingEnabled } = useGlobalSettingsStore.getState()
      await updateGitStatusPollingEnabled(false)

      expect(mockGlobalSettingsAPI.set).toHaveBeenCalledWith('gitStatus', {
        pollingEnabled: false,
        pollingInterval: 30000
      })
    })

    it('rolls back on IPC failure (error result)', async () => {
      mockGlobalSettingsAPI.set.mockResolvedValue({
        success: false,
        error: 'Write failed'
      })

      const { updateGitStatusPollingEnabled } = useGlobalSettingsStore.getState()
      await updateGitStatusPollingEnabled(false)

      const state = useGlobalSettingsStore.getState()
      expect(state.settings?.gitStatus.pollingEnabled).toBe(true) // Rolled back
      expect(state.error).toBe('Write failed')
    })

    it('rolls back on IPC exception', async () => {
      const testError = new Error('IPC timeout')
      mockGlobalSettingsAPI.set.mockRejectedValue(testError)

      const { updateGitStatusPollingEnabled } = useGlobalSettingsStore.getState()
      await updateGitStatusPollingEnabled(false)

      const state = useGlobalSettingsStore.getState()
      expect(state.settings?.gitStatus.pollingEnabled).toBe(true) // Rolled back
      expect(state.error).toBe('IPC timeout')
    })

    it('handles non-Error exceptions', async () => {
      mockGlobalSettingsAPI.set.mockRejectedValue('String error')

      const { updateGitStatusPollingEnabled } = useGlobalSettingsStore.getState()
      await updateGitStatusPollingEnabled(false)

      const state = useGlobalSettingsStore.getState()
      expect(state.error).toBe('Unknown error')
    })

    it('does nothing if settings not loaded', async () => {
      useGlobalSettingsStore.setState({ settings: null })

      const { updateGitStatusPollingEnabled } = useGlobalSettingsStore.getState()
      await updateGitStatusPollingEnabled(false)

      expect(mockGlobalSettingsAPI.set).not.toHaveBeenCalled()
    })
  })

  describe('updateGitStatusPollingInterval()', () => {
    beforeEach(() => {
      // Initialize with settings including gitStatus
      useGlobalSettingsStore.setState({
        settings: {
          logging: { level: 'info' },
          editor: { preserveLineBreaks: false },
          gitStatus: { pollingEnabled: true, pollingInterval: 30000 }
        },
        isInitialized: true
      })
    })

    it('optimistically updates state', async () => {
      mockGlobalSettingsAPI.set.mockResolvedValue({ success: true })

      const { updateGitStatusPollingInterval } = useGlobalSettingsStore.getState()
      const promise = updateGitStatusPollingInterval(60000)

      // Check optimistic update (before IPC completes)
      const stateBeforeIPC = useGlobalSettingsStore.getState()
      expect(stateBeforeIPC.settings?.gitStatus.pollingInterval).toBe(60000)

      await promise
    })

    it('sends correct IPC call', async () => {
      mockGlobalSettingsAPI.set.mockResolvedValue({ success: true })

      const { updateGitStatusPollingInterval } = useGlobalSettingsStore.getState()
      await updateGitStatusPollingInterval(60000)

      expect(mockGlobalSettingsAPI.set).toHaveBeenCalledWith('gitStatus', {
        pollingEnabled: true,
        pollingInterval: 60000
      })
    })

    it('rolls back on IPC failure (error result)', async () => {
      mockGlobalSettingsAPI.set.mockResolvedValue({
        success: false,
        error: 'Write failed'
      })

      const { updateGitStatusPollingInterval } = useGlobalSettingsStore.getState()
      await updateGitStatusPollingInterval(60000)

      const state = useGlobalSettingsStore.getState()
      expect(state.settings?.gitStatus.pollingInterval).toBe(30000) // Rolled back
      expect(state.error).toBe('Write failed')
    })

    it('rolls back on IPC exception', async () => {
      const testError = new Error('IPC timeout')
      mockGlobalSettingsAPI.set.mockRejectedValue(testError)

      const { updateGitStatusPollingInterval } = useGlobalSettingsStore.getState()
      await updateGitStatusPollingInterval(60000)

      const state = useGlobalSettingsStore.getState()
      expect(state.settings?.gitStatus.pollingInterval).toBe(30000) // Rolled back
      expect(state.error).toBe('IPC timeout')
    })

    it('handles non-Error exceptions', async () => {
      mockGlobalSettingsAPI.set.mockRejectedValue('String error')

      const { updateGitStatusPollingInterval } = useGlobalSettingsStore.getState()
      await updateGitStatusPollingInterval(60000)

      const state = useGlobalSettingsStore.getState()
      expect(state.error).toBe('Unknown error')
    })

    it('does nothing if settings not loaded', async () => {
      useGlobalSettingsStore.setState({ settings: null })

      const { updateGitStatusPollingInterval } = useGlobalSettingsStore.getState()
      await updateGitStatusPollingInterval(60000)

      expect(mockGlobalSettingsAPI.set).not.toHaveBeenCalled()
    })
  })

  describe('resetSettings()', () => {
    it('triggers IPC call', async () => {
      mockGlobalSettingsAPI.reset.mockResolvedValue({ success: true })

      const { resetSettings } = useGlobalSettingsStore.getState()
      await resetSettings()

      expect(mockGlobalSettingsAPI.reset).toHaveBeenCalled()
    })

    it('sets isLoading during reset', async () => {
      let resolvePromise: (value: any) => void = () => {}
      const promise = new Promise((resolve) => {
        resolvePromise = resolve
      })

      mockGlobalSettingsAPI.reset.mockReturnValue(promise)

      const { resetSettings } = useGlobalSettingsStore.getState()
      const resetPromise = resetSettings()

      expect(useGlobalSettingsStore.getState().isLoading).toBe(true)

      resolvePromise({ success: true })
      await resetPromise

      expect(useGlobalSettingsStore.getState().isLoading).toBe(false)
    })

    it('handles IPC failure', async () => {
      mockGlobalSettingsAPI.reset.mockResolvedValue({
        success: false,
        error: 'Reset failed'
      })

      const { resetSettings } = useGlobalSettingsStore.getState()
      await resetSettings()

      const state = useGlobalSettingsStore.getState()
      expect(state.error).toBe('Reset failed')
    })

    it('handles IPC exception', async () => {
      const testError = new Error('IPC error')
      mockGlobalSettingsAPI.reset.mockRejectedValue(testError)

      const { resetSettings } = useGlobalSettingsStore.getState()
      await resetSettings()

      const state = useGlobalSettingsStore.getState()
      expect(state.error).toBe('IPC error')
    })

    it('handles non-Error exceptions', async () => {
      mockGlobalSettingsAPI.reset.mockRejectedValue('String error')

      const { resetSettings } = useGlobalSettingsStore.getState()
      await resetSettings()

      const state = useGlobalSettingsStore.getState()
      expect(state.error).toBe('Unknown error')
    })
  })

  describe('_handleSettingsChanged()', () => {
    it('updates state from broadcast', () => {
      const newSettings: GlobalSettings = {
        logging: { level: 'debug' }
      }

      const { _handleSettingsChanged } = useGlobalSettingsStore.getState()
      _handleSettingsChanged(newSettings)

      const state = useGlobalSettingsStore.getState()
      expect(state.settings).toEqual(newSettings)
      expect(state.error).toBeNull()
    })

    it('clears error when settings updated', () => {
      useGlobalSettingsStore.setState({ error: 'Previous error' })

      const newSettings: GlobalSettings = {
        logging: { level: 'warn' }
      }

      const { _handleSettingsChanged } = useGlobalSettingsStore.getState()
      _handleSettingsChanged(newSettings)

      const state = useGlobalSettingsStore.getState()
      expect(state.error).toBeNull()
    })
  })

  describe('clearCorruptionFlag()', () => {
    it('clears wasCorruptionRecovered flag', () => {
      useGlobalSettingsStore.setState({ wasCorruptionRecovered: true })

      const { clearCorruptionFlag } = useGlobalSettingsStore.getState()
      clearCorruptionFlag()

      const state = useGlobalSettingsStore.getState()
      expect(state.wasCorruptionRecovered).toBe(false)
    })

    it('can be called when already false', () => {
      useGlobalSettingsStore.setState({ wasCorruptionRecovered: false })

      const { clearCorruptionFlag } = useGlobalSettingsStore.getState()
      clearCorruptionFlag()

      const state = useGlobalSettingsStore.getState()
      expect(state.wasCorruptionRecovered).toBe(false)
    })
  })
})
