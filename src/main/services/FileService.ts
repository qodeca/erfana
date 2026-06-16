// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { readdir, readFile, writeFile, stat, rm, mkdir, rename as fsRename, cp, copyFile } from 'fs/promises'
import { join, extname, basename, relative } from 'path'
import type { IFileService } from '../interfaces/IFileService'
import { SymlinkDetector } from '../utils/SymlinkDetector'
import { RollbackHandler } from '../utils/RollbackHandler'
import { assertValidUserFilename } from '../utils/validateFilename'
import { DEFAULT_TREE_HIDDEN_PATTERNS } from '../../shared/constants'
import { logger } from './LoggingService'

/**
 * Supported image extensions for readFileAsBase64.
 * Matches IMAGE_EXTENSIONS in renderer/src/utils/imageUtils.ts
 */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']

/**
 * MIME type mapping for image extensions.
 */
const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon'
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  extension?: string
  isSymlink?: boolean
}

// Maximum number of auto-numbered copies before rejecting operation (e.g., file.md, file (1).md, ... file (999).md)
export const MAX_COPY_ATTEMPTS = 1000

export class FileService implements IFileService {
  private projectPath: string | null = null
  private symlinkDetector = new SymlinkDetector()
  private rollbackHandler = new RollbackHandler()

  // Dynamic hidden patterns (configurable per-project via .erfana/settings.json)
  private hiddenPatterns: string[] = [...DEFAULT_TREE_HIDDEN_PATTERNS]

  // One-time flag for logging active hidden patterns per project
  private hasLoggedPatterns = false

  /**
   * Set custom hidden patterns (called by ProjectService after loading settings)
   */
  setHiddenPatterns(patterns: string[]): void {
    this.hiddenPatterns = patterns
  }

  /**
   * Get current hidden patterns
   */
  getHiddenPatterns(): string[] {
    return [...this.hiddenPatterns]
  }

  setProjectPath(path: string): void {
    this.projectPath = path
    this.hasLoggedPatterns = false
  }

  getProjectPath(): string | null {
    return this.projectPath
  }

  async readDirectory(dirPath: string): Promise<FileNode[]> {
    const start = performance.now()
    const result = await this._readDirectoryInternal(dirPath, 0)
    const durationMs = Math.round(performance.now() - start)

    // Count files and directories in result
    const counts = this.countNodes(result)

    logger.info('FileService: readDirectory completed', {
      durationMs,
      fileCount: counts.files,
      dirCount: counts.dirs,
      hiddenPatternCount: counts.hiddenPatternCount,
      maxDepth: counts.maxDepth
    })

    // Log hidden patterns once per project
    if (!this.hasLoggedPatterns) {
      this.hasLoggedPatterns = true
      logger.debug('FileService: hidden patterns active', { patterns: this.hiddenPatterns })
    }

    return result
  }

  /**
   * Count files, directories, and max depth in a tree
   */
  private countNodes(nodes: FileNode[]): { files: number; dirs: number; hiddenPatternCount: number; maxDepth: number } {
    let files = 0
    let dirs = 0
    let maxDepth = 0

    const walk = (items: FileNode[], depth: number): void => {
      for (const item of items) {
        if (item.type === 'file') files++
        else {
          dirs++
          if (item.children && item.children.length > 0) {
            if (depth + 1 > maxDepth) maxDepth = depth + 1
            walk(item.children, depth + 1)
          }
        }
      }
    }

    walk(nodes, 0)
    return { files, dirs, hiddenPatternCount: this.hiddenPatterns.length, maxDepth }
  }

  private async _readDirectoryInternal(dirPath: string, depth: number): Promise<FileNode[]> {
    const entries = await readdir(dirPath, { withFileTypes: true })
    const nodes: FileNode[] = []

    for (const entry of entries) {
      // Skip hidden directories (configurable via .erfana/settings.json)
      if (this.hiddenPatterns.includes(entry.name)) {
        continue
      }

      const fullPath = join(dirPath, entry.name)
      const node: FileNode = {
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory() ? 'directory' : 'file'
      }
      // Flag symlinks for UI indication/security awareness
      if (this.symlinkDetector.checkDirent(entry)) {
        node.isSymlink = true
      }

      if (node.type === 'file') {
        node.extension = extname(entry.name)
      }

      // Recursively read subdirectories for markdown files
      if (node.type === 'directory') {
        try {
          node.children = await this._readDirectoryInternal(fullPath, depth + 1)
        } catch (error) {
          logger.warn('FileService: readDirectory error recovered', { path: fullPath, error: error instanceof Error ? error.message : String(error) })
          node.children = []
        }
      }

      nodes.push(node)
    }

    // Sort: directories first, then files alphabetically
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  }

