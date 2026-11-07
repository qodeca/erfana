// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { ITerminalOperations } from '../interfaces/ITerminalOperations'
import { logger } from '../utils/logger'
import { terminalGateway } from '../services/terminalGateway'
import type { ShellKind } from '../../../shared/shellKind'
import { formatPathsForTerminal, platformDefaultShellKind } from '../utils/shellPathEscape'
import { stripControlCharacters, toBracketedPaste } from '../utils/bracketedPaste'
import { waitForInputToSettle } from './terminalInputSettle'

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
  /**
   * Record that a terminal printed output. Called for every output batch, so it
   * writes a plain map, not store state: nothing re-renders on it. Read only by
   * `sendToTerminal` and `sendToTerminalId`, to know when a paste has been taken.
   */
  noteOutput: (id: string) => void
  sendToTerminal: (text: string, autoExecute?: boolean) => Promise<boolean>
  /**
   * Type a prompt into the named terminal (active or not): control characters
   * except line breaks removed, one bracketed paste, then Enter once the paste
   * has settled. Queued behind any other send to the same terminal, like
   * `sendToTerminal` (#449). False when the id is empty, nothing is left to
   * send, or a write fails.
   */
  sendToTerminalId: (terminalId: string, text: string) => Promise<boolean>

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
  // Not store state: written on every output batch, read only while a send waits
  const lastOutputById = new Map<string, number>()
  // The send in progress for each terminal. Sends to one terminal run one at a
  // time: a second prompt pasted while the first one's Enter is still waiting
  // would otherwise land in the prompt box first, so the first Enter submits
  // both prompts as one and the second Enter an empty one (#449)
  const sendQueueById = new Map<string, Promise<boolean>>()

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
    lastOutputById.delete(id)
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

  noteOutput: (id: string) => {
    lastOutputById.set(id, Date.now())
  },

  sendToTerminal: (text: string, autoExecute = false): Promise<boolean> => {
    const terminalId = get().activeTerminalId

    // Debug logging for issue #41
    logger.info(`sendToTerminal: autoExecute=${autoExecute}, terminalId=${terminalId}, textLength=${text.length}`)

    if (!terminalId) {
      logger.warn('sendToTerminal: No active terminal available')
      return Promise.resolve(false)
    }

    // For multi-line text, wrap in bracketed paste mode so the receiving
    // terminal program (e.g. Claude CLI) treats it as a single paste event
    // rather than character-by-character input. Convert line endings to \r
    // (the standard terminal input line ending – Enter key sends \r).
    // Uses the same bracketed paste protocol that xterm.js uses for clipboard pastes.
    const isMultiLine = /[\r\n]/.test(text)
    const textToWrite = isMultiLine
      ? `\x1b[200~${text.replace(/\r?\n/g, '\r')}\x1b[201~`
      : text

    return enqueueSend(terminalId, () => sendNow(get, terminalId, textToWrite, autoExecute, 'sendToTerminal'))
  },

  sendToTerminalId: (terminalId: string, text: string): Promise<boolean> => {
    if (!terminalId) {
      logger.warn('sendToTerminalId: No terminal id given')
      return Promise.resolve(false)
    }
    if (stripControlCharacters(text).trim() === '') {
      logger.warn(`sendToTerminalId: Nothing to send to ${terminalId}`)
      return Promise.resolve(false)
    }

    const paste = toBracketedPaste(text)
    return enqueueSend(terminalId, () => sendNow(get, terminalId, paste, true, 'sendToTerminalId'))
  },

  // Scroll lock state - ephemeral, resets on app restart
  scrollLocked: false,

  setScrollLocked: (locked: boolean) => {
    logger.info(`Scroll lock: ${locked ? 'ON' : 'OFF'}`)
    set({ scrollLocked: locked })
  }
  }))

  /**
   * Run `send` once the previous send to `terminalId` – its Enter included – has
   * finished (none pending: start at once, so a lone send writes in the same
   * tick). `send` must not reject, or every later send to that terminal would.
   */
  function enqueueSend(terminalId: string, send: () => Promise<boolean>): Promise<boolean> {
    const previous = sendQueueById.get(terminalId)
    const queued = previous ? previous.then(send) : send()
    sendQueueById.set(terminalId, queued)
    void queued.finally(() => {
      if (sendQueueById.get(terminalId) === queued) sendQueueById.delete(terminalId)
    })
    return queued
  }

  /**
   * Write one send to `terminalId` – `data` as given, then Enter when
   * `autoExecute` – never throwing. `label` names the caller in the log.
   */
  async function sendNow(
    get: () => TerminalStore,
    terminalId: string,
    data: string,
    autoExecute: boolean,
    label: string
  ): Promise<boolean> {
    try {
      const writeResult = await terminalOps.write(terminalId, data)
      const writtenAt = Date.now()

      if (!writeResult.success) {
        logger.error(`${label}: Write failed: ${writeResult.error}`)
        return false
      }

      // Programmatic input counts as user input: a prompt the app sent on the
      // user's behalf (prompt sends, drag-and-drop, ProjectTree actions) starts
      // work just as typing does, and the restart and quit guards must see it.
      get().markUserInput(terminalId)
      get().markActivity(terminalId)

      // Enter goes once the program has taken the paste, not on a fixed timer:
      // written too early it reaches the program in the same read as the end of
      // a long paste and counts as a line break in it (#449, terminalInputSettle.ts)
      if (autoExecute) {
        const reason = await waitForInputToSettle(() => lastOutputById.get(terminalId), writtenAt)
        logger.info(`${label}: sending Enter (${reason}) ${Date.now() - writtenAt} ms after the text`)

        // Send Enter key (carriage return)
        const enterResult = await terminalOps.write(terminalId, '\r')

        if (!enterResult.success) {
          logger.error(`${label}: Failed to send Enter: ${enterResult.error}`)
          return false
        }
        logger.info(`${label}: Enter sent successfully`)
      }

      logger.info(`${label}: Write successful`)
      return true
    } catch (error) {
      logger.error(`${label}: Unexpected error`, error instanceof Error ? error : undefined)
      return false
    }
  }
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
