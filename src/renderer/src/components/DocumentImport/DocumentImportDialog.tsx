// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * DocumentImportDialog Component
 *
 * Modal dialog for the document import workflow via LiteParse. Displays four
 * mutually exclusive views: import options, progress, success, and error.
 *
 * Composes on BaseDialog for portal rendering, overlay, and focus management.
 *
 * Features:
 * - OCR toggle with language selector (31 Tesseract languages)
 * - Page screenshot toggle with DPI selector
 * - Phase-based progress bar with indeterminate shimmer animation
 * - OCR warning banner for Tesseract availability issues
 * - Focus trap within the dialog for keyboard accessibility
 * - Escape key to cancel/close
 * - ARIA attributes for screen reader support
 *
 * @see Issue #134 - LiteParse frontend UI
 * @see Spec #021 - LiteParse document import
 */

import { useEffect, useRef, useCallback, useId } from 'react'
import { FileText } from 'lucide-react'
import { useDocumentImportStore } from '../../stores/useDocumentImportStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { OcrLanguageSelect } from './OcrLanguageSelect'
import { TEST_IDS } from '../../constants/testids'
import { BaseDialog } from '../Dialog/BaseDialog'
import { sanitizeFilePath, getBasename } from '../../utils/fileUtils'
import { triggerOrganizePrompt } from '../../hooks/useImport'
import { useTerminalPortalOptional } from '../../context/TerminalPortalContext'
import { logger } from '../../utils/logger'
import './DocumentImportDialog.css'

/**
 * Format file size in MB for display.
 *
 * @param sizeMb - File size in megabytes
 * @returns Formatted string like "2.4 MB"
 */
function formatSize(sizeMb: number): string {
  if (sizeMb < 0.1) return '< 0.1 MB'
  return `${sizeMb.toFixed(1)} MB`
}

/**
 * DocumentImportDialog -- modal dialog for document import via LiteParse.
 *
 * Reads all state from useDocumentImportStore. Renders nothing when the
 * dialog is not open.
 *
 * @returns Rendered dialog via BaseDialog, or null when closed
 *
 * @example
 * ```tsx
 * // In your app layout:
 * <DocumentImportDialog />
 *
 * // To open from elsewhere:
 * const { openDialog } = useDocumentImportStore()
 * openDialog('/path/to/report.pdf', 'report.pdf', 2.4, 'pdf')
 * ```
 */
