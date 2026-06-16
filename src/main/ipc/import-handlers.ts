// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { ipcMain, dialog } from 'electron'
import { stat, writeFile, mkdir, cp, rm } from 'fs/promises'
import { basename, extname, isAbsolute, normalize, join } from 'path'
import { importService, converterRegistry } from '../services/import'
import { fileService } from '../services/FileService'
import type { ValidationResult, ImportResult } from '../services/import'
import { logger } from '../services/LoggingService'
import { VIDEO_IMPORT, IMPORT } from '../../shared/constants'
import { IMPORT_CHANNELS } from '../../shared/ipc/import-channels'
import {
  DocumentImportRequestSchema,
  type DocumentImportResult,
  type DocumentImportProgress
} from '../../shared/ipc/import-schema'
import { ErrorCode, AppError, getUserFriendlyMessage } from '../../shared/errors'
import { isConfigurableConverter } from '../services/import/types'
import { changeExtension, sanitizeFileName, findAvailableFileName } from '../utils/fileUtils'

/**
 * File selection result from the native dialog
 */
export interface FileSelection {
  path: string
  name: string
  sizeInMB: number
  extension: string
}

/**
 * Register unified import IPC handlers
 *
 * Channels:
 * - import:selectFile - Open native file dialog for selecting importable files
 * - import:validate - Validate a file before import
 * - import:process - Full import workflow (validate, convert, write)
 * - import:getSupportedExtensions - Get list of supported file extensions
 */
export function registerImportHandlers(): void {
  /**
   * Open native file dialog for file selection
   *
   * Shows a unified file dialog with filters for all supported file types.
   * Returns file info or null if cancelled.
   */
  ipcMain.handle('import:selectFile', async (): Promise<FileSelection | null> => {
    // Build file filters from supported extensions
    const extensions = converterRegistry.getSupportedExtensions()
    const { requiresConversion, passthrough } = converterRegistry.getExtensionsByConversionType()

    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: 'Select File to Import',
      buttonLabel: 'Import',
      filters: [
        // All supported files as default
        { name: 'All Importable Files', extensions: [...extensions] },
        // Document files (require conversion)
        { name: 'Documents (PDF)', extensions: requiresConversion },
        // Audio files
        { name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'flac'] },
        // Video files (Issue #110)
        { name: 'Video Files', extensions: [...VIDEO_IMPORT.SUPPORTED_EXTENSIONS] },
        // Text files (passthrough)
        { name: 'Text Files', extensions: passthrough },
        // Allow any file for advanced users
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const filePath = result.filePaths[0]
    const fileName = basename(filePath)
    const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : ''

    // Get file stats for size info
    try {
      const fileStats = await stat(filePath)
      const sizeInMB = fileStats.size / (1024 * 1024)

      return {
        path: filePath,
        name: fileName,
        sizeInMB,
        extension
      }
    } catch (error) {
      logger.error('Error getting file stats', error instanceof Error ? error : undefined)
      throw new Error('Failed to read selected file')
    }
  })

  /**
   * Validate a file before import
   *
   * Returns validation result with any warnings/errors.
   * Warnings (like file too large) don't prevent import but inform the user.
   */
  ipcMain.handle('import:validate', async (_event, filePath: string): Promise<ValidationResult> => {
    // Input validation
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid file path: must be a non-empty string')
    }

    const trimmedPath = filePath.trim()
    if (!trimmedPath) {
      throw new Error('Invalid file path: path is empty after trimming')
    }

    try {
      return await importService.validate(trimmedPath)
    } catch (error) {
      logger.error('Error validating file', error instanceof Error ? error : undefined)
      throw error
    }
  })

  /**
   * Import a file into the current project
   *
   * Full import workflow:
   * 1. Validate file
   * 2. Convert content (if needed)
   * 3. Write to import/ directory
   *
   * Requires a project to be open.
   * Returns import result with output path or error info.
   */
  ipcMain.handle('import:process', async (_event, filePath: string): Promise<ImportResult> => {
    // Input validation
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid file path: must be a non-empty string')
    }

    const trimmedPath = filePath.trim()
    if (!trimmedPath) {
      throw new Error('Invalid file path: path is empty after trimming')
    }

    // Check if project is open
    const projectPath = fileService.getProjectPath()
    if (!projectPath) {
      throw new Error('No project is currently open. Please open a project first.')
    }

    try {
      return await importService.importFile(trimmedPath, projectPath)
    } catch (error) {
      logger.error('Error importing file', error instanceof Error ? error : undefined)
      throw error
    }
  })

  /**
   * Get list of supported file extensions
   *
   * Returns array of extensions (lowercase, without dot).
   * Useful for file dialog filters and validation on renderer side.
   */
  ipcMain.handle('import:getSupportedExtensions', async (): Promise<string[]> => {
    return importService.getSupportedExtensions()
  })

  /**
   * Check if a file type is supported for import
   *
   * @param extension - File extension (with or without dot)
   * @returns true if the file type can be imported
   */
  ipcMain.handle('import:isSupported', async (_event, extension: string): Promise<boolean> => {
    if (!extension || typeof extension !== 'string') {
      return false
    }
    return importService.isSupported(extension)
  })
}

