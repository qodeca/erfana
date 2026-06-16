// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectManagementContext
 *
 * Provides a singleton instance of the project management state to avoid
 * duplicate IPC listeners when multiple components use useProjectManagement.
 *
 * Problem: Both ProjectTree and WelcomePanel were creating their own instances
 * of useProjectManagement, each registering separate onProjectChanged listeners,
 * causing duplicate "Project Opened" toasts.
 *
 * Solution: This context ensures only ONE instance of the hook exists,
 * meaning only ONE IPC listener and ONE toast per event.
 *
 * Usage:
 * - Wrap app with <ProjectManagementProvider> (inside DialogProvider)
 * - Use useProjectManagementContext() for full hook return value
 * - Use useOpenProjectByPath() for focused ISP-compliant subset
 */

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { useProjectManagement } from '../hooks/useProjectManagement'
import type { IUseProjectManagementReturn } from '../interfaces/IProjectManagement'
import { logger } from '../utils/logger'
import { getBasename } from '../utils/fileUtils'

const ProjectManagementContext = createContext<IUseProjectManagementReturn | null>(null)

interface ProjectManagementProviderProps {
  children: ReactNode
}

// Callback registry for components that need to react to project changes
type ProjectChangedCallback = (newPath: string | null) => void
const projectChangedCallbacks = new Set<ProjectChangedCallback>()

/**
 * Register a callback to be notified when project changes.
 * Used by ProjectTree to reset UI state (expanded folders, selections).
 *
 * @param callback - Function to call when project changes
 * @returns Cleanup function to unregister the callback
 */
export function registerProjectChangedCallback(callback: ProjectChangedCallback): () => void {
  projectChangedCallbacks.add(callback)
  return () => {
    projectChangedCallbacks.delete(callback)
  }
}

export function ProjectManagementProvider({ children }: ProjectManagementProviderProps) {
  // Single instance of the hook - only ONE IPC listener
  const projectManagement = useProjectManagement({
    onProjectChanged: (newPath) => {
      // Notify all registered callbacks
      projectChangedCallbacks.forEach((callback) => {
        try {
          callback(newPath)
        } catch (err) {
          logger.warn('ProjectManagementContext: callback error', { error: err instanceof Error ? err.message : String(err) })
        }
      })
    }
  })

  // Drive the OS window title from project state (single per-window owner of
  // projectPath). document.title flows to the native title bar on both
  // platforms — "ERFANA v{version}" with no project, "{name} | ERFANA v{version}"
  // when one is open.
  const { projectPath } = projectManagement
  useEffect(() => {
    const base = `ERFANA v${__APP_VERSION__}`
    const name = projectPath ? getBasename(projectPath) : ''
    document.title = name ? `${name} | ${base}` : base
  }, [projectPath])

  return (
    <ProjectManagementContext.Provider value={projectManagement}>
      {children}
    </ProjectManagementContext.Provider>
  )
}

/**
 * Access full project management state and operations.
 * Use this in components that need full control (e.g., ProjectTree).
 *
 * @throws Error if used outside ProjectManagementProvider
 */
export function useProjectManagementContext(): IUseProjectManagementReturn {
  const context = useContext(ProjectManagementContext)
  if (!context) {
    throw new Error('useProjectManagementContext must be used within ProjectManagementProvider')
  }
  return context
}

/**
 * Safe version that returns null if outside provider.
 * Use for optional features that should degrade gracefully.
 */
export function useProjectManagementContextSafe(): IUseProjectManagementReturn | null {
  return useContext(ProjectManagementContext)
}

/**
 * Focused hook for components that only need to open projects (ISP).
 * Use this in components like WelcomePanel that only need handleOpenProjectByPath.
 *
 * @throws Error if used outside ProjectManagementProvider
 */
export function useOpenProjectByPath() {
  const { handleOpenProjectByPath, isSwitchingProject } = useProjectManagementContext()
  return { handleOpenProjectByPath, isSwitchingProject }
}

/**
 * Hook to register for project change notifications.
 * Use this in components that need to reset state when project changes.
 *
 * Uses a ref pattern to avoid re-registration when callback changes.
 * The callback is always invoked with latest closure.
 *
 * @param onProjectChanged - Callback when project changes
 */
export function useProjectChangedEffect(onProjectChanged: ProjectChangedCallback): void {
  // Store callback in ref to avoid re-registration on callback changes
  const callbackRef = useRef(onProjectChanged)
  callbackRef.current = onProjectChanged

  useEffect(() => {
    // Register a stable wrapper that calls the latest callback
    const stableCallback: ProjectChangedCallback = (newPath) => {
      callbackRef.current(newPath)
    }

    const unregister = registerProjectChangedCallback(stableCallback)

    return () => {
      unregister()
    }
  }, []) // Empty deps - register once, use ref for latest callback
}
