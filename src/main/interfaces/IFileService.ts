// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { FileNode } from '../../shared/ipc/file-schema'
import type { ImageReadResponse } from '../../shared/ipc/file-image-schema'
import type { ProjectPathFilter } from '../utils/projectPathFilter'
import type { ProjectSession } from '../services/session/ProjectSession'

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
  readDirectory(dirPath: string, options?: { shallow?: boolean }): Promise<FileNode[]>

  /**
   * Files of one name below a folder, bounded (terminal links on an incomplete tree)
   */
  findByName(dirPath: string, name: string): Promise<{ paths: string[]; truncated: boolean }>

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
   * Read an image as a base64 data URL, or report it as unchanged when the
   * caller's `knownVersion` still matches the file on disk (#70).
   */
  readImage(filePath: string, knownVersion?: string): Promise<ImageReadResponse>


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

  /**
   * Set the project's path filter (#211, called by ProjectService on project
   * open): tree walks skip excluded entries without reading them, and every
   * completed walk of the project root replaces the filter's walk hints
   * (read them with `filter.getWalkHints()`). Null means no exclusion.
   */
  setPathFilter(filter: ProjectPathFilter | null): void

  /**
   * Give the service the open-project session (called once by `ProjectService`),
   * so it can refuse to delete or move the project root by its canonical path.
   */
  bindSession?(session: Pick<ProjectSession, 'current'>): void
}
