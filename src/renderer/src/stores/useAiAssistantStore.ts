import { create } from 'zustand'

interface AiAssistantStore {
  pendingMessage: string | null
  shouldSendImmediately: boolean
  setPendingMessage: (message: string, sendImmediately?: boolean) => void
  clearPendingMessage: () => void
}

/**
 * Store for programmatic AI Assistant message sending
 * Enables cross-component communication (e.g., context menu → chat panel)
 */
export const useAiAssistantStore = create<AiAssistantStore>((set) => ({
  pendingMessage: null,
  shouldSendImmediately: false,

  setPendingMessage: (message: string, sendImmediately = false) => {
    set({ pendingMessage: message, shouldSendImmediately: sendImmediately })
  },

  clearPendingMessage: () => {
    set({ pendingMessage: null, shouldSendImmediately: false })
  }
}))
