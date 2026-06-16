// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { create } from 'zustand'
import type { GlobalSettings, LoggingLevel } from '../../../shared/ipc/global-settings-schema'
import type { TranscriptionBackend, WhisperModel } from '../../../shared/ipc/transcription-schema'

/**
 * Helper type for setting section keys
 * (Issue #74 review fix - reduces repetition in update methods)
 */
type SettingSection = keyof GlobalSettings

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
  updatePreserveLineBreaks: (enabled: boolean) => Promise<void>
  updateGitStatusPollingEnabled: (enabled: boolean) => Promise<void>
  updateGitStatusPollingInterval: (interval: number) => Promise<void>
  updateTranscriptionBackend: (backend: TranscriptionBackend) => Promise<void>
  updateWhisperModel: (model: WhisperModel) => Promise<void>
  resetSettings: () => Promise<void>
  clearCorruptionFlag: () => void

  // Internal - called by IPC listener
  _handleSettingsChanged: (settings: GlobalSettings) => void
  // Internal - generic update helper (Issue #74 review fix)
  _updateSection: <S extends SettingSection>(
    section: S,
    updater: (current: GlobalSettings[S]) => GlobalSettings[S]
  ) => Promise<void>
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

  // Update methods refactored to use _updateSection helper (Issue #74 review fix)
  updateLoggingLevel: async (level: LoggingLevel) => {
    await get()._updateSection('logging', (current) => ({ ...current, level }))
  },

  updatePreserveLineBreaks: async (enabled: boolean) => {
    await get()._updateSection('editor', (current) => ({ ...current, preserveLineBreaks: enabled }))
  },

  updateGitStatusPollingEnabled: async (enabled: boolean) => {
    await get()._updateSection('gitStatus', (current) => ({ ...current, pollingEnabled: enabled }))
  },

  updateGitStatusPollingInterval: async (interval: number) => {
    await get()._updateSection('gitStatus', (current) => ({ ...current, pollingInterval: interval }))
  },

  updateTranscriptionBackend: async (backend: TranscriptionBackend) => {
    await get()._updateSection('transcription', (current) => ({ ...current, backend }))
  },

  updateWhisperModel: async (model: WhisperModel) => {
    await get()._updateSection('transcription', (current) => ({ ...current, whisperModel: model }))
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
  },

  /**
   * Generic helper for optimistic settings updates with rollback
   * (Issue #74 review fix - reduces code duplication in update methods)
   */
  _updateSection: async <S extends SettingSection>(
    section: S,
    updater: (current: GlobalSettings[S]) => GlobalSettings[S]
  ): Promise<void> => {
    const currentSettings = get().settings
    if (!currentSettings) return

    // Compute new section value
    const newSectionValue = updater(currentSettings[section])

    // Optimistic update
    const previousSettings = currentSettings
    set({
      settings: {
        ...currentSettings,
        [section]: newSectionValue
      }
    })

    try {
      const result = await window.api.globalSettings.set(section, newSectionValue)
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
  }
}))
