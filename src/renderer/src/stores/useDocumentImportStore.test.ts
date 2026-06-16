// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useDocumentImportStore
 *
 * Covers state transitions, progress updates, dialog lifecycle,
 * session-persistent options, and error handling for the document
 * import Zustand store.
 *
 * @see Issue #134 - LiteParse frontend UI
 * @see Spec #021 - LiteParse document import
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useDocumentImportStore } from './useDocumentImportStore'
import type {
  DocumentImportProgress,
  DocumentImportResult
} from '../../../shared/ipc/import-schema'

// =============================================================================
// Mock window.api.import
// =============================================================================

const mockDocumentImport = vi.fn()
const mockDocumentCancel = vi.fn()
const mockGetDocumentExtensions = vi.fn()
const mockOnDocumentProgress = vi.fn()
const mockOnDependenciesReady = vi.fn()

;(window as any).api = {
  ...(window as any).api,
  import: {
    ...(window as any).api?.import,
    documentImport: mockDocumentImport,
    cancelDocument: mockDocumentCancel,
    getDocumentExtensions: mockGetDocumentExtensions,
    onDocumentProgress: mockOnDocumentProgress,
    onDependenciesReady: mockOnDependenciesReady
  }
}

// =============================================================================
// Helper: reset store between tests
// =============================================================================

function resetStore(): void {
  useDocumentImportStore.setState({
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
    hasImageMagick: false
  })
}

// =============================================================================
// Tests
// =============================================================================

