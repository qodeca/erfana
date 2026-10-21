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
 * - M5: The target folder is resolved against the open project by the IPC layer (confinement);
 *       this service acts on the checked path it is handed
 * - M6: Error handling for source file deletion during operations
 * - S1: Null byte and Unicode normalization in filename sanitization
 * - S4: Filters special files (devices, pipes, sockets), not just directories
 */

import { basename, dirname, extname, isAbsolute } from 'path'
import { randomUUID } from 'crypto'
import { lstat, stat, realpath, copyFile, rename, rm, access, constants } from 'fs/promises'
import type { Stats } from 'fs'
import { validateSymlink, isSystemDirectory } from '../utils/pathSecurity'
import { AppError, ErrorCode, ERROR_MESSAGES } from '../../shared/errors'
import { logger } from './LoggingService'
import { redactPath, redactedLogError } from '../utils/redactUserInput'
import { childPath } from '../utils/childPath'
import { ATOMIC_TEMP_PREFIX } from '../utils/atomicWrite'
import { normaliseResolved } from '../utils/pathCompare'
import type { MoveAnswer, MoveConfirmer } from './ExternalMoveConfirmer'
import { externalSourceGrants as defaultGrants, type ExternalSourceGrants } from './ExternalSourceGrants'
import type { IFileService } from '../interfaces/IFileService'
import { fileService as defaultFileService } from './FileService'
import type {
  ExternalFileValidateResponse,
  ExternalFileCopyResponse,
  ExternalFileMoveResponse,
  ConflictResolution
} from '../../shared/ipc/external-file-schema'

/** Error message safe to log: quoted absolute paths in errno messages are replaced. */
function redactedMessage(error: unknown): string {
  return redactedLogError(error)?.message ?? String(error)
}

/** Errors a rename gives when another program holds the destination open */
const RENAME_BUSY_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES'])

/** Maximum number of auto-numbered copies (e.g., file.md, file (1).md, ... file (999).md) */
const MAX_COPY_ATTEMPTS = 1000

/**
 * A target folder the IPC layer has already checked against the open project.
 * The service acts on `real` and hands paths built from `requested` back.
 */
export interface ExternalTarget {
  /** Canonical folder the file is written into */
  real: string
  /** The folder as the caller wrote it; returned paths are built from it */
  requested: string
}

/** One file of a batch move, with the way its name conflict was settled. */
export interface ExternalMoveItem {
  sourcePath: string
  conflictResolution?: ConflictResolution
}

/**
 * Interface for ExternalFileService operations
 */
export interface IExternalFileService {
  /**
   * Who is asked before a file that was not picked in the dialog is moved.
   * Without one, such a move is refused.
   */
  setMoveConfirmer(confirmer: MoveConfirmer | null): void

  /**
   * Validate an external file for import into project
   * Performs security checks before copy/move
   */
  validateExternalFile(sourcePath: string): Promise<ExternalFileValidateResponse>

  /**
   * Copy an external file into the project
   * Validates first, then delegates to FileService for copy
   */
  copyFromExternal(
    sourcePath: string,
    target: ExternalTarget,
    conflictResolution?: ConflictResolution
  ): Promise<ExternalFileCopyResponse>

  /**
   * Move an external file into the project
   * Validates, asks the user to confirm, checks again that nothing changed
   * (`recheckTarget` answers false when the target no longer resolves the same),
   * copies, then deletes source
   */
  moveFromExternal(
    sourcePath: string,
    target: ExternalTarget,
    senderId: number | null,
    conflictResolution?: ConflictResolution,
    recheckTarget?: () => Promise<boolean>,
    decided?: MoveAnswer
  ): Promise<ExternalFileMoveResponse>

  /**
   * Move several external files into the project after ONE confirmation: the
   * files that can be moved at all are put to the user together, so a drop of
   * many files shows one box, not one per file. Answers one result per item, in
   * order; a cancelled or unavailable answer moves nothing.
   */
  moveBatchFromExternal(
    items: readonly ExternalMoveItem[],
    target: ExternalTarget,
    senderId: number | null,
    recheckTarget?: () => Promise<boolean>
  ): Promise<ExternalFileMoveResponse[]>
}

/**
 * ExternalFileService implementation
 */
