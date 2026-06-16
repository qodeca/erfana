// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for TranscriptionDialog Component
 *
 * Tests dialog rendering, language selection, progress updates,
 * cancel/error/success states, and accessibility attributes.
 *
 * @see Issue #75 - Media import with transcription
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TranscriptionDialog } from './TranscriptionDialog'
import { useTranscriptionStore } from '../../stores/useTranscriptionStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { TEST_IDS } from '../../constants/testids'

// =============================================================================
// Mock createPortal to render inline (no actual portal)
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
// Mock window.api.transcription
// =============================================================================

const mockTranscriptionImport = vi.fn()
const mockTranscriptionCancel = vi.fn()
const mockOnProgress = vi.fn().mockReturnValue(vi.fn())

// Extend window.api without replacing the entire window object
// (vi.stubGlobal('window', ...) would destroy React DOM internals)
;(window as any).api = {
  transcription: {
    import: mockTranscriptionImport,
    cancel: mockTranscriptionCancel,
    onProgress: mockOnProgress
  }
}

// =============================================================================
// Helper: reset store state
// =============================================================================

function resetStore(): void {
  useTranscriptionStore.setState({
    isDialogOpen: false,
    filePath: null,
    fileName: null,
    isTranscribing: false,
    progress: null,
    result: null,
    error: null,
    lastLanguage: 'auto'
  })
}

// =============================================================================
// Tests
// =============================================================================

