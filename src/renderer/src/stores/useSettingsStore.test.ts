// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from './useSettingsStore'

describe('useSettingsStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useSettingsStore.setState({
      isOpen: false
    })
  })

  describe('Initial state', () => {
    it('initializes with isOpen: false', () => {
      const state = useSettingsStore.getState()
      expect(state.isOpen).toBe(false)
    })
  })

  describe('openSettings', () => {
    it('sets isOpen to true', () => {
      const { openSettings } = useSettingsStore.getState()

      openSettings()

      const state = useSettingsStore.getState()
      expect(state.isOpen).toBe(true)
    })

    it('can be called multiple times without error', () => {
      const { openSettings } = useSettingsStore.getState()

      openSettings()
      openSettings()

      const state = useSettingsStore.getState()
      expect(state.isOpen).toBe(true)
    })
  })

  describe('closeSettings', () => {
    it('sets isOpen to false', () => {
      const { openSettings, closeSettings } = useSettingsStore.getState()

      // First open
      openSettings()
      expect(useSettingsStore.getState().isOpen).toBe(true)

      // Then close
      closeSettings()
      expect(useSettingsStore.getState().isOpen).toBe(false)
    })

    it('can be called when already closed', () => {
      const { closeSettings } = useSettingsStore.getState()

      closeSettings()

      const state = useSettingsStore.getState()
      expect(state.isOpen).toBe(false)
    })
  })

  describe('Toggle behavior', () => {
    it('can toggle between open and close states', () => {
      const { openSettings, closeSettings } = useSettingsStore.getState()

      // Initially closed
      expect(useSettingsStore.getState().isOpen).toBe(false)

      // Open
      openSettings()
      expect(useSettingsStore.getState().isOpen).toBe(true)

      // Close
      closeSettings()
      expect(useSettingsStore.getState().isOpen).toBe(false)

      // Open again
      openSettings()
      expect(useSettingsStore.getState().isOpen).toBe(true)
    })

    it('maintains state across multiple get calls', () => {
      const { openSettings } = useSettingsStore.getState()

      openSettings()

      // Multiple getState calls should return same value
      expect(useSettingsStore.getState().isOpen).toBe(true)
      expect(useSettingsStore.getState().isOpen).toBe(true)
      expect(useSettingsStore.getState().isOpen).toBe(true)
    })
  })
})
