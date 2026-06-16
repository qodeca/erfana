// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Factory for creating panel managers
 * Provides default implementations using Zustand stores
 */

import { useActivityBarStore } from '../stores/useActivityBarStore'
import { useTerminalStore } from '../stores/useTerminalStore'
import type { IPanelManager, ITerminalManager, PanelManagers } from './panelManager.types'
import { logger } from './logger'

/**
 * Create a panel manager using the ActivityBarStore
 * @returns IPanelManager implementation
 */
export function createPanelManager(): IPanelManager {
  return {
    setActivePanel: (panel, location) => {
      useActivityBarStore.getState().setActivePanel(panel, location)
    }
  }
}

/**
 * Create a terminal manager using the TerminalStore
 * @returns ITerminalManager implementation
 */
export function createTerminalManager(): ITerminalManager {
  return {
    isReady: () => {
      return useTerminalStore.getState().activeTerminalId !== null
    },
    sendToTerminal: async (content, autoExecute = false) => {
      return useTerminalStore.getState().sendToTerminal(content, autoExecute)
    },
    /**
     * Event-based waiting for terminal readiness
     * Uses Zustand subscription for immediate notification when terminal becomes ready.
     * This is more efficient than polling as it reacts immediately to state changes.
     */
    waitForReady: (timeoutMs = 5000) => {
      return new Promise<boolean>((resolve) => {
        // Check if already ready
        if (useTerminalStore.getState().activeTerminalId !== null) {
          resolve(true)
          return
        }

        // Guard flag to prevent double resolution from race between timeout and subscription
        let resolved = false

        // Set up timeout
        const timeoutId = setTimeout(() => {
          if (resolved) return
          resolved = true
          unsubscribe()
          logger.warn('Terminal readiness timeout after ' + timeoutMs + ' ms')
          resolve(false)
        }, timeoutMs)

        // Subscribe to store changes
        const unsubscribe = useTerminalStore.subscribe((state) => {
          if (resolved) return
          if (state.activeTerminalId !== null) {
            resolved = true
            clearTimeout(timeoutId)
            unsubscribe()
            resolve(true)
          }
        })
      })
    }
  }
}

/**
 * Create default panel managers using Zustand stores
 * Use this factory for production code
 * @returns PanelManagers with default implementations
 */
export function createDefaultManagers(): PanelManagers {
  return {
    panelManager: createPanelManager(),
    terminalManager: createTerminalManager()
  }
}
