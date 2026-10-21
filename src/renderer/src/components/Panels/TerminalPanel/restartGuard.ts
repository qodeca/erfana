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
 * The guard combines three signals, any one of which is enough:
 *
 * 1. **Claude Code is running** – the Claude status store holds a snapshot for
 *    this terminal. Main only publishes one while the `claude` CLI is a live
 *    descendant of this terminal's PTY (`ClaudeStatusService`, #216), so this
 *    catches an agent sitting idle at its prompt with no recent output.
 * 2. **Recent activity after user input** – the quit heuristic
 *    (`checkTerminalBusy`) applied to THIS terminal: the user has typed in it
 *    and it produced output or input within {@link TERMINAL.RECENT_ACTIVITY_WINDOW}.
 *    Catches any CLI agent or long-running command, not only Claude Code.
 * 3. **A program is running** – main reports a foreground process other than
 *    the shell (`terminal:getActivity`). Catches a silent agent or command that
 *    has produced no output and received no input for a while. Where the
 *    platform cannot tell (Windows), only signals 1 and 2 apply.
 *
 * "Input" covers keystrokes AND programmatic input: `sendToTerminal` (prompt
 * sends, drag-and-drop paths, ProjectTree actions) marks the terminal too, so
 * a task handed to an agent by the app counts the same as one typed by hand.
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
 * - `'process'` – a program other than the shell is running in it
 */
export type RestartRisk = 'claude' | 'activity' | 'process' | null

/**
 * Decide whether restarting `terminalId` could end work in progress.
 *
 * Reads both stores through `getState()` at call time, so the answer reflects
 * the moment the user clicked, not the last render. The cheap local signals run
 * first; main is asked only when they find nothing.
 *
 * @param terminalId - The PTY session about to be restarted, or `null` when
 *   the panel has none (nothing to lose, so no prompt)
 * @param windowMs - How recent activity must be to count. Default: the quit
 *   prompt's window, so both prompts agree on what "busy" means
 * @returns The reason to confirm, or `null` to restart straight away
 *
 * @example
 * ```ts
 * const risk = await getRestartRisk(terminalIdRef.current)
 * if (risk !== null && !(await showConfirm(buildRestartConfirm(risk)))) return
 * await restart()
 * ```
 */
export async function getRestartRisk(
  terminalId: string | null,
  windowMs: number = TERMINAL.RECENT_ACTIVITY_WINDOW
): Promise<RestartRisk> {
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

  return (await hasRunningProgram(terminalId)) ? 'process' : null
}

/**
 * Ask main whether a program other than the shell runs in the terminal. Any
 * failure (no bridge, a refused call) reads as "no", so the guard never blocks
 * a restart on a broken lookup.
 */
async function hasRunningProgram(terminalId: string): Promise<boolean> {
  try {
    const result = await window.api?.terminal?.getActivity?.(terminalId)
    return result?.success === true && result.busy === true
  } catch {
    return false
  }
}

const RESTART_MESSAGES: Record<Exclude<RestartRisk, null>, string> = {
  claude: 'Claude Code is running in this terminal. Restarting ends it and stops anything it is doing.',
  activity: 'This terminal was in use moments ago. Restarting ends anything still running in it.',
  process: 'A program is running in this terminal. Restarting ends it and stops anything it is doing.'
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
    message: RESTART_MESSAGES[risk],
    confirmLabel: 'Restart',
    cancelLabel: 'Cancel',
    danger: true
  }
}
