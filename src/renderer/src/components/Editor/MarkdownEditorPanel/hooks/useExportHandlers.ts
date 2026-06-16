// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Export Handlers Hook for Markdown Editor
 *
 * Provides PDF and DOCX export functionality with proper state management,
 * error handling, and toast notifications. Handles Mermaid diagram conversion
 * for DOCX exports using renderer-side canvas rendering.
 *
 * @module useExportHandlers
 * @see Issue #58 - markdown-to-PDF export
 * @see Issue #65 - DOCX export with Mermaid diagram support
 */

import { useState, useCallback } from 'react'
import { convertMermaidDiagramsToImages } from '../../../../utils/svgToImage'
import { getBasename } from '../../../../utils/fileUtils'
import { logger } from '../../../../utils/logger'
import type { MarkdownPreviewHandle } from '../../MarkdownPreview'
import type { EditorFile } from '../types'

// Re-export EditorFile for consumers who import from this module
export type { EditorFile } from '../types'

/**
 * Toast notification payload structure.
 * Matches the signature expected by ToastContext.showToast.
 */
export interface ToastPayload {
  /** Toast title displayed prominently */
  title: string
  /** Detailed message content */
  message: string
  /** Visual type determining icon and color */
  type: 'success' | 'error' | 'info' | 'warning'
  /** Auto-dismiss duration in milliseconds */
  duration?: number
}

/**
 * Configuration options for the useExportHandlers hook.
 */
export interface UseExportHandlersOptions {
  /** Currently open file, or null if no file is open */
  currentFile: EditorFile | null
  /** Reference to the MarkdownPreview component for accessing rendered HTML */
  previewHandleRef: React.RefObject<MarkdownPreviewHandle | null>
  /** Function to display toast notifications */
  showToast: (payload: ToastPayload) => void
}

/**
 * Return type for the useExportHandlers hook.
 */
export interface UseExportHandlersReturn {
  /** Whether a PDF export is currently in progress */
  isExportingPdf: boolean
  /** Whether a DOCX export is currently in progress */
  isExportingDocx: boolean
  /** Handler function to trigger PDF export */
  handleExportPdf: () => Promise<void>
  /** Handler function to trigger DOCX export */
  handleExportDocx: () => Promise<void>
}

/**
 * Extracts the filename from a file path.
 *
 * @param filePath - Full path to the file
 * @returns Filename with extension
 *
 * @example
 * ```ts
 * extractFileName('/path/to/document.md') // 'document.md'
 * ```
 */
function extractFileName(filePath: string): string {
  return getBasename(filePath) || filePath
}

/**
 * Extracts the base filename without extension.
 *
 * @param filePath - Full path to the file
 * @returns Filename without extension
 *
 * @example
 * ```ts
 * extractBaseFileName('/path/to/document.md') // 'document'
 * ```
 */
function extractBaseFileName(filePath: string): string {
  const fileName = extractFileName(filePath)
  const lastDot = fileName.lastIndexOf('.')
  return lastDot > 0 ? fileName.substring(0, lastDot) : fileName
}

/**
 * Hook for handling PDF and DOCX export operations.
 *
 * Provides stateful export handlers with:
 * - Debounce protection against rapid clicks
 * - Proper error handling with user notifications
 * - Mermaid diagram conversion for DOCX (renders SVG to PNG via canvas)
 * - Loading state management for UI feedback
 *
 * @param options - Configuration options including file, preview ref, and toast function
 * @returns Export state and handler functions
 *
 * @example
 * ```tsx
 * function MarkdownEditorPanel() {
 *   const { showToast } = useToast()
 *   const previewHandleRef = useRef<MarkdownPreviewHandle>(null)
 *   const [currentFile, setCurrentFile] = useState<EditorFile | null>(null)
 *
 *   const {
 *     isExportingPdf,
 *     isExportingDocx,
 *     handleExportPdf,
 *     handleExportDocx
 *   } = useExportHandlers({
 *     currentFile,
 *     previewHandleRef,
 *     showToast
 *   })
 *
 *   return (
 *     <>
 *       <button onClick={handleExportPdf} disabled={isExportingPdf}>
 *         Export PDF
 *       </button>
 *       <button onClick={handleExportDocx} disabled={isExportingDocx}>
 *         Export DOCX
 *       </button>
 *     </>
 *   )
 * }
 * ```
 */
