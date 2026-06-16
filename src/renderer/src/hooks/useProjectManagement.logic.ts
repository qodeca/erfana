// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure Logic for useProjectManagement Hook
 *
 * Extracted for unit testing without React rendering.
 * All functions are pure - no side effects, deterministic outputs.
 */

import { getBasename } from '../utils/fileUtils'

/**
 * Project change event data structure
 */
export interface ProjectChangeData {
  oldPath: string | null
  newPath: string | null
}

/**
 * Determines if the last project should be loaded on mount
 *
 * @param mounted - Whether the component is still mounted
 * @returns true if should load, false otherwise
 */
export function shouldLoadLastProject(mounted: boolean): boolean {
  return mounted === true
}

/**
 * Determines if a new project should be opened (external change)
 *
 * @param newPath - The new project path from external change
 * @returns true if should open new project, false otherwise
 */
export function shouldOpenExternalProject(newPath: string | null): boolean {
  return newPath !== null && newPath !== undefined && newPath !== ''
}

/**
 * Determines if the project should be closed (external change)
 *
 * @param newPath - The new project path from external change
 * @returns true if should close project, false otherwise
 */
export function shouldCloseExternalProject(newPath: string | null): boolean {
  return newPath === null
}

/**
 * Determines if files should be refreshed
 *
 * @param projectPath - Current project path
 * @returns true if should refresh, false otherwise
 */
export function shouldRefreshFiles(projectPath: string | null): boolean {
  return projectPath !== null && projectPath !== ''
}

/**
 * Determines if component is still valid for state updates
 *
 * @param mounted - Whether the component is mounted
 * @param lastPath - The last project path loaded
 * @returns true if should proceed with state update, false otherwise
 */
export function shouldProceedWithStateUpdate(mounted: boolean, lastPath: string | null): boolean {
  return mounted === true && lastPath !== null && lastPath !== undefined
}

/**
 * Creates a success toast message for opened project
 *
 * @param path - The project path that was opened
 * @returns Formatted toast message
 */
export function createProjectOpenedMessage(path: string): string {
  return path
}

/**
 * Creates an info toast message for closed project
 *
 * @returns Formatted toast message
 */
export function createProjectClosedMessage(): string {
  return 'Current project has been closed.'
}

/**
 * Creates an error message for failed open operation
 *
 * @param error - The error that occurred
 * @returns Formatted error message
 */
export function createOpenErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/**
 * Creates an error message for failed close operation
 *
 * @param error - The error that occurred
 * @returns Formatted error message
 */
export function createCloseErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/**
 * Creates an error message for failed load operation
 *
 * @param error - The error that occurred
 * @returns Formatted error message
 */
export function createLoadErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'Failed to load project'
}

/**
 * Formats an error for display in error state
 *
 * @param error - The error that occurred
 * @returns Formatted error string
 */
export function formatErrorForState(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'An unknown error occurred'
}

/**
 * Creates a log message for project changed event
 *
 * @param data - The project change data
 * @returns Formatted log message
 */
export function createProjectChangedLogMessage(data: ProjectChangeData): string {
  return `🌳 useProjectManagement: Project changed: ${JSON.stringify(data)}`
}

/**
 * Creates a log message for callback warning
 *
 * @param error - The callback error
 * @returns Formatted warning message
 */
export function createCallbackWarningMessage(error: unknown): string {
  return `onProjectChanged callback threw: ${error}`
}

/**
 * Creates a log message for load project error
 *
 * @returns Formatted error log message
 */
export function createLoadProjectErrorLog(): string {
  return 'Error loading last project:'
}

/**
 * Creates a log message for new project tree loading error
 *
 * @returns Formatted error log message
 */
export function createNewProjectTreeErrorLog(): string {
  return 'Error loading new project tree:'
}

/**
 * Creates a log message for refresh error
 *
 * @returns Formatted error log message
 */
export function createRefreshErrorLog(): string {
  return 'Error refreshing file tree:'
}

/**
 * Creates a log message for open project error
 *
 * @returns Formatted error log message
 */
export function createOpenProjectErrorLog(): string {
  return 'Error opening project:'
}

/**
 * Creates a log message for close project error
 *
 * @returns Formatted error log message
 */
export function createCloseProjectErrorLog(): string {
  return 'Error closing project:'
}

/**
 * Determines the initial load complete value
 *
 * @param lastPath - The last project path
 * @param fileTree - The loaded file tree
 * @returns true if initial load should be marked complete
 */
export function shouldMarkInitialLoadComplete(
  lastPath: string | null,
  fileTree: unknown[]
): boolean {
  return lastPath !== null && fileTree !== null && fileTree !== undefined
}

/**
 * Extracts project name from full path
 *
 * @param path - Full project path
 * @returns Project name (last segment of path)
 */
export function extractProjectName(path: string): string {
  if (!path) return ''
  return getBasename(path) || path
}

/**
 * Formats project path for display (truncates if too long)
 *
 * @param path - Full project path
 * @param maxLength - Maximum length before truncation
 * @returns Formatted path
 */
export function formatProjectPath(path: string, maxLength: number = 50): string {
  if (path.length <= maxLength) return path
  const start = Math.floor(maxLength / 2) - 2
  const end = path.length - Math.floor(maxLength / 2) + 2
  return `${path.substring(0, start)}...${path.substring(end)}`
}

/**
 * Checks if a path is valid
 *
 * @param path - Path to validate
 * @returns true if valid, false otherwise
 */
export function isValidProjectPath(path: string | null): boolean {
  return path !== null && path !== undefined && path !== '' && path.length > 0
}

/**
 * Determines if an error is related to file operations
 *
 * @param error - The error to check
 * @returns true if file operation error, false otherwise
 */
export function isFileOperationError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return (
      message.includes('enoent') ||
      message.includes('eacces') ||
      message.includes('eperm') ||
      message.includes('file') ||
      message.includes('directory')
    )
  }
  return false
}

/**
 * Checks if callback invocation is safe
 *
 * @param callback - The callback to check
 * @returns true if safe to call, false otherwise
 */
export function isSafeToInvokeCallback(callback: unknown): boolean {
  return typeof callback === 'function'
}
