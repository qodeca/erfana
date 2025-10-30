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

    console.log(`📝 sendToTerminal: text length=${text.length}, autoExecute=${autoExecute}, terminalId=${terminalId}`)

    try {
      // Wait for terminal to be fully initialized with polling
      const maxWait = 5000 // 5 seconds max wait
      const pollInterval = 50 // Check every 50ms
      const startTime = Date.now()

      console.log(`⏱️ sendToTerminal: Waiting for terminal initialization...`)

      while (Date.now() - startTime < maxWait) {
        try {
          const availabilityResult = await window.api.terminal.isAvailable(terminalId)

          if (!availabilityResult.available) {
            console.warn('❌ sendToTerminal: Terminal not available')
            return false
          }

          if (availabilityResult.initialized) {
            console.log(`✅ sendToTerminal: Terminal initialized (waited ${Date.now() - startTime}ms)`)
            break
          }

          // Still initializing, wait a bit more
          await new Promise(resolve => setTimeout(resolve, pollInterval))
        } catch (error) {
          console.error('❌ sendToTerminal: Error checking availability during polling:', error)
          return false
        }
      }

      // Final check after timeout
      const finalCheck = await window.api.terminal.isAvailable(terminalId)
      if (!finalCheck.available) {
        console.error('❌ sendToTerminal: Terminal became unavailable during wait')
        return false
      }
      if (!finalCheck.initialized) {
        // For autoExecute, fail hard to prevent command corruption
        // For manual writes, proceed with warning (user may want to send text anyway)
        if (autoExecute) {
          console.error(`❌ sendToTerminal: Terminal not initialized after ${maxWait}ms, aborting autoExecute to prevent command corruption`)
          return false
        }
        console.warn(`⚠️ sendToTerminal: Terminal not initialized after ${maxWait}ms, proceeding anyway (manual write)`)
      }

      // AWAIT the write operation to ensure it completes
      console.log(`📤 sendToTerminal: Writing ${text.length} characters...`)
      const writeResult = await window.api.terminal.write(terminalId, text)

      if (!writeResult.success) {
        console.error(`❌ sendToTerminal: Write failed: ${writeResult.error}`)
        return false
      }

      console.log(`✅ sendToTerminal: Text written successfully`)

      // If autoExecute is enabled, send Enter key
      if (autoExecute) {
        // Wait 200ms to ensure text rendering is complete before Enter
        // This is more conservative than the previous 100ms
        console.log(`⏱️ sendToTerminal: Waiting 200ms before sending Enter...`)
        await new Promise(resolve => setTimeout(resolve, 200))

        // AWAIT the Enter key write
        console.log(`⏎ sendToTerminal: Sending Enter key...`)
        const enterResult = await window.api.terminal.write(terminalId, '\r')

        if (!enterResult.success) {
          console.error(`❌ sendToTerminal: Failed to send Enter: ${enterResult.error}`)
          return false
        }

        console.log('✅ sendToTerminal: Auto-executed command (Enter sent)')
      }

      return true
    } catch (error) {
      console.error('❌ sendToTerminal: Unexpected error:', error)
      return false
    }
  }
}))
