// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Document Import Store
 *
 * Zustand store managing document import dialog state, options persistence,
 * progress tracking, and extension cache for LiteParse document imports.
 *
 * Session-persistent options (OCR, language, screenshots, DPI) survive
 * dialog open/close within the session. Transient state (progress, errors)
 * resets on each dialog open.
 *
 * @see Issue #134 - LiteParse frontend UI
 * @see Spec #021 - LiteParse document import
 */

import { create } from 'zustand'
import type {
  DocumentImportProgress,
  DocumentImportResult
} from '../../../shared/ipc/import-schema'

/**
 * State and actions for the document import workflow.
 */
interface DocumentImportState {
  // Dialog state
  /** Whether the document import dialog is currently visible */
  isOpen: boolean
  /** Absolute path to the document file being imported */
  filePath: string | null
  /** Display name of the document file */
  fileName: string | null
  /** File size in MB */
  fileSize: number
  /** File extension (e.g., 'pdf', 'docx') */
  fileType: string | null

  // Import state (transient – reset on dialog open/close)
  /** Whether an import is actively running */
  isImporting: boolean
  /** Current progress data from the main process (null when idle) */
  progress: DocumentImportProgress | null
  /** Error message if import failed (null if no error) */
  error: string | null
  /** Machine-readable error code (null if no error) */
  errorCode: string | null
  /** Result of the completed import (null until complete) */
  result: DocumentImportResult | null

  // Options (session-persistent – survive dialog close, NOT app restart)
  /** Whether OCR is enabled for text recognition */
  lastOcr: boolean
  /** OCR language in ISO 639-3 format (e.g., 'eng', 'deu') */
  lastLanguage: string
  /** Whether to generate page screenshots */
  lastScreenshots: boolean
  /** Screenshot DPI resolution */
  lastDpi: number

  // Extension cache (fetched from backend, refreshed on dependenciesReady)
  /** List of supported document extensions (e.g., ['pdf', 'docx', 'pptx']) */
  documentExtensions: string[]

  // Dependency status (set by DependencyReadyEvent)
  /** Whether LibreOffice (soffice) is available for Office document conversion */
  hasLibreOffice: boolean
  /** Whether ImageMagick is available for image conversion */
  hasImageMagick: boolean

  // Actions
  /** Open the import dialog for a specific document file */
  openDialog: (filePath: string, fileName: string, fileSize: number, fileType: string) => void
  /** Close the dialog and reset transient state */
  closeDialog: () => void
  /** Start the import with current options */
  startImport: () => Promise<void>
  /** Cancel the active import */
  cancelImport: () => Promise<void>
  /** Update the OCR enabled setting */
  setOcr: (value: boolean) => void
  /** Update the OCR language */
  setLanguage: (value: string) => void
  /** Update the screenshots enabled setting */
  setScreenshots: (value: boolean) => void
  /** Update the screenshot DPI */
  setDpi: (value: number) => void
  /** Fetch available document extensions from the backend */
  fetchExtensions: () => Promise<void>
  /** Subscribe to dependency-ready events; returns cleanup function */
  initDependencyListener: () => () => void

  // Internal – progress event handler (exposed for testing)
  /** Handle incoming progress events from the main process */
  _handleProgress: (progress: DocumentImportProgress) => void
}

/**
 * Cleanup function for the progress event listener.
 * Stored at module level so it can be called from any action.
 */
let progressCleanup: (() => void) | null = null

/**
 * Zustand store for document import dialog and progress state.
 *
 * @example
 * ```tsx
 * const { isOpen, openDialog, startImport } = useDocumentImportStore()
 *
 * // Open dialog for a document file
 * openDialog('/path/to/report.pdf', 'report.pdf', 2.4, 'pdf')
 *
 * // Start import with current options
 * await startImport()
 * ```
 */