export class ExternalFileService implements IExternalFileService {
  private fileService: IFileService
  private grants: ExternalSourceGrants
  private moveConfirmer: MoveConfirmer | null

  constructor(fileService?: IFileService, grants?: ExternalSourceGrants, moveConfirmer?: MoveConfirmer) {
    this.moveConfirmer = moveConfirmer ?? null
    // M4: Compose with FileService for file operations
    this.fileService = fileService || defaultFileService
    this.grants = grants || defaultGrants
  }

  setMoveConfirmer(confirmer: MoveConfirmer | null): void {
    this.moveConfirmer = confirmer
  }

  /**
   * Validate an external file for import
   *
   * Security checks performed:
   * 1. Source exists and is accessible
   * 2. Source is not a directory
   * 3. Source is a regular file (not device, pipe, socket)
   * 4. If symlink, target is not a system directory
   */
  async validateExternalFile(sourcePath: string): Promise<ExternalFileValidateResponse> {
    logger.debug('Validating external file', { sourcePath: redactPath(sourcePath) })

    // Validate input is an absolute path
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

    // Check source exists
    let sourceStats: Stats
    try {
      sourceStats = await lstat(sourcePath) // Don't follow symlinks initially
    } catch (error) {
      logger.warn('External file not found', { sourcePath: redactPath(sourcePath), error: redactedMessage(error) })
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
      logger.debug('External file is directory, rejecting', { sourcePath: redactPath(sourcePath) })
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
      logger.debug('External file is special file, rejecting', { sourcePath: redactPath(sourcePath) })
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
            sourcePath: redactPath(sourcePath),
            target: redactPath(resolvedTarget)
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
            sourcePath: redactPath(sourcePath),
            error: redactedMessage(error),
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
        logger.warn('External file symlink error', { sourcePath: redactPath(sourcePath), error: redactedMessage(error) })
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
      sourcePath: redactPath(sourcePath),
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
    target: ExternalTarget,
    conflictResolution?: ConflictResolution
  ): Promise<ExternalFileCopyResponse> {
    logger.info('Copying external file', { sourcePath: redactPath(sourcePath), targetFolder: redactPath(target.requested), conflictResolution })

    // Validate the external file first
    const validation = await this.validateExternalFile(sourcePath)
    if (!validation.valid) {
      return {
        success: false,
        isSymlink: validation.isSymlink,
        error: validation.error,
        errorCode: validation.errorCode
      }
    }

    try {
      // S1: Sanitize the filename
      const originalName = basename(sourcePath)
      const sanitizedName = this.sanitizeFileName(originalName)

      // Handle conflicts based on resolution strategy
      const targetName = await this.resolveTargetName(
        target.real,
        sanitizedName,
        conflictResolution
      )
      const targetPath = childPath(target.real, targetName)
      const resultPath = childPath(target.requested, targetName)

      if (await this.isSameFile(sourcePath, targetPath)) return this.sameFileRefusal()

      // M6: Verify source still exists before copy (race condition check)
      try {
        await access(sourcePath, constants.R_OK)
      } catch {
        logger.error('Source file deleted during copy operation', undefined, { sourcePath: redactPath(sourcePath) })
        return {
          success: false,
          error: 'Source file was deleted',
          errorCode: ErrorCode.EXTERNAL_FILE_SOURCE_DELETED
        }
      }

      // Perform the copy
      await this.copyInto(sourcePath, targetPath, conflictResolution, target.real)

      logger.info('External file copied successfully', {
        sourcePath: redactPath(sourcePath),
        targetPath: redactPath(resultPath),
        isSymlink: validation.isSymlink
      })

      return {
        success: true,
        path: resultPath,
        isSymlink: validation.isSymlink
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to copy external file', redactedLogError(error), {
        sourcePath: redactPath(sourcePath),
        targetFolder: redactPath(target.requested)
      })
      return {
        success: false,
        error: message,
        errorCode: ErrorCode.EXTERNAL_FILE_COPY_FAILED
      }
    }
  }

