import { create } from 'zustand'

interface CopilotStore {
  pendingMessage: string | null
  shouldSendImmediately: boolean
  setPendingMessage: (message: string, sendImmediately?: boolean) => void
  clearPendingMessage: () => void
}

/**
 * Store for programmatic Copilot message sending
 * Enables cross-component communication (e.g., context menu → copilot panel)
 *
 * Note: Currently routes to Claude Code backend via window.api.claudeCode
 */
export const useCopilotStore = create<CopilotStore>((set) => ({
  pendingMessage: null,
  shouldSendImmediately: false,

  setPendingMessage: (message: string, sendImmediately = false) => {
    set({ pendingMessage: message, shouldSendImmediately: sendImmediately })
  },

  clearPendingMessage: () => {
    set({ pendingMessage: null, shouldSendImmediately: false })
  }
}))
