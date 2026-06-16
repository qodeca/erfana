// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Per-terminal Claude Code context-status store (issue #216).
 *
 * Holds the latest display-only snapshot for each terminal panel keyed by
 * `terminalId`. A single global subscription (set up once at an always-mounted
 * root — see `AppContent` in `App.tsx`) pushes change payloads here via
 * {@link useClaudeStatusStore.getState}().setSnapshot; each `ClaudeStatusBar`
 * subscribes to only its own slice via {@link useClaudeStatus}.
 *
 * The map is updated immutably per key (clone-then-set) so Zustand's reference
 * equality fires only for the affected terminal — components reading other
 * terminals are not re-rendered (arch §10 "store selector contract").
 *
 * @see Issue #216 - Per-terminal Claude Code context status bar
 * @see docs/designs/216-claude-status-bar.md §10
 */
import { create } from 'zustand'
import type {
  ClaudeStatusChangePayload,
  ClaudeStatusSnapshot
} from '../../../shared/ipc/claude-status-schema'

/**
 * State shape for the Claude-status store.
 */
interface ClaudeStatusState {
  /**
   * Latest snapshot per terminal. A `null` value means the bar should hide
   * for that terminal (fail-closed); absence of a key means never-registered.
   */
  byTerminalId: Map<string, ClaudeStatusSnapshot | null>

  /**
   * Apply a change payload, routing it to the correct terminal slice.
   * Updates the map immutably (clone + set the single key).
   *
   * @param payload - Envelope carrying the terminal id and snapshot (or null).
   */
  setSnapshot: (payload: ClaudeStatusChangePayload) => void

  /**
   * Remove a terminal's slice entirely (e.g. on panel unmount).
   *
   * @param terminalId - Terminal to drop from the map.
   */
  clearTerminal: (terminalId: string) => void

  /**
   * Reset all tracked snapshots (e.g. full teardown / tests).
   */
  reset: () => void
}

/**
 * Zustand store tracking per-terminal Claude context snapshots.
 *
 * @example Push a snapshot from the global subscription
 * ```ts
 * window.api.claudeStatus.onChanged((payload) => {
 *   useClaudeStatusStore.getState().setSnapshot(payload)
 * })
 * ```
 */
export const useClaudeStatusStore = create<ClaudeStatusState>((set) => ({
  byTerminalId: new Map<string, ClaudeStatusSnapshot | null>(),

  setSnapshot: (payload) =>
    set((state) => {
      // Immutable per-key update: clone the map so the store reference changes
      // and selectors for this terminal re-evaluate, but other keys keep their
      // identity (arch §10 — do not subscribe the whole map in components).
      const next = new Map(state.byTerminalId)
      next.set(payload.terminalId, payload.snapshot)
      return { byTerminalId: next }
    }),

  clearTerminal: (terminalId) =>
    set((state) => {
      if (!state.byTerminalId.has(terminalId)) return state
      const next = new Map(state.byTerminalId)
      next.delete(terminalId)
      return { byTerminalId: next }
    }),

  reset: () => set({ byTerminalId: new Map<string, ClaudeStatusSnapshot | null>() })
}))

/**
 * Per-terminal selector hook. Returns the latest snapshot for `terminalId`,
 * or `null` when there is none (bar hidden).
 *
 * Subscribes to ONLY this terminal's slice so a snapshot change for another
 * terminal never re-renders this component (arch §10).
 *
 * @param terminalId - Terminal panel to read.
 * @returns The current snapshot for that terminal, or `null`.
 *
 * @example
 * ```tsx
 * const snapshot = useClaudeStatus(terminalId)
 * if (!snapshot) return null
 * ```
 */
export function useClaudeStatus(terminalId: string): ClaudeStatusSnapshot | null {
  return useClaudeStatusStore((s) => s.byTerminalId.get(terminalId) ?? null)
}
