// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ExternalFileService
 *
 * Handles secure file operations for external file drops (Spec #012).
 * Implements security validation per architect review:
 * - M1: Reuses validateSymlink() from pathSecurity.ts
 * - M2: Uses fs.realpath() to resolve symlink targets before validation
 * - M3: Blocks symlinks pointing to system directories via isSystemDirectory()
 * - M4: Composes with FileService instead of duplicating operations
 * - M5: Uses path.relative() for project boundary check to prevent prefix attacks
 * - M6: Error handling for source file deletion during operations
 * - S1: Null byte and Unicode normalization in filename sanitization
 * - S4: Filters special files (devices, pipes, sockets), not just directories
 */

import { basename, extname, join, relative, normalize, isAbsolute } from 'path'
import { lstat, realpath, copyFile, rm, access, constants } from 'fs/promises'
import type { Stats } from 'fs'
import { validateSymlink, isSystemDirectory } from '../utils/pathSecurity'
import { AppError, ErrorCode } from '../../shared/errors'
import { logger } from './LoggingService'
import type { IFileService } from '../interfaces/IFileService'
import { fileService as defaultFileService } from './FileService'
import type {
  ExternalFileValidateResponse,
  ExternalFileCopyResponse,
  ExternalFileMoveResponse,
  ConflictResolution
} from '../../shared/ipc/external-file-schema'

/** Maximum number of auto-numbered copies (e.g., file.md, file (1).md, ... file (999).md) */
const MAX_COPY_ATTEMPTS = 1000

/**
 * Interface for ExternalFileService operations
 */
export interface IExternalFileService {
  /**
   * Validate an external file for import into project
   * Performs security checks before copy/move
   */
  validateExternalFile(
    sourcePath: string,
    projectRoot: string
  ): Promise<ExternalFileValidateResponse>

  /**
   * Copy an external file into the project
   * Validates first, then delegates to FileService for copy
   */
  copyFromExternal(
    sourcePath: string,
    targetFolder: string,
    projectRoot: string,
    conflictResolution?: ConflictResolution
  ): Promise<ExternalFileCopyResponse>

  /**
   * Move an external file into the project
   * Validates first, copies, then deletes source
   */
  moveFromExternal(
    sourcePath: string,
    targetFolder: string,
    projectRoot: string,
    conflictResolution?: ConflictResolution
  ): Promise<ExternalFileMoveResponse>
}

/**
 * ExternalFileService implementation
 */
export class ExternalFileService implements IExternalFileService {
  private fileService: IFileService

  constructor(fileService?: IFileService) {
    // M4: Compose with FileService for file operations
    this.fileService = fileService || defaultFileService
  }

  /**
   * Validate an external file for import
   *
   * Security checks performed:
   * 1. Source exists and is accessible
   * 2. Source is not a directory
   * 3. Source is a regular file (not device, pipe, socket)
   * 4. If symlink, target is not a system directory
   * 5. Target folder is within project boundary
   */
  async validateExternalFile(
    sourcePath: string,
    projectRoot: string
  ): Promise<ExternalFileValidateResponse> {
    logger.debug('Validating external file', { sourcePath, projectRoot })

    // Validate inputs are absolute paths
    if (!isAbsolute(sourcePath)) {
      return {
        valid: false,
        isSymlink: false,
        isDirectory: false,
        exists: false,
        isRegularFile: false,
        error: 'Source path must be absolute',
        errorCode: ErrorCode.PATH_NOT_ABSOLUTE
      }
    }

    if (!isAbsolute(projectRoot)) {
      return {
        valid: false,
        isSymlink: false,
        isDirectory: false,
        exists: false,
        isRegularFile: false,
        error: 'Project root must be absolute',
        errorCode: ErrorCode.PATH_NOT_ABSOLUTE
      }
    }

    // Check source exists
    let sourceStats: Stats
    try {
      sourceStats = await lstat(sourcePath) // Don't follow symlinks initially
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('External file not found', { sourcePath, error: message })
      return {
        valid: false,
        isSymlink: false,
        isDirectory: false,
        exists: false,
        isRegularFile: false,
        error: 'File not found',
        errorCode: ErrorCode.EXTERNAL_FILE_NOT_FOUND
      }
    }

    const isSymlink = sourceStats.isSymbolicLink()
    const isDirectory = sourceStats.isDirectory()

    // Reject directories
    if (isDirectory) {
      logger.debug('External file is directory, rejecting', { sourcePath })
      return {
        valid: false,
        isSymlink,
        isDirectory: true,
        exists: true,
        isRegularFile: false,
        error: 'Cannot import directories',
        errorCode: ErrorCode.EXTERNAL_FILE_IS_DIRECTORY
      }
    }

    // S4: Check for special files (devices, pipes, sockets)
    const isRegular = await this.isRegularFile(sourcePath, sourceStats)
    if (!isRegular) {
      logger.debug('External file is special file, rejecting', { sourcePath })
      return {
        valid: false,
        isSymlink,
        isDirectory: false,
        exists: true,
        isRegularFile: false,
        error: 'Cannot import special files',
        errorCode: ErrorCode.EXTERNAL_FILE_NOT_REGULAR
      }
    }

    // M1/M2/M3: Validate symlinks
    if (isSymlink) {
      try {
        // M2: Resolve symlink target using fs.realpath()
        const resolvedTarget = await realpath(sourcePath)

        // M3: Block symlinks to system directories
        if (isSystemDirectory(resolvedTarget)) {
          logger.warn('External file symlink points to system directory', {
            sourcePath,
            target: resolvedTarget
          })
          return {
            valid: false,
            isSymlink: true,
            isDirectory: false,
            exists: true,
            isRegularFile: true,
            error: 'Symlink points to system directory',
            errorCode: ErrorCode.EXTERNAL_FILE_SYMLINK_SYSTEM
          }
        }

        // M1: Use existing validateSymlink for additional checks
        await validateSymlink(sourcePath)
      } catch (error) {
        if (error instanceof AppError) {
          logger.warn('External file symlink validation failed', {
            sourcePath,
            error: error.message,
            code: error.code
          })
          return {
            valid: false,
            isSymlink: true,
            isDirectory: false,
            exists: true,
            isRegularFile: true,
            error: error.message,
            errorCode: error.code
          }
        }
        // Broken symlink or other error
        const message = error instanceof Error ? error.message : String(error)
        logger.warn('External file symlink error', { sourcePath, error: message })
        return {
          valid: false,
          isSymlink: true,
          isDirectory: false,
          exists: true,
          isRegularFile: true,
          error: `Symlink validation failed: ${message}`,
          errorCode: ErrorCode.SYMLINK_ATTACK
        }
      }
    }

    logger.debug('External file validated successfully', {
      sourcePath,
      isSymlink,
      isRegularFile: true
    })

    return {
      valid: true,
      isSymlink,
      isDirectory: false,
      exists: true,
      isRegularFile: true
    }
  }

  /**
   * Copy an external file into the project
   */
  async copyFromExternal(
    sourcePath: string,
    targetFolder: string,
    projectRoot: string,
    conflictResolution?: ConflictResolution
  ): Promise<ExternalFileCopyResponse> {
    logger.info('Copying external file', { sourcePath, targetFolder, conflictResolution })

    // Validate the external file first
    const validation = await this.validateExternalFile(sourcePath, projectRoot)
    if (!validation.valid) {
      return {
        success: false,
        isSymlink: validation.isSymlink,
        error: validation.error,
        errorCode: validation.errorCode
      }
    }

    // M5: Validate target folder is within project boundary
    if (!this.isWithinProject(targetFolder, projectRoot)) {
      logger.warn('Target folder outside project boundary', { targetFolder, projectRoot })
      return {
        success: false,
        error: 'Target folder is outside project',
        errorCode: ErrorCode.PATH_OUTSIDE_PROJECT
      }
    }

    try {
      // S1: Sanitize the filename
      const originalName = basename(sourcePath)
      const sanitizedName = this.sanitizeFileName(originalName)

      // Handle conflicts based on resolution strategy
      const targetPath = await this.resolveTargetPath(
        targetFolder,
        sanitizedName,
        conflictResolution
      )

      // M6: Verify source still exists before copy (race condition check)
      try {
        await access(sourcePath, constants.R_OK)
      } catch {
        logger.error('Source file deleted during copy operation', undefined, { sourcePath })
        return {
          success: false,
          error: 'Source file was deleted',
          errorCode: ErrorCode.EXTERNAL_FILE_SOURCE_DELETED
        }
      }

      // Perform the copy
      await copyFile(sourcePath, targetPath)

      logger.info('External file copied successfully', {
        sourcePath,
        targetPath,
        isSymlink: validation.isSymlink
      })

      return {
        success: true,
        path: targetPath,
        isSymlink: validation.isSymlink
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to copy external file', error instanceof Error ? error : undefined, {
        sourcePath,
        targetFolder
      })
      return {
        success: false,
        error: message,
        errorCode: ErrorCode.EXTERNAL_FILE_COPY_FAILED
      }
    }
  }

  /**
   * Move an external file into the project
   * Copies file, then deletes source
   */
  async moveFromExternal(
    sourcePath: string,
    targetFolder: string,
    projectRoot: string,
    conflictResolution?: ConflictResolution
  ): Promise<ExternalFileMoveResponse> {
    logger.info('Moving external file', { sourcePath, targetFolder, conflictResolution })

    // Validate the external file first
    const validation = await this.validateExternalFile(sourcePath, projectRoot)
    if (!validation.valid) {
      return {
        success: false,
        isSymlink: validation.isSymlink,
        error: validation.error,
        errorCode: validation.errorCode
      }
    }

    // M5: Validate target folder is within project boundary
    if (!this.isWithinProject(targetFolder, projectRoot)) {
      logger.warn('Target folder outside project boundary', { targetFolder, projectRoot })
      return {
        success: false,
        error: 'Target folder is outside project',
        errorCode: ErrorCode.PATH_OUTSIDE_PROJECT
      }
    }

    try {
      // S1: Sanitize the filename
      const originalName = basename(sourcePath)
      const sanitizedName = this.sanitizeFileName(originalName)

      // Handle conflicts based on resolution strategy
      const targetPath = await this.resolveTargetPath(
        targetFolder,
        sanitizedName,
        conflictResolution
      )

      // M6: Verify source still exists before copy (race condition check)
      try {
        await access(sourcePath, constants.R_OK)
      } catch {
        logger.error('Source file deleted during move operation', undefined, { sourcePath })
        return {
          success: false,
          error: 'Source file was deleted',
          errorCode: ErrorCode.EXTERNAL_FILE_SOURCE_DELETED
        }
      }

      // Copy the file first
      await copyFile(sourcePath, targetPath)

      // M6: Try to delete source, but don't fail if it's already gone
      try {
        await rm(sourcePath)
        logger.debug('Source file deleted after move', { sourcePath })
      } catch (deleteError) {
        // Source might have been deleted by another process
        const code = (deleteError as NodeJS.ErrnoException).code
        if (code === 'ENOENT') {
          logger.warn('Source file already deleted during move', { sourcePath })
          // File was already deleted - operation still successful
        } else {
          // Other error - log but don't fail (file was copied successfully)
          logger.warn('Failed to delete source file after move', {
            sourcePath,
            error: deleteError instanceof Error ? deleteError.message : String(deleteError)
          })
        }
      }

      logger.info('External file moved successfully', {
        sourcePath,
        targetPath,
        isSymlink: validation.isSymlink
      })

      return {
        success: true,
        path: targetPath,
        isSymlink: validation.isSymlink
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to move external file', error instanceof Error ? error : undefined, {
        sourcePath,
        targetFolder
      })
      return {
        success: false,
        error: message,
        errorCode: ErrorCode.EXTERNAL_FILE_MOVE_FAILED
      }
    }
  }

  /**
   * Sanitize filename for safe use
   *
   * S1: Implements null byte and Unicode normalization:
   * - Remove null bytes (\x00)
   * - Normalize Unicode (NFC form)
   * - Remove path traversal sequences (../, ..\)
   * - Remove leading/trailing dots and spaces
   * - Remove path separators
   * - Limit filename length
   */
  sanitizeFileName(name: string): string {
    // Remove null bytes (security)
    // eslint-disable-next-line no-control-regex
    let sanitized = name.replace(/\u0000/g, '')

    // Normalize Unicode to NFC form (consistent representation)
    sanitized = sanitized.normalize('NFC')

    // Remove path separators and traversal patterns
    sanitized = sanitized.replace(/[/\\]/g, '')
    sanitized = sanitized.replace(/\.\./g, '')

    // Remove leading/trailing dots and spaces
    sanitized = sanitized.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '')

    // Limit length (255 is typical filesystem limit, leave room for numbering)
    const maxLength = 240
    if (sanitized.length > maxLength) {
      const ext = extname(sanitized)
      const nameWithoutExt = sanitized.slice(0, -ext.length || undefined)
      sanitized = nameWithoutExt.slice(0, maxLength - ext.length) + ext
    }

    // If empty after sanitization, use default name
    if (!sanitized || sanitized === '.md' || sanitized === '.markdown') {
      sanitized = 'imported-file.md'
    }

    return sanitized
  }

  /**
   * Check if a path is a regular file (not device, pipe, socket)
   *
   * S4: Filters special files that shouldn't be imported
   */
  private async isRegularFile(filePath: string, stats?: Stats): Promise<boolean> {
    try {
      const fileStats = stats || (await lstat(filePath))

      // Regular files and symlinks (to files) are allowed
      // Directories, block devices, character devices, FIFOs, sockets are rejected
      if (
        fileStats.isBlockDevice() ||
        fileStats.isCharacterDevice() ||
        fileStats.isFIFO() ||
        fileStats.isSocket()
      ) {
        return false
      }

      // If symlink, check what it points to
      if (fileStats.isSymbolicLink()) {
        try {
          const targetPath = await realpath(filePath)
          const targetStats = await lstat(targetPath)
          // Target must be a regular file
          return (
            targetStats.isFile() &&
            !targetStats.isBlockDevice() &&
            !targetStats.isCharacterDevice() &&
            !targetStats.isFIFO() &&
            !targetStats.isSocket()
          )
        } catch {
          // Broken symlink
          return false
        }
      }

      return fileStats.isFile()
    } catch {
      return false
    }
  }

  /**
   * Check if a path is within the project boundary
   *
   * M5: Uses path.relative() to prevent prefix attacks
   * e.g., /project-evil could match /project prefix check
   */
  private isWithinProject(targetPath: string, projectRoot: string): boolean {
    const normalizedTarget = normalize(targetPath)
    const normalizedRoot = normalize(projectRoot)

    // Use relative path to check containment
    const relativePath = relative(normalizedRoot, normalizedTarget)

    // If relative path starts with '..' or is absolute, target is outside project
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      return false
    }

    return true
  }

  /**
   * Resolve target path based on conflict resolution strategy
   */
  private async resolveTargetPath(
    targetFolder: string,
    fileName: string,
    conflictResolution?: ConflictResolution
  ): Promise<string> {
    const targetPath = join(targetFolder, fileName)

    // Check if conflict exists
    const hasConflict = await this.fileService.checkNameConflict(targetFolder, fileName)

    if (!hasConflict) {
      return targetPath
    }

    if (conflictResolution === 'replace') {
      // Caller will handle replacement
      return targetPath
    }

    // Default to keepBoth: generate unique name with (1), (2), etc.
    const ext = extname(fileName)
    const nameWithoutExt = ext ? fileName.slice(0, -ext.length) : fileName
    let copyNumber = 1
    let newPath = targetPath

    while (await this.fileService.checkNameConflict(targetFolder, basename(newPath))) {
      newPath = join(targetFolder, `${nameWithoutExt} (${copyNumber})${ext}`)
      copyNumber++

      // Safety limit
      if (copyNumber > MAX_COPY_ATTEMPTS) {
        throw new AppError(
          `Cannot create more than ${MAX_COPY_ATTEMPTS} copies with the same name`,
          ErrorCode.EXTERNAL_FILE_COPY_FAILED
        )
      }
    }

    return newPath
  }
}

/**
 * Factory function to create ExternalFileService instance
 * Enables dependency injection and testing
 */
export function createExternalFileService(fileService?: IFileService): IExternalFileService {
  return new ExternalFileService(fileService)
}

// Singleton instance for backward compatibility
export const externalFileService = createExternalFileService()