export function useExportHandlers(
  options: UseExportHandlersOptions
): UseExportHandlersReturn {
  const { currentFile, previewHandleRef, showToast } = options

  // PDF export state - prevents rapid clicks (edge case from issue #58)
  const [isExportingPdf, setIsExportingPdf] = useState(false)

  // DOCX export state - prevents rapid clicks (edge case from issue #65)
  const [isExportingDocx, setIsExportingDocx] = useState(false)

  /**
   * Export markdown preview to PDF.
   *
   * Gets rendered HTML from preview and sends to main process for PDF generation.
   * Shows success/error toast notification based on result.
   *
   * @see Issue #58 - markdown-to-PDF export
   */
  const handleExportPdf = useCallback(async () => {
    // Prevent rapid clicks (edge case from issue #58)
    if (isExportingPdf) {
      return
    }

    // Check if we have preview element and current file
    const previewElement = previewHandleRef.current?.element
    if (!previewElement || !currentFile) {
      showToast({
        title: 'Export failed',
        message: 'No content to export',
        type: 'error',
        duration: 3000
      })
      return
    }

    // Get the inner content (the rendered markdown)
    const contentElement = previewElement.querySelector('.markdown-preview-content')
    const html = contentElement?.innerHTML || previewElement.innerHTML

    // Get filename from current file path (without .md extension)
    const fileName = extractBaseFileName(currentFile.path)

    setIsExportingPdf(true)
    try {
      const result = await window.api.pdf.exportToPdf({ html, fileName })

      if (result.success && result.filePath) {
        // Show success with just the filename
        const savedFileName = extractFileName(result.filePath)
        showToast({
          title: 'PDF exported',
          message: `Saved as ${savedFileName}`,
          type: 'success',
          duration: 3000
        })
      } else if (result.errorCode !== 'PDF_EXPORT_CANCELLED') {
        // Show error (but not for cancelled exports - user intentionally cancelled)
        showToast({
          title: 'Export failed',
          message: result.error || 'Unknown error',
          type: 'error',
          duration: 5000
        })
      }
      // Note: Cancelled exports show no toast (user-initiated action)
    } catch (error) {
      logger.error('PDF export failed', error instanceof Error ? error : undefined)
      showToast({
        title: 'Export failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        type: 'error',
        duration: 5000
      })
    } finally {
      setIsExportingPdf(false)
    }
  }, [isExportingPdf, currentFile, previewHandleRef, showToast])

  /**
   * Export markdown preview to DOCX (Word document).
   *
   * Extracts HTML from preview, converts Mermaid diagrams to PNG images
   * (using renderer-side canvas rendering to avoid jsdom/canvas issues),
   * then sends to main process for DOCX generation.
   *
   * @see Issue #65 - DOCX export with Mermaid diagram support
   */
  const handleExportDocx = useCallback(async () => {
    // Prevent rapid clicks (edge case from issue #65)
    if (isExportingDocx) {
      return
    }

    // Check if we have preview element and current file
    const previewElement = previewHandleRef.current?.element
    if (!previewElement || !currentFile) {
      showToast({
        title: 'Export failed',
        message: 'No content to export',
        type: 'error',
        duration: 3000
      })
      return
    }

    // Get the inner content (the rendered markdown)
    const contentElement = previewElement.querySelector('.markdown-preview-content')
    if (!contentElement) {
      showToast({
        title: 'Export failed',
        message: 'No preview content available',
        type: 'error',
        duration: 3000
      })
      return
    }

    // Get filename from current file path (without .md extension)
    const fileName = extractBaseFileName(currentFile.path)

    setIsExportingDocx(true)
    try {
      // Convert Mermaid diagrams to PNG images before sending to main process.
      // This avoids jsdom/canvas dependency issues in the main process.
      // The conversion happens in the renderer where DOM/canvas APIs are available.
      const conversionResult = await convertMermaidDiagramsToImages(contentElement)

      // Warn user if some diagrams failed to convert (partial success)
      if (conversionResult.failedDiagrams > 0) {
        showToast({
          title: 'Diagram conversion warning',
          message: `${conversionResult.failedDiagrams} of ${conversionResult.totalDiagrams} diagram(s) could not be converted`,
          type: 'warning',
          duration: 5000
        })
      }

      const result = await window.api.docx.exportToDocx({
        html: conversionResult.html,
        fileName
      })

      if (result.success && result.filePath) {
        // Show success with just the filename
        const savedFileName = extractFileName(result.filePath)
        showToast({
          title: 'DOCX exported',
          message: `Saved as ${savedFileName}`,
          type: 'success',
          duration: 3000
        })
      } else if (result.errorCode !== 'DOCX_EXPORT_CANCELLED') {
        // Show error (but not for cancelled exports - user intentionally cancelled)
        showToast({
          title: 'Export failed',
          message: result.error || 'Unknown error',
          type: 'error',
          duration: 5000
        })
      }
      // Note: Cancelled exports show no toast (user-initiated action)
    } catch (error) {
      logger.error('DOCX export failed', error instanceof Error ? error : undefined)
      showToast({
        title: 'Export failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        type: 'error',
        duration: 5000
      })
    } finally {
      setIsExportingDocx(false)
    }
  }, [isExportingDocx, currentFile, previewHandleRef, showToast])

  return {
    isExportingPdf,
    isExportingDocx,
    handleExportPdf,
    handleExportDocx
  }
}
