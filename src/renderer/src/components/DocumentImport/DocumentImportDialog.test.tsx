// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for DocumentImportDialog Component
 *
 * Tests dialog rendering, options view, progress, error, success states,
 * keyboard interaction, and Done button behavior.
 *
 * @see Issue #134 - LiteParse frontend UI
 * @see Spec #021 - LiteParse document import
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DocumentImportDialog } from './DocumentImportDialog'
import { useDocumentImportStore } from '../../stores/useDocumentImportStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { TEST_IDS } from '../../constants/testids'

// =============================================================================
// Mock createPortal to render inline
// =============================================================================

vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom')
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node
  }
})

// =============================================================================
// Mock triggerOrganizePrompt
// =============================================================================

const mockTriggerOrganizePrompt = vi.fn().mockResolvedValue(undefined)

vi.mock('../../hooks/useImport', () => ({
  triggerOrganizePrompt: (...args: unknown[]) => mockTriggerOrganizePrompt(...args)
}))

// =============================================================================
// Mock TerminalPortalContext
// =============================================================================

vi.mock('../../context/TerminalPortalContext', () => ({
  useTerminalPortalOptional: () => null
}))

// =============================================================================
// Mock logger
// =============================================================================

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

// =============================================================================
// Mock OcrLanguageSelect – renders a plain select to avoid dependency complexity
// =============================================================================

vi.mock('./OcrLanguageSelect', () => ({
  OcrLanguageSelect: ({ value, onChange, disabled, id }: any) => (
    <select
      data-testid="doc-import-language-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      id={id}
    >
      <option value="eng">English</option>
      <option value="pol">Polish</option>
      <option value="deu">German</option>
    </select>
  )
}))

// =============================================================================
// Helper: reset store to closed/idle state
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
    lastDpi: 150
  })
}

// =============================================================================
// Common open state
// =============================================================================

const openFileState = {
  isOpen: true,
  filePath: '/test/document.pdf',
  fileName: 'document.pdf',
  fileSize: 2.5,
  fileType: 'pdf'
}

// =============================================================================
// Tests
// =============================================================================

