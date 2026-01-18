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
import { IMPORT, BYTES_PER_MB } from '../../../shared/constants'
import { ERROR_MESSAGES, ErrorCode } from '../../../shared/errors'
import { useTerminalPortalOptional } from '../context/TerminalPortalContext'
import { scheduleScrollIfNeeded } from '../utils/promptScrollScheduler.logic'
import { logger } from '../utils/logger'

/** Size threshold for confirmation dialog (in MB) */
const LARGE_FILE_THRESHOLD_MB = IMPORT.SIZE_WARNING_THRESHOLD / BYTES_PER_MB

/** Information about a file to be imported */
export interface ImportFileInfo {
  /** Absolute path to the source file */
  path: string
  /** File name (for display in dialogs/toasts) */
  name: string
  /** File size in bytes (explicit naming for clarity) */
  sizeInBytes: number
}

/** Result status for individual file processing */
export type FileResultStatus = 'success' | 'failed' | 'skipped'

/** Options for processFiles method */
export interface ProcessFilesOptions {
  /**
   * Callback for individual file results (for tracking progress).
   * @param file - The file that was processed
   * @param status - 'success' | 'failed' | 'skipped' (user-initiated skip, e.g., large file warning)
   * @param outputPath - Output path if successful, undefined otherwise
   */
  onFileResult?: (file: ImportFileInfo, status: FileResultStatus, outputPath?: string) => void
}

/** Result of processFiles operation */
export interface ProcessFilesResult {
  /** Number of files successfully imported */
  successCount: number
  /**
   * Number of files that failed to import (excluding user-skipped).
   * Note: If batch is rejected pre-processing (e.g., exceeds MAX_BATCH_SIZE),
   * this will be 0 since no files entered the processing loop.
   */
  failCount: number
  /** Number of files user chose to skip (e.g., large file warnings) */
  skippedCount: number
  /** Output paths of successfully imported files */
  outputPaths: string[]
  /** Failed files with error messages (for potential retry) */
  failures: Array<{ file: ImportFileInfo; error: string }>
}

interface UseImportReturn {
  /** Whether an import is currently in progress */
  isImporting: boolean
  /** Import via file dialog. Returns output path or null if cancelled/failed */
  importFile: () => Promise<string | null>
  /** Process files directly (for drop, programmatic use). Returns results */
  processFiles: (files: ImportFileInfo[], options?: ProcessFilesOptions) => Promise<ProcessFilesResult>
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

