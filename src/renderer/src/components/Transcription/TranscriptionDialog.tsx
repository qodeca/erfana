/**
 * TranscriptionDialog Component
 *
 * Modal dialog for the audio import transcription workflow. Displays four
 * distinct states: language selection, progress, success, and error.
 *
 * Renders as a portal to #portal-root for proper overlay stacking.
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

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, FileAudio } from 'lucide-react'
import { useTranscriptionStore } from '../../stores/useTranscriptionStore'
import { LanguageSelect } from './LanguageSelect'
import { TEST_IDS } from '../../constants/testids'
import type { TranscriptionLanguage } from '../../../../shared/ipc/transcription-schema'
import { ErrorCode } from '../../../../shared/errors'
import './TranscriptionDialog.css'

/**
 * Get actionable suggestion text for a transcription error code.
 */
function getErrorSuggestion(errorCode: string | undefined): string | null {
  switch (errorCode) {
    case ErrorCode.TRANSCRIPTION_NO_API_KEY:
      return 'Add your OpenAI API key in Settings.'
    case ErrorCode.TRANSCRIPTION_INVALID_API_KEY:
      return 'Check your API key in Settings.'
    case ErrorCode.TRANSCRIPTION_NETWORK_ERROR:
      return 'Check your internet connection and try again.'
    case ErrorCode.TRANSCRIPTION_RATE_LIMITED:
      return 'Wait a moment and try again.'
    case ErrorCode.TRANSCRIPTION_INVALID_AUDIO:
      return 'Ensure the file is a valid audio file in a supported format.'
    case ErrorCode.TRANSCRIPTION_TIMEOUT:
      return 'The file may be too large. Try a shorter recording.'
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
 * @returns Rendered dialog via portal, or null when closed
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

  const [selectedLanguage, setSelectedLanguage] = useState<TranscriptionLanguage>('auto')
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Initialize language selection from last used language when dialog opens
  useEffect(() => {
    if (isDialogOpen) {
      setSelectedLanguage(lastLanguage)
    }
  }, [isDialogOpen, filePath, lastLanguage])

  // Focus close button when dialog opens
  useEffect(() => {
    if (isDialogOpen) {
      // Small delay to ensure the dialog is rendered
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus()
      }, 10)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [isDialogOpen])

  // Escape key handler
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

  const portalRoot = document.getElementById('portal-root')
  if (!portalRoot) return null

  /** Determine dialog view state */
  const hasError = error !== null && !isTranscribing
  const hasSuccess = result?.success === true && !isTranscribing
  const showLanguageSelection = !isTranscribing && !hasError && !hasSuccess
  const errorSuggestion = hasError && result?.errorCode
    ? getErrorSuggestion(result.errorCode)
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

  const dialogContent = (
    <div
      className="transcription-overlay"
      // Clicking outside the dialog closes it (unless transcribing)
      onClick={(e) => {
        if (e.target === e.currentTarget && !isTranscribing) {
          closeDialog()
        }
      }}
    >
      <div
        ref={dialogRef}
        className="transcription-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transcription-dialog-title"
        data-testid={TEST_IDS.TRANSCRIPTION_DIALOG}
      >
        {/* Header */}
        <div className="transcription-header">
          <h2 id="transcription-dialog-title" className="transcription-title">
            Transcribe audio
          </h2>
          <button
            ref={closeButtonRef}
            className="transcription-close-btn"
            onClick={handleClose}
            aria-label={isTranscribing ? 'Cancel transcription' : 'Close dialog'}
            title={isTranscribing ? 'Cancel transcription' : 'Close dialog'}
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="transcription-body">
          {/* File info -- always visible */}
          <div className="transcription-file-info">
            <FileAudio size={18} strokeWidth={1.5} className="transcription-file-icon" />
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
            <div className="transcription-error" data-testid={TEST_IDS.TRANSCRIPTION_ERROR}>
              <p className="transcription-error-message">{error}</p>
              {errorSuggestion && (
                <p className="transcription-error-suggestion">{errorSuggestion}</p>
              )}
            </div>
          )}

          {/* Success state */}
          {hasSuccess && result?.outputPath && (
            <div className="transcription-success">
              <p className="transcription-success-message">Transcription complete</p>
              <p className="transcription-output-path">{result.outputPath}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="transcription-footer">
          {/* Language selection: Start + Cancel buttons */}
          {showLanguageSelection && (
            <>
              <button
                className="transcription-btn-secondary"
                onClick={closeDialog}
              >
                Cancel
              </button>
              <button
                className="transcription-btn-primary"
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
              className="transcription-btn-danger"
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
                className="transcription-btn-secondary"
                onClick={closeDialog}
              >
                Dismiss
              </button>
              <button
                className="transcription-btn-primary"
                onClick={handleRetry}
                data-testid={TEST_IDS.TRANSCRIPTION_BTN_START}
              >
                Retry
              </button>
            </>
          )}

          {/* Success: Close button */}
          {hasSuccess && (
            <button
              className="transcription-btn-primary"
              onClick={closeDialog}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(dialogContent, portalRoot)
}
