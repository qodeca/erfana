import { create } from 'zustand'

interface TerminalStore {
  // Active terminal ID (null if no terminal is active)
  activeTerminalId: string | null

  // Actions
  setActiveTerminalId: (id: string | null) => void
  getActiveTerminalId: () => string | null
  sendToTerminal: (text: string) => Promise<boolean>
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  activeTerminalId: null,

  setActiveTerminalId: (id) => {
    console.log(`📝 Terminal store: Setting active terminal ID to ${id}`)
    set({ activeTerminalId: id })
  },

  getActiveTerminalId: () => {
    return get().activeTerminalId
  },

  sendToTerminal: async (text: string): Promise<boolean> => {
    const terminalId = get().activeTerminalId

    if (!terminalId) {
      console.warn('❌ No active terminal available')
      return false
    }

    try {
      // Check if terminal is available
      const availabilityResult = await window.api.terminal.isAvailable()
      if (!availabilityResult.available) {
        console.warn('❌ Terminal not available')
        return false
      }

      // Send text to terminal
      window.api.terminal.write(terminalId, text)
      console.log(`✅ Sent ${text.length} characters to terminal ${terminalId}`)
      return true
    } catch (error) {
      console.error('❌ Failed to send text to terminal:', error)
      return false
    }
  }
}))
