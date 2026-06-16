// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * TranscriptionDialog Component
 *
 * Modal dialog for the audio import transcription workflow. Displays four
 * distinct states: language selection, progress, success, and error.
 *
 * Composes on BaseDialog for portal rendering, overlay, and focus management.
 *
 * Features:
 * - Language selector with 30+ supported languages
 * - Real-time progress bar with phase text, chunk indicator, and ETA
 * - Focus trap within the dialog for keyboard accessibility
 * - Escape key to cancel/close
 * - ARIA attributes for screen reader support
 *
 * @see Issue #75 - Media import with transcription
 * @see Spec #009 - Media import with transcription specification
 */

import { useState, useEffect, useRef, useCallback, useId } from 'react'
import { FileAudio, FileVideo } from 'lucide-react'
import { VIDEO_IMPORT } from '../../../../shared/constants'
import { useTranscriptionStore } from '../../stores/useTranscriptionStore'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { LanguageSelect } from './LanguageSelect'
import { TEST_IDS } from '../../constants/testids'
import type { TranscriptionLanguage } from '../../../../shared/ipc/transcription-schema'
import { ErrorCode } from '../../../../shared/errors'
import { BaseDialog } from '../Dialog/BaseDialog'
import { sanitizeFilePath, getBasename } from '../../utils/fileUtils'
import { triggerOrganizePrompt } from '../../hooks/useImport'
import { useTerminalPortalOptional } from '../../context/TerminalPortalContext'
import { logger } from '../../utils/logger'
import './TranscriptionDialog.css'

/**
 * Get actionable suggestion text for a transcription error code.
 *
 * @param errorCode - Error code from the transcription result
 * @param backend - Active transcription backend ('openai' or 'local')
 */
function getErrorSuggestion(errorCode: string | undefined, backend: string): string | null {
  switch (errorCode) {
    case ErrorCode.TRANSCRIPTION_NO_API_KEY:
      // API key errors are only relevant for the OpenAI backend
      return backend === 'openai' ? 'Add your OpenAI API key in Settings.' : null
    case ErrorCode.TRANSCRIPTION_INVALID_API_KEY:
      return backend === 'openai' ? 'Check your API key in Settings.' : null
    case ErrorCode.TRANSCRIPTION_NETWORK_ERROR:
      return backend === 'local'
        ? 'Check the local whisper model is downloaded in Settings.'
        : 'Check your internet connection and try again.'
    case ErrorCode.TRANSCRIPTION_RATE_LIMITED:
      return 'Wait a moment and try again.'
    case ErrorCode.TRANSCRIPTION_INVALID_AUDIO:
      return 'Ensure the file is a valid audio file in a supported format.'
    case ErrorCode.TRANSCRIPTION_TIMEOUT:
      return 'The file may be too large. Try a shorter recording.'
    case ErrorCode.VIDEO_NO_AUDIO_TRACK:
      return 'This video has no audio track. Only videos with audio can be transcribed.'
    case ErrorCode.VIDEO_EXTRACTION_FAILED:
      return 'Audio extraction failed. The video file may be corrupted.'
    case ErrorCode.VIDEO_FFMPEG_UNAVAILABLE:
      return 'Video import requires ffmpeg. Please reinstall the application.'
    default:
      return null
  }
}

/**
 * Format seconds as a human-readable ETA string.
 *
 * @param seconds - Estimated seconds remaining
 * @returns Formatted string like "~30s", "~2m 15s", or "~1h 5m"
 */
function formatEta(seconds: number): string {
  if (seconds < 60) {
    return `~${Math.round(seconds)}s`
  }
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return secs > 0 ? `~${mins}m ${secs}s` : `~${mins}m`
  }
  const hours = Math.floor(seconds / 3600)
  const mins = Math.round((seconds % 3600) / 60)
  return mins > 0 ? `~${hours}h ${mins}m` : `~${hours}h`
}

/**
 * TranscriptionDialog -- modal dialog for audio import transcription.
 *
 * Reads all state from useTranscriptionStore. Renders nothing when the
 * dialog is not open.
 *
 * @returns Rendered dialog via BaseDialog, or null when closed
 *
 * @example
 * ```tsx
 * // In your app layout:
 * <TranscriptionDialog />
 *
 * // To open from elsewhere:
 * const { openDialog } = useTranscriptionStore()
 * openDialog('/path/to/audio.mp3', 'audio.mp3')
 * ```
 */
