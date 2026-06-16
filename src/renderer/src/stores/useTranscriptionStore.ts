// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Transcription Store
 *
 * Zustand store managing transcription dialog state, progress tracking,
 * and result handling for audio-to-text import operations.
 *
 * Subscribes to progress events from the main process via the preload bridge
 * when transcription is active, and automatically unsubscribes when complete.
 *
 * @see Issue #75 - Media import with transcription
 * @see Spec #009 - Media import with transcription specification
 */

import { create } from 'zustand'
import type {
  TranscriptionLanguage,
  TranscriptionProgress,
  TranscriptionImportResult
} from '../../../shared/ipc/transcription-schema'

/**
 * State and actions for the transcription workflow.
 */
interface TranscriptionState {
  // Dialog state
  /** Whether the transcription dialog is currently visible */
  isDialogOpen: boolean
  /** Absolute path to the audio file being imported */
  filePath: string | null
  /** Display name of the audio file */
  fileName: string | null

  // Progress state
  /** Whether a transcription is actively running */
  isTranscribing: boolean
  /** Current progress data from the main process (null when idle) */
  progress: TranscriptionProgress | null

  // Result state
  /** Result of the completed transcription (null until complete) */
  result: TranscriptionImportResult | null
  /** Error message if transcription failed (null if no error) */
  error: string | null

  // Language persistence (session-level, spec NFR-008)
  /** Last selected language, persists across dialog open/close within session */
  lastLanguage: TranscriptionLanguage

  // Actions
  /** Open the transcription dialog for a specific audio file */
  openDialog: (filePath: string, fileName: string) => void
  /** Close the dialog and reset all state */
  closeDialog: () => void
  /** Start transcription with the selected language */
  startTranscription: (language: TranscriptionLanguage) => Promise<void>
  /** Cancel the active transcription */
  cancelTranscription: () => Promise<void>
  /** Update the remembered language selection (persists within session) */
  setLastLanguage: (language: TranscriptionLanguage) => void

  // Internal -- progress event handler (exposed for testing)
  /** Handle incoming progress events from the main process */
  _handleProgress: (progress: TranscriptionProgress) => void
}

/**
 * Cleanup function for the progress event listener.
 * Stored at module level so it can be called from any action.
 */
let progressCleanup: (() => void) | null = null

/**
 * Zustand store for transcription dialog and progress state.
 *
 * @example
 * ```tsx
 * const { isDialogOpen, openDialog, startTranscription } = useTranscriptionStore()
 *
 * // Open dialog for an audio file
 * openDialog('/path/to/recording.mp3', 'recording.mp3')
 *
 * // Start transcription with English language
 * await startTranscription('en')
 * ```
 */
export const useTranscriptionStore = create<TranscriptionState>((set, get) => ({
  // Initial state
  isDialogOpen: false,
  filePath: null,
  fileName: null,
  isTranscribing: false,
  progress: null,
  result: null,
  error: null,
  lastLanguage: 'auto',

  openDialog: (filePath: string, fileName: string) => {
    set({
      isDialogOpen: true,
      filePath,
      fileName,
      // Reset transient state when opening a new dialog
      isTranscribing: false,
      progress: null,
      result: null,
      error: null
    })
  },

  closeDialog: () => {
    // Unsubscribe from progress events if still listening
    if (progressCleanup) {
      progressCleanup()
      progressCleanup = null
    }

    set({
      isDialogOpen: false,
      filePath: null,
      fileName: null,
      isTranscribing: false,
      progress: null,
      result: null,
      error: null
    })
  },

  startTranscription: async (language: TranscriptionLanguage) => {
    const { filePath } = get()
    if (!filePath) return

    // Reset previous results and set transcribing state
    set({
      isTranscribing: true,
      progress: null,
      result: null,
      error: null
    })

    // Subscribe to progress events from the main process
    progressCleanup = window.api.transcription.onProgress((progress) => {
      get()._handleProgress(progress)
    })

    try {
      const result = await window.api.transcription.import({
        filePath,
        language
      })

      // Unsubscribe from progress events after completion
      if (progressCleanup) {
        progressCleanup()
        progressCleanup = null
      }

      if (result.success) {
        set({
          isTranscribing: false,
          result,
          // Set progress to 100% on success for UI display
          progress: { percent: 100, phase: 'Complete' }
        })
      } else {
        set({
          isTranscribing: false,
          result,
          error: result.error || 'Transcription failed'
        })
      }
    } catch (error) {
      // Unsubscribe from progress events on error
      if (progressCleanup) {
        progressCleanup()
        progressCleanup = null
      }

      set({
        isTranscribing: false,
        error: error instanceof Error ? error.message : 'Unexpected error during transcription'
      })
    }
  },

  cancelTranscription: async () => {
    // Unsubscribe from progress events
    if (progressCleanup) {
      progressCleanup()
      progressCleanup = null
    }

    try {
      await window.api.transcription.cancel()
    } catch {
      // Cancel is best-effort; the transcription may have already completed
    }

    set({
      isTranscribing: false,
      progress: null,
      error: null
    })
  },

  setLastLanguage: (language: TranscriptionLanguage) => {
    set({ lastLanguage: language })
  },

  _handleProgress: (progress: TranscriptionProgress) => {
    set({ progress })
  }
}))