describe('DocumentImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()

    if (!document.getElementById('portal-root')) {
      const portalRoot = document.createElement('div')
      portalRoot.id = 'portal-root'
      document.body.appendChild(portalRoot)
    }
  })

  afterEach(() => {
    const portalRoot = document.getElementById('portal-root')
    if (portalRoot?.parentNode) {
      portalRoot.parentNode.removeChild(portalRoot)
    }
  })

  // ===========================================================================
  // View state rendering
  // ===========================================================================

  describe('View state rendering', () => {
    it('renders nothing when isOpen is false', () => {
      render(<DocumentImportDialog />)
      expect(screen.queryByTestId(TEST_IDS.DOCUMENT_IMPORT_DIALOG)).not.toBeInTheDocument()
    })

    it('renders options view when open and not importing', () => {
      useDocumentImportStore.setState(openFileState)

      render(<DocumentImportDialog />)
      expect(screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_DIALOG)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_OCR_TOGGLE)).toBeInTheDocument()
      expect(screen.queryByTestId(TEST_IDS.DOCUMENT_IMPORT_PROGRESS)).not.toBeInTheDocument()
    })

    it('renders progress view when isImporting is true', () => {
      useDocumentImportStore.setState({
        ...openFileState,
        isImporting: true,
        progress: { percent: 40, phase: 'Extracting text' }
      })

      render(<DocumentImportDialog />)
      expect(screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_PROGRESS)).toBeInTheDocument()
      expect(screen.queryByTestId(TEST_IDS.DOCUMENT_IMPORT_OCR_TOGGLE)).not.toBeInTheDocument()
    })

    it('renders error view when error is set and not importing', () => {
      useDocumentImportStore.setState({
        ...openFileState,
        error: 'Conversion failed',
        isImporting: false
      })

      render(<DocumentImportDialog />)
      expect(screen.getByText('Conversion failed')).toBeInTheDocument()
      expect(screen.queryByTestId(TEST_IDS.DOCUMENT_IMPORT_OCR_TOGGLE)).not.toBeInTheDocument()
      expect(screen.queryByTestId(TEST_IDS.DOCUMENT_IMPORT_PROGRESS)).not.toBeInTheDocument()
    })

    it('renders success view when result.success is true and not importing', () => {
      useDocumentImportStore.setState({
        ...openFileState,
        result: { success: true, outputPath: '/project/import/document.md' },
        error: null,
        isImporting: false
      })

      render(<DocumentImportDialog />)
      expect(screen.getByText('Import complete')).toBeInTheDocument()
      expect(screen.queryByTestId(TEST_IDS.DOCUMENT_IMPORT_OCR_TOGGLE)).not.toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Options view
  // ===========================================================================

  describe('Options view', () => {
    it('renders file name in file info section', () => {
      useDocumentImportStore.setState(openFileState)

      render(<DocumentImportDialog />)
      expect(screen.getByText('document.pdf')).toBeInTheDocument()
    })

    it('renders dialog title', () => {
      useDocumentImportStore.setState(openFileState)

      render(<DocumentImportDialog />)
      expect(screen.getByText('Import document')).toBeInTheDocument()
    })

    it('OCR toggle is checked by default (lastOcr: true)', () => {
      useDocumentImportStore.setState(openFileState)

      render(<DocumentImportDialog />)
      const ocrToggle = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_OCR_TOGGLE) as HTMLInputElement
      expect(ocrToggle.checked).toBe(true)
    })

    it('OCR toggle is unchecked when lastOcr is false', () => {
      useDocumentImportStore.setState({ ...openFileState, lastOcr: false })

      render(<DocumentImportDialog />)
      const ocrToggle = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_OCR_TOGGLE) as HTMLInputElement
      expect(ocrToggle.checked).toBe(false)
    })

    it('language select shows eng by default', () => {
      useDocumentImportStore.setState(openFileState)

      render(<DocumentImportDialog />)
      const langSelect = screen.getByTestId('doc-import-language-select') as HTMLSelectElement
      expect(langSelect.value).toBe('eng')
    })

    it('screenshots toggle is unchecked by default', () => {
      useDocumentImportStore.setState(openFileState)

      render(<DocumentImportDialog />)
      const screenshotsToggle = screen.getByTestId(
        TEST_IDS.DOCUMENT_IMPORT_SCREENSHOTS_TOGGLE
      ) as HTMLInputElement
      expect(screenshotsToggle.checked).toBe(false)
    })

    it('DPI select is disabled when screenshots are off', () => {
      useDocumentImportStore.setState({ ...openFileState, lastScreenshots: false })

      render(<DocumentImportDialog />)
      const dpiSelect = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_DPI_SELECT)
      expect(dpiSelect).toBeDisabled()
    })

    it('DPI select is enabled when screenshots are on', () => {
      useDocumentImportStore.setState({ ...openFileState, lastScreenshots: true })

      render(<DocumentImportDialog />)
      const dpiSelect = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_DPI_SELECT)
      expect(dpiSelect).toBeEnabled()
    })

    it('shows 100-page screenshot limit hint when screenshots enabled', () => {
      useDocumentImportStore.setState({ ...openFileState, lastScreenshots: true })

      render(<DocumentImportDialog />)
      expect(screen.getByTestId('doc-import-screenshot-hint')).toHaveTextContent(
        'Screenshots will be generated for the first 100 pages only.'
      )
    })

    it('hides screenshot limit hint when screenshots disabled', () => {
      useDocumentImportStore.setState({ ...openFileState, lastScreenshots: false })

      render(<DocumentImportDialog />)
      expect(screen.queryByTestId('doc-import-screenshot-hint')).not.toBeInTheDocument()
    })

    it('language select is disabled when OCR is off', () => {
      useDocumentImportStore.setState({ ...openFileState, lastOcr: false })

      render(<DocumentImportDialog />)
      const langSelect = screen.getByTestId('doc-import-language-select')
      expect(langSelect).toBeDisabled()
    })

    it('language select is enabled when OCR is on', () => {
      useDocumentImportStore.setState({ ...openFileState, lastOcr: true })

      render(<DocumentImportDialog />)
      const langSelect = screen.getByTestId('doc-import-language-select')
      expect(langSelect).toBeEnabled()
    })

    it('Import button is visible in options view', () => {
      useDocumentImportStore.setState(openFileState)

      render(<DocumentImportDialog />)
      expect(screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_BTN_START)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_BTN_START)).toHaveTextContent('Import')
    })

    it('Cancel button calls closeDialog in options view', () => {
      const closeDialogSpy = vi.fn()
      useDocumentImportStore.setState({ ...openFileState, closeDialog: closeDialogSpy })

      render(<DocumentImportDialog />)
      fireEvent.click(screen.getByText('Cancel'))

      expect(closeDialogSpy).toHaveBeenCalledOnce()
    })

    it('Import button calls startImport', () => {
      const startImportSpy = vi.fn()
      useDocumentImportStore.setState({ ...openFileState, startImport: startImportSpy })

      render(<DocumentImportDialog />)
      fireEvent.click(screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_BTN_START))

      expect(startImportSpy).toHaveBeenCalledOnce()
    })

    it('shows file type badge when fileType is provided', () => {
      useDocumentImportStore.setState(openFileState)

      render(<DocumentImportDialog />)
      expect(screen.getByText('pdf')).toBeInTheDocument()
    })

    it('shows formatted file size', () => {
      useDocumentImportStore.setState({ ...openFileState, fileSize: 2.5 })

      render(<DocumentImportDialog />)
      expect(screen.getByText('2.5 MB')).toBeInTheDocument()
    })

    it('shows < 0.1 MB for very small files', () => {
      useDocumentImportStore.setState({ ...openFileState, fileSize: 0.05 })

      render(<DocumentImportDialog />)
      expect(screen.getByText('< 0.1 MB')).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Progress view
  // ===========================================================================

  describe('Progress view', () => {
    it('shows phase text from progress', () => {
      useDocumentImportStore.setState({
        ...openFileState,
        isImporting: true,
        progress: { percent: 50, phase: 'Running OCR' }
      })

      render(<DocumentImportDialog />)
      expect(screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_PHASE_TEXT)).toHaveTextContent('Running OCR')
    })

    it('shows "Starting import..." when progress is null', () => {
      useDocumentImportStore.setState({
        ...openFileState,
        isImporting: true,
        progress: null
      })

      render(<DocumentImportDialog />)
      expect(screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_PHASE_TEXT)).toHaveTextContent(
        'Starting import...'
      )
    })

    it('Cancel button is visible during import', () => {
      useDocumentImportStore.setState({
        ...openFileState,
        isImporting: true,
        progress: { percent: 30, phase: 'Extracting' }
      })

      render(<DocumentImportDialog />)
      expect(screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_BTN_CANCEL)).toBeInTheDocument()
    })

    it('Cancel button during import calls cancelImport', () => {
      const cancelImportSpy = vi.fn()
      useDocumentImportStore.setState({
        ...openFileState,
        isImporting: true,
        progress: { percent: 30, phase: 'Extracting' },
        cancelImport: cancelImportSpy
      })

      render(<DocumentImportDialog />)
      fireEvent.click(screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_BTN_CANCEL))

      expect(cancelImportSpy).toHaveBeenCalledOnce()
    })

    it('OCR warning banner appears when progress.warnings is set', () => {
      useDocumentImportStore.setState({
        ...openFileState,
        isImporting: true,
        progress: { percent: 10, phase: 'Initializing', warnings: 'Tesseract not available' }
      })

      render(<DocumentImportDialog />)
      expect(screen.getByRole('alert')).toHaveTextContent('Tesseract not available')
    })

    it('no warning banner when progress.warnings is absent', () => {
      useDocumentImportStore.setState({
        ...openFileState,
        isImporting: true,
        progress: { percent: 20, phase: 'Extracting' }
      })

      render(<DocumentImportDialog />)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('phase text has aria-live="polite"', () => {
      useDocumentImportStore.setState({
        ...openFileState,
        isImporting: true,
        progress: { percent: 50, phase: 'Processing' }
      })

      render(<DocumentImportDialog />)
      const phaseText = screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_PHASE_TEXT)
      expect(phaseText).toHaveAttribute('aria-live', 'polite')
    })

    it('progress bar has role="progressbar"', () => {
      useDocumentImportStore.setState({
        ...openFileState,
        isImporting: true,
        progress: { percent: 60, phase: 'Extracting' }
      })

      render(<DocumentImportDialog />)
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Error view
  // ===========================================================================

  describe('Error view', () => {
    it('error message is displayed', () => {
      useDocumentImportStore.setState({
        ...openFileState,
        error: 'LibreOffice not found',
        isImporting: false
      })

      render(<DocumentImportDialog />)
      expect(screen.getByText('LibreOffice not found')).toBeInTheDocument()
    })

    it('error container has role="alert" with aria-live="assertive"', () => {
      useDocumentImportStore.setState({
        ...openFileState,
        error: 'Import failed',
        isImporting: false
      })

      render(<DocumentImportDialog />)
      const errorContainer = screen
        .getByText('Import failed')
        .closest('[role="alert"]')
      expect(errorContainer).toHaveAttribute('aria-live', 'assertive')
    })

    it('Retry button triggers startImport', () => {
      const startImportSpy = vi.fn()
      useDocumentImportStore.setState({
        ...openFileState,
        error: 'Conversion failed',
        isImporting: false,
        startImport: startImportSpy
      })

      render(<DocumentImportDialog />)
      fireEvent.click(screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_BTN_RETRY))

      expect(startImportSpy).toHaveBeenCalledOnce()
    })

    it('Dismiss button calls closeDialog', () => {
      const closeDialogSpy = vi.fn()
      useDocumentImportStore.setState({
        ...openFileState,
        error: 'Something went wrong',
        isImporting: false,
        closeDialog: closeDialogSpy
      })

      render(<DocumentImportDialog />)
      fireEvent.click(screen.getByText('Dismiss'))

      expect(closeDialogSpy).toHaveBeenCalledOnce()
    })

    it('does not show options view buttons in error state', () => {
      useDocumentImportStore.setState({
        ...openFileState,
        error: 'Failed',
        isImporting: false
      })

      render(<DocumentImportDialog />)
      expect(screen.queryByTestId(TEST_IDS.DOCUMENT_IMPORT_BTN_START)).not.toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Success view
  // ===========================================================================

  describe('Success view', () => {
    it('shows "Import complete" success message', () => {
      useDocumentImportStore.setState({
        ...openFileState,
        result: { success: true, outputPath: '/project/import/document.md' },
        error: null,
        isImporting: false
      })

      render(<DocumentImportDialog />)
      expect(screen.getByText('Import complete')).toBeInTheDocument()
    })

    it('output path is displayed', () => {
      useDocumentImportStore.setState({
        ...openFileState,
        result: { success: true, outputPath: '/project/import/document.md' },
        error: null,
        isImporting: false
      })

      render(<DocumentImportDialog />)
      expect(screen.getByText('/project/import/document.md')).toBeInTheDocument()
    })

    it('Done button is visible', () => {
      useDocumentImportStore.setState({
        ...openFileState,
        result: { success: true, outputPath: '/project/import/document.md' },
        error: null,
        isImporting: false
      })

      render(<DocumentImportDialog />)
      expect(screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_BTN_DONE)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_BTN_DONE)).toHaveTextContent('Done')
    })

    it('success container has role="status" with aria-live="polite"', () => {
      useDocumentImportStore.setState({
        ...openFileState,
        result: { success: true, outputPath: '/out.md' },
        error: null,
        isImporting: false
      })

      render(<DocumentImportDialog />)
      const successEl = screen.getByText('Import complete').closest('[role="status"]')
      expect(successEl).toHaveAttribute('aria-live', 'polite')
    })

    it('Done button calls closeDialog', () => {
      const closeDialogSpy = vi.fn()
      useDocumentImportStore.setState({
        ...openFileState,
        result: { success: true, outputPath: '/project/import/document.md' },
        error: null,
        isImporting: false,
        closeDialog: closeDialogSpy
      })

      render(<DocumentImportDialog />)
      fireEvent.click(screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_BTN_DONE))

      expect(closeDialogSpy).toHaveBeenCalledOnce()
    })

    it('Done button opens imported file in editor when dockviewApi is available', () => {
      const mockSetActive = vi.fn()
      const mockFocus = vi.fn()
      const mockGetPanel = vi.fn().mockReturnValue(null)
      const mockAddPanel = vi.fn().mockReturnValue({
        api: { setActive: mockSetActive },
        group: { focus: mockFocus }
      })
      const mockRegisterEditorPanel = vi.fn()

      useProjectStore.setState({
        dockviewApi: {
          getPanel: mockGetPanel,
          addPanel: mockAddPanel
        } as any,
        registerEditorPanel: mockRegisterEditorPanel
      })

      useDocumentImportStore.setState({
        ...openFileState,
        result: { success: true, outputPath: '/project/import/document.md' },
        error: null,
        isImporting: false
      })

      render(<DocumentImportDialog />)
      fireEvent.click(screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_BTN_DONE))

      expect(mockAddPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          component: 'editor',
          title: 'document.md',
          params: expect.objectContaining({ filePath: '/project/import/document.md' })
        })
      )
      expect(mockSetActive).toHaveBeenCalled()
      expect(mockFocus).toHaveBeenCalled()
    })

    it('Done button triggers organize-import prompt', () => {
      useDocumentImportStore.setState({
        ...openFileState,
        result: { success: true, outputPath: '/project/import/document.md' },
        error: null,
        isImporting: false
      })

      render(<DocumentImportDialog />)
      fireEvent.click(screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_BTN_DONE))

      expect(mockTriggerOrganizePrompt).toHaveBeenCalledWith(
        '/project/import/document.md',
        undefined
      )
    })

    it('does not trigger prompt when outputPath is missing', () => {
      const closeDialogSpy = vi.fn()
      useDocumentImportStore.setState({
        ...openFileState,
        result: { success: true },
        error: null,
        isImporting: false,
        closeDialog: closeDialogSpy
      })

      render(<DocumentImportDialog />)
      // Done button is rendered for hasSuccess=true regardless of outputPath
      fireEvent.click(screen.getByTestId(TEST_IDS.DOCUMENT_IMPORT_BTN_DONE))

      expect(closeDialogSpy).toHaveBeenCalledOnce()
      expect(mockTriggerOrganizePrompt).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Keyboard interaction
  // ===========================================================================

  describe('Keyboard interaction', () => {
    it('Escape key closes dialog when not importing', () => {
      const closeDialogSpy = vi.fn()
      useDocumentImportStore.setState({
        ...openFileState,
        isImporting: false,
        closeDialog: closeDialogSpy
      })

      render(<DocumentImportDialog />)
      fireEvent.keyDown(document, { key: 'Escape' })

      expect(closeDialogSpy).toHaveBeenCalledOnce()
    })

    it('Escape key cancels import when importing', () => {
      const cancelImportSpy = vi.fn()
      useDocumentImportStore.setState({
        ...openFileState,
        isImporting: true,
        progress: { percent: 50, phase: 'Extracting' },
        cancelImport: cancelImportSpy
      })

      render(<DocumentImportDialog />)
      fireEvent.keyDown(document, { key: 'Escape' })

      expect(cancelImportSpy).toHaveBeenCalledOnce()
    })

    it('Escape key has no effect when dialog is closed', () => {
      const closeDialogSpy = vi.fn()
      useDocumentImportStore.setState({ isOpen: false, closeDialog: closeDialogSpy })

      render(<DocumentImportDialog />)
      fireEvent.keyDown(document, { key: 'Escape' })

      expect(closeDialogSpy).not.toHaveBeenCalled()
    })
  })
})
