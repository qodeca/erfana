/**
 * usePdfImport Hook
 *
 * Orchestrates the PDF import workflow:
 * 1. Select PDF file via native dialog
 * 2. Confirm large file imports (>50MB)
 * 3. Import and convert to markdown
 * 4. Trigger organize-import prompt for Claude Code
 *
 * Uses dependency injection for testability.
 */

import { useState, useCallback } from 'react'
import { useDialog } from '../components/Dialog/DialogContext'
import { showSuccessToast, showErrorToast, showWarningToast } from '../utils/toastHelpers'
import { executePromptTemplate } from '../utils/panelUtils'
import type { PromptVariables } from '../prompts/types'

/** Size threshold for confirmation dialog (in MB) */
const LARGE_FILE_THRESHOLD_MB = 50

interface UsePdfImportReturn {
  /** Whether a PDF import is currently in progress */
  isImporting: boolean
  /** Import a PDF file and convert to markdown. Returns output path or null if cancelled/failed */
  importPdf: () => Promise<string | null>
}

/**
 * Hook for importing PDF files and converting them to markdown.
 *
 * @returns Object with isImporting state and importPdf function
 *
 * @example
 * const { isImporting, importPdf } = usePdfImport()
 *
 * const handleClick = async () => {
 *   const outputPath = await importPdf()
 *   if (outputPath) {
 *     console.log('PDF imported to:', outputPath)
 *   }
 * }
 */
export function usePdfImport(): UsePdfImportReturn {
  const [isImporting, setIsImporting] = useState(false)
  const { showConfirm } = useDialog()

  const importPdf = useCallback(async (): Promise<string | null> => {
    // 1. Select PDF via native file dialog
    let selectedFile: { path: string; name: string; sizeInMB: number } | null
    try {
      selectedFile = await window.api.pdfImport.selectFile()
    } catch (error) {
      console.error('Failed to open file dialog:', error)
      showErrorToast('File Selection Failed', 'Could not open file selection dialog')
      return null
    }

    if (!selectedFile) {
      // User cancelled file selection
      return null
    }

    // 2. If file >50MB, show confirmation dialog
    if (selectedFile.sizeInMB > LARGE_FILE_THRESHOLD_MB) {
      const confirmed = await showConfirm({
        title: 'Large File Warning',
        message: `The selected PDF "${selectedFile.name}" is ${selectedFile.sizeInMB.toFixed(1)} MB. Large files may take longer to process and use more memory. Continue?`,
        confirmLabel: 'Import Anyway',
        cancelLabel: 'Cancel',
        danger: false
      })

      if (!confirmed) {
        showWarningToast('Import Cancelled', 'Large file import was cancelled')
        return null
      }
    }

    // 3. Begin import process
    setIsImporting(true)

    try {
      const result = await window.api.pdfImport.import(selectedFile.path)

      if (!result.success) {
        // Handle specific error codes with user-friendly messages
        const errorMessage = getErrorMessage(result.errorCode, result.error)
        showErrorToast('Import Failed', errorMessage)
        return null
      }

      // 4. Success - show toast and trigger organize prompt
      const outputPath = result.outputPath
      if (!outputPath) {
        showErrorToast('Import Failed', 'Conversion succeeded but output path was not returned')
        return null
      }
      showSuccessToast(
        'PDF Imported',
        `"${selectedFile.name}" converted to markdown successfully`
      )

      // 5. Trigger organize-import prompt to help user organize the file
      await triggerOrganizePrompt(outputPath)

      return outputPath
    } catch (error) {
      console.error('PDF import error:', error)
      showErrorToast('Import Failed', 'An unexpected error occurred during PDF import')
      return null
    } finally {
      setIsImporting(false)
    }
  }, [showConfirm])

  return {
    isImporting,
    importPdf
  }
}

/**
 * Get user-friendly error message based on error code
 * Uses ErrorCode enum values from shared/errors.ts
 */
function getErrorMessage(errorCode?: string, fallbackError?: string): string {
  switch (errorCode) {
    case 'PDF_ENCRYPTED':
      return 'This PDF is password protected and cannot be imported'
    case 'PDF_EMPTY':
      return 'PDF has no text content to convert'
    case 'PDF_CORRUPT':
      return 'Unable to read PDF file. It may be corrupted or in an unsupported format.'
    case 'PDF_TOO_LARGE':
      return 'PDF file is too large to process'
    case 'PDF_CONVERSION_FAILED':
      return 'Failed to convert PDF to markdown'
    default:
      return fallbackError || 'Failed to import PDF'
  }
}

/**
 * Trigger the organize-import prompt to help Claude Code organize the imported file
 */
async function triggerOrganizePrompt(importedFilePath: string): Promise<void> {
  const variables: PromptVariables = {
    selectedText: '',
    filePath: importedFilePath,
    fullDocument: '',
    // Custom variable for organize-import template
    importedFilePath
  }

  try {
    const success = await executePromptTemplate('organize-import', variables)
    if (!success) {
      // Template may not exist yet, which is fine - just log it
      console.log('organize-import prompt not executed (template may not be registered)')
    }
  } catch (error) {
    // Non-fatal - the import succeeded, just the prompt didn't run
    console.warn('Failed to trigger organize-import prompt:', error)
  }
}
