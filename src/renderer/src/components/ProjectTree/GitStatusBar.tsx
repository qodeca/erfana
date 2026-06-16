// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Git Status Bar Component
 * =========================
 * Footer bar showing git branch and status counts
 *
 * Layout: [Branch] | [Counts]
 */

import { GitBranch, AlertTriangle } from 'lucide-react'
import type { GitStatusCounts } from '../../../../shared/ipc/git-schema'
import { TEST_IDS } from '../../constants/testids'

interface GitStatusBarProps {
  isGitRepo: boolean
  branch: string | null
  isDetached: boolean
  counts: GitStatusCounts
  truncated: boolean
}

/**
 * Git status footer bar for Project Tree
 * Only renders if project is a git repository
 */
export function GitStatusBar({
  isGitRepo,
  branch,
  isDetached,
  counts,
  truncated,
}: GitStatusBarProps) {
  // Don't render if not a git repo
  if (!isGitRepo) {
    return null
  }

  // Display branch name (or HEAD for detached)
  const branchDisplay = isDetached ? 'HEAD (detached)' : (branch || 'unknown')

  // Build counts with status type for coloring
  const countsItems: { label: string; status: string }[] = []
  if (counts.modified > 0) countsItems.push({ label: `M${counts.modified}`, status: 'modified' })
  if (counts.untracked > 0) countsItems.push({ label: `U${counts.untracked}`, status: 'untracked' })
  if (counts.deleted > 0) countsItems.push({ label: `D${counts.deleted}`, status: 'deleted' })
  if (counts.staged > 0) countsItems.push({ label: `A${counts.staged}`, status: 'staged' })
  if (counts.conflicted > 0) countsItems.push({ label: `!${counts.conflicted}`, status: 'conflicted' })

  return (
    <div className="git-status-bar" data-testid={TEST_IDS.GIT_STATUS_BAR}>
      {/* Branch name */}
      <div className="git-branch" data-testid={TEST_IDS.GIT_BRANCH_NAME}>
        <GitBranch size={14} />
        <span>{branchDisplay}</span>
      </div>

      {/* Status counts */}
      <div className="git-counts" data-testid={TEST_IDS.GIT_STATUS_COUNTS}>
        {countsItems.length > 0 ? (
          countsItems.map((item, index) => (
            <span key={index} className="git-count-item" data-git-status={item.status}>
              {item.label}
            </span>
          ))
        ) : (
          <span className="git-count-clean">Clean</span>
        )}
        {truncated && (
          <span
            className="git-truncated-warning"
            title="Too many changes - showing first 10,000 files"
            data-testid={TEST_IDS.GIT_SYNC_INDICATOR}
          >
            <AlertTriangle size={14} />
          </span>
        )}
      </div>
    </div>
  )
}
