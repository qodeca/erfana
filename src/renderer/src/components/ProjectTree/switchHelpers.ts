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
import { fileGateway } from '../../services/fileGateway'
import { terminalGateway } from '../../services/terminalGateway'

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
   * End the transition once the open or close has finished, however it went:
   * lifts the UI lock and decides what happens to the autosave hold.
   *
   * @param projectChanged - What the open or close answered: `true` when it
   *   switched or closed the project, `false` for a no-op, a cancelled picker
   *   or a failure; omit it when that is not known. A project that did change
   *   keeps the hold (the tabs unmount and drop it, so nothing can write into
   *   the project that was left); anything else releases it and autosave
   *   re-arms. A `true` answer is also checked against the `project:changed`
   *   generation, because a hold kept on tabs that never unmount would leave
   *   autosave off for good; with no answer the generation decides alone.
   *
   * Safe to call more than once.
   */
  settle: (projectChanged?: boolean) => void
}

/** What the blocker says while open tabs are being saved */
const SAVING_TABS_MESSAGE = 'Saving open tabs…'

/**
 * Get the editors ready for a project switch or close.
 *
 * 1. Lock the UI and hold every tab's autosave (and make the editors
 *    read-only), so nothing can be typed or saved from here.
 * 2. Save every dirty tab; a tab in conflict is left alone.
 * 3. Re-read what is still unsaved (conflicts, failed or timed-out writes,
 *    tabs dirty again) and, only then, prompt: "N tabs could not be saved".
 *
 * With nothing to ask, the lock stays on until `settle()`, so there is no
 * unlock and relock between the flush and the open. A prompt lifts it, because
 * the blocker paints above dialogs, and a confirmed prompt locks again.
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

  useProjectStore.getState().setProjectChanging(true, SAVING_TABS_MESSAGE)
  const releaseHold = editorSaveRegistry.holdAll()
  let settled = false
  const settle = (projectChanged?: boolean): void => {
    if (settled) return
    settled = true
    useProjectStore.getState().setProjectChanging(false)
    const eventSeen = getLastSeenProjectGeneration() !== startGeneration
    const generationUnknown = startGeneration === undefined && getLastSeenProjectGeneration() === undefined
    const keep =
      projectChanged === false ? false : projectChanged === true ? eventSeen || generationUnknown : eventSeen
    if (!keep) releaseHold()
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
    if (!needsSwitchConfirmation(unsavedCount > 0, terminalBusy)) {
      return { proceed: true, terminalBusy, settle }
    }

    useProjectStore.getState().setProjectChanging(false)
    const confirmed = await confirmProjectSwitch(unsavedCount > 0, terminalBusy, action, confirm, unsavedCount)
    if (!confirmed) {
      settle(false)
      return { proceed: false, terminalBusy, settle }
    }
    useProjectStore.getState().setProjectChanging(true, action === 'switch' ? 'Switching project…' : 'Closing project…')
    return { proceed: true, terminalBusy, settle }
  } catch (error) {
    settle(false)
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
    await terminalGateway.write(tid, TERMINAL.INTERRUPT_SIGNAL)
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
    const path = await fileGateway.openProject()

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
  const ok = await fileGateway.closeProject()

  if (!ok) return false
  if (currentToken !== switchTokenRef.current) {
    // Another switch operation started while we were waiting
    return false
  }

  // Only update project path - IPC event will clear files and UI state
  setProjectPath(null)
  return true
}
