// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Auto-open terminal panel when project loads
 *
 * Opens the terminal panel automatically when a new project is loaded,
 * unless the user has explicitly closed it during the current session.
 *
 * @see Issue #55 - auto-open terminal panel feature
 */

import { useProjectChangedEffect } from '../context/ProjectManagementContext'
import { useActivityBarStore } from '../stores/useActivityBarStore'
import { logger } from '../utils/logger'

/**
 * Hook to auto-open terminal panel on project load.
 *
 * Uses ephemeral state to track if user explicitly closed the terminal.
 * When a new project loads, resets this flag and opens terminal
 * using an atomic store action to prevent intermediate state issues.
 *
 * @example
 * ```tsx
 * // In AppDockLayout.tsx
 * function AppDockLayout() {
 *   useAutoOpenTerminal();
 *   // ... rest of component
 * }
 * ```
 */
export function useAutoOpenTerminal(): void {
  const openTerminalOnProjectLoad = useActivityBarStore((state) => state.openTerminalOnProjectLoad)

  useProjectChangedEffect((newPath) => {
    if (newPath) {
      // New project loaded - use atomic action to reset flag and open terminal
      const terminalWasClosed = useActivityBarStore.getState().terminalUserClosed
      logger.debug('Project loaded, auto-opening terminal', { newPath, terminalWasClosed })
      openTerminalOnProjectLoad()
    }
    // When project closes (newPath is null), do nothing - existing behavior handles it
  })
}
