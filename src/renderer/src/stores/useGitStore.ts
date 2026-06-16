// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Git Store - Zustand State Management
 * ======================================
 * Manages git status state for Project Tree display
 */

import { create } from 'zustand'
import type { GitDisplayStatus, GitStatusResponse, GitStatusCounts } from '../../../shared/ipc/git-schema'
import { calculateFolderStatuses } from '../utils/gitStatus.logic'

interface GitState {
  // Status data
  isGitRepo: boolean
  branch: string | null
  isDetached: boolean
  fileStatuses: Map<string, GitDisplayStatus>
  folderStatuses: Map<string, GitDisplayStatus>
  counts: GitStatusCounts
  truncated: boolean
  error: string | null

  // Refresh state
  isRefreshing: boolean
  lastRefreshTime: number

  // Actions
  setStatus: (response: GitStatusResponse) => void
  setRefreshing: (refreshing: boolean) => void
  getFileStatus: (path: string) => GitDisplayStatus | undefined
  getFolderStatus: (path: string) => GitDisplayStatus | undefined
  clear: () => void
}

const initialCounts: GitStatusCounts = {
  modified: 0,
  untracked: 0,
  deleted: 0,
  staged: 0,
  conflicted: 0,
}

export const useGitStore = create<GitState>((set, get) => ({
  // Initial state
  isGitRepo: false,
  branch: null,
  isDetached: false,
  fileStatuses: new Map<string, GitDisplayStatus>(),
  folderStatuses: new Map<string, GitDisplayStatus>(),
  counts: initialCounts,
  truncated: false,
  error: null,
  isRefreshing: false,
  lastRefreshTime: 0,

  // Set git status from response
  setStatus: (response: GitStatusResponse) => {
    // Build file status map
    const fileStatuses = new Map<string, GitDisplayStatus>()
    for (const file of response.files) {
      fileStatuses.set(file.path, file.status)
    }

    // Calculate folder statuses via propagation logic
    const folderStatuses = calculateFolderStatuses(response.files)

    set({
      isGitRepo: response.isGitRepo,
      branch: response.branch,
      isDetached: response.isDetached,
      fileStatuses,
      folderStatuses,
      counts: response.counts,
      truncated: response.truncated,
      error: response.error || null,
      lastRefreshTime: Date.now(),
    })
  },

  // Set refreshing state
  setRefreshing: (refreshing: boolean) =>
    set({ isRefreshing: refreshing }),

  // Get status for a file
  getFileStatus: (path: string) =>
    get().fileStatuses.get(path),

  // Get status for a folder
  getFolderStatus: (path: string) =>
    get().folderStatuses.get(path),

  // Clear all status data
  clear: () =>
    set({
      isGitRepo: false,
      branch: null,
      isDetached: false,
      fileStatuses: new Map<string, GitDisplayStatus>(),
      folderStatuses: new Map<string, GitDisplayStatus>(),
      counts: initialCounts,
      truncated: false,
      error: null,
      isRefreshing: false,
      lastRefreshTime: 0,
    }),
}))
