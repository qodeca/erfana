// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The built-in browser's **Open terminal** (spec 025, 025-FR-061): start a new
 * terminal in the terminal panel once the current one's shell has exited, and
 * do nothing while it runs.
 *
 * The new terminal comes from the panel's own restart (the portal's
 * `terminalControls.restart`), which asks first only when the terminal looks
 * busy – an exited one never does, its activity is cleared at the exit – and
 * which never moves keyboard focus.
 *
 * @module TerminalPanel/hooks/useStartIfGone
 */
import { useCallback, useEffect, useRef } from 'react'
import { terminalGateway } from '../../../../services/terminalGateway'
import { useLatestRef } from '../../../../hooks/useLatestRef'

/**
 * Track whether `terminalId`'s shell has exited and offer to start a new one.
 *
 * @param terminalId - The terminal to watch, or `null` while there is none
 * @param restart - Starts a new terminal in place of the current one (the panel's restart)
 * @returns Calls `restart` and resolves `true` when the shell had exited; resolves `false`, doing nothing, otherwise
 *   – while it runs, while a start is already under way, or without a terminal
 */
export function useStartIfGone(terminalId: string | null, restart: () => Promise<void>): () => Promise<boolean> {
  const exitedRef = useRef(false)
  const startingRef = useRef(false)
  const restartRef = useLatestRef(restart)

  useEffect(() => {
    exitedRef.current = false
    if (terminalId === null) return
    return terminalGateway.onExit((data) => {
      if (data.terminalId === terminalId) exitedRef.current = true
    })
  }, [terminalId])

  return useCallback(async (): Promise<boolean> => {
    if (!exitedRef.current || startingRef.current) return false
    exitedRef.current = false
    startingRef.current = true
    try {
      await restartRef.current()
      return true
    } finally {
      startingRef.current = false
    }
  }, [restartRef])
}