export const useDocumentImportStore = create<DocumentImportState>((set, get) => ({
  // Initial state
  isOpen: false,
  filePath: null,
  fileName: null,
  fileSize: 0,
  fileType: null,

  isImporting: false,
  progress: null,
  error: null,
  errorCode: null,
  result: null,

  lastOcr: true,
  lastLanguage: 'eng',
  lastScreenshots: false,
  lastDpi: 150,

  documentExtensions: [],

  hasLibreOffice: false,
  hasImageMagick: false,

  openDialog: (filePath: string, fileName: string, fileSize: number, fileType: string) => {
    // Reject if an import is currently running
    if (get().isImporting) return

    set({
      isOpen: true,
      filePath,
      fileName,
      fileSize,
      fileType,
      // Reset transient state when opening a new dialog
      isImporting: false,
      progress: null,
      error: null,
      errorCode: null,
      result: null
    })
  },

  closeDialog: () => {
    // Unsubscribe from progress events if still listening
    if (progressCleanup) {
      progressCleanup()
      progressCleanup = null
    }

    set({
      isOpen: false,
      filePath: null,
      fileName: null,
      fileSize: 0,
      fileType: null,
      isImporting: false,
      progress: null,
      error: null,
      errorCode: null,
      result: null
    })
  },

  startImport: async () => {
    const { filePath, isImporting } = get()
    if (!filePath || isImporting) return

    // Reset previous results and set importing state
    set({
      isImporting: true,
      progress: null,
      result: null,
      error: null,
      errorCode: null
    })

    // Subscribe to progress events from the main process
    progressCleanup = window.api.import.onDocumentProgress((progress) => {
      get()._handleProgress(progress)
    })

    try {
      const request = {
        filePath,
        options: {
          ocr: get().lastOcr,
          ocrLanguage: get().lastOcr ? get().lastLanguage : undefined,
          screenshots: get().lastScreenshots,
          dpi: get().lastScreenshots ? get().lastDpi : undefined
        }
      }

      const result = await window.api.import.documentImport(request)

      // Unsubscribe from progress events after completion
      if (progressCleanup) {
        progressCleanup()
        progressCleanup = null
      }

      if (result.success) {
        set({
          isImporting: false,
          result,
          progress: { percent: 100, phase: 'Complete' }
        })
      } else {
        set({
          isImporting: false,
          result,
          error: result.error || 'Document import failed',
          errorCode: result.errorCode || null
        })
      }
    } catch (error) {
      // Unsubscribe from progress events on error
      if (progressCleanup) {
        progressCleanup()
        progressCleanup = null
      }

      set({
        isImporting: false,
        error: error instanceof Error ? error.message : 'Unexpected error during document import',
        errorCode: null
      })
    }
  },

  cancelImport: async () => {
    // Unsubscribe from progress events
    if (progressCleanup) {
      progressCleanup()
      progressCleanup = null
    }

    try {
      await window.api.import.cancelDocument()
    } catch {
      // Cancel is best-effort; the import may have already completed
    }

    set({
      isImporting: false,
      progress: null,
      error: null,
      errorCode: null,
      result: null
    })
  },

  setOcr: (value: boolean) => {
    set({ lastOcr: value })
  },

  setLanguage: (value: string) => {
    set({ lastLanguage: value })
  },

  setScreenshots: (value: boolean) => {
    set({ lastScreenshots: value })
  },

  setDpi: (value: number) => {
    set({ lastDpi: value })
  },

  fetchExtensions: async () => {
    try {
      const extensions = await window.api.import.getDocumentExtensions()
      set({ documentExtensions: extensions })
    } catch {
      // Silently fail – extensions will remain empty until next fetch
    }
  },

  initDependencyListener: () => {
    if (!window.api?.import?.onDependenciesReady) {
      return () => {}
    }
    const cleanup = window.api.import.onDependenciesReady((event) => {
      set({
        documentExtensions: event.extensions,
        hasLibreOffice: event.libreOffice,
        hasImageMagick: event.imageMagick
      })
    })
    return cleanup
  },

  _handleProgress: (progress: DocumentImportProgress) => {
    set({ progress })
  }
}))
