// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Restart-terminal guard (lens review finding [25]).
 *
 * "Restart terminal" kills the PTY and everything running in it – including a
 * coding agent in the middle of a task – so it must ask first whenever the
 * terminal looks busy. Quit already asks on the same evidence
 * (`utils/quitHelpers.ts`); restart did not.
 *
 * The renderer cannot see the terminal's foreground process: that would need
 * a main-side IPC that does not exist today. The guard therefore uses the two
 * signals the renderer already has, either of which is enough:
 *
 * 1. **Claude Code is running** – the Claude status store holds a snapshot for
 *    this terminal. Main only publishes one while the `claude` CLI is a live
 *    descendant of this terminal's PTY (`ClaudeStatusService`, #216), so this
 *    catches an agent sitting idle at its prompt with no recent output.
 * 2. **Recent activity after user input** – the quit heuristic
 *    (`checkTerminalBusy`) applied to THIS terminal: the user has typed in it
 *    and it produced output or input within {@link TERMINAL.RECENT_ACTIVITY_WINDOW}.
 *    Catches any CLI agent or long-running command, not only Claude Code.
 *
 * "Input" covers keystrokes AND programmatic input: `sendToTerminal` (prompt
 * sends, drag-and-drop paths, ProjectTree actions) marks the terminal too, so
 * a task handed to an agent by the app counts the same as one typed by hand.
 *
 * KNOWN GAP: an agent other than Claude Code that has produced no output and
 * received no input for longer than the window (20 s) restarts without a
 * prompt – e.g. one thinking silently or idling at its own prompt. Closing it
 * needs the PTY's foreground process from main (node-pty exposes
 * `IPty.process`), i.e. a new IPC channel.
 */

import { useTerminalStore } from '../../../stores/useTerminalStore'
import { useClaudeStatusStore } from '../../../stores/useClaudeStatusStore'
import { TERMINAL } from '../../ProjectTree/constants'
import type { ConfirmDialogConfig } from '../../Dialog/types'

/**
 * Why a restart needs confirmation, or `null` when it is safe to restart.
 *
 * - `'claude'` – Claude Code is running in the terminal
 * - `'activity'` – the terminal was used and is still producing output
 */
export type RestartRisk = 'claude' | 'activity' | null

/**
 * Decide whether restarting `terminalId` could end work in progress.
 *
 * Reads both stores through `getState()` at call time, so the answer reflects
 * the moment the user clicked, not the last render.
 *
 * @param terminalId - The PTY session about to be restarted, or `null` when
 *   the panel has none (nothing to lose, so no prompt)
 * @param windowMs - How recent activity must be to count. Default: the quit
 *   prompt's window, so both prompts agree on what "busy" means
 * @returns The reason to confirm, or `null` to restart straight away
 *
 * @example
 * ```ts
 * const risk = getRestartRisk(terminalIdRef.current)
 * if (risk !== null && !(await showConfirm(buildRestartConfirm(risk)))) return
 * await restart()
 * ```
 */
export function getRestartRisk(
  terminalId: string | null,
  windowMs: number = TERMINAL.RECENT_ACTIVITY_WINDOW
): RestartRisk {
  if (!terminalId) return null

  // A `null` value is main's "bar hidden" signal (no live claude process);
  // only a real snapshot counts.
  if (useClaudeStatusStore.getState().byTerminalId.get(terminalId)) return 'claude'

  const terminal = useTerminalStore.getState()
  // User input first: a fresh shell prints its prompt and banner, which is
  // "activity" with nothing to lose.
  if (terminal.userInputById.has(terminalId) && terminal.isRecentlyActiveId(terminalId, windowMs)) {
    return 'activity'
  }

  return null
}

/**
 * The confirmation shown before a risky restart. Always a danger prompt, so
 * it opens with focus on Cancel and Enter follows focus (ConfirmDialog).
 *
 * @param risk - A non-null result of {@link getRestartRisk}
 * @returns ConfirmDialog config without `id` (the dialog system assigns it)
 *
 * @example
 * ```ts
 * await showConfirm(buildRestartConfirm('claude'))
 * ```
 */
export function buildRestartConfirm(
  risk: Exclude<RestartRisk, null>
): Omit<ConfirmDialogConfig, 'id'> {
  return {
    title: 'Restart terminal?',
    message:
      risk === 'claude'
        ? 'Claude Code is running in this terminal. Restarting ends it and stops anything it is doing.'
        : 'This terminal was in use moments ago. Restarting ends anything still running in it.',
    confirmLabel: 'Restart',
    cancelLabel: 'Cancel',
    danger: true
  }
}
