// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Quit Confirmation Helper Functions
 *
 * Helper utilities for determining if quit should be blocked
 * and building appropriate confirmation messages.
 *
 * @see Issue #64 - quit confirmation feature
 */

import { checkHasDirtyEditors, checkTerminalBusy } from '../components/ProjectTree/switchHelpers'
import { TERMINAL } from '../components/ProjectTree/constants'

/**
 * State indicating whether quit should be blocked
 */
export interface QuitBlockedState {
  /** Whether there are unsaved changes in editors */
  hasDirtyEditors: boolean
  /** Whether terminal has recent activity */
  hasTerminalActivity: boolean
  /** Whether quit should be blocked (either condition true) */
  isBlocked: boolean
}

/**
 * Check if quit should be blocked due to unsaved changes or terminal activity
 *
 * @returns State object indicating what is blocking quit
 */
export async function checkQuitBlocked(): Promise<QuitBlockedState> {
  const hasDirtyEditors = await checkHasDirtyEditors()
  const hasTerminalActivity = await checkTerminalBusy(TERMINAL.RECENT_ACTIVITY_WINDOW)

  return {
    hasDirtyEditors,
    hasTerminalActivity,
    isBlocked: hasDirtyEditors || hasTerminalActivity
  }
}

/**
 * Build confirmation message for quit dialog based on blocked state
 *
 * @param state - The blocked state from checkQuitBlocked
 * @returns Object with title and message for confirmation dialog
 */
export function buildQuitConfirmMessage(state: QuitBlockedState): { title: string; message: string } {
  if (state.hasDirtyEditors && state.hasTerminalActivity) {
    return {
      title: 'Unsaved changes and active terminal',
      message: 'You have unsaved changes and an active terminal session. Discard changes and quit?'
    }
  }

  if (state.hasDirtyEditors) {
    return {
      title: 'Unsaved changes',
      message: 'You have unsaved changes. Discard and quit?'
    }
  }

  if (state.hasTerminalActivity) {
    return {
      title: 'Active terminal session',
      message: 'Terminal shows recent activity. Stop it and quit?'
    }
  }

  // Should not be called if not blocked, but provide fallback
  return {
    title: 'Quit application',
    message: 'Are you sure you want to quit?'
  }
}
