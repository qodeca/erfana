// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Git Status Badge Component
 * ===========================
 * Visual indicator for git file/folder status
 *
 * - Files: Letter badge (M, U, D, A, R, !)
 * - Folders: Colored dot indicator
 */

import type { GitDisplayStatus } from '../../../../shared/ipc/git-schema'
import { getStatusBadge } from '../../utils/gitStatus.logic'

interface GitStatusBadgeProps {
  status: GitDisplayStatus
  isFolder?: boolean
}

/**
 * Git status visual indicator
 * Shows different styles for files vs folders
 */
export function GitStatusBadge({ status, isFolder = false }: GitStatusBadgeProps) {
  // Don't render for unmodified status
  if (status === 'unmodified') {
    return null
  }

  const badge = getStatusBadge(status)

  // Accessibility labels
  const statusLabels: Record<GitDisplayStatus, string> = {
    modified: 'Modified',
    untracked: 'Untracked',
    deleted: 'Deleted',
    staged: 'Added',
    renamed: 'Renamed',
    conflicted: 'Conflicted',
    unmodified: '',
  }

  const ariaLabel = statusLabels[status]

  if (isFolder) {
    // Folder: Colored dot indicator
    return (
      <span
        className="git-status-dot"
        data-git-status={status}
        aria-label={`Folder contains ${ariaLabel.toLowerCase()} files`}
        role="img"
      />
    )
  }

  // File: Letter badge
  return (
    <span
      className="git-status-badge"
      data-git-status={status}
      aria-label={ariaLabel}
      role="img"
    >
      {badge}
    </span>
  )
}
