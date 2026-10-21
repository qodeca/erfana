// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Project Management Hook Interface
 *
 * Defines the contract for the useProjectManagement hook, which encapsulates
 * all project lifecycle operations (loading, switching, closing).
 *
 * This interface follows the Dependency Inversion Principle by allowing
 * the hook to accept optional dependencies for testing and flexibility.
 */

import type { IProjectTreeApi, FileNode } from './IProjectTreeApi'

/**
 * Options for useProjectManagement hook
 */
export interface IUseProjectManagementOptions {
  /**
   * Optional API override for testing
   * Defaults to window.api if not provided
   */
  api?: IProjectTreeApi

  /**
   * Callback invoked when project changes (opened/closed/switched)
   * Useful for resetting UI state (expanded folders, selections, etc.)
   *
   * @param newPath - New project path, or null if project was closed
   */
  onProjectChanged?: (newPath: string | null) => void
}

/**
 * Return value from useProjectManagement hook
 *
 * Provides project state and operations for managing project lifecycle
 */
export interface IUseProjectManagementReturn {
  /**
   * Current project path, or null if no project is open
   */
  projectPath: string | null

  /**
   * File tree for the current project
   */
  files: FileNode[]

  /**
   * Loading state for async operations
   */
  loading: boolean

  /**
   * Error message if project operation failed
   */
  error: string | null

  /**
   * Whether a project switch/close is in progress
   * Used to disable UI and prevent concurrent operations
   */
  isSwitchingProject: boolean

  /**
   * Whether the first tree read of the current project has been applied –
   * the directory watcher's start gate (#211, D12).
   *
   * `false` with no project open, and while the first read after a
   * project-changed open (or the read that superseded it) is in flight.
   * `true` once that read settles, on success **or** failure, so a failed
   * first read can still self-heal through the watcher. A read superseded by
   * a newer open or a close never opens it. Main's no-op re-open, which sends
   * no project-changed event, opens it at once.
   */
  initialLoadComplete: boolean

  /**
   * Open a new project
   * - Shows file picker dialog
   * - Checks for unsaved changes and terminal activity
   * - Requests confirmation if needed
   * - Loads project files
   */
  handleOpenProject: () => Promise<void>

  /**
   * Close the current project
   * - Checks for unsaved changes and terminal activity
   * - Requests confirmation if needed
   * - Clears project state
   */
  handleCloseProject: () => Promise<void>

  /**
   * Refresh the file tree for the current project
   * Used by file operations to update the tree after making changes
   *
   * Coalesced (#208): calls made while a read runs share one follow-up read
   * that starts after it. The promise resolves – it never rejects – once a
   * read that started after the call has finished, or without a read of its
   * own if the project changed or closed before that read could start, or if
   * the caller belongs to a project that is no longer open. Results from an
   * older project or an older read are never shown.
   */
  refreshFiles: () => Promise<void>

  /**
   * Open a project by direct path (for recent projects)
   * - Checks for unsaved changes and terminal activity
   * - Requests confirmation if needed
   * - Opens project directly without file picker dialog
   *
   * @param projectPath - Path to the project folder
   * @returns true if project was opened, false if cancelled by user
   */
  handleOpenProjectByPath: (projectPath: string) => Promise<boolean>
}