  /**
   * Move several external files into the project after one confirmation.
   *
   * The files that pass validation (and are not links, which are never moved)
   * ask together, inside the confirmer's batching window, so they share a box.
   * Each file then goes through the same steps as a single move, with its answer
   * already in hand; the moves run one after another so name conflicts in the
   * target folder are settled in order.
   */
  async moveBatchFromExternal(
    items: readonly ExternalMoveItem[],
    target: ExternalTarget,
    senderId: number | null,
    recheckTarget?: () => Promise<boolean>
  ): Promise<ExternalFileMoveResponse[]> {
    logger.info('Moving external files', { count: items.length })

    const askable: string[] = []
    for (const item of items) {
      const validation = await this.validateExternalFile(item.sourcePath)
      if (validation.valid && !validation.isSymlink) askable.push(item.sourcePath)
    }

    const answers = new Map<string, MoveAnswer>()
    const confirmer = this.moveConfirmer
    if (confirmer) {
      await Promise.all(
        askable.map(async (sourcePath) => {
          answers.set(sourcePath, await confirmer.confirm(senderId, sourcePath, askable))
        })
      )
    }

    const results: ExternalFileMoveResponse[] = []
    for (const item of items) {
      results.push(
        await this.moveFromExternal(
          item.sourcePath,
          target,
          senderId,
          item.conflictResolution,
          recheckTarget,
          // A file that was not put to the user fails its own checks before the answer is read
          answers.get(item.sourcePath) ?? (confirmer ? undefined : 'unavailable')
        )
      )
    }
    return results
  }

