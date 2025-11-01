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
import type { FileNode } from '../../../../preload/index'
import { TERMINAL } from './constants'

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
 * @returns true if user confirmed, false if cancelled
 */
export async function confirmProjectSwitch(
  hasDirty: boolean,
  terminalBusy: boolean,
  action: 'switch' | 'close',
  confirm: ConfirmFn
): Promise<boolean> {
  if (!needsSwitchConfirmation(hasDirty, terminalBusy)) {
    return true
  }

  const title = hasDirty ? 'Unsaved Changes' : 'Active Terminal Session'
  const actionVerb = action === 'switch' ? 'switch project' : 'close project'
  const message = hasDirty
    ? `You have unsaved changes. Discard and ${actionVerb}?`
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
    console.warn('Failed to signal terminal:', e)
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
 * @param switchTokenRef - Ref holding current switch token
 * @param setProjectPath - Callback to update project path state
 * @param setFiles - Callback to update files state
 * @returns Opened project path, or null if operation was cancelled or token mismatch
 */
export async function openProjectWithTokenGuard(
  switchTokenRef: MutableRefObject<number>,
  setProjectPath: (path: string) => void,
  setFiles: (nodes: FileNode[]) => void
): Promise<string | null> {
  const currentToken = ++switchTokenRef.current
  const path = await window.api.file.openProject()

  if (!path) return null
  if (currentToken !== switchTokenRef.current) {
    // Another switch operation started while we were waiting
    return null
  }

  setProjectPath(path)
  const fileTree = await window.api.file.readDirectory(path)
  setFiles(fileTree)
  return path
}

/**
 * Close project with token-based race guard
 *
 * @param switchTokenRef - Ref holding current switch token
 * @param setProjectPath - Callback to update project path state
 * @param setFiles - Callback to update files state
 * @param setExpandedFolders - Callback to clear expanded folders state
 * @returns true if project was closed successfully
 */
export async function closeProjectWithTokenGuard(
  switchTokenRef: MutableRefObject<number>,
  setProjectPath: (path: string | null) => void,
  setFiles: (nodes: FileNode[]) => void,
  setExpandedFolders: (folders: Set<string>) => void
): Promise<boolean> {
  const currentToken = ++switchTokenRef.current
  const ok = await window.api.file.closeProject()

  if (!ok) return false
  if (currentToken !== switchTokenRef.current) {
    // Another switch operation started while we were waiting
    return false
  }

  setProjectPath(null)
  setFiles([])
  setExpandedFolders(new Set())
  return true
}
