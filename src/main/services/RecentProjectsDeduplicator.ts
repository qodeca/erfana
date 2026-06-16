// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * RecentProjectsDeduplicator
 *
 * REFACTORING (todo014): Extract duplicate removal from SettingsService
 *
 * Handles duplicate detection and removal using canonical path comparison.
 * Prevents duplicates on case-insensitive filesystems (macOS, Windows) and
 * symlink duplicates.
 *
 * Single Responsibility: Duplicate detection using filesystem-aware comparison
 */

import { realpath } from 'fs/promises'
import { RecentProject } from './SettingsService'

export class RecentProjectsDeduplicator {
  /**
   * Get canonical path for comparison (resolves case and symlinks)
   * Returns original path if resolution fails
   */
  private async getCanonicalPathAsync(path: string): Promise<string> {
    try {
      return await realpath(path)
    } catch {
      // Path doesn't exist or not accessible, return as-is
      return path
    }
  }

  /**
   * Remove duplicates from project list
   *
   * Uses canonical path comparison to handle:
   * - Case-insensitive filesystems (macOS: /Users/foo vs /users/foo)
   * - Symlinks pointing to same directory
   *
   * @param projects - Existing project list
   * @param newPath - New project path to filter out
   * @returns Filtered list without duplicates
   */
  async removeDuplicates(
    projects: RecentProject[],
    newPath: string
  ): Promise<RecentProject[]> {
    // Resolve all paths in parallel for performance
    const canonicalPath = await this.getCanonicalPathAsync(newPath)
    const canonicalPaths = await Promise.all(
      projects.map((p) => this.getCanonicalPathAsync(p.path))
    )

    // Filter out any project matching the new path
    return projects.filter((_p, i) => canonicalPaths[i] !== canonicalPath)
  }
}
