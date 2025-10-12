import { create } from 'zustand'

interface AiAssistantStore {
  pendingMessage: string | null
  setPendingMessage: (message: string) => void
  clearPendingMessage: () => void
}

/**
 * Store for programmatic AI Assistant message sending
 * Enables cross-component communication (e.g., context menu → chat panel)
 */
export const useAiAssistantStore = create<AiAssistantStore>((set) => ({
  pendingMessage: null,

  setPendingMessage: (message: string) => {
    set({ pendingMessage: message })
  },

  clearPendingMessage: () => {
    set({ pendingMessage: null })
  }
}))
