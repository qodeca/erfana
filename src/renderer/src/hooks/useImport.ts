/**
 * useImport Hook
 *
 * Unified hook for importing files of any supported type:
 * - PDF files (converted to markdown)
 * - Text files (imported as-is)
 * - Future: Audio/video files (transcribed to markdown)
 *
 * Workflow:
 * 1. Select file via native dialog (supports all importable types)
 * 2. Confirm large file imports (>50MB)
 * 3. Import and convert/copy to import/ directory
 * 4. Trigger organize-import prompt for Claude Code
 *
 * Uses dependency injection for testability.
 */

import { useState, useCallback } from 'react'
import { useDialog } from '../components/Dialog/DialogContext'
import { showSuccessToast, showErrorToast, showWarningToast } from '../utils/toastHelpers'
import { executePromptTemplate } from '../utils/panelUtils'
import type { PromptVariables } from '../prompts/types'
import { IMPORT } from '../../../shared/constants'
import { ERROR_MESSAGES, ErrorCode } from '../../../shared/errors'
import { useTerminalPortalOptional } from '../context/TerminalPortalContext'
import { scheduleScrollIfNeeded } from '../utils/promptScrollScheduler.logic'

/** Size threshold for confirmation dialog (in MB) */
const LARGE_FILE_THRESHOLD_MB = IMPORT.SIZE_WARNING_THRESHOLD / (1024 * 1024)

interface UseImportReturn {
  /** Whether an import is currently in progress */
  isImporting: boolean
  /** Import a file. Returns output path or null if cancelled/failed */
  importFile: () => Promise<string | null>
}

/**
 * Hook for importing files and converting them to markdown (if needed).
 *
 * @returns Object with isImporting state and importFile function
 *
 * @example
 * const { isImporting, importFile } = useImport()
 *
 * const handleClick = async () => {
 *   const outputPath = await importFile()
 *   if (outputPath) {
 *     console.log('File imported to:', outputPath)
 *   }
 * }
 */
export function useImport(): UseImportReturn {
  const [isImporting, setIsImporting] = useState(false)
  const { showConfirm } = useDialog()

  // Terminal portal context for scroll scheduling (issue #52)
  const terminalPortal = useTerminalPortalOptional()

  const importFile = useCallback(async (): Promise<string | null> => {
    // 1. Select file via native file dialog
    let selectedFile: { path: string; name: string; sizeInMB: number; extension: string } | null
    try {
      selectedFile = await window.api.import.selectFile()
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
        message: `The selected file "${selectedFile.name}" is ${selectedFile.sizeInMB.toFixed(1)} MB. Large files may take longer to process and use more memory. Continue?`,
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
      const result = await window.api.import.process(selectedFile.path)

      if (!result.success) {
        // Handle specific error codes with user-friendly messages
        const errorMessage = getErrorMessage(result.errorCode, result.error)
        showErrorToast('Import Failed', errorMessage)
        return null
      }

      // 4. Success - show toast and trigger organize prompt
      const outputPath = result.outputPath
      if (!outputPath) {
        showErrorToast('Import Failed', 'Import succeeded but output path was not returned')
        return null
      }

      showSuccessToast('File Imported', `"${selectedFile.name}" imported successfully`)

      // 5. Trigger organize-import prompt to help user organize the file
      await triggerOrganizePrompt(outputPath, terminalPortal ?? undefined)

      return outputPath
    } catch (error) {
      console.error('Import error:', error)
      showErrorToast('Import Failed', 'An unexpected error occurred during import')
      return null
    } finally {
      setIsImporting(false)
    }
  }, [showConfirm, terminalPortal])

  return {
    isImporting,
    importFile
  }
}

/**
 * Get user-friendly error message based on error code
 *
 * Prioritizes generic IMPORT_* error codes, falls back to legacy PDF_* codes,
 * and finally uses the ERROR_MESSAGES map from shared/errors.ts
 */
function getErrorMessage(errorCode?: string, fallbackError?: string): string {
  if (!errorCode) {
    return fallbackError || 'Failed to import file'
  }

  // Check if it's a known ErrorCode and get message from ERROR_MESSAGES
  // Use Object.values() instead of 'in' operator which doesn't work correctly with enums
  if (Object.values(ErrorCode).includes(errorCode as ErrorCode)) {
    const message = ERROR_MESSAGES[errorCode as ErrorCode]
    if (message) {
      return message
    }
  }

  // Fallback to the error string from the result
  return fallbackError || 'Failed to import file'
}

/**
 * Trigger the organize-import prompt to help Claude Code organize the imported file
 * Note: This is a module-level function and doesn't have access to terminalPortal.
 * Scroll scheduling is NOT integrated here because:
 * 1. This function is called from useImport which already has terminalPortal access
 * 2. Moving scroll scheduling logic to useImport would be more appropriate
 * 3. Keeping this function pure and focused on prompt execution
 */
async function triggerOrganizePrompt(
  importedFilePath: string,
  terminalPortal?: {
    terminalControls: { scrollToBottom: () => void } | null
    isTerminalReady: boolean
    lastUserScrollTsRef: React.RefObject<number> | null
  }
): Promise<void> {
  const variables: PromptVariables = {
    selectedText: '',
    filePath: importedFilePath,
    fullDocument: '',
    // Custom variable for organize-import template
    importedFilePath
  }

  try {
    const result = await executePromptTemplate('organize-import', variables)

    // Schedule scroll-to-bottom after prompt execution (issue #52)
    if (result.success && result.completionTs && terminalPortal?.lastUserScrollTsRef) {
      scheduleScrollIfNeeded({
        completionTs: result.completionTs,
        terminalPortal: {
          terminalControls: terminalPortal.terminalControls,
          isTerminalReady: terminalPortal.isTerminalReady
        },
        lastUserScrollTsRef: terminalPortal.lastUserScrollTsRef,
        delayMs: 1000
      })
    }

    if (!result.success && import.meta.env.DEV) {
      // Template may not exist yet, which is fine - log in dev only
      console.log('organize-import prompt not executed (template may not be registered)')
    }
  } catch (error) {
    // Non-fatal - the import succeeded, just the prompt didn't run
    console.warn('Failed to trigger organize-import prompt:', error)
  }
}