export function DocumentImportDialog(): JSX.Element | null {
  const {
    isOpen,
    fileName,
    fileSize,
    fileType,
    isImporting,
    progress,
    error,
    result,
    lastOcr,
    lastLanguage,
    lastScreenshots,
    lastDpi,
    closeDialog,
    startImport,
    cancelImport,
    setOcr,
    setLanguage,
    setScreenshots,
    setDpi
  } = useDocumentImportStore()

  const terminalPortal = useTerminalPortalOptional()

  const id = useId()
  const titleId = `doc-import-title${id}`
  const descriptionId = `doc-import-desc${id}`

  const dialogRef = useRef<HTMLDivElement>(null)

  // Escape key handler (custom cancel-vs-close logic)
  useEffect(() => {
    if (!isOpen) return undefined

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (isImporting) {
          cancelImport()
        } else {
          closeDialog()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, isImporting, cancelImport, closeDialog])

  // Focus trap within the dialog
  const handleFocusTrap = useCallback(
    (e: KeyboardEvent): void => {
      if (e.key !== 'Tab' || !dialogRef.current) return

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    },
    []
  )

  useEffect(() => {
    if (!isOpen) return undefined
    document.addEventListener('keydown', handleFocusTrap)
    return () => document.removeEventListener('keydown', handleFocusTrap)
  }, [isOpen, handleFocusTrap])

  if (!isOpen) return null

  /** Determine dialog view state */
  const hasError = error !== null && !isImporting
  const hasSuccess = result?.success === true && !isImporting
  const showOptions = !isImporting && !hasError && !hasSuccess

  const handleClose = (): void => {
    if (isImporting) {
      cancelImport()
    } else {
      closeDialog()
    }
  }

  const handleDone = (): void => {
    // Capture outputPath before closeDialog resets store state
    const outputPath = result?.outputPath

    closeDialog()

    if (!outputPath) return

    // Auto-open imported file in editor
    try {
      const dockviewApi = useProjectStore.getState().dockviewApi
      if (dockviewApi) {
        const panelTitle = getBasename(outputPath) || 'Document'
        const panelId = `editor-${sanitizeFilePath(outputPath)}`

        let editorPanel = dockviewApi.getPanel(panelId)
        if (!editorPanel) {
          editorPanel = dockviewApi.addPanel({
            id: panelId,
            component: 'editor',
            title: panelTitle,
            tabComponent: 'editorTab',
            params: { filePath: outputPath, panelId }
          })
          useProjectStore.getState().registerEditorPanel(panelId)
        }
        editorPanel.api.setActive()
        editorPanel.group.focus()
      }
    } catch {
      logger.warn('Failed to auto-open imported file')
    }

    // Trigger organize-import prompt – fire-and-forget
    triggerOrganizePrompt(outputPath, terminalPortal ?? undefined).catch(() => {
      // Non-fatal, already logged inside triggerOrganizePrompt
    })
  }

  return (
    <BaseDialog
      isOpen={isOpen}
      onClose={handleClose}
      zIndex={10000}
      closeOnBackdrop={false}
      closeOnEscape={false}
      className="doc-import-dialog"
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
    >
      <div ref={dialogRef} data-testid={TEST_IDS.DOCUMENT_IMPORT_DIALOG}>
        {/* Header */}
        <div className="dialog-header">
          <h3 id={titleId} className="dialog-title">
            Import document
          </h3>
        </div>

        {/* Body */}
        <div id={descriptionId}>
          {/* File info -- always visible */}
          <div
            className="doc-import-file-info"
            data-testid={TEST_IDS.DOCUMENT_IMPORT_FILE_INFO}
          >
            <FileText size={18} strokeWidth={1.5} className="doc-import-file-icon" />
            <span className="doc-import-file-name">{fileName}</span>
            <div className="doc-import-file-meta">
              <span className="doc-import-file-size">{formatSize(fileSize)}</span>
              {fileType && (
                <span className="doc-import-file-type">{fileType}</span>
              )}
            </div>
          </div>

          {/* Options state */}
          {showOptions && (
            <div className="doc-import-options">
              {/* OCR toggle */}
              <div className="doc-import-option-row">
                <label className="doc-import-checkbox-label">
                  <input
                    type="checkbox"
                    checked={lastOcr}
                    onChange={(e) => setOcr(e.target.checked)}
                    data-testid={TEST_IDS.DOCUMENT_IMPORT_OCR_TOGGLE}
                  />
                  <span>Enable OCR text recognition</span>
                </label>
              </div>

              {/* OCR language (disabled when OCR off) */}
              <div className="doc-import-option-row">
                <label className="doc-import-option-label" htmlFor="doc-import-ocr-lang">
                  OCR language
                </label>
                <OcrLanguageSelect
                  id="doc-import-ocr-lang"
                  value={lastLanguage}
                  onChange={setLanguage}
                  disabled={!lastOcr}
                />
              </div>

              {/* Screenshots toggle */}
              <div className="doc-import-option-row">
                <label className="doc-import-checkbox-label">
                  <input
                    type="checkbox"
                    checked={lastScreenshots}
                    onChange={(e) => setScreenshots(e.target.checked)}
                    data-testid={TEST_IDS.DOCUMENT_IMPORT_SCREENSHOTS_TOGGLE}
                  />
                  <span>Generate page screenshots</span>
                </label>
              </div>

              {/* DPI select (disabled when screenshots off) */}
              <div className="doc-import-option-row">
                <label className="doc-import-option-label" htmlFor="doc-import-dpi">
                  Screenshot DPI
                </label>
                <select
                  id="doc-import-dpi"
                  className="doc-import-dpi-select"
                  value={lastDpi}
                  onChange={(e) => setDpi(Number(e.target.value))}
                  disabled={!lastScreenshots}
                  data-testid={TEST_IDS.DOCUMENT_IMPORT_DPI_SELECT}
                >
                  <option value={72}>72 DPI (low)</option>
                  <option value={150}>150 DPI (medium)</option>
                  <option value={300}>300 DPI (high)</option>
                </select>
              </div>

              {/* Screenshot page limit warning */}
              {lastScreenshots && (
                <div className="doc-import-screenshot-hint" data-testid="doc-import-screenshot-hint">
                  Screenshots will be generated for the first 100 pages only.
                </div>
              )}
            </div>
          )}

          {/* Progress state */}
          {isImporting && (
            <div
              className="doc-import-progress-section"
              data-testid={TEST_IDS.DOCUMENT_IMPORT_PROGRESS}
            >
              <div
                className="doc-import-progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                {...(progress && progress.percent > 0
                  ? {
                      'aria-valuenow': progress.percent,
                      'aria-label': `Import progress: ${Math.round(progress.percent)}%`
                    }
                  : { 'aria-valuetext': progress?.phase || 'Starting import...' }
                )}
              >
                <div
                  className={`doc-import-progress-fill ${!progress || progress.percent === 0 ? 'doc-import-progress-indeterminate' : ''}`}
                  style={progress && progress.percent > 0 ? { width: `${progress.percent}%` } : undefined}
                />
              </div>

              <div className="doc-import-progress-info">
                <span
                  className="doc-import-phase-text"
                  data-testid={TEST_IDS.DOCUMENT_IMPORT_PHASE_TEXT}
                  aria-live="polite"
                >
                  {progress?.phase || 'Starting import...'}
                </span>
                {progress && progress.percent > 0 && (
                  <span className="doc-import-progress-text">
                    {Math.round(progress.percent)}%
                  </span>
                )}
              </div>

              {/* OCR warning banner */}
              {progress?.warnings && (
                <div className="doc-import-warning" role="alert">
                  {progress.warnings}
                </div>
              )}
            </div>
          )}

          {/* Error state */}
          {hasError && (
            <div className="doc-import-error" role="alert" aria-live="assertive">
              <p className="doc-import-error-message">{error}</p>
            </div>
          )}

          {/* Success state */}
          {hasSuccess && result?.outputPath && (
            <div className="doc-import-success" role="status" aria-live="polite">
              <p className="doc-import-success-message">Import complete</p>
              <p className="doc-import-output-path">{result.outputPath}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="dialog-actions">
          {/* Options: Import + Cancel buttons */}
          {showOptions && (
            <>
              <button
                className="dialog-btn dialog-btn-secondary"
                onClick={handleClose}
              >
                Cancel
              </button>
              <button
                className="dialog-btn dialog-btn-primary"
                onClick={() => startImport()}
                data-testid={TEST_IDS.DOCUMENT_IMPORT_BTN_START}
              >
                Import
              </button>
            </>
          )}

          {/* Progress: Cancel button */}
          {isImporting && (
            <button
              className="dialog-btn dialog-btn-danger"
              onClick={() => cancelImport()}
              data-testid={TEST_IDS.DOCUMENT_IMPORT_BTN_CANCEL}
            >
              Cancel
            </button>
          )}

          {/* Error: Retry + Dismiss buttons */}
          {hasError && (
            <>
              <button
                className="dialog-btn dialog-btn-secondary"
                onClick={closeDialog}
              >
                Dismiss
              </button>
              <button
                className="dialog-btn dialog-btn-primary"
                onClick={() => startImport()}
                data-testid={TEST_IDS.DOCUMENT_IMPORT_BTN_RETRY}
              >
                Retry
              </button>
            </>
          )}

          {/* Success: Done button -- opens document and triggers organize prompt */}
          {hasSuccess && (
            <button
              className="dialog-btn dialog-btn-primary"
              onClick={handleDone}
              data-testid={TEST_IDS.DOCUMENT_IMPORT_BTN_DONE}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </BaseDialog>
  )
}
