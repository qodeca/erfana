import { ipcMain, dialog } from 'electron'
import { stat } from 'fs/promises'
import { basename } from 'path'
import { importService, converterRegistry } from '../services/import'
import { fileService } from '../services/FileService'
import type { ValidationResult, ImportResult } from '../services/import'

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
      console.error('Error getting file stats:', error)
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
      console.error('Error validating file:', error)
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
      console.error('Error importing file:', error)
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
