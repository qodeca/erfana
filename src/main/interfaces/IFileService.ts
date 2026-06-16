// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { FileNode } from '../../preload/index'

/**
 * Interface for file system operations
 * Enables dependency inversion and testability
 */
export interface IFileService {
  /**
   * Set the project root path for boundary validation
   */
  setProjectPath(path: string): void

  /**
   * Get the current project root path
   */
  getProjectPath(): string | null

  /**
   * Read directory contents recursively
   */
  readDirectory(dirPath: string): Promise<FileNode[]>

  /**
   * Read file contents
   */
  readFile(filePath: string): Promise<string>

  /**
   * Write file contents
   */
  writeFile(filePath: string, content: string): Promise<void>

  /**
   * Get file statistics
   */
  getFileStats(filePath: string): Promise<{
    isFile: () => boolean
    isDirectory: () => boolean
    size: number
    mtime: Date
    birthtime: Date
  }>

  /**
   * Check if file is a markdown file
   */
  isMarkdownFile(filePath: string): boolean

  /**
   * Check if file is a supported image file
   */
  isImageFile(filePath: string): boolean

  /**
   * Read a file and return it as a base64-encoded data URL.
   * Used for loading images in the sandboxed renderer.
   */
  readFileAsBase64(filePath: string): Promise<string>

  /**
   * Create a new file
   */
  createFile(dirPath: string, fileName: string): Promise<string>

  /**
   * Create a new folder
   */
  createFolder(dirPath: string, folderName: string): Promise<string>

  /**
   * Delete a file
   */
  deleteFile(filePath: string): Promise<void>

  /**
   * Delete a folder
   */
  deleteFolder(folderPath: string): Promise<void>

  /**
   * Rename a file or folder
   */
  rename(oldPath: string, newName: string): Promise<string>

  /**
   * Move a file or folder to a new parent directory
   * Returns path and symlink indicator
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
   * Returns path and symlink indicator
   */
  copyItem(
    sourcePath: string,
    targetParentPath: string,
    newName?: string
  ): Promise<{ path: string; isSymlink?: boolean }>

  /**
   * Check if a name conflicts with existing items in target directory
   */
  checkNameConflict(targetParentPath: string, itemName: string): Promise<boolean>

  /**
   * Set custom hidden patterns (called by ProjectService after loading settings)
   */
  setHiddenPatterns(patterns: string[]): void

  /**
   * Get current hidden patterns
   */
  getHiddenPatterns(): string[]
}
