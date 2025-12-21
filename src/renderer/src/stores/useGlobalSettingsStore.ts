import { create } from 'zustand'
import type { GlobalSettings, LoggingLevel } from '../../../shared/ipc/global-settings-schema'

interface GlobalSettingsState {
  // State
  settings: GlobalSettings | null
  isLoading: boolean
  error: string | null
  isInitialized: boolean

  // Flag for corruption recovery notification
  wasCorruptionRecovered: boolean

  // Actions
  loadSettings: () => Promise<void>
  updateLoggingLevel: (level: LoggingLevel) => Promise<void>
  resetSettings: () => Promise<void>
  clearCorruptionFlag: () => void

  // Internal - called by IPC listener
  _handleSettingsChanged: (settings: GlobalSettings) => void
}

export const useGlobalSettingsStore = create<GlobalSettingsState>((set, get) => ({
  settings: null,
  isLoading: false,
  error: null,
  isInitialized: false,
  wasCorruptionRecovered: false,

  loadSettings: async () => {
    if (get().isLoading) return

    set({ isLoading: true, error: null })
    try {
      const result = await window.api.globalSettings.get()
      if (result.success && result.settings) {
        set({ settings: result.settings, isInitialized: true })
      } else {
        set({ error: result.error || 'Failed to load settings' })
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      set({ isLoading: false })
    }
  },

  updateLoggingLevel: async (level: LoggingLevel) => {
    const currentSettings = get().settings
    if (!currentSettings) return

    // Optimistic update
    const previousSettings = currentSettings
    set({
      settings: {
        ...currentSettings,
        logging: { ...currentSettings.logging, level }
      }
    })

    try {
      const result = await window.api.globalSettings.set('logging', {
        ...currentSettings.logging,
        level
      })
      if (!result.success) {
        // Rollback on failure
        set({ settings: previousSettings, error: result.error })
      }
    } catch (error) {
      set({
        settings: previousSettings,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  },

  resetSettings: async () => {
    set({ isLoading: true })
    try {
      const result = await window.api.globalSettings.reset()
      if (!result.success) {
        set({ error: result.error })
      }
      // Settings will update via onSettingsChanged listener
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      set({ isLoading: false })
    }
  },

  clearCorruptionFlag: () => {
    set({ wasCorruptionRecovered: false })
  },

  _handleSettingsChanged: (settings: GlobalSettings) => {
    set({ settings, error: null })
  }
}))
