import { ipcMain, dialog } from 'electron'
import { stat } from 'fs/promises'
import { basename } from 'path'
import { pdfImportService } from '../services/PdfImportService'
import { fileService } from '../services/FileService'
import type { PdfValidationResult, PdfConversionResult } from '../services/PdfImportService'

export interface PdfFileSelection {
  path: string
  name: string
  sizeInMB: number
}

export function registerPdfImportHandlers(): void {
  /**
   * Open native file dialog for PDF selection
   * Returns file info or null if cancelled
   */
  ipcMain.handle('pdf:selectFile', async (): Promise<PdfFileSelection | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: 'Select PDF File',
      buttonLabel: 'Select',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const filePath = result.filePaths[0]

    // Get file stats for size info
    try {
      const fileStats = await stat(filePath)
      const sizeInMB = fileStats.size / (1024 * 1024)

      return {
        path: filePath,
        name: basename(filePath),
        sizeInMB
      }
    } catch (error) {
      console.error('Error getting PDF file stats:', error)
      throw new Error('Failed to read selected PDF file')
    }
  })

  /**
   * Validate a PDF file
   * Returns validation result with any warnings/errors
   */
  ipcMain.handle('pdf:validate', async (_event, pdfPath: string): Promise<PdfValidationResult> => {
    // Input validation
    if (!pdfPath || typeof pdfPath !== 'string') {
      throw new Error('Invalid PDF path: must be a non-empty string')
    }

    const trimmedPath = pdfPath.trim()
    if (!trimmedPath) {
      throw new Error('Invalid PDF path: path is empty after trimming')
    }

    try {
      return await pdfImportService.validatePdf(trimmedPath)
    } catch (error) {
      console.error('Error validating PDF:', error)
      throw error
    }
  })

  /**
   * Import PDF: validate and convert to markdown
   * Requires a project to be open
   * Returns conversion result with output path or error info
   */
  ipcMain.handle('pdf:import', async (_event, pdfPath: string): Promise<PdfConversionResult> => {
    // Input validation
    if (!pdfPath || typeof pdfPath !== 'string') {
      throw new Error('Invalid PDF path: must be a non-empty string')
    }

    const trimmedPath = pdfPath.trim()
    if (!trimmedPath) {
      throw new Error('Invalid PDF path: path is empty after trimming')
    }

    // Check if project is open
    const projectPath = fileService.getProjectPath()
    if (!projectPath) {
      throw new Error('No project is currently open. Please open a project first.')
    }

    try {
      return await pdfImportService.convertPdf(trimmedPath, projectPath)
    } catch (error) {
      console.error('Error importing PDF:', error)
      throw error
    }
  })
}
