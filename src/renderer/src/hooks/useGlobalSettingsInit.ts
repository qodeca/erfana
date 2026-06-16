// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useEffect } from 'react'
import { useGlobalSettingsStore } from '../stores/useGlobalSettingsStore'

/**
 * Initialize global settings store and subscribe to changes from main process.
 * Call this once at app root level (App.tsx).
 */
export function useGlobalSettingsInit(): void {
  const loadSettings = useGlobalSettingsStore((state) => state.loadSettings)
  const _handleSettingsChanged = useGlobalSettingsStore((state) => state._handleSettingsChanged)
  const isInitialized = useGlobalSettingsStore((state) => state.isInitialized)

  useEffect(() => {
    // Load settings on mount (only once)
    if (!isInitialized) {
      loadSettings()
    }
  }, [isInitialized, loadSettings])

  useEffect(() => {
    // Subscribe to settings changes from main process
    const unsubscribe = window.api.globalSettings.onSettingsChanged((data) => {
      _handleSettingsChanged(data.settings)
    })

    return () => unsubscribe()
  }, [_handleSettingsChanged])
}