  async readFile(filePath: string): Promise<string> {
    return await readFile(filePath, 'utf-8')
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await writeFile(filePath, content, 'utf-8')
  }

  async getFileStats(filePath: string) {
    return await stat(filePath)
  }

  isMarkdownFile(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase()
    return ext === '.md' || ext === '.markdown'
  }

  /**
   * Check if a file is a supported image file by extension.
   *
   * @param filePath - File path to check
   * @returns True if the file has a supported image extension
   */
  isImageFile(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase()
    return IMAGE_EXTENSIONS.includes(ext)
  }

  /**
   * Read a file and return it as a base64-encoded data URL.
   *
   * Used by ImageViewerPanel to load images in the sandboxed renderer.
   * Constructs a data URL like: data:image/png;base64,iVBORw0KGgo...
   *
   * @param filePath - Absolute path to the image file
   * @returns Data URL string for use in <img src="...">
   * @throws Error if file doesn't exist or is not a supported image type
   *
   * @example
   * ```ts
   * const dataUrl = await fileService.readFileAsBase64('/path/to/image.png');
   * // Returns: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB..."
   * ```
   */
  async readFileAsBase64(filePath: string): Promise<string> {
    const ext = extname(filePath).toLowerCase()

    // Validate file extension
    if (!IMAGE_EXTENSIONS.includes(ext)) {
      throw new Error(`Unsupported image format: ${ext}`)
    }

    // Security: Limit file size to prevent memory exhaustion (DoS)
    // Base64 encoding increases size by ~33%, so 50MB file becomes ~67MB string
    const MAX_IMAGE_SIZE = 50 * 1024 * 1024 // 50 MB
    const stats = await stat(filePath)
    if (stats.size > MAX_IMAGE_SIZE) {
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(1)
      throw new Error(`Image file too large (${sizeMB} MB). Maximum size is 50 MB.`)
    }

    // Get MIME type
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream'

    // Read file as buffer and convert to base64
    const buffer = await readFile(filePath)
    const base64 = buffer.toString('base64')

    return `data:${mimeType};base64,${base64}`
  }

  async createFile(dirPath: string, fileName: string): Promise<string> {
    // Strip path separators FIRST — prevents `../../etc/passwd` style traversal
    // before `join()`. Sibling methods `createFolder` and `rename` already do
    // this; `createFile` was missing the strip until the Phase 2 review.
    fileName = fileName.replace(/[/\\]/g, '')

    if (!fileName) {
      throw new Error('File name cannot be empty')
    }

    // Ensure .md extension
    if (!fileName.endsWith('.md') && !fileName.endsWith('.markdown')) {
      fileName = `${fileName}.md`
    }

    // #161: reject reserved Windows names (CON, PRN, COM1-9, LPT1-9) and
    // forbidden chars (`<>:"/\|?*` on Windows), trailing dots/spaces,
    // control chars, bidi overrides. POSIX rejects only the universal
    // portability-breaking classes (control chars, bidi, empty, too long).
    assertValidUserFilename(fileName)

    const filePath = join(dirPath, fileName)

    // Check if file already exists
    try {
      await stat(filePath)
      throw new Error(`File "${fileName}" already exists`)
    } catch (error) {
      // File doesn't exist - good, we can create it
      const code = (error as { code?: unknown }).code
      if (code !== 'ENOENT') {
        throw error
      }
    }

    // Create empty file
    await writeFile(filePath, '', 'utf-8')

    return filePath
  }

  async createFolder(dirPath: string, folderName: string): Promise<string> {
    // Sanitize folder name - remove path separators
    folderName = folderName.replace(/[/\\]/g, '')

    if (!folderName) {
      throw new Error('Folder name cannot be empty')
    }

    // #161: validate reserved names, forbidden chars, etc. (platform-aware).
    assertValidUserFilename(folderName)

    const folderPath = join(dirPath, folderName)

    // Check if folder already exists
    try {
      await stat(folderPath)
      throw new Error(`Folder "${folderName}" already exists`)
    } catch (error) {
      // Folder doesn't exist - good, we can create it
      const code = (error as { code?: unknown }).code
      if (code !== 'ENOENT') {
        throw error
      }
    }

    // Create folder
    await mkdir(folderPath)

    return folderPath
  }