describe('TranscriptionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()

    // Ensure portal-root exists
    if (!document.getElementById('portal-root')) {
      const portalRoot = document.createElement('div')
      portalRoot.id = 'portal-root'
      document.body.appendChild(portalRoot)
    }
  })

  afterEach(() => {
    // Clean up DOM safely
    const portalRoot = document.getElementById('portal-root')
    if (portalRoot && portalRoot.parentNode) {
      portalRoot.parentNode.removeChild(portalRoot)
    }
  })

  describe('Rendering', () => {
    it('renders nothing when dialog is closed', () => {
      render(<TranscriptionDialog />)
      expect(screen.queryByTestId(TEST_IDS.TRANSCRIPTION_DIALOG)).not.toBeInTheDocument()
    })

    it('renders dialog when open', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3'
      })

      render(<TranscriptionDialog />)
      expect(screen.getByTestId(TEST_IDS.TRANSCRIPTION_DIALOG)).toBeInTheDocument()
    })

    it('displays the file name', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/recording.mp3',
        fileName: 'recording.mp3'
      })

      render(<TranscriptionDialog />)
      expect(screen.getByText('recording.mp3')).toBeInTheDocument()
    })

    it('displays the dialog title', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3'
      })

      render(<TranscriptionDialog />)
      expect(screen.getByText('Transcribe audio')).toBeInTheDocument()
    })
  })

  describe('Language selection', () => {
    it('renders language select dropdown', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3'
      })

      render(<TranscriptionDialog />)
      expect(screen.getByTestId(TEST_IDS.TRANSCRIPTION_LANGUAGE_SELECT)).toBeInTheDocument()
    })

    it('defaults to auto-detect', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3'
      })

      render(<TranscriptionDialog />)
      const select = screen.getByTestId(TEST_IDS.TRANSCRIPTION_LANGUAGE_SELECT) as HTMLSelectElement
      expect(select.value).toBe('auto')
    })

    it('allows language selection change', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3'
      })

      render(<TranscriptionDialog />)
      const select = screen.getByTestId(TEST_IDS.TRANSCRIPTION_LANGUAGE_SELECT) as HTMLSelectElement

      fireEvent.change(select, { target: { value: 'pl' } })
      expect(select.value).toBe('pl')
    })

    it('renders Start transcription button', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3'
      })

      render(<TranscriptionDialog />)
      expect(screen.getByTestId(TEST_IDS.TRANSCRIPTION_BTN_START)).toBeInTheDocument()
      expect(screen.getByTestId(TEST_IDS.TRANSCRIPTION_BTN_START)).toHaveTextContent('Start transcription')
    })
  })

  describe('Progress state', () => {
    it('renders progress bar when transcribing', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: true,
        progress: {
          percent: 42,
          phase: 'Transcribing'
        }
      })

      render(<TranscriptionDialog />)
      const progressBar = screen.getByTestId(TEST_IDS.TRANSCRIPTION_PROGRESS_BAR)
      expect(progressBar).toBeInTheDocument()
    })

    it('displays correct ARIA attributes on progress bar', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: true,
        progress: {
          percent: 65,
          phase: 'Processing'
        }
      })

      render(<TranscriptionDialog />)
      const progressBar = screen.getByTestId(TEST_IDS.TRANSCRIPTION_PROGRESS_BAR)

      expect(progressBar).toHaveAttribute('role', 'progressbar')
      expect(progressBar).toHaveAttribute('aria-valuenow', '65')
      expect(progressBar).toHaveAttribute('aria-valuemin', '0')
      expect(progressBar).toHaveAttribute('aria-valuemax', '100')
      expect(progressBar).toHaveAttribute('aria-label', 'Transcription progress: 65%')
    })

    it('displays phase text', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: true,
        progress: {
          percent: 30,
          phase: 'Uploading chunk'
        }
      })

      render(<TranscriptionDialog />)
      expect(screen.getByTestId(TEST_IDS.TRANSCRIPTION_PHASE_TEXT)).toHaveTextContent('Uploading chunk')
    })

    it('displays chunk progress indicator', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: true,
        progress: {
          percent: 40,
          phase: 'Transcribing',
          currentChunk: 2,
          totalChunks: 5
        }
      })

      render(<TranscriptionDialog />)
      const phaseText = screen.getByTestId(TEST_IDS.TRANSCRIPTION_PHASE_TEXT)
      expect(phaseText.textContent).toContain('chunk 2 of 5')
    })

    it('displays percentage text', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: true,
        progress: {
          percent: 73,
          phase: 'Processing'
        }
      })

      render(<TranscriptionDialog />)
      expect(screen.getByTestId(TEST_IDS.TRANSCRIPTION_PROGRESS_TEXT)).toHaveTextContent('73%')
    })

    it('renders cancel button during transcription', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: true,
        progress: {
          percent: 50,
          phase: 'Transcribing'
        }
      })

      render(<TranscriptionDialog />)
      expect(screen.getByTestId(TEST_IDS.TRANSCRIPTION_BTN_CANCEL)).toBeInTheDocument()
    })

    it('shows "Starting transcription..." when transcribing with no progress', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: true,
        progress: null
      })

      render(<TranscriptionDialog />)
      expect(screen.getByTestId(TEST_IDS.TRANSCRIPTION_PHASE_TEXT)).toHaveTextContent('Starting transcription...')
    })
  })

  describe('Error state', () => {
    it('displays error message', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: false,
        error: 'No API key configured. Add your OpenAI API key in Settings.'
      })

      render(<TranscriptionDialog />)
      const errorEl = screen.getByTestId(TEST_IDS.TRANSCRIPTION_ERROR)
      expect(errorEl).toBeInTheDocument()
      expect(errorEl).toHaveTextContent('No API key configured')
    })

    it('shows Retry button on error', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: false,
        error: 'Transcription failed'
      })

      render(<TranscriptionDialog />)
      expect(screen.getByText('Retry')).toBeInTheDocument()
    })

    it('shows Dismiss button on error', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: false,
        error: 'Transcription failed'
      })

      render(<TranscriptionDialog />)
      expect(screen.getByText('Dismiss')).toBeInTheDocument()
    })
  })

  describe('Success state', () => {
    it('shows success message and output path', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: false,
        result: {
          success: true,
          outputPath: '/project/import/audio.md'
        },
        error: null
      })

      render(<TranscriptionDialog />)
      expect(screen.getByText('Transcription complete')).toBeInTheDocument()
      expect(screen.getByText('/project/import/audio.md')).toBeInTheDocument()
    })

    it('shows Done button on success', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: false,
        result: { success: true, outputPath: '/out.md' },
        error: null
      })

      render(<TranscriptionDialog />)
      expect(screen.getByText('Done')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('has role="dialog" and aria-modal="true"', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3'
      })

      render(<TranscriptionDialog />)
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it('has aria-labelledby pointing to title', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3'
      })

      render(<TranscriptionDialog />)
      const dialog = screen.getByRole('dialog')
      const labelledBy = dialog.getAttribute('aria-labelledby')
      expect(labelledBy).toBeTruthy()
      const titleElement = document.getElementById(labelledBy!)
      expect(titleElement).toHaveTextContent('Transcribe audio')
    })

    it('progress bar has correct ARIA role', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: true,
        progress: { percent: 0, phase: 'Starting' }
      })

      render(<TranscriptionDialog />)
      const progressBar = screen.getByTestId(TEST_IDS.TRANSCRIPTION_PROGRESS_BAR)
      expect(progressBar).toHaveAttribute('role', 'progressbar')
    })

    it('language select has aria-label', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3'
      })

      render(<TranscriptionDialog />)
      const select = screen.getByTestId(TEST_IDS.TRANSCRIPTION_LANGUAGE_SELECT)
      expect(select).toHaveAttribute('aria-label', 'Transcription language')
    })

    it('has aria-describedby pointing to body', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3'
      })

      render(<TranscriptionDialog />)
      const dialog = screen.getByRole('dialog')
      const describedBy = dialog.getAttribute('aria-describedby')
      expect(describedBy).toBeTruthy()
      const bodyElement = document.getElementById(describedBy!)
      expect(bodyElement).toBeInTheDocument()
      expect(bodyElement).toHaveTextContent('audio.mp3')
    })

    it('error state has role="alert" with aria-live', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: false,
        error: 'Test error'
      })

      render(<TranscriptionDialog />)
      const errorEl = screen.getByTestId(TEST_IDS.TRANSCRIPTION_ERROR)
      expect(errorEl).toHaveAttribute('role', 'alert')
      expect(errorEl).toHaveAttribute('aria-live', 'assertive')
    })

    it('success state has role="status" with aria-live', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: false,
        result: { success: true, outputPath: '/out.md' },
        error: null
      })

      render(<TranscriptionDialog />)
      const successEl = screen.getByText('Transcription complete').closest('[role="status"]')
      expect(successEl).toHaveAttribute('aria-live', 'polite')
    })

    it('phase text has aria-live for screen reader announcements', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: true,
        progress: { percent: 50, phase: 'Processing' }
      })

      render(<TranscriptionDialog />)
      const phaseText = screen.getByTestId(TEST_IDS.TRANSCRIPTION_PHASE_TEXT)
      expect(phaseText).toHaveAttribute('aria-live', 'polite')
    })

    it('uses h3 for title (consistent with other dialogs)', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3'
      })

      render(<TranscriptionDialog />)
      const title = screen.getByText('Transcribe audio')
      expect(title.tagName).toBe('H3')
    })
  })

  describe('Done button behavior', () => {
    it('closes dialog when Done is clicked', () => {
      const closeDialogSpy = vi.fn()
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: false,
        result: { success: true, outputPath: '/project/import/audio.md' },
        error: null,
        closeDialog: closeDialogSpy
      })

      render(<TranscriptionDialog />)
      fireEvent.click(screen.getByTestId(TEST_IDS.TRANSCRIPTION_BTN_DONE))

      expect(closeDialogSpy).toHaveBeenCalledOnce()
    })

    it('opens transcript file in editor on Done click (AC-022)', () => {
      const mockSetActive = vi.fn()
      const mockFocus = vi.fn()
      const mockGetPanel = vi.fn().mockReturnValue(null)
      const mockAddPanel = vi.fn().mockReturnValue({
        api: { setActive: mockSetActive },
        group: { focus: mockFocus }
      })
      const mockRegisterEditorPanel = vi.fn()

      // Set up dockview API mock
      useProjectStore.setState({
        dockviewApi: {
          getPanel: mockGetPanel,
          addPanel: mockAddPanel
        } as any,
        registerEditorPanel: mockRegisterEditorPanel
      })

      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: false,
        result: { success: true, outputPath: '/project/import/audio.md' },
        error: null
      })

      render(<TranscriptionDialog />)
      fireEvent.click(screen.getByTestId(TEST_IDS.TRANSCRIPTION_BTN_DONE))

      expect(mockAddPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          component: 'editor',
          title: 'audio.md',
          params: expect.objectContaining({ filePath: '/project/import/audio.md' })
        })
      )
      expect(mockSetActive).toHaveBeenCalled()
      expect(mockFocus).toHaveBeenCalled()
      expect(mockRegisterEditorPanel).toHaveBeenCalled()
    })

    it('reuses existing editor panel if already open (AC-022)', () => {
      const mockSetActive = vi.fn()
      const mockFocus = vi.fn()
      const existingPanel = {
        api: { setActive: mockSetActive },
        group: { focus: mockFocus }
      }
      const mockGetPanel = vi.fn().mockReturnValue(existingPanel)
      const mockAddPanel = vi.fn()

      useProjectStore.setState({
        dockviewApi: {
          getPanel: mockGetPanel,
          addPanel: mockAddPanel
        } as any
      })

      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: false,
        result: { success: true, outputPath: '/project/import/audio.md' },
        error: null
      })

      render(<TranscriptionDialog />)
      fireEvent.click(screen.getByTestId(TEST_IDS.TRANSCRIPTION_BTN_DONE))

      expect(mockAddPanel).not.toHaveBeenCalled()
      expect(mockSetActive).toHaveBeenCalled()
      expect(mockFocus).toHaveBeenCalled()
    })

    it('triggers organize-import prompt on Done click (AC-019)', () => {
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: false,
        result: { success: true, outputPath: '/project/import/audio.md' },
        error: null
      })

      render(<TranscriptionDialog />)
      fireEvent.click(screen.getByTestId(TEST_IDS.TRANSCRIPTION_BTN_DONE))

      expect(mockTriggerOrganizePrompt).toHaveBeenCalledWith(
        '/project/import/audio.md',
        undefined
      )
    })

    it('does not open file or trigger prompt when outputPath is missing', () => {
      const closeDialogSpy = vi.fn()
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: false,
        result: { success: true },
        error: null,
        closeDialog: closeDialogSpy
      })

      render(<TranscriptionDialog />)
      fireEvent.click(screen.getByTestId(TEST_IDS.TRANSCRIPTION_BTN_DONE))

      // Dialog closes but no file open or prompt trigger
      expect(closeDialogSpy).toHaveBeenCalledOnce()
      expect(mockTriggerOrganizePrompt).not.toHaveBeenCalled()
    })
  })

  describe('Keyboard interaction', () => {
    it('closes dialog on Escape when not transcribing', () => {
      const closeDialogSpy = vi.fn()
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: false
      })
      // Replace closeDialog with spy
      useTranscriptionStore.setState({ closeDialog: closeDialogSpy })

      render(<TranscriptionDialog />)
      fireEvent.keyDown(document, { key: 'Escape' })

      expect(closeDialogSpy).toHaveBeenCalledOnce()
    })

    it('cancels transcription on Escape when transcribing', () => {
      const cancelSpy = vi.fn().mockResolvedValue(undefined)
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: true,
        progress: { percent: 50, phase: 'Transcribing' },
        cancelTranscription: cancelSpy
      })

      render(<TranscriptionDialog />)
      fireEvent.keyDown(document, { key: 'Escape' })

      expect(cancelSpy).toHaveBeenCalledOnce()
    })
  })
})
