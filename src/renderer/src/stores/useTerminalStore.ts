import { create } from 'zustand'

interface TerminalStore {
  // Active terminal ID (null if no terminal is active)
  activeTerminalId: string | null
  activityById: Map<string, number>
  userInputById: Map<string, number>

  // Actions
  setActiveTerminalId: (id: string | null) => void
  getActiveTerminalId: () => string | null
  markActivity: (id: string) => void
  clearActivity: (id: string) => void
  isRecentlyActive: (windowMs?: number) => boolean
  isRecentlyActiveId: (id: string, windowMs?: number) => boolean
  markUserInput: (id: string) => void
  hasUserInteracted: () => boolean
  sendToTerminal: (text: string, autoExecute?: boolean) => Promise<boolean>
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  activeTerminalId: null,
  activityById: new Map<string, number>(),
  userInputById: new Map<string, number>(),

  setActiveTerminalId: (id) => {
    console.log(`📝 Terminal store: Setting active terminal ID to ${id}`)
    set({ activeTerminalId: id })
  },

  getActiveTerminalId: () => {
    return get().activeTerminalId
  },

  markActivity: (id: string) => {
    const map = new Map(get().activityById)
    map.set(id, Date.now())
    set({ activityById: map })
  },

  clearActivity: (id: string) => {
    const map = new Map(get().activityById)
    map.delete(id)
    set({ activityById: map })
  },

  isRecentlyActive: (windowMs = 3000) => {
    const id = get().activeTerminalId
    if (!id) return false
    const ts = get().activityById.get(id)
    if (!ts) return false
    return Date.now() - ts <= windowMs
  },

  isRecentlyActiveId: (id: string, windowMs = 3000) => {
    const ts = get().activityById.get(id)
    if (!ts) return false
    return Date.now() - ts <= windowMs
  },

  markUserInput: (id: string) => {
    const map = new Map(get().userInputById)
    map.set(id, Date.now())
    set({ userInputById: map })
  },

  hasUserInteracted: () => {
    const id = get().activeTerminalId
    if (!id) return false
    return get().userInputById.has(id)
  },

  sendToTerminal: async (text: string, autoExecute = false): Promise<boolean> => {
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

      // If autoExecute is enabled, simulate pressing Enter
      if (autoExecute) {
        // Small delay to ensure text is written before Enter
        await new Promise(resolve => setTimeout(resolve, 100))
        // Send carriage return - this is the standard Enter key for terminals
        window.api.terminal.write(terminalId, '\r')
        console.log('⏎ Auto-executed command in terminal')
      }

      return true
    } catch (error) {
      console.error('❌ Failed to send text to terminal:', error)
      return false
    }
  }
}))