describe('useDocumentImportStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()

    // Default mock: onDocumentProgress returns a cleanup function
    mockOnDocumentProgress.mockReturnValue(vi.fn())
  })

  describe('Initial state', () => {
    it('has isOpen false by default', () => {
      const state = useDocumentImportStore.getState()
      expect(state.isOpen).toBe(false)
    })

    it('has null file info by default', () => {
      const state = useDocumentImportStore.getState()
      expect(state.filePath).toBeNull()
      expect(state.fileName).toBeNull()
      expect(state.fileSize).toBe(0)
      expect(state.fileType).toBeNull()
    })

    it('has no active import state by default', () => {
      const state = useDocumentImportStore.getState()
      expect(state.isImporting).toBe(false)
      expect(state.progress).toBeNull()
      expect(state.error).toBeNull()
      expect(state.errorCode).toBeNull()
      expect(state.result).toBeNull()
    })

    it('has correct default persistent options', () => {
      const state = useDocumentImportStore.getState()
      expect(state.lastOcr).toBe(true)
      expect(state.lastLanguage).toBe('eng')
      expect(state.lastScreenshots).toBe(false)
      expect(state.lastDpi).toBe(150)
    })

    it('has empty documentExtensions by default', () => {
      const state = useDocumentImportStore.getState()
      expect(state.documentExtensions).toEqual([])
    })
  })

  describe('openDialog', () => {
    it('sets isOpen to true with file info', () => {
      const { openDialog } = useDocumentImportStore.getState()

      openDialog('/path/to/report.pdf', 'report.pdf', 2.4, 'pdf')

      const state = useDocumentImportStore.getState()
      expect(state.isOpen).toBe(true)
      expect(state.filePath).toBe('/path/to/report.pdf')
      expect(state.fileName).toBe('report.pdf')
      expect(state.fileSize).toBe(2.4)
      expect(state.fileType).toBe('pdf')
    })

    it('resets transient state when opening a new dialog', () => {
      // Arrange: set leftover state from a previous import
      useDocumentImportStore.setState({
        isImporting: false,
        progress: { percent: 90, phase: 'OCR' },
        result: { success: true, outputPath: '/old/out.md' },
        error: 'old error',
        errorCode: 'OLD_CODE'
      })

      const { openDialog } = useDocumentImportStore.getState()
      openDialog('/path/new.docx', 'new.docx', 0.5, 'docx')

      const state = useDocumentImportStore.getState()
      expect(state.isImporting).toBe(false)
      expect(state.progress).toBeNull()
      expect(state.result).toBeNull()
      expect(state.error).toBeNull()
      expect(state.errorCode).toBeNull()
    })

    it('preserves persistent options when opening', () => {
      // Arrange: change options from defaults
      useDocumentImportStore.getState().setOcr(false)
      useDocumentImportStore.getState().setLanguage('deu')
      useDocumentImportStore.getState().setScreenshots(true)
      useDocumentImportStore.getState().setDpi(300)

      const { openDialog } = useDocumentImportStore.getState()
      openDialog('/path/to/file.pdf', 'file.pdf', 1.0, 'pdf')

      const state = useDocumentImportStore.getState()
      expect(state.lastOcr).toBe(false)
      expect(state.lastLanguage).toBe('deu')
      expect(state.lastScreenshots).toBe(true)
      expect(state.lastDpi).toBe(300)
    })

    it('does not open when isImporting is true', () => {
      // Arrange: simulate an active import
      useDocumentImportStore.setState({
        isOpen: true,
        filePath: '/original.pdf',
        fileName: 'original.pdf',
        fileSize: 1.0,
        fileType: 'pdf',
        isImporting: true
      })

      const { openDialog } = useDocumentImportStore.getState()
      openDialog('/new.pdf', 'new.pdf', 2.0, 'pdf')

      // State should not change
      const state = useDocumentImportStore.getState()
      expect(state.filePath).toBe('/original.pdf')
      expect(state.fileName).toBe('original.pdf')
    })
  })

  describe('closeDialog', () => {
    it('resets isOpen and file info', () => {
      useDocumentImportStore.setState({
        isOpen: true,
        filePath: '/path/to/file.pdf',
        fileName: 'file.pdf',
        fileSize: 3.1,
        fileType: 'pdf'
      })

      const { closeDialog } = useDocumentImportStore.getState()
      closeDialog()

      const state = useDocumentImportStore.getState()
      expect(state.isOpen).toBe(false)
      expect(state.filePath).toBeNull()
      expect(state.fileName).toBeNull()
      expect(state.fileSize).toBe(0)
      expect(state.fileType).toBeNull()
    })

    it('resets transient import state', () => {
      useDocumentImportStore.setState({
        isOpen: true,
        isImporting: false,
        progress: { percent: 50, phase: 'Converting' },
        error: 'something failed',
        errorCode: 'CONVERT_ERROR',
        result: { success: false, error: 'something failed' }
      })

      const { closeDialog } = useDocumentImportStore.getState()
      closeDialog()

      const state = useDocumentImportStore.getState()
      expect(state.isImporting).toBe(false)
      expect(state.progress).toBeNull()
      expect(state.error).toBeNull()
      expect(state.errorCode).toBeNull()
      expect(state.result).toBeNull()
    })

    it('preserves persistent options after closing', () => {
      useDocumentImportStore.getState().setOcr(false)
      useDocumentImportStore.getState().setLanguage('fra')
      useDocumentImportStore.getState().setScreenshots(true)
      useDocumentImportStore.getState().setDpi(300)

      useDocumentImportStore.getState().closeDialog()

      const state = useDocumentImportStore.getState()
      expect(state.lastOcr).toBe(false)
      expect(state.lastLanguage).toBe('fra')
      expect(state.lastScreenshots).toBe(true)
      expect(state.lastDpi).toBe(300)
    })

    it('can be called when already closed without error', () => {
      const { closeDialog } = useDocumentImportStore.getState()
      closeDialog()
      expect(useDocumentImportStore.getState().isOpen).toBe(false)
    })
  })

  describe('setOcr', () => {
    it('updates lastOcr to false', () => {
      const { setOcr } = useDocumentImportStore.getState()
      setOcr(false)
      expect(useDocumentImportStore.getState().lastOcr).toBe(false)
    })

    it('updates lastOcr back to true', () => {
      useDocumentImportStore.setState({ lastOcr: false })
      useDocumentImportStore.getState().setOcr(true)
      expect(useDocumentImportStore.getState().lastOcr).toBe(true)
    })
  })

  describe('setLanguage', () => {
    it('updates lastLanguage', () => {
      const { setLanguage } = useDocumentImportStore.getState()
      setLanguage('pol')
      expect(useDocumentImportStore.getState().lastLanguage).toBe('pol')
    })

    it('updates to a multi-part code like chi_sim', () => {
      useDocumentImportStore.getState().setLanguage('chi_sim')
      expect(useDocumentImportStore.getState().lastLanguage).toBe('chi_sim')
    })
  })

  describe('setScreenshots', () => {
    it('updates lastScreenshots to true', () => {
      const { setScreenshots } = useDocumentImportStore.getState()
      setScreenshots(true)
      expect(useDocumentImportStore.getState().lastScreenshots).toBe(true)
    })

    it('updates lastScreenshots back to false', () => {
      useDocumentImportStore.setState({ lastScreenshots: true })
      useDocumentImportStore.getState().setScreenshots(false)
      expect(useDocumentImportStore.getState().lastScreenshots).toBe(false)
    })
  })

  describe('setDpi', () => {
    it('updates lastDpi', () => {
      const { setDpi } = useDocumentImportStore.getState()
      setDpi(300)
      expect(useDocumentImportStore.getState().lastDpi).toBe(300)
    })

    it('accepts any integer within valid range', () => {
      useDocumentImportStore.getState().setDpi(72)
      expect(useDocumentImportStore.getState().lastDpi).toBe(72)
    })
  })

  describe('startImport', () => {
    it('sets isImporting to true and subscribes to progress', async () => {
      const successResult: DocumentImportResult = {
        success: true,
        outputPath: '/project/import/report.md'
      }
      mockDocumentImport.mockResolvedValue(successResult)

      useDocumentImportStore.getState().openDialog('/report.pdf', 'report.pdf', 1.0, 'pdf')
      await useDocumentImportStore.getState().startImport()

      expect(mockOnDocumentProgress).toHaveBeenCalledOnce()
      expect(mockDocumentImport).toHaveBeenCalledOnce()
    })

    it('passes correct options with ocr enabled', async () => {
      mockDocumentImport.mockResolvedValue({ success: true, outputPath: '/out.md' })

      useDocumentImportStore.setState({ lastOcr: true, lastLanguage: 'deu', lastScreenshots: false })
      useDocumentImportStore.getState().openDialog('/doc.pdf', 'doc.pdf', 0.8, 'pdf')
      await useDocumentImportStore.getState().startImport()

      expect(mockDocumentImport).toHaveBeenCalledWith({
        filePath: '/doc.pdf',
        options: {
          ocr: true,
          ocrLanguage: 'deu',
          screenshots: false,
          dpi: undefined
        }
      })
    })

    it('omits ocrLanguage when ocr is disabled', async () => {
      mockDocumentImport.mockResolvedValue({ success: true, outputPath: '/out.md' })

      useDocumentImportStore.setState({ lastOcr: false, lastLanguage: 'eng', lastScreenshots: false })
      useDocumentImportStore.getState().openDialog('/doc.pdf', 'doc.pdf', 0.8, 'pdf')
      await useDocumentImportStore.getState().startImport()

      const callArg = mockDocumentImport.mock.calls[0][0]
      expect(callArg.options.ocrLanguage).toBeUndefined()
    })

    it('passes dpi when screenshots is enabled', async () => {
      mockDocumentImport.mockResolvedValue({ success: true, outputPath: '/out.md' })

      useDocumentImportStore.setState({ lastOcr: false, lastScreenshots: true, lastDpi: 300 })
      useDocumentImportStore.getState().openDialog('/doc.pdf', 'doc.pdf', 0.8, 'pdf')
      await useDocumentImportStore.getState().startImport()

      const callArg = mockDocumentImport.mock.calls[0][0]
      expect(callArg.options.screenshots).toBe(true)
      expect(callArg.options.dpi).toBe(300)
    })

    it('omits dpi when screenshots is disabled', async () => {
      mockDocumentImport.mockResolvedValue({ success: true, outputPath: '/out.md' })

      useDocumentImportStore.setState({ lastScreenshots: false, lastDpi: 300 })
      useDocumentImportStore.getState().openDialog('/doc.pdf', 'doc.pdf', 0.8, 'pdf')
      await useDocumentImportStore.getState().startImport()

      const callArg = mockDocumentImport.mock.calls[0][0]
      expect(callArg.options.dpi).toBeUndefined()
    })

    it('sets result and clears isImporting on success', async () => {
      const successResult: DocumentImportResult = {
        success: true,
        outputPath: '/project/import/report.md'
      }
      mockDocumentImport.mockResolvedValue(successResult)

      useDocumentImportStore.getState().openDialog('/report.pdf', 'report.pdf', 1.0, 'pdf')
      await useDocumentImportStore.getState().startImport()

      const state = useDocumentImportStore.getState()
      expect(state.isImporting).toBe(false)
      expect(state.result).toEqual(successResult)
      expect(state.error).toBeNull()
      expect(state.errorCode).toBeNull()
      expect(state.progress).toEqual({ percent: 100, phase: 'Complete' })
    })

    it('sets error and errorCode on failed import result', async () => {
      const failResult: DocumentImportResult = {
        success: false,
        error: 'LibreOffice not found',
        errorCode: 'LIBREOFFICE_MISSING'
      }
      mockDocumentImport.mockResolvedValue(failResult)

      useDocumentImportStore.getState().openDialog('/doc.docx', 'doc.docx', 0.3, 'docx')
      await useDocumentImportStore.getState().startImport()

      const state = useDocumentImportStore.getState()
      expect(state.isImporting).toBe(false)
      expect(state.error).toBe('LibreOffice not found')
      expect(state.errorCode).toBe('LIBREOFFICE_MISSING')
      expect(state.result).toEqual(failResult)
    })

    it('sets fallback error message when failed result has no error field', async () => {
      mockDocumentImport.mockResolvedValue({ success: false })

      useDocumentImportStore.getState().openDialog('/doc.pdf', 'doc.pdf', 1.0, 'pdf')
      await useDocumentImportStore.getState().startImport()

      const state = useDocumentImportStore.getState()
      expect(state.error).toBe('Document import failed')
    })

    it('handles unexpected exceptions', async () => {
      mockDocumentImport.mockRejectedValue(new Error('IPC channel error'))

      useDocumentImportStore.getState().openDialog('/doc.pdf', 'doc.pdf', 1.0, 'pdf')
      await useDocumentImportStore.getState().startImport()

      const state = useDocumentImportStore.getState()
      expect(state.isImporting).toBe(false)
      expect(state.error).toBe('IPC channel error')
      expect(state.errorCode).toBeNull()
    })

    it('handles non-Error exceptions with fallback message', async () => {
      mockDocumentImport.mockRejectedValue('string error')

      useDocumentImportStore.getState().openDialog('/doc.pdf', 'doc.pdf', 1.0, 'pdf')
      await useDocumentImportStore.getState().startImport()

      const state = useDocumentImportStore.getState()
      expect(state.error).toBe('Unexpected error during document import')
    })

    it('does nothing when filePath is null', async () => {
      // Do not call openDialog – filePath stays null
      await useDocumentImportStore.getState().startImport()

      expect(mockDocumentImport).not.toHaveBeenCalled()
      expect(mockOnDocumentProgress).not.toHaveBeenCalled()
    })

    it('does nothing when isImporting is already true', async () => {
      useDocumentImportStore.setState({
        filePath: '/doc.pdf',
        isImporting: true
      })

      await useDocumentImportStore.getState().startImport()

      expect(mockDocumentImport).not.toHaveBeenCalled()
    })

    it('cleans up progress listener on success', async () => {
      const cleanupFn = vi.fn()
      mockOnDocumentProgress.mockReturnValue(cleanupFn)
      mockDocumentImport.mockResolvedValue({ success: true, outputPath: '/out.md' })

      useDocumentImportStore.getState().openDialog('/doc.pdf', 'doc.pdf', 1.0, 'pdf')
      await useDocumentImportStore.getState().startImport()

      expect(cleanupFn).toHaveBeenCalledOnce()
    })

    it('cleans up progress listener on failure result', async () => {
      const cleanupFn = vi.fn()
      mockOnDocumentProgress.mockReturnValue(cleanupFn)
      mockDocumentImport.mockResolvedValue({ success: false, error: 'fail' })

      useDocumentImportStore.getState().openDialog('/doc.pdf', 'doc.pdf', 1.0, 'pdf')
      await useDocumentImportStore.getState().startImport()

      expect(cleanupFn).toHaveBeenCalledOnce()
    })

    it('cleans up progress listener on exception', async () => {
      const cleanupFn = vi.fn()
      mockOnDocumentProgress.mockReturnValue(cleanupFn)
      mockDocumentImport.mockRejectedValue(new Error('crash'))

      useDocumentImportStore.getState().openDialog('/doc.pdf', 'doc.pdf', 1.0, 'pdf')
      await useDocumentImportStore.getState().startImport()

      expect(cleanupFn).toHaveBeenCalledOnce()
    })
  })

  describe('cancelImport', () => {
    it('calls cancelDocument and resets isImporting', async () => {
      mockDocumentCancel.mockResolvedValue(undefined)

      useDocumentImportStore.setState({
        isImporting: true,
        progress: { percent: 45, phase: 'OCR' }
      })

      await useDocumentImportStore.getState().cancelImport()

      expect(mockDocumentCancel).toHaveBeenCalledOnce()

      const state = useDocumentImportStore.getState()
      expect(state.isImporting).toBe(false)
      expect(state.progress).toBeNull()
      expect(state.error).toBeNull()
      expect(state.errorCode).toBeNull()
      expect(state.result).toBeNull()
    })

    it('handles cancel API failure gracefully', async () => {
      mockDocumentCancel.mockRejectedValue(new Error('Cancel failed'))

      useDocumentImportStore.setState({ isImporting: true })

      // Should not throw
      await useDocumentImportStore.getState().cancelImport()

      const state = useDocumentImportStore.getState()
      expect(state.isImporting).toBe(false)
    })
  })

  describe('fetchExtensions', () => {
    it('calls getDocumentExtensions and sets documentExtensions', async () => {
      const extensions = ['pdf', 'docx', 'pptx', 'xlsx']
      mockGetDocumentExtensions.mockResolvedValue(extensions)

      await useDocumentImportStore.getState().fetchExtensions()

      expect(mockGetDocumentExtensions).toHaveBeenCalledOnce()
      expect(useDocumentImportStore.getState().documentExtensions).toEqual(extensions)
    })

    it('silently ignores errors – documentExtensions stays unchanged', async () => {
      mockGetDocumentExtensions.mockRejectedValue(new Error('IPC error'))

      useDocumentImportStore.setState({ documentExtensions: ['pdf'] })

      await useDocumentImportStore.getState().fetchExtensions()

      // documentExtensions should remain as set before the failed call
      expect(useDocumentImportStore.getState().documentExtensions).toEqual(['pdf'])
    })
  })

  describe('_handleProgress', () => {
    it('updates progress state', () => {
      const progress: DocumentImportProgress = {
        percent: 30,
        phase: 'Converting'
      }

      useDocumentImportStore.getState()._handleProgress(progress)

      expect(useDocumentImportStore.getState().progress).toEqual(progress)
    })

    it('overwrites previous progress', () => {
      useDocumentImportStore.setState({
        progress: { percent: 10, phase: 'Starting' }
      })

      const newProgress: DocumentImportProgress = {
        percent: 80,
        phase: 'OCR',
        warning: 'Low confidence on page 3'
      }

      useDocumentImportStore.getState()._handleProgress(newProgress)

      expect(useDocumentImportStore.getState().progress).toEqual(newProgress)
    })
  })

  describe('Session persistence', () => {
    it('options survive closeDialog and re-open', () => {
      // Arrange: open dialog and configure options
      useDocumentImportStore.getState().openDialog('/first.pdf', 'first.pdf', 1.0, 'pdf')
      useDocumentImportStore.getState().setOcr(false)
      useDocumentImportStore.getState().setLanguage('jpn')
      useDocumentImportStore.getState().setScreenshots(true)
      useDocumentImportStore.getState().setDpi(300)

      // Act: close and re-open with a different file
      useDocumentImportStore.getState().closeDialog()
      useDocumentImportStore.getState().openDialog('/second.docx', 'second.docx', 2.0, 'docx')

      // Assert: options are intact
      const state = useDocumentImportStore.getState()
      expect(state.lastOcr).toBe(false)
      expect(state.lastLanguage).toBe('jpn')
      expect(state.lastScreenshots).toBe(true)
      expect(state.lastDpi).toBe(300)

      // File info reflects the new file
      expect(state.filePath).toBe('/second.docx')
      expect(state.fileName).toBe('second.docx')
    })
  })

  describe('initDependencyListener', () => {
    it('calls onDependenciesReady and returns a cleanup function', () => {
      const cleanupFn = vi.fn()
      mockOnDependenciesReady.mockReturnValue(cleanupFn)

      const cleanup = useDocumentImportStore.getState().initDependencyListener()

      expect(mockOnDependenciesReady).toHaveBeenCalledOnce()
      expect(typeof cleanup).toBe('function')
    })

    it('updates documentExtensions when dependency event fires', () => {
      let capturedCallback: ((event: { libreOffice: boolean; imageMagick: boolean; extensions: string[] }) => void) | null = null
      mockOnDependenciesReady.mockImplementation((cb) => {
        capturedCallback = cb
        return vi.fn()
      })

      useDocumentImportStore.getState().initDependencyListener()

      // Simulate the event
      capturedCallback!({
        libreOffice: true,
        imageMagick: false,
        extensions: ['pdf', 'docx']
      })

      expect(useDocumentImportStore.getState().documentExtensions).toEqual(['pdf', 'docx'])
      expect(useDocumentImportStore.getState().hasLibreOffice).toBe(true)
      expect(useDocumentImportStore.getState().hasImageMagick).toBe(false)
    })

    it('returns a no-op cleanup when api.import.onDependenciesReady is missing', () => {
      // Temporarily remove the handler
      const original = (window as any).api.import.onDependenciesReady
      ;(window as any).api.import.onDependenciesReady = undefined

      const cleanup = useDocumentImportStore.getState().initDependencyListener()

      // Should not throw and should return a function
      expect(typeof cleanup).toBe('function')
      expect(() => cleanup()).not.toThrow()

      // Restore
      ;(window as any).api.import.onDependenciesReady = original
    })
  })
})