export function TranscriptionDialog(): JSX.Element | null {
  const {
    isDialogOpen,
    filePath,
    fileName,
    isTranscribing,
    progress,
    result,
    error,
    lastLanguage,
    closeDialog,
    startTranscription,
    cancelTranscription,
    setLastLanguage
  } = useTranscriptionStore()

  const { settings } = useGlobalSettingsStore()
  const terminalPortal = useTerminalPortalOptional()

  const id = useId()
  const titleId = `transcription-title${id}`
  const descriptionId = `transcription-desc${id}`

  const [selectedLanguage, setSelectedLanguage] = useState<TranscriptionLanguage>('auto')
  const dialogRef = useRef<HTMLDivElement>(null)

  // Initialize language selection from last used language when dialog opens
  useEffect(() => {
    if (isDialogOpen) {
      setSelectedLanguage(lastLanguage)
    }
  }, [isDialogOpen, filePath, lastLanguage])

  // Escape key handler (custom cancel-vs-close logic)
  useEffect(() => {
    if (!isDialogOpen) return undefined

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (isTranscribing) {
          cancelTranscription()
        } else {
          closeDialog()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [isDialogOpen, isTranscribing, cancelTranscription, closeDialog])

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
    if (!isDialogOpen) return undefined
    document.addEventListener('keydown', handleFocusTrap)
    return () => document.removeEventListener('keydown', handleFocusTrap)
  }, [isDialogOpen, handleFocusTrap])

  if (!isDialogOpen) return null

  /** Check if the current file is a video file */
  const isVideo = fileName
    ? (VIDEO_IMPORT.SUPPORTED_EXTENSIONS as readonly string[]).includes(
        fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
      )
    : false
  const FileIcon = isVideo ? FileVideo : FileAudio
  const dialogTitle = isVideo ? 'Transcribe video' : 'Transcribe audio'

  /** Determine dialog view state */
  const hasError = error !== null && !isTranscribing
  const hasSuccess = result?.success === true && !isTranscribing
  const showLanguageSelection = !isTranscribing && !hasError && !hasSuccess
  const activeBackend = settings?.transcription.backend ?? 'openai'
  const errorSuggestion = hasError && result?.errorCode
    ? getErrorSuggestion(result.errorCode, activeBackend)
    : null

  const handleStart = (): void => {
    setLastLanguage(selectedLanguage)
    startTranscription(selectedLanguage)
  }

  const handleClose = (): void => {
    if (isTranscribing) {
      cancelTranscription()
    } else {
      closeDialog()
    }
  }

  const handleRetry = (): void => {
    startTranscription(selectedLanguage)
  }

  const handleDone = (): void => {
    // Capture outputPath before closeDialog resets store state
    const outputPath = result?.outputPath

    closeDialog()

    if (!outputPath) return

    // Auto-open transcript file in editor (AC-022)
    try {
      const dockviewApi = useProjectStore.getState().dockviewApi
      if (dockviewApi) {
        const panelTitle = getBasename(outputPath) || 'Transcript'
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
      logger.warn('Failed to auto-open transcript file')
    }

    // Trigger organize-import prompt (AC-019) – fire-and-forget
    triggerOrganizePrompt(outputPath, terminalPortal ?? undefined).catch(() => {
      // Non-fatal, already logged inside triggerOrganizePrompt
    })
  }

  return (
    <BaseDialog
      isOpen={isDialogOpen}
      onClose={handleClose}
      zIndex={10000}
      closeOnBackdrop={false}
      closeOnEscape={false}
      className="transcription-dialog"
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
    >
      <div ref={dialogRef} data-testid={TEST_IDS.TRANSCRIPTION_DIALOG}>
        {/* Header */}
        <div className="dialog-header">
          <h3 id={titleId} className="dialog-title">
            {dialogTitle}
          </h3>
        </div>

        {/* Body */}
        <div id={descriptionId}>
          {/* File info -- always visible */}
          <div className="transcription-file-info">
            <FileIcon size={18} strokeWidth={1.5} className="transcription-file-icon" />
            <span className="transcription-file-name">{fileName}</span>
          </div>

          {/* Language selection state */}
          {showLanguageSelection && (
            <div className="transcription-language-section">
              <label className="transcription-language-label" htmlFor="transcription-lang">
                Language
              </label>
              <LanguageSelect
                value={selectedLanguage}
                onChange={setSelectedLanguage}
                disabled={false}
              />
            </div>
          )}

          {/* Progress state */}
          {isTranscribing && progress && (
            <div className="transcription-progress-section">
              <div
                className="transcription-progress-track"
                role="progressbar"
                aria-valuenow={progress.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Transcription progress: ${Math.round(progress.percent)}%`}
                data-testid={TEST_IDS.TRANSCRIPTION_PROGRESS_BAR}
              >
                <div
                  className="transcription-progress-fill"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>

              <div className="transcription-progress-info">
                <span
                  className="transcription-phase-text"
                  data-testid={TEST_IDS.TRANSCRIPTION_PHASE_TEXT}
                  aria-live="polite"
                >
                  {progress.phase}
                  {progress.currentChunk !== undefined && progress.totalChunks !== undefined && (
                    <> &ndash; chunk {progress.currentChunk} of {progress.totalChunks}</>
                  )}
                </span>
                <span
                  className="transcription-progress-text"
                  data-testid={TEST_IDS.TRANSCRIPTION_PROGRESS_TEXT}
                >
                  {Math.round(progress.percent)}%
                </span>
              </div>

              {progress.etaSeconds !== undefined && progress.etaSeconds > 0 && (
                <div className="transcription-eta-text">
                  Estimated time remaining: {formatEta(progress.etaSeconds)}
                </div>
              )}
            </div>
          )}

          {/* Transcribing but no progress yet -- show initial state */}
          {isTranscribing && !progress && (
            <div className="transcription-progress-section">
              <div
                className="transcription-progress-track"
                role="progressbar"
                aria-valuenow={0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Transcription progress: 0%"
                data-testid={TEST_IDS.TRANSCRIPTION_PROGRESS_BAR}
              >
                <div className="transcription-progress-fill" style={{ width: '0%' }} />
              </div>
              <div className="transcription-progress-info">
                <span
                  className="transcription-phase-text"
                  data-testid={TEST_IDS.TRANSCRIPTION_PHASE_TEXT}
                  aria-live="polite"
                >
                  Starting transcription...
                </span>
                <span
                  className="transcription-progress-text"
                  data-testid={TEST_IDS.TRANSCRIPTION_PROGRESS_TEXT}
                >
                  0%
                </span>
              </div>
            </div>
          )}

          {/* Error state */}
          {hasError && (
            <div
              className="transcription-error"
              data-testid={TEST_IDS.TRANSCRIPTION_ERROR}
              role="alert"
              aria-live="assertive"
            >
              <p className="transcription-error-message">{error}</p>
              {errorSuggestion && (
                <p className="transcription-error-suggestion">{errorSuggestion}</p>
              )}
            </div>
          )}

          {/* Success state */}
          {hasSuccess && result?.outputPath && (
            <div className="transcription-success" role="status" aria-live="polite">
              <p className="transcription-success-message">Transcription complete</p>
              <p className="transcription-output-path">{result.outputPath}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="dialog-actions">
          {/* Language selection: Start + Cancel buttons */}
          {showLanguageSelection && (
            <>
              <button
                className="dialog-btn dialog-btn-secondary"
                onClick={closeDialog}
              >
                Cancel
              </button>
              <button
                className="dialog-btn dialog-btn-primary"
                onClick={handleStart}
                data-testid={TEST_IDS.TRANSCRIPTION_BTN_START}
              >
                Start transcription
              </button>
            </>
          )}

          {/* Progress: Cancel button */}
          {isTranscribing && (
            <button
              className="dialog-btn dialog-btn-danger"
              onClick={cancelTranscription}
              data-testid={TEST_IDS.TRANSCRIPTION_BTN_CANCEL}
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
                onClick={handleRetry}
                data-testid={TEST_IDS.TRANSCRIPTION_BTN_RETRY}
              >
                Retry
              </button>
            </>
          )}

          {/* Success: Done button – opens transcript and triggers organize prompt */}
          {hasSuccess && (
            <button
              className="dialog-btn dialog-btn-primary"
              onClick={handleDone}
              data-testid={TEST_IDS.TRANSCRIPTION_BTN_DONE}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </BaseDialog>
  )
}
