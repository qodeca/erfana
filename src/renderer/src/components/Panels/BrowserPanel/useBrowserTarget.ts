// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A browser tab's target terminal (spec 025, 025-FR-061; solution design
 * § 9.4; commit 19): the project's most recently focused terminal – Erfana
 * has one terminal panel, so that is its one live terminal – and what runs
 * in front in it, read main-side (`targetStatus`, never trusted from the
 * renderer).
 *
 * Main answers from a process snapshot it may not have yet (Windows, design
 * Q8): an answer with `fresh: false` is asked again after
 * {@link TARGET_REASK_MS}, up to {@link TARGET_REASK_LIMIT} times, so the
 * toolbar settles on the real foreground. `refresh()` asks again now – the
 * panel calls it as it opens, so its pre-warning is current; the shell guard
 * itself always runs again in main at send.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTerminalStore } from '../../../stores/useTerminalStore'
import { browserTabGateway } from '../../../services/browserTabGateway'
import { logger } from '../../../utils/logger'
import { targetView, type TargetStatus, type TargetView } from './pickRow.logic'

/** The name the one terminal panel goes by in the target's words. */
export const TERMINAL_NAME = 'Terminal'
/** Wait before asking again after a `fresh: false` answer. */
export const TARGET_REASK_MS = 1000
/** Most re-asks for one terminal before the answer stands. */
export const TARGET_REASK_LIMIT = 5

/** The target as the pick row, panel and dialog use it. */
export interface BrowserTarget {
  /** The terminal's id, or `null` when none is open. */
  readonly terminalId: string | null
  /** Its name, or `null` when none is open. */
  readonly terminalName: string | null
  readonly status: TargetStatus
  readonly view: TargetView
  /** Ask main again now. */
  readonly refresh: () => void
}

/**
 * Follows the target terminal and its foreground.
 *
 * @returns {@link BrowserTarget}
 */
export function useBrowserTarget(): BrowserTarget {
  const terminalId = useTerminalStore(s => s.activeTerminalId)
  const [status, setStatus] = useState<{ id: string; value: TargetStatus } | null>(null)
  /** Bumped by `refresh()`: the effect asks again from the start. */
  const [asking, setAsking] = useState(0)

  useEffect(() => {
    if (terminalId === null) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const ask = (reasks: number): void => {
      browserTabGateway
        .targetStatus(terminalId)
        .then(answer => {
          if (!live) return
          setStatus({ id: terminalId, value: { kind: answer.kind, process: answer.process } })
          if (answer.fresh || reasks >= TARGET_REASK_LIMIT) return
          timer = setTimeout(() => ask(reasks + 1), TARGET_REASK_MS)
        })
        .catch((error: unknown) => {
          logger.warn('Browser target status failed', { error: error instanceof Error ? error.message : String(error) })
        })
    }
    ask(0)
    return () => {
      live = false
      if (timer !== null) clearTimeout(timer)
    }
  }, [terminalId, asking])

  const refresh = useCallback(() => setAsking(n => n + 1), [])

  const current = terminalId !== null && status?.id === terminalId ? status.value : null
  const terminalName = terminalId === null ? null : TERMINAL_NAME
  return { terminalId, terminalName, status: current, view: targetView(terminalName, current), refresh }
}