  /**
   * Move an external file into the project
   * Copies file, then deletes source
   */
  async moveFromExternal(
    sourcePath: string,
    target: ExternalTarget,
    senderId: number | null,
    conflictResolution?: ConflictResolution,
    recheckTarget?: () => Promise<boolean>,
    decided?: MoveAnswer
  ): Promise<ExternalFileMoveResponse> {
    logger.info('Moving external file', { sourcePath: redactPath(sourcePath), targetFolder: redactPath(target.requested), conflictResolution })

    // Validate the external file first
    const validation = await this.validateExternalFile(sourcePath)
    if (!validation.valid) {
      return {
        success: false,
        isSymlink: validation.isSymlink,
        error: validation.error,
        errorCode: validation.errorCode
      }
    }

    // A link can be copied; moving one would remove the link and leave its target
    if (validation.isSymlink) {
      return {
        success: false,
        isSymlink: true,
        error: ERROR_MESSAGES[ErrorCode.EXTERNAL_FILE_MOVE_SYMLINK],
        errorCode: ErrorCode.EXTERNAL_FILE_MOVE_SYMLINK
      }
    }

    try {
      const sourceIdentity = await this.identityOf(sourcePath)
      // What the user was shown: this entry, in this folder
      const sourceEntry = await this.entryIdentityOf(sourcePath)
      const sourceFolder = await this.folderOf(sourcePath)
      if (await this.plannedIsSameFile(sourcePath, target, conflictResolution)) {
        return this.sameFileRefusal()
      }

      // The original is deleted below: every move waits for the user's answer to a
      // native box. A file picked in the dialog is named together with its pick.
      // A batch move has asked for all its files at once (`decided`)
      const answer: MoveAnswer =
        decided ??
        (this.moveConfirmer
          ? await this.moveConfirmer.confirm(
              senderId,
              sourcePath,
              (await this.grants.batchOf(senderId, sourcePath)) ?? undefined
            )
          : 'unavailable')
      if (answer !== 'move') {
        logger.info('Move not confirmed', { sourcePath: redactPath(sourcePath), answer })
        const code =
          answer === 'cancel'
            ? ErrorCode.EXTERNAL_FILE_MOVE_CANCELLED
            : ErrorCode.EXTERNAL_FILE_MOVE_NOT_GRANTED
        return {
          success: false,
          isSymlink: validation.isSymlink,
          error: ERROR_MESSAGES[code],
          errorCode: code
        }
      }
      this.grants.forget(senderId, sourcePath)

      // The box was open for as long as the user took: nothing may have changed meanwhile
      const again = await this.validateExternalFile(sourcePath)
      const unchanged =
        again.valid &&
        (await this.identityOf(sourcePath)) === sourceIdentity &&
        (recheckTarget ? await recheckTarget() : true)
      if (!unchanged) {
        logger.warn('Move cancelled: source or target changed while waiting', {
          sourcePath: redactPath(sourcePath)
        })
        return {
          success: false,
          isSymlink: validation.isSymlink,
          error: ERROR_MESSAGES[ErrorCode.EXTERNAL_FILE_MOVE_CHANGED],
          errorCode: ErrorCode.EXTERNAL_FILE_MOVE_CHANGED
        }
      }

      // S1: Sanitize the filename
      const originalName = basename(sourcePath)
      const sanitizedName = this.sanitizeFileName(originalName)

      // Handle conflicts based on resolution strategy
      const targetName = await this.resolveTargetName(
        target.real,
        sanitizedName,
        conflictResolution
      )
      const targetPath = childPath(target.real, targetName)
      const resultPath = childPath(target.requested, targetName)

      // Never delete the source when the copy would land on the source itself
      if (await this.isSameFile(sourcePath, targetPath)) return this.sameFileRefusal()

      // M6: Verify source still exists before copy (race condition check)
      try {
        await access(sourcePath, constants.R_OK)
      } catch {
        logger.error('Source file deleted during move operation', undefined, { sourcePath: redactPath(sourcePath) })
        return {
          success: false,
          error: 'Source file was deleted',
          errorCode: ErrorCode.EXTERNAL_FILE_SOURCE_DELETED
        }
      }

      // Copy the file first
      await this.copyInto(sourcePath, targetPath, conflictResolution, target.real)

      // The copy can take long. Delete only the entry the user was shown, in the
      // folder they were shown; otherwise keep the copy and leave the source alone.
      if (
        (await this.entryIdentityOf(sourcePath)) !== sourceEntry ||
        (await this.folderOf(sourcePath)) !== sourceFolder
      ) {
        logger.warn('Original changed during the move; it was not removed', {
          sourcePath: redactPath(sourcePath)
        })
        return {
          success: false,
          isSymlink: false,
          error: ERROR_MESSAGES[ErrorCode.EXTERNAL_FILE_SOURCE_CHANGED],
          errorCode: ErrorCode.EXTERNAL_FILE_SOURCE_CHANGED
        }
      }

      // M6: Try to delete source, but don't fail if it's already gone
      try {
        await rm(sourcePath)
        logger.debug('Source file deleted after move', { sourcePath: redactPath(sourcePath) })
      } catch (deleteError) {
        // Source might have been deleted by another process
        const code = (deleteError as NodeJS.ErrnoException).code
        if (code === 'ENOENT') {
          logger.warn('Source file already deleted during move', { sourcePath: redactPath(sourcePath) })
          // File was already deleted - operation still successful
        } else {
          // Other error - log but don't fail (file was copied successfully)
          logger.warn('Failed to delete source file after move', {
            sourcePath: redactPath(sourcePath),
            error: redactedMessage(deleteError)
          })
        }
      }

      logger.info('External file moved successfully', {
        sourcePath: redactPath(sourcePath),
        targetPath: redactPath(resultPath),
        isSymlink: validation.isSymlink
      })

      return {
        success: true,
        path: resultPath,
        isSymlink: validation.isSymlink
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to move external file', redactedLogError(error), {
        sourcePath: redactPath(sourcePath),
        targetFolder: redactPath(target.requested)
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

  /** Device and inode of a path (links followed), or null when it cannot be read. */
  private async identityOf(filePath: string): Promise<string | null> {
    try {
      const stats = await stat(filePath, { bigint: true })
      return stats ? `${stats.dev}:${stats.ino}` : null
    } catch {
      return null
    }
  }

  /** Device and inode of the entry itself (a link is not followed), or null. */
  private async entryIdentityOf(filePath: string): Promise<string | null> {
    try {
      const stats = await lstat(filePath, { bigint: true })
      return stats ? `${stats.dev}:${stats.ino}` : null
    } catch {
      return null
    }
  }

  /** The real folder a path sits in, or null when it cannot be resolved. */
  private async folderOf(filePath: string): Promise<string | null> {
    try {
      const real = await realpath(dirname(filePath))
      return real ? normaliseResolved(real) : null
    } catch {
      return null
    }
  }

  /** Throws unless the folder the copy is about to enter is still the one that was checked. */
  private async assertFolderUnchanged(targetPath: string, folder: string): Promise<void> {
    const actual = await this.folderOf(targetPath)
    const same =
      actual !== null &&
      (process.platform === 'linux'
        ? actual === normaliseResolved(folder)
        : actual.toLowerCase() === normaliseResolved(folder).toLowerCase())
    if (!same) {
      throw new AppError(
        'The destination folder changed; nothing was copied',
        ErrorCode.PATH_OUTSIDE_PROJECT
      )
    }
  }

  /** Whether both paths are the same file on disk (a hard link counts). */
  private async isSameFile(first: string, second: string): Promise<boolean> {
    const [a, b] = await Promise.all([this.identityOf(first), this.identityOf(second)])
    return a !== null && a === b
  }

  /** Whether the copy would land on the source, for the name the copy would get now. */
  private async plannedIsSameFile(
    sourcePath: string,
    target: ExternalTarget,
    conflictResolution?: ConflictResolution
  ): Promise<boolean> {
    const name = await this.resolveTargetName(
      target.real,
      this.sanitizeFileName(basename(sourcePath)),
      conflictResolution
    )
    return this.isSameFile(sourcePath, childPath(target.real, name))
  }

  private sameFileRefusal(): { success: false; error: string; errorCode: string } {
    return {
      success: false,
      error: ERROR_MESSAGES[ErrorCode.EXTERNAL_FILE_SAME_FILE],
      errorCode: ErrorCode.EXTERNAL_FILE_SAME_FILE
    }
  }

  /**
   * Write the copy. A new name is created exclusively. Replacing an existing name
   * writes to a temporary name in the same folder first (also exclusively) and
   * renames it over the old entry, so a link or a hard link at that name is
   * replaced, never written through.
   */
  private async copyInto(
    sourcePath: string,
    targetPath: string,
    conflictResolution: ConflictResolution | undefined,
    folder: string
  ): Promise<void> {
    await this.assertFolderUnchanged(targetPath, folder)
    let existing: Stats | null = null
    if (conflictResolution === 'replace') {
      try {
        existing = (await lstat(targetPath)) ?? null
      } catch {
        existing = null
      }
    }
    if (!existing) {
      await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL)
      return
    }
    const temporary = childPath(dirname(targetPath), `${ATOMIC_TEMP_PREFIX}${randomUUID()}`)
    let renaming = false
    try {
      await copyFile(sourcePath, temporary, constants.COPYFILE_EXCL)
      await this.assertFolderUnchanged(targetPath, folder)
      renaming = true
      await rename(temporary, targetPath)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      const code = (error as NodeJS.ErrnoException).code
      if (renaming && code !== undefined && RENAME_BUSY_CODES.has(code)) {
        // The error text names the temporary file; the log keeps its redacted form
        logger.warn('Replace blocked', { error: redactedMessage(error), code })
        throw new AppError(
          `Could not replace ${basename(targetPath)} – it may be open in another program.`,
          ErrorCode.EXTERNAL_FILE_COPY_FAILED
        )
      }
      throw error
    }
  }

  /**
   * Resolve the name the copy gets, based on conflict resolution strategy
   */
  private async resolveTargetName(
    targetFolder: string,
    fileName: string,
    conflictResolution?: ConflictResolution
  ): Promise<string> {
    // Check if conflict exists
    const hasConflict = await this.fileService.checkNameConflict(targetFolder, fileName)

    if (!hasConflict || conflictResolution === 'replace') {
      // For 'replace' the caller overwrites the existing file
      return fileName
    }

    // Default to keepBoth: generate unique name with (1), (2), etc.
    const ext = extname(fileName)
    const nameWithoutExt = ext ? fileName.slice(0, -ext.length) : fileName
    let copyNumber = 1
    let newName = fileName

    while (await this.fileService.checkNameConflict(targetFolder, newName)) {
      newName = `${nameWithoutExt} (${copyNumber})${ext}`
      copyNumber++

      // Safety limit
      if (copyNumber > MAX_COPY_ATTEMPTS) {
        throw new AppError(
          `Cannot create more than ${MAX_COPY_ATTEMPTS} copies with the same name`,
          ErrorCode.EXTERNAL_FILE_COPY_FAILED
        )
      }
    }

    return newName
  }
}

/**
 * Factory function to create ExternalFileService instance
 * Enables dependency injection and testing
 */
export function createExternalFileService(
  fileService?: IFileService,
  grants?: ExternalSourceGrants
): IExternalFileService {
  return new ExternalFileService(fileService, grants)
}

// Singleton instance for backward compatibility
export const externalFileService = createExternalFileService()