  async deleteFile(filePath: string): Promise<void> {
    // Verify it's a file, not a directory
    const stats = await stat(filePath)
    if (stats.isDirectory()) {
      throw new Error('Cannot delete a directory using deleteFile. Use deleteFolder instead.')
    }

    // Prevent deleting files outside project
    if (this.projectPath && !filePath.startsWith(this.projectPath)) {
      throw new Error('Cannot delete files outside the project directory')
    }

    await rm(filePath)
  }

  async deleteFolder(folderPath: string): Promise<void> {
    // Verify it's a directory
    const stats = await stat(folderPath)
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory')
    }

    // Prevent deleting project root
    if (this.projectPath && folderPath === this.projectPath) {
      throw new Error('Cannot delete the project root directory')
    }

    // Prevent deleting folders outside project
    if (this.projectPath && !folderPath.startsWith(this.projectPath)) {
      throw new Error('Cannot delete folders outside the project directory')
    }

    // Delete folder recursively
    await rm(folderPath, { recursive: true, force: true })
  }

  async rename(oldPath: string, newName: string): Promise<string> {
    // Sanitize new name - remove path separators
    newName = newName.replace(/[/\\]/g, '')

    if (!newName) {
      throw new Error('Name cannot be empty')
    }

    // #161: validate reserved names, forbidden chars, etc. (platform-aware).
    assertValidUserFilename(newName)

    // Get the directory and construct new path
    const { dirname } = await import('path')
    const parentDir = dirname(oldPath)
    const newPath = join(parentDir, newName)

    // Check if already exists
    try {
      await stat(newPath)
      throw new Error(`"${newName}" already exists`)
    } catch (error) {
      // File/folder doesn't exist - good, we can rename
      const code = (error as { code?: unknown }).code
      if (code !== 'ENOENT') {
        throw error
      }
    }

    // Prevent renaming files/folders outside project
    if (this.projectPath && !oldPath.startsWith(this.projectPath)) {
      throw new Error('Cannot rename items outside the project directory')
    }

    // Prevent renaming project root
    if (this.projectPath && oldPath === this.projectPath) {
      throw new Error('Cannot rename the project root directory')
    }

    // Perform the rename
    const { rename } = await import('fs/promises')
    await rename(oldPath, newPath)

    return newPath
  }

  /**
   * Check if a name conflicts with existing items in target directory (case-insensitive)
   */
  async checkNameConflict(targetParentPath: string, itemName: string): Promise<boolean> {
    try {
      const entries = await readdir(targetParentPath)
      const lowerName = itemName.toLowerCase()
      return entries.some(entry => entry.toLowerCase() === lowerName)
    } catch {
      // If directory doesn't exist or can't be read, no conflict
      return false
    }
  }

  /**
   * Check if a path is a descendant of another path
   */
  private isDescendant(possibleDescendant: string, possibleAncestor: string): boolean {
    const rel = relative(possibleAncestor, possibleDescendant)
    return !rel.startsWith('..') && !join(possibleAncestor, rel).startsWith(possibleDescendant)
  }

  /**
   * Move a file or folder to a new parent directory
   * Uses fs.rename() for same-filesystem moves, falls back to copy+delete for cross-filesystem
   * @param replaceExisting - If true, delete existing item at target before moving
   */
  async moveItem(sourcePath: string, targetParentPath: string, newName?: string, replaceExisting?: boolean): Promise<{ path: string; isSymlink?: boolean }> {
    // Validate source exists and check if it's a symlink
    const sourceStats = await stat(sourcePath)
    const isSymlink = await this.symlinkDetector.checkPath(sourcePath)
    const sourceItemName = basename(sourcePath)
    const finalName = newName || sourceItemName

    // Validate target parent is a directory
    const targetStats = await stat(targetParentPath)
    if (!targetStats.isDirectory()) {
      throw new Error('Target must be a directory')
    }

    // Construct final target path
    const targetPath = join(targetParentPath, finalName)

    // Prevent moving to the same location
    if (sourcePath === targetPath) {
      throw new Error('Source and target paths are the same')
    }

    // Prevent moving project root
    if (this.projectPath && sourcePath === this.projectPath) {
      throw new Error('Cannot move the project root directory')
    }

    // Prevent moving items outside project
    if (this.projectPath && !sourcePath.startsWith(this.projectPath)) {
      throw new Error('Cannot move items outside the project directory')
    }

    // Prevent moving items to outside project
    if (this.projectPath && !targetParentPath.startsWith(this.projectPath)) {
      throw new Error('Cannot move items to outside the project directory')
    }

    // Prevent circular move (folder into its own descendant)
    if (sourceStats.isDirectory() && this.isDescendant(targetParentPath, sourcePath)) {
      throw new Error('Cannot move a folder into its own subfolder')
    }

    // Check if target already exists (case-insensitive for cross-platform compatibility)
    const conflictExists = await this.checkNameConflict(targetParentPath, finalName)
    if (conflictExists) {
      if (replaceExisting) {
        // Delete existing item before move
        const existingItemPath = join(targetParentPath, finalName)
        try {
          const existingStats = await stat(existingItemPath)

          if (existingStats.isDirectory()) {
            await rm(existingItemPath, { recursive: true, force: true })
          } else {
            await rm(existingItemPath)
          }

          logger.info('Replaced existing item', { path: existingItemPath })
        } catch (deleteError) {
          const message = deleteError instanceof Error ? deleteError.message : String(deleteError)
          throw new Error(`Failed to replace existing item: ${message}`)
        }
      } else {
        throw new Error(`An item named "${finalName}" already exists in the target location`)
      }
    }

    // Try fs.rename first (fast, atomic for same filesystem)
    try {
      await fsRename(sourcePath, targetPath)
      return { path: targetPath, isSymlink: this.symlinkDetector.toOptionalFlag(isSymlink) }
    } catch (error) {
      const code = (error as { code?: string }).code

      // EXDEV error means cross-filesystem move, fallback to copy+delete with rollback
      if (code === 'EXDEV') {
        // Copy to target
        if (sourceStats.isDirectory()) {
          await cp(sourcePath, targetPath, { recursive: true, preserveTimestamps: true })
        } else {
          await copyFile(sourcePath, targetPath)
        }

        // Delete original after successful copy
        try {
          await rm(sourcePath, { recursive: true, force: true })
        } catch (deleteError) {
          // Rollback: Delete the copied item if original deletion fails
          await this.rollbackHandler.rollbackCopyOnDeleteFailure(
            sourcePath,
            targetPath,
            deleteError
          )
        }

        return { path: targetPath, isSymlink: this.symlinkDetector.toOptionalFlag(isSymlink) }
      }

      // Other errors, rethrow
      throw error
    }
  }

  /**
   * Copy a file or folder to a new location with automatic name conflict resolution
   */
  async copyItem(sourcePath: string, targetParentPath: string, newName?: string): Promise<{ path: string; isSymlink?: boolean }> {
    // Validate source exists and check if it's a symlink
    const sourceStats = await stat(sourcePath)
    const isSymlink = await this.symlinkDetector.checkPath(sourcePath)
    const sourceItemName = basename(sourcePath)
    const finalName = newName || sourceItemName

    // Validate target parent is a directory
    const targetStats = await stat(targetParentPath)
    if (!targetStats.isDirectory()) {
      throw new Error('Target must be a directory')
    }

    // Prevent copying items outside project
    if (this.projectPath && !sourcePath.startsWith(this.projectPath)) {
      throw new Error('Cannot copy items outside the project directory')
    }

    // Prevent copying items to outside project
    if (this.projectPath && !targetParentPath.startsWith(this.projectPath)) {
      throw new Error('Cannot copy items to outside the project directory')
    }

    // Handle name conflicts by adding (1), (2), etc.
    let targetPath = join(targetParentPath, finalName)
    let copyNumber = 1

    while (await this.checkNameConflict(targetParentPath, basename(targetPath))) {
      // Extract name and extension
      const ext = extname(finalName)
      const nameWithoutExt = ext ? finalName.slice(0, -ext.length) : finalName

      // Generate new name with copy number
      targetPath = join(targetParentPath, `${nameWithoutExt} (${copyNumber})${ext}`)
      copyNumber++

      // Safety limit to prevent infinite loops
      if (copyNumber > MAX_COPY_ATTEMPTS) {
        throw new Error(`Cannot create more than ${MAX_COPY_ATTEMPTS} copies with the same name`)
      }
    }

    // Perform the copy
    if (sourceStats.isDirectory()) {
      await cp(sourcePath, targetPath, { recursive: true, preserveTimestamps: true })
    } else {
      await copyFile(sourcePath, targetPath)
    }

    return { path: targetPath, isSymlink: this.symlinkDetector.toOptionalFlag(isSymlink) }
  }
}

/**
 * Factory function to create FileService instance
 * Enables dependency injection and testing
 */
export function createFileService(): IFileService {
  return new FileService()
}

// Singleton instance for backward compatibility
// TODO: Remove after all consumers use dependency injection
export const fileService = createFileService()
