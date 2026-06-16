// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { lstat } from 'fs/promises'
import type { Dirent } from 'fs'

/**
 * SymlinkDetector handles symlink detection for file system entries
 * Provides both sync (from Dirent) and async (from file path) detection
 *
 * Example:
 *   const detector = new SymlinkDetector()
 *   const isSymlink = await detector.checkPath('/some/path')
 *   const isSymlinkDirent = detector.checkDirent(direntEntry)
 */
export class SymlinkDetector {
  /**
   * Check if a file system path is a symlink
   * Uses lstat to avoid following the link
   */
  async checkPath(filePath: string): Promise<boolean> {
    try {
      const stats = await lstat(filePath)
      return stats.isSymbolicLink()
    } catch {
      // If lstat fails, treat as non-symlink
      return false
    }
  }

  /**
   * Check if a Dirent entry is a symlink
   * Faster than checkPath as it doesn't require file system access
   */
  checkDirent(entry: Dirent): boolean {
    return entry.isSymbolicLink()
  }

  /**
   * Convert boolean symlink status to optional flag (for API responses)
   * Returns undefined for false to reduce payload size
   */
  toOptionalFlag(isSymlink: boolean): boolean | undefined {
    return isSymlink || undefined
  }
}
