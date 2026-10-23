// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { ITerminalOperations } from '../interfaces/ITerminalOperations'
import { logger } from '../utils/logger'
import { terminalGateway } from '../services/terminalGateway'
import type { ShellKind } from '../../../shared/shellKind'
import { formatPathsForTerminal, platformDefaultShellKind } from '../utils/shellPathEscape'

/** Shortest gap between two recorded activity timestamps for one terminal. */
export const ACTIVITY_THROTTLE_MS = 250

interface TerminalStore {
  // Active terminal ID (null if no terminal is active)
  activeTerminalId: string | null
  // Quoting flavour of the active terminal's shell (null until it is known)
  activeShellKind: ShellKind | null
  activityById: Map<string, number>
  userInputById: Map<string, number>

  // Actions
  setActiveTerminalId: (id: string | null) => void
  getActiveTerminalId: () => string | null
  /** Set the active terminal and its shell kind together, so they cannot drift apart. */
  setActiveTerminal: (terminal: { id: string; shellKind: ShellKind | null } | null) => void
  /** Quote paths for the active terminal's own shell (platform default until known). */
  formatPathsForActiveTerminal: (paths: string[]) => string
  markActivity: (id: string) => void
  clearActivity: (id: string) => void
  isRecentlyActive: (windowMs?: number) => boolean
  isRecentlyActiveId: (id: string, windowMs?: number) => boolean
  markUserInput: (id: string) => void
  hasUserInteracted: () => boolean
  sendToTerminal: (text: string, autoExecute?: boolean) => Promise<boolean>

  // Scroll lock state (global - affects all terminals)
  scrollLocked: boolean
  setScrollLocked: (locked: boolean) => void
}

/**
 * Factory function to create terminal store with injected terminal operations
 * Enables dependency injection and testing
 */
export function createTerminalStore(
  terminalOps: ITerminalOperations
): UseBoundStore<StoreApi<TerminalStore>> {
  return create<TerminalStore>((set, get) => ({
  activeTerminalId: null,
  activeShellKind: null,
  activityById: new Map<string, number>(),
  userInputById: new Map<string, number>(),

  setActiveTerminalId: (id) => {
    logger.info(`Terminal store: Setting active terminal ID to ${id}`)
    // A kind recorded for another terminal must not outlive it
    set(id === get().activeTerminalId ? { activeTerminalId: id } : { activeTerminalId: id, activeShellKind: null })
  },

  getActiveTerminalId: () => {
    return get().activeTerminalId
  },

  setActiveTerminal: (terminal) => {
    logger.info(`Terminal store: Setting active terminal to ${terminal?.id ?? null}`)
    set({ activeTerminalId: terminal?.id ?? null, activeShellKind: terminal?.shellKind ?? null })
  },

  formatPathsForActiveTerminal: (paths) => {
    return formatPathsForTerminal(paths, get().activeShellKind ?? platformDefaultShellKind())
  },

  // Called for every batch of output, so a flood would clone the Map and notify
  // every subscriber hundreds of times a second. The readers compare against
  // windows of seconds, so a timestamp up to ACTIVITY_THROTTLE_MS old is as good.
  markActivity: (id: string) => {
    const now = Date.now()
    const previous = get().activityById.get(id)
    if (previous !== undefined && now >= previous && now - previous < ACTIVITY_THROTTLE_MS) return
    const map = new Map(get().activityById)
    map.set(id, now)
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

    // Debug logging for issue #41
    logger.info(`sendToTerminal: autoExecute=${autoExecute}, terminalId=${terminalId}, textLength=${text.length}`)

    if (!terminalId) {
      logger.warn('sendToTerminal: No active terminal available')
      return false
    }

    try {
      // For multi-line text, wrap in bracketed paste mode so the receiving
      // terminal program (e.g. Claude CLI) treats it as a single paste event
      // rather than character-by-character input. Convert line endings to \r
      // (the standard terminal input line ending – Enter key sends \r).
      // Uses the same bracketed paste protocol that xterm.js uses for clipboard pastes.
      const isMultiLine = /[\r\n]/.test(text)
      const textToWrite = isMultiLine
        ? `\x1b[200~${text.replace(/\r?\n/g, '\r')}\x1b[201~`
        : text

      // Write text to terminal using injected terminal operations
      const writeResult = await terminalOps.write(terminalId, textToWrite)

      if (!writeResult.success) {
        logger.error(`sendToTerminal: Write failed: ${writeResult.error}`)
        return false
      }

      // Programmatic input counts as user input: a prompt the app sent on the
      // user's behalf (prompt sends, drag-and-drop, ProjectTree actions) starts
      // work just as typing does, and the restart and quit guards must see it.
      get().markUserInput(terminalId)
      get().markActivity(terminalId)

      // If autoExecute is enabled, send Enter key after a short delay
      // IMPORTANT: The 200ms delay is REQUIRED - atomic writes don't work reliably
      // This accounts for: PTY buffering + shell line discipline processing + rendering
      // See: https://xtermjs.org/docs/guides/flowcontrol/
      if (autoExecute) {
        logger.info(`sendToTerminal: autoExecute=true, waiting 200ms before sending Enter`)
        await new Promise(resolve => setTimeout(resolve, 200))

        // Send Enter key (carriage return)
        const enterResult = await terminalOps.write(terminalId, '\r')

        if (!enterResult.success) {
          logger.error(`sendToTerminal: Failed to send Enter: ${enterResult.error}`)
          return false
        }
        logger.info(`sendToTerminal: Enter sent successfully`)
      }

      logger.info(`sendToTerminal: Write successful`)
      return true
    } catch (error) {
      logger.error('sendToTerminal: Unexpected error', error instanceof Error ? error : undefined)
      return false
    }
  },

  // Scroll lock state - ephemeral, resets on app restart
  scrollLocked: false,

  setScrollLocked: (locked: boolean) => {
    logger.info(`Scroll lock: ${locked ? 'ON' : 'OFF'}`)
    set({ scrollLocked: locked })
  }
  }))
}

// Default instance using window.api for backward compatibility
// TODO: Remove after all consumers use dependency injection
// Lazy initialization to avoid accessing window.api at module load time
let _defaultStore: ReturnType<typeof createTerminalStore> | null = null

function getDefaultStore() {
  if (!_defaultStore) {
    _defaultStore = createTerminalStore(terminalGateway)
  }
  return _defaultStore
}

// Export as a proxy to enable lazy initialization
// The Proxy needs to support both function calls (for hook usage) and property access
export const useTerminalStore = new Proxy(
  function(...args: Parameters<ReturnType<typeof createTerminalStore>>) {
    // When called as a hook, forward to the real store
    return getDefaultStore()(...args)
  } as ReturnType<typeof createTerminalStore>,
  {
    get(_target, prop) {
      // When accessing properties, get from the real store
      return getDefaultStore()[prop as keyof ReturnType<typeof createTerminalStore>]
    }
  }
)
