// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useTranscriptionStore
 *
 * Covers state transitions, progress updates, dialog lifecycle,
 * and error handling for the transcription Zustand store.
 *
 * @see Issue #75 - Media import with transcription
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useTranscriptionStore } from './useTranscriptionStore'
import type {
  TranscriptionImportResult,
  TranscriptionProgress
} from '../../../shared/ipc/transcription-schema'

// =============================================================================
// Mock window.api.transcription
// =============================================================================

const mockImport = vi.fn()
const mockCancel = vi.fn()
const mockOnProgress = vi.fn()

vi.stubGlobal('window', {
  api: {
    transcription: {
      import: mockImport,
      cancel: mockCancel,
      onProgress: mockOnProgress
    }
  }
})

// =============================================================================
// Helper: reset store between tests
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

describe('useTranscriptionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()

    // Default mock: onProgress returns a cleanup function
    mockOnProgress.mockReturnValue(vi.fn())
  })

  describe('Initial state', () => {
    it('initializes with dialog closed and no active transcription', () => {
      const state = useTranscriptionStore.getState()

      expect(state.isDialogOpen).toBe(false)
      expect(state.filePath).toBeNull()
      expect(state.fileName).toBeNull()
      expect(state.isTranscribing).toBe(false)
      expect(state.progress).toBeNull()
      expect(state.result).toBeNull()
      expect(state.error).toBeNull()
    })
  })

  describe('openDialog', () => {
    it('opens the dialog with file info', () => {
      const { openDialog } = useTranscriptionStore.getState()

      openDialog('/path/to/audio.mp3', 'audio.mp3')

      const state = useTranscriptionStore.getState()
      expect(state.isDialogOpen).toBe(true)
      expect(state.filePath).toBe('/path/to/audio.mp3')
      expect(state.fileName).toBe('audio.mp3')
    })

    it('resets transient state when opening', () => {
      // Set some leftover state
      useTranscriptionStore.setState({
        isTranscribing: true,
        progress: { percent: 50, phase: 'Transcribing' },
        result: { success: true, outputPath: '/old/path' },
        error: 'old error'
      })

      const { openDialog } = useTranscriptionStore.getState()
      openDialog('/new/file.mp3', 'file.mp3')

      const state = useTranscriptionStore.getState()
      expect(state.isTranscribing).toBe(false)
      expect(state.progress).toBeNull()
      expect(state.result).toBeNull()
      expect(state.error).toBeNull()
    })
  })

  describe('closeDialog', () => {
    it('resets all state', () => {
      // Open and set some state
      useTranscriptionStore.setState({
        isDialogOpen: true,
        filePath: '/path/to/audio.mp3',
        fileName: 'audio.mp3',
        isTranscribing: true,
        progress: { percent: 30, phase: 'Processing' },
        error: 'some error'
      })

      const { closeDialog } = useTranscriptionStore.getState()
      closeDialog()

      const state = useTranscriptionStore.getState()
      expect(state.isDialogOpen).toBe(false)
      expect(state.filePath).toBeNull()
      expect(state.fileName).toBeNull()
      expect(state.isTranscribing).toBe(false)
      expect(state.progress).toBeNull()
      expect(state.result).toBeNull()
      expect(state.error).toBeNull()
    })

    it('can be called when already closed without error', () => {
      const { closeDialog } = useTranscriptionStore.getState()
      closeDialog()

      expect(useTranscriptionStore.getState().isDialogOpen).toBe(false)
    })
  })

  describe('startTranscription', () => {
    it('sets isTranscribing to true and subscribes to progress', async () => {
      const successResult: TranscriptionImportResult = {
        success: true,
        outputPath: '/project/import/audio.md'
      }
      mockImport.mockResolvedValue(successResult)

      // Open dialog first
      useTranscriptionStore.getState().openDialog('/path/to/audio.mp3', 'audio.mp3')

      await useTranscriptionStore.getState().startTranscription('en')

      // Should have subscribed to progress
      expect(mockOnProgress).toHaveBeenCalledOnce()

      // Should have called import
      expect(mockImport).toHaveBeenCalledWith({
        filePath: '/path/to/audio.mp3',
        language: 'en'
      })
    })

    it('sets result on successful transcription', async () => {
      const successResult: TranscriptionImportResult = {
        success: true,
        outputPath: '/project/import/audio.md'
      }
      mockImport.mockResolvedValue(successResult)

      useTranscriptionStore.getState().openDialog('/path/to/audio.mp3', 'audio.mp3')
      await useTranscriptionStore.getState().startTranscription('en')

      const state = useTranscriptionStore.getState()
      expect(state.isTranscribing).toBe(false)
      expect(state.result).toEqual(successResult)
      expect(state.error).toBeNull()
    })

    it('sets error on failed transcription', async () => {
      const failResult: TranscriptionImportResult = {
        success: false,
        error: 'No API key configured'
      }
      mockImport.mockResolvedValue(failResult)

      useTranscriptionStore.getState().openDialog('/path/to/audio.mp3', 'audio.mp3')
      await useTranscriptionStore.getState().startTranscription('auto')

      const state = useTranscriptionStore.getState()
      expect(state.isTranscribing).toBe(false)
      expect(state.error).toBe('No API key configured')
    })

    it('handles unexpected errors', async () => {
      mockImport.mockRejectedValue(new Error('Network error'))

      useTranscriptionStore.getState().openDialog('/path/to/audio.mp3', 'audio.mp3')
      await useTranscriptionStore.getState().startTranscription('en')

      const state = useTranscriptionStore.getState()
      expect(state.isTranscribing).toBe(false)
      expect(state.error).toBe('Network error')
    })

    it('does nothing if filePath is null', async () => {
      // Do not open dialog (filePath stays null)
      await useTranscriptionStore.getState().startTranscription('en')

      expect(mockImport).not.toHaveBeenCalled()
      expect(mockOnProgress).not.toHaveBeenCalled()
    })

    it('cleans up progress listener on success', async () => {
      const cleanupFn = vi.fn()
      mockOnProgress.mockReturnValue(cleanupFn)
      mockImport.mockResolvedValue({ success: true, outputPath: '/out.md' })

      useTranscriptionStore.getState().openDialog('/path/audio.mp3', 'audio.mp3')
      await useTranscriptionStore.getState().startTranscription('en')

      expect(cleanupFn).toHaveBeenCalledOnce()
    })

    it('cleans up progress listener on error', async () => {
      const cleanupFn = vi.fn()
      mockOnProgress.mockReturnValue(cleanupFn)
      mockImport.mockRejectedValue(new Error('fail'))

      useTranscriptionStore.getState().openDialog('/path/audio.mp3', 'audio.mp3')
      await useTranscriptionStore.getState().startTranscription('en')

      expect(cleanupFn).toHaveBeenCalledOnce()
    })
  })

  describe('cancelTranscription', () => {
    it('calls cancel API and resets transcribing state', async () => {
      mockCancel.mockResolvedValue({ success: true })

      useTranscriptionStore.setState({
        isTranscribing: true,
        progress: { percent: 50, phase: 'Transcribing' }
      })

      await useTranscriptionStore.getState().cancelTranscription()

      expect(mockCancel).toHaveBeenCalledOnce()

      const state = useTranscriptionStore.getState()
      expect(state.isTranscribing).toBe(false)
      expect(state.progress).toBeNull()
      expect(state.error).toBeNull()
    })

    it('handles cancel API failure gracefully', async () => {
      mockCancel.mockRejectedValue(new Error('Cancel failed'))

      useTranscriptionStore.setState({ isTranscribing: true })

      // Should not throw
      await useTranscriptionStore.getState().cancelTranscription()

      const state = useTranscriptionStore.getState()
      expect(state.isTranscribing).toBe(false)
    })
  })

  describe('_handleProgress', () => {
    it('updates progress state', () => {
      const progress: TranscriptionProgress = {
        percent: 42,
        phase: 'Transcribing',
        currentChunk: 2,
        totalChunks: 5,
        etaSeconds: 30
      }

      useTranscriptionStore.getState()._handleProgress(progress)

      expect(useTranscriptionStore.getState().progress).toEqual(progress)
    })

    it('overwrites previous progress', () => {
      useTranscriptionStore.setState({
        progress: { percent: 10, phase: 'Starting' }
      })

      const newProgress: TranscriptionProgress = {
        percent: 50,
        phase: 'Processing chunk 3 of 5'
      }

      useTranscriptionStore.getState()._handleProgress(newProgress)

      expect(useTranscriptionStore.getState().progress).toEqual(newProgress)
    })
  })

  describe('lastLanguage persistence', () => {
    it('should default lastLanguage to auto', () => {
      const state = useTranscriptionStore.getState()

      expect(state.lastLanguage).toBe('auto')
    })

    it('should update lastLanguage via setLastLanguage', () => {
      const { setLastLanguage } = useTranscriptionStore.getState()

      setLastLanguage('pl')

      expect(useTranscriptionStore.getState().lastLanguage).toBe('pl')
    })

    it('should preserve lastLanguage when openDialog is called', () => {
      // Arrange: set a non-default language
      useTranscriptionStore.getState().setLastLanguage('pl')

      // Act: open a dialog for a new file
      useTranscriptionStore.getState().openDialog('/path/to/audio.mp3', 'audio.mp3')

      // Assert: lastLanguage is unchanged
      expect(useTranscriptionStore.getState().lastLanguage).toBe('pl')
    })

    it('should preserve lastLanguage when closeDialog is called', () => {
      // Arrange: open dialog and set a non-default language
      useTranscriptionStore.getState().openDialog('/path/to/audio.mp3', 'audio.mp3')
      useTranscriptionStore.getState().setLastLanguage('en')

      // Act: close the dialog
      useTranscriptionStore.getState().closeDialog()

      // Assert: lastLanguage survives dialog close
      expect(useTranscriptionStore.getState().lastLanguage).toBe('en')
    })
  })
})
