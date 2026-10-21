// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Project Switching Helper Functions
 *
 * Extracted from ProjectTree to reduce cyclomatic complexity in
 * handleOpenProject and handleCloseProject.
 *
 * These helpers encapsulate:
 * - Dynamic store imports (dirty editors, terminal activity)
 * - Confirmation dialog logic
 * - Terminal interrupt signaling
 * - Token-based race guards
 *
 * Complexity Reduction:
 * - handleOpenProject: 67 lines, complexity ~10 → 25-30 lines, complexity 3-4
 * - handleCloseProject: Can reuse the same helpers for consistency
 */

import type { MutableRefObject } from 'react'
import { TERMINAL } from './constants'
import { logger } from '../../utils/logger'
import { editorSaveRegistry } from '../../services/editorSaveRegistry'
import { getLastSeenProjectGeneration } from '../../services/projectGeneration'

/**
 * Type for confirmation dialog function
 */
export type ConfirmFn = (params: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}) => Promise<boolean>

/**
 * Check if there are unsaved editors in the project
 * Uses dynamic import to avoid circular dependencies
 *
 * @returns true if there are dirty (unsaved) editors
 */
export async function checkHasDirtyEditors(): Promise<boolean> {
  try {
    const { useProjectStore } = await import('../../stores/useProjectStore')
    return useProjectStore.getState().hasDirtyEditors()
  } catch {
    return false
  }
}

/**
 * Check if terminal has recent activity within the specified window
 * Uses dynamic import to avoid circular dependencies
 *
 * @param windowMs - Time window in milliseconds (e.g., 20000 for 20s)
 * @returns true if terminal is busy (has user interaction + recent activity)
 */
export async function checkTerminalBusy(windowMs: number): Promise<boolean> {
  try {
    const { useTerminalStore } = await import('../../stores/useTerminalStore')
    const store = useTerminalStore.getState()
    return store.hasUserInteracted() && store.isRecentlyActive(windowMs)
  } catch {
    return false
  }
}

/**
 * Determine if user confirmation is needed before switching/closing project
 *
 * @param hasDirty - Whether there are unsaved editors
 * @param terminalBusy - Whether terminal has recent activity
 * @returns true if confirmation is needed
 */
export function needsSwitchConfirmation(hasDirty: boolean, terminalBusy: boolean): boolean {
  return hasDirty || terminalBusy
}

/**
 * Show confirmation dialog with appropriate message for project switch/close
 *
 * @param hasDirty - Whether there are unsaved editors
 * @param terminalBusy - Whether terminal has recent activity
 * @param action - Action being performed ('switch' or 'close')
 * @param confirm - Confirmation dialog function
 * @param unsavedCount - How many tabs could not be saved, when known. Names the
 *   count in the message ("1 tab could not be saved"); omitted, the message
 *   keeps the generic "You have unsaved changes" wording.
 * @returns true if user confirmed, false if cancelled
 */
export async function confirmProjectSwitch(
  hasDirty: boolean,
  terminalBusy: boolean,
  action: 'switch' | 'close',
  confirm: ConfirmFn,
  unsavedCount?: number
): Promise<boolean> {
  if (!needsSwitchConfirmation(hasDirty, terminalBusy)) {
    return true
  }

  const title = hasDirty ? 'Unsaved Changes' : 'Active Terminal Session'
  const actionVerb = action === 'switch' ? 'switch project' : 'close project'
  const unsavedLead =
    unsavedCount === undefined || unsavedCount < 1
      ? 'You have unsaved changes.'
      : `${unsavedCount} ${unsavedCount === 1 ? 'tab' : 'tabs'} could not be saved.`
  const message = hasDirty
    ? `${unsavedLead} Discard and ${actionVerb}?`
    : `Terminal shows recent activity. Stop it and ${actionVerb}?`
  const confirmLabel = action === 'switch' ? 'Switch Anyway' : 'Close Anyway'

  return confirm({
    title,
    message,
    confirmLabel,
    danger: true
  })
}

/**
 * The outcome of {@link prepareProjectTransition}.
 */
export interface ProjectTransition {
  /** false when the user cancelled; the transition has already ended */
  proceed: boolean
  /** Whether the terminal showed recent activity when the check ran */
  terminalBusy: boolean
  /**
   * End the transition once the open or close has finished, however it went.
   * If the project did change (a new `project:changed` generation arrived) the
   * autosave hold is kept: the tabs unmount and drop it, so nothing can write
   * into the project that was left. If it did not (picker cancelled, main
   * answered no-op, an error), the hold is released and autosave re-arms.
   * Safe to call more than once.
   */
  settle: () => void
}

/**
 * Get the editors ready for a project switch or close.
 *
 * 1. Lock the UI and hold every tab's autosave, so no timer can fire from here.
 * 2. Save every dirty tab; a tab in conflict is left alone.
 * 3. Re-read what is still unsaved (conflicts, failed writes, typing during
 *    the save) and, only then, prompt: "N tabs could not be saved".
 *
 * The lock is lifted before the prompt, because it paints above dialogs.
 * Cancelling ends the transition here and re-arms autosave.
 *
 * @param action - 'switch' or 'close'
 * @param confirm - Confirmation dialog function
 * @returns Whether to go on, and how to end the transition afterwards
 */