/** Active AbortController for current document import */
let activeDocumentController: AbortController | null = null

/**
 * Register document import IPC handlers (LiteParse)
 *
 * Channels:
 * - import:document           - Import document with options and progress streaming
 * - import:documentCancel     - Cancel active document import
 * - import:getDocumentExtensions - Get supported document extensions
 *
 * @see Issue #133 - LiteParse IPC handlers
 * @see Spec #021 - LiteParse document import
 */
export function registerDocumentImportHandlers(): void {
  /**
   * Import a document with LiteParse
   *
   * 1. Validates request with Zod schema
   * 2. Validates file path (absolute, no traversal)
   * 3. Rejects concurrent imports (mutex)
   * 4. Gets converter from registry, configures if options provided
   * 5. Runs conversion with progress streaming
   * 6. Writes result to import/ directory
   */
  ipcMain.handle(
    IMPORT_CHANNELS.DOCUMENT,
    async (event, request: unknown): Promise<DocumentImportResult> => {
      // Validate request schema
      const parseResult = DocumentImportRequestSchema.safeParse(request)
      if (!parseResult.success) {
        logger.error('Document import validation error', parseResult.error)
        return {
          success: false,
          error: 'Invalid import request',
          errorCode: ErrorCode.IMPORT_CONVERSION_FAILED
        }
      }

      const { filePath, options } = parseResult.data

      // Validate file path (prevent path traversal)
      if (!isAbsolute(filePath) || normalize(filePath) !== filePath) {
        return {
          success: false,
          error: 'Invalid file path',
          errorCode: ErrorCode.PATH_TRAVERSAL
        }
      }

      // Prevent concurrent document imports
      if (activeDocumentController) {
        return {
          success: false,
          error: 'A document import is already in progress',
          errorCode: ErrorCode.IMPORT_BUSY
        }
      }

      // Check project is open
      const projectPath = fileService.getProjectPath()
      if (!projectPath) {
        return {
          success: false,
          error: 'No project is currently open.',
          errorCode: ErrorCode.PROJECT_NOT_FOUND
        }
      }

      // Create AbortController for cancellation support
      activeDocumentController = new AbortController()
      // Capture local reference – the cancel handler nulls the module-level variable
      const controller = activeDocumentController

      // Progress callback that streams to renderer
      const webContents = event.sender
      const sendProgress = (progress: DocumentImportProgress): void => {
        try {
          if (!webContents.isDestroyed()) {
            webContents.send(IMPORT_CHANNELS.DOCUMENT_PROGRESS, progress)
          }
        } catch {
          // WebContents may be destroyed during import
        }
      }

      try {
        sendProgress({ percent: 0, phase: 'Validating document...' })

        // Get file extension
        const fileName = basename(filePath)
        const ext = extname(filePath).slice(1).toLowerCase()

        // Get converter from registry
        const converter = converterRegistry.getConverter(ext)
        if (!converter) {
          return {
            success: false,
            error: getUserFriendlyMessage(new AppError('Unsupported file type', ErrorCode.IMPORT_UNSUPPORTED_TYPE)),
            errorCode: ErrorCode.IMPORT_UNSUPPORTED_TYPE
          }
        }

        // Configure converter if options provided
        const configuredConverter =
          options && isConfigurableConverter(converter)
            ? converter.createConfigured(options)
            : converter

        sendProgress({ percent: 10, phase: 'Converting document...' })

        // Run conversion
        const result = await configuredConverter.convert(filePath)

        // Check if cancelled during conversion (uses local ref – immune to cancel handler nulling)
        if (controller.signal.aborted) {
          // Clean up temp screenshot dir if generated before cancellation
          if (result.screenshotDir) {
            rm(result.screenshotDir, { recursive: true, force: true }).catch(() => {})
          }
          return {
            success: false,
            error: 'Import cancelled'
          }
        }

        if (!result.success || !result.content) {
          return {
            success: false,
            error: result.error || 'Conversion failed',
            errorCode: result.errorCode || ErrorCode.IMPORT_CONVERSION_FAILED
          }
        }

        // Second abort check before file write
        if (controller.signal.aborted) {
          if (result.screenshotDir) {
            rm(result.screenshotDir, { recursive: true, force: true }).catch(() => {})
          }
          return {
            success: false,
            error: 'Import cancelled'
          }
        }

        sendProgress({ percent: 90, phase: 'Writing file...' })

        // Write to import/ directory
        const importDir = join(projectPath, IMPORT.DIR_NAME)
        await mkdir(importDir, { recursive: true })

        const safeName = sanitizeFileName(fileName)
        const outputName = changeExtension(safeName, '.md')
        const outputPath = await findAvailableFileName(importDir, outputName)

        await writeFile(outputPath, result.content, 'utf-8')

        // Copy screenshots if generated
        if (result.screenshotDir) {
          try {
            const screenshotDestDir = join(importDir, 'screenshots', basename(outputPath, '.md'))
            await mkdir(screenshotDestDir, { recursive: true })
            await cp(result.screenshotDir, screenshotDestDir, { recursive: true })
          } catch (copyError) {
            // Screenshot copy failure is non-fatal
            const message = copyError instanceof Error ? copyError.message : String(copyError)
            logger.warn('Failed to copy screenshots', { error: message })
          } finally {
            // Clean up temp directory to prevent /tmp leaks
            rm(result.screenshotDir, { recursive: true, force: true }).catch(() => {})
          }
        }

        sendProgress({ percent: 100, phase: 'Complete' })

        return {
          success: true,
          outputPath
        }
      } catch (error) {
        logger.error('Document import failed', error instanceof Error ? error : undefined)
        return {
          success: false,
          error: getUserFriendlyMessage(error),
          errorCode: ErrorCode.IMPORT_CONVERSION_FAILED
        }
      } finally {
        activeDocumentController = null
      }
    }
  )

  /**
   * Cancel active document import
   *
   * Aborts the AbortController (best-effort since LiteParse has no AbortSignal).
   * The import handler checks the abort flag before writing output.
   */
  ipcMain.handle(
    IMPORT_CHANNELS.DOCUMENT_CANCEL,
    async (): Promise<{ success: boolean; error?: string }> => {
      if (activeDocumentController) {
        activeDocumentController.abort()
        activeDocumentController = null
        logger.info('Document import cancelled by user')
        return { success: true }
      }
      return { success: false, error: 'No active document import' }
    }
  )

  /**
   * Get supported document extensions
   *
   * Returns the current list of supported document extensions,
   * which may change after DependencyDetector completes.
   */
  ipcMain.handle(
    IMPORT_CHANNELS.GET_DOCUMENT_EXTENSIONS,
    async (): Promise<string[]> => {
      const { requiresConversion } = converterRegistry.getExtensionsByConversionType()
      return requiresConversion
    }
  )
}
