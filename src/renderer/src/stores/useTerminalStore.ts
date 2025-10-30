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
      console.warn('❌ sendToTerminal: No active terminal available')
      return false
    }

    try {
      // Write text to terminal
      const writeResult = await window.api.terminal.write(terminalId, text)

      if (!writeResult.success) {
        console.error(`❌ sendToTerminal: Write failed: ${writeResult.error}`)
        return false
      }

      // If autoExecute is enabled, send Enter key after a short delay
      if (autoExecute) {
        // Wait 200ms to ensure text is rendered in terminal before sending Enter
        // This delay accounts for: PTY buffering (1-20ms) + shell processing (1-50ms)
        // + GPU rendering (10-100ms) + margin for loaded systems
        await new Promise(resolve => setTimeout(resolve, 200))

        // Send Enter key
        const enterResult = await window.api.terminal.write(terminalId, '\r')

        if (!enterResult.success) {
          console.error(`❌ sendToTerminal: Failed to send Enter: ${enterResult.error}`)
          return false
        }
      }

      return true
    } catch (error) {
      console.error('❌ sendToTerminal: Unexpected error:', error)
      return false
    }
  }
}))
