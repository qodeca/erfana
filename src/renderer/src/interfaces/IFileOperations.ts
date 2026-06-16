// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Interface for file operations required by clipboard store
 * Enables dependency injection and testing
 */
export interface IFileOperations {
  /**
   * Move a file or folder to a new parent directory
   * @param replaceExisting - If true, delete existing item at target before moving
   */
  moveItem(
    sourcePath: string,
    targetParentPath: string,
    newName?: string,
    replaceExisting?: boolean
  ): Promise<{ path: string; isSymlink?: boolean }>

  /**
   * Copy a file or folder to a new location
   */
  copyItem(
    sourcePath: string,
    targetParentPath: string,
    newName?: string
  ): Promise<{ path: string; isSymlink?: boolean }>
}
