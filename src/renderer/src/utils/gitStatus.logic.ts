// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Git Status Logic - Pure Functions
 * ===================================
 * Pure logic for git status badge rendering, folder status propagation,
 * and status color mapping.
 *
 * This is testable, framework-agnostic logic extracted from UI components.
 */

import type { GitDisplayStatus, GitFileEntry } from '../../../shared/ipc/git-schema'

/**
 * STATUS_PRIORITY - Priority map for folder status propagation
 * Higher number = higher priority (bubbles up to parent folders)
 */
export const STATUS_PRIORITY: Record<GitDisplayStatus, number> = {
  conflicted: 5,
  deleted: 4,
  modified: 3,
  untracked: 2,
  staged: 1,
  renamed: 1,
  unmodified: 0,
}

/**
 * Calculate folder statuses by propagating file statuses up the tree
 * Higher priority statuses bubble up to parent folders
 *
 * @param files - Array of git file entries
 * @returns Map of folder path to highest priority status
 */
export function calculateFolderStatuses(files: GitFileEntry[]): Map<string, GitDisplayStatus> {
  const folderStatuses = new Map<string, GitDisplayStatus>()

  for (const file of files) {
    // Skip unmodified files (no indicator)
    if (file.status === 'unmodified') continue

    const filePriority = STATUS_PRIORITY[file.status]

    // Propagate status to all parent folders
    let currentPath = file.path
    while (true) {
      const lastSlash = Math.max(
        currentPath.lastIndexOf('/'),
        currentPath.lastIndexOf('\\'),
      )
      if (lastSlash === -1) break // Reached root

      const folderPath = currentPath.substring(0, lastSlash)
      const existingStatus = folderStatuses.get(folderPath)
      const existingPriority = existingStatus ? STATUS_PRIORITY[existingStatus] : 0

      // Higher priority wins
      if (filePriority > existingPriority) {
        folderStatuses.set(folderPath, file.status)
      }

      currentPath = folderPath
    }
  }

  return folderStatuses
}

/**
 * Get badge letter for a given status
 * Used for file status indicators
 *
 * @param status - Git display status
 * @returns Single letter badge (M, U, D, A, R, !)
 */
export function getStatusBadge(status: GitDisplayStatus): string {
  switch (status) {
    case 'modified':
      return 'M'
    case 'untracked':
      return 'U'
    case 'deleted':
      return 'D'
    case 'staged':
      return 'A'
    case 'renamed':
      return 'R'
    case 'conflicted':
      return '!'
    case 'unmodified':
      return ''
  }
}

/**
 * Get CSS color token for a given status
 * Returns design token variable name
 *
 * @param status - Git display status
 * @returns CSS variable name (e.g., "var(--color-git-modified)")
 */
export function getStatusColorToken(status: GitDisplayStatus): string {
  switch (status) {
    case 'modified':
      return 'var(--color-git-modified)'
    case 'untracked':
      return 'var(--color-git-untracked)'
    case 'deleted':
      return 'var(--color-git-deleted)'
    case 'staged':
      return 'var(--color-git-staged)'
    case 'renamed':
      return 'var(--color-git-renamed)'
    case 'conflicted':
      return 'var(--color-git-conflicted)'
    case 'unmodified':
      return ''
  }
}