export async function prepareProjectTransition(
  action: 'switch' | 'close',
  confirm: ConfirmFn
): Promise<ProjectTransition> {
  const { useProjectStore } = await import('../../stores/useProjectStore')
  const startGeneration = getLastSeenProjectGeneration()

  useProjectStore.getState().setProjectChanging(true)
  const releaseHold = editorSaveRegistry.holdAll()
  let settled = false
  const settle = (): void => {
    if (settled) return
    settled = true
    if (getLastSeenProjectGeneration() === startGeneration) releaseHold()
  }

  try {
    const flushed = await editorSaveRegistry.flushAll({ skipConflicts: true })
    logger.info('[switchHelpers] Flushed unsaved tabs before project transition', {
      action,
      saved: flushed.saved.length,
      failed: flushed.failed.length,
      conflicted: flushed.conflicted.length
    })

    const terminalBusy = await checkTerminalBusy(TERMINAL.RECENT_ACTIVITY_WINDOW)
    const unsavedCount = useProjectStore.getState().dirtyPanelIds.size
    useProjectStore.getState().setProjectChanging(false)

    const confirmed = await confirmProjectSwitch(unsavedCount > 0, terminalBusy, action, confirm, unsavedCount)
    if (!confirmed) {
      settle()
      return { proceed: false, terminalBusy, settle }
    }
    return { proceed: true, terminalBusy, settle }
  } catch (error) {
    useProjectStore.getState().setProjectChanging(false)
    settle()
    throw error
  }
}

/**
 * Send Ctrl+C signal to active terminal and clear activity if it becomes idle
 * Uses dynamic import to avoid circular dependencies
 *
 * Process:
 * 1. Get active terminal ID
 * 2. Send Ctrl+C signal
 * 3. Wait for signal to propagate (300ms)
 * 4. Check if terminal is still active
 * 5. Clear activity flag if terminal went idle
 */
export async function interruptActiveTerminalIfAny(): Promise<void> {
  try {
    const { useTerminalStore } = await import('../../stores/useTerminalStore')
    const tid = useTerminalStore.getState().getActiveTerminalId()
    if (!tid) return

    // Send Ctrl+C signal
    await window.api.terminal.write(tid, TERMINAL.INTERRUPT_SIGNAL)
    // Give it a moment to propagate
    await new Promise((r) => setTimeout(r, TERMINAL.SIGNAL_DELAY))

    // If no new activity in short window, clear activity flag
    const stillActive = useTerminalStore.getState().isRecentlyActiveId(tid, TERMINAL.ACTIVITY_CHECK_WINDOW)
    if (!stillActive) {
      useTerminalStore.getState().clearActivity(tid)
    }
  } catch (e) {
    logger.warn('Failed to signal terminal', { error: e })
  }
}

/**
 * Open project with token-based race guard
 *
 * Token Guard Pattern:
 * - Increment token before async operation
 * - Only update state if token matches after operation completes
 * - Prevents stale responses from overriding newer ones
 *
 * Note: This function only updates project path. The IPC event listener
 * (onProjectChanged) is the single source of truth for file tree updates,
 * preventing race conditions from duplicate state updates.
 *
 * @param switchTokenRef - Ref holding current switch token
 * @param setProjectPath - Callback to update project path state
 * @returns Opened project path, or null if operation was cancelled or token mismatch
 */
export async function openProjectWithTokenGuard(
  switchTokenRef: MutableRefObject<number>,
  setProjectPath: (path: string) => void
): Promise<string | null> {
  // Import store dynamically to avoid circular dependencies
  const { useProjectStore } = await import('../../stores/useProjectStore')

  // Set global lock to prevent UI interactions during folder dialog
  useProjectStore.getState().setProjectChanging(true)

  try {
    const currentToken = ++switchTokenRef.current
    const path = await window.api.file.openProject()

    if (!path) return null
    if (currentToken !== switchTokenRef.current) {
      // Another switch operation started while we were waiting
      return null
    }

    // Only update project path - IPC event will handle file tree loading
    setProjectPath(path)
    return path
  } finally {
    // Always release the lock, even if operation was canceled or failed
    useProjectStore.getState().setProjectChanging(false)
  }
}

/**
 * Close project with token-based race guard
 *
 * Note: This function only updates project path. The IPC event listener
 * (onProjectChanged) is the single source of truth for file tree and UI state updates,
 * preventing race conditions from duplicate state updates.
 *
 * @param switchTokenRef - Ref holding current switch token
 * @param setProjectPath - Callback to update project path state
 * @returns true if project was closed successfully
 */
export async function closeProjectWithTokenGuard(
  switchTokenRef: MutableRefObject<number>,
  setProjectPath: (path: string | null) => void
): Promise<boolean> {
  const currentToken = ++switchTokenRef.current
  const ok = await window.api.file.closeProject()

  if (!ok) return false
  if (currentToken !== switchTokenRef.current) {
    // Another switch operation started while we were waiting
    return false
  }

  // Only update project path - IPC event will clear files and UI state
  setProjectPath(null)
  return true
}