  /**
   * Process files directly - core import workflow.
   * Used by importFile (after dialog) and external drop handlers.
   *
   * Workflow per file:
   * 1. Large file warning (skip if user cancels)
   * 2. Process via IPC
   * 3. Track success/failure/skip
   *
   * After all files:
   * 4. Summary toast (for batch imports)
   * 5. Organize prompt (single file only)
   *
   * Note: Organize prompt fires before Git refresh in caller - this is acceptable
   * since organize prompt doesn't depend on Git status.
   */
  const processFiles = useCallback(async (
    files: ImportFileInfo[],
    options?: ProcessFilesOptions
  ): Promise<ProcessFilesResult> => {
    if (files.length === 0) {
      return { successCount: 0, failCount: 0, skippedCount: 0, outputPaths: [], failures: [] }
    }

    // Batch size limit to prevent DOS (M4)
    if (files.length > IMPORT.MAX_BATCH_SIZE) {
      showErrorToast(
        'Too many files',
        `Cannot import more than ${IMPORT.MAX_BATCH_SIZE} files at once. Please select fewer files.`
      )
      return { successCount: 0, failCount: 0, skippedCount: 0, outputPaths: [], failures: [] }
    }

    setIsImporting(true)
    const outputPaths: string[] = []
    const failures: Array<{ file: ImportFileInfo; error: string }> = []
    let successCount = 0
    let failCount = 0
    let skippedCount = 0

    try {
      for (const file of files) {
        // Large file warning
        const fileSizeMB = file.sizeInBytes / BYTES_PER_MB
        if (fileSizeMB > LARGE_FILE_THRESHOLD_MB) {
          const confirmed = await showConfirm({
            title: 'Large file warning',
            message: `The file "${file.name}" is ${fileSizeMB.toFixed(1)} MB. Large files may take longer to process and use more memory. Continue?`,
            confirmLabel: 'Import anyway',
            cancelLabel: 'Skip',
            danger: false
          })

          if (!confirmed) {
            logger.info('User skipped large file', { fileName: file.name })
            options?.onFileResult?.(file, 'skipped')
            skippedCount++
            continue
          }
        }

        // Process import
        try {
          const result = await window.api.import.process(file.path)

          if (result.success) {
            if (!result.outputPath) {
              // Backend bug - success but no path (L7: clearer error handling)
              logger.error('Import succeeded but no outputPath returned', undefined, { fileName: file.name })
              const errorMessage = 'No output path returned'
              failures.push({ file, error: errorMessage })
              failCount++
              showErrorToast('Import error', `${file.name}: Backend returned success without output path`)
              options?.onFileResult?.(file, 'failed')
              continue
            }
            successCount++
            outputPaths.push(result.outputPath)
            options?.onFileResult?.(file, 'success', result.outputPath)
          } else {
            // Expected failure path
            const errorMessage = getErrorMessage(result.errorCode, result.error)
            failures.push({ file, error: errorMessage })
            failCount++
            showErrorToast('Import failed', `${file.name}: ${errorMessage}`)
            options?.onFileResult?.(file, 'failed')
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unexpected error'
          failures.push({ file, error: errorMessage })
          failCount++
          logger.error('Import error', error instanceof Error ? error : undefined)
          showErrorToast('Import failed', `${file.name}: ${errorMessage}`)
          options?.onFileResult?.(file, 'failed')
        }
      }

      // Summary toast
      const totalProcessed = successCount + failCount
      if (files.length > 1) {
        // Batch import summary
        if (successCount > 0 && failCount === 0) {
          showSuccessToast('Import complete', `Imported ${successCount} files`)
        } else if (successCount > 0 && failCount > 0) {
          showWarningToast('Import partially complete', `Imported ${successCount} of ${totalProcessed} files`)
        } else if (failCount > 0 && successCount === 0) {
          // All files failed - show summary in addition to individual errors (L1 fix)
          showErrorToast('Import failed', `Failed to import ${failCount} files`)
        }
        // Note: If all files were skipped (skippedCount === files.length), no summary needed
      } else if (successCount === 1) {
        // Single file success
        showSuccessToast('File imported', `"${files[0].name}" imported successfully`)
      }

      // Organize prompt for single file import only
      if (outputPaths.length === 1) {
        await triggerOrganizePrompt(outputPaths[0], terminalPortal ?? undefined)
      }

      return { successCount, failCount, skippedCount, outputPaths, failures }
    } finally {
      setIsImporting(false)
    }
  }, [showConfirm, terminalPortal])

  /**
   * Import via file dialog.
   * Opens native file picker, then delegates to processFiles for actual import.
   */
  const importFile = useCallback(async (): Promise<string | null> => {
    // 1. Select file via native file dialog
    let selectedFile: { path: string; name: string; sizeInMB: number; extension: string } | null
    try {
      selectedFile = await window.api.import.selectFile()
    } catch (error) {
      logger.error('Failed to open file dialog:', error instanceof Error ? error : undefined)
      showErrorToast('File selection failed', 'Could not open file selection dialog')
      return null
    }

    if (!selectedFile) {
      // User cancelled file selection
      return null
    }

    // 2. Convert to ImportFileInfo format
    // Note: selectFile API returns sizeInMB (decimal MB), convert to bytes
    const fileInfo: ImportFileInfo = {
      path: selectedFile.path,
      name: selectedFile.name,
      sizeInBytes: selectedFile.sizeInMB * BYTES_PER_MB
    }

    // 3. Process using shared workflow
    const result = await processFiles([fileInfo])

    return result.outputPaths[0] ?? null
  }, [processFiles])

  return {
    isImporting,
    importFile,
    processFiles
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
 * Trigger the organize-import prompt to help Claude Code organize the imported file.
 *
 * Accepts terminalPortal context for scroll-to-bottom scheduling after prompt execution.
 * If terminalPortal is provided and prompt succeeds, schedules a scroll to bottom
 * with a 1-second delay to allow the terminal to update.
 *
 * @param importedFilePath - Path to the imported file
 * @param terminalPortal - Optional terminal context for scroll scheduling (issue #52)
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
      logger.info('organize-import prompt not executed (template may not be registered)')
    }
  } catch (error) {
    // Non-fatal - the import succeeded, just the prompt didn't run
    const errorMsg = error instanceof Error ? error.message : String(error)
    logger.warn(`Failed to trigger organize-import prompt: ${errorMsg}`)
  }
}
