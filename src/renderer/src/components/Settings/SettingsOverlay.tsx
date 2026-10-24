// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'
import { LoggingLevelSchema, type LoggingLevel } from '../../../../shared/ipc/global-settings-schema'
import { TranscriptionBackendSchema, WhisperModelSchema } from '../../../../shared/ipc/transcription-schema'
import type { WhisperModel } from '../../../../shared/ipc/transcription-schema'
import { LOCAL_WHISPER } from '../../../../shared/constants'
import { logger } from '../../utils/logger'
import { useOccluder } from '../../hooks/useOccluder'
import { useOverlayStackEntry } from '../../hooks/useOverlayStackEntry'
import { TEST_IDS } from '../../constants/testids'
import { HtmlPreviewSection } from './sections/HtmlPreviewSection'
import { ImportToolsSection } from './sections/ImportToolsSection'
import './SettingsOverlay.css'
import { loggingGateway } from '../../services/loggingGateway'

// Small delay to ensure overlay is fully rendered before focusing
const FOCUS_DELAY_MS = 10

// Log level options for dropdown
const LOG_LEVEL_OPTIONS: { value: LoggingLevel; label: string }[] = [
  { value: 'trace', label: 'Trace' },
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
  { value: 'fatal', label: 'Fatal' }
]

// Git status polling interval options (milliseconds)
const POLLING_INTERVAL_OPTIONS: { value: number; label: string }[] = [
  { value: 3000, label: '3s' },
  { value: 5000, label: '5s' },
  { value: 7000, label: '7s' },
  { value: 10000, label: '10s' }
]

// Format bytes as human-readable size
function formatModelSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `~${(bytes / 1_000_000_000).toFixed(1)} GB`
  return `~${Math.round(bytes / 1_000_000)} MB`
}

// Download progress reaches the screen reader at most every 10 % or every 5 s,
// so the status region does not flood it (WCAG 4.1.3 Status Messages).
const ANNOUNCE_STEP_PERCENT = 10
const ANNOUNCE_INTERVAL_MS = 5000

/** The last progress the status region announced. */
interface Announced {
  percent: number
  at: number
}

/**
 * Whether new download progress is worth announcing. A percent lower than the
 * last one means a new file started (the binary, then the model), so it counts
 * from zero again.
 */
function shouldAnnounceProgress(last: Announced | null, percent: number, now: number): boolean {
  if (!last || percent < last.percent) return true
  if (percent === last.percent) return false
  return (
    Math.floor(percent / ANNOUNCE_STEP_PERCENT) > Math.floor(last.percent / ANNOUNCE_STEP_PERCENT) ||
    now - last.at >= ANNOUNCE_INTERVAL_MS
  )
}

// Whisper model options derived from shared constants
const WHISPER_MODEL_OPTIONS: { value: WhisperModel; label: string }[] =
  LOCAL_WHISPER.SUPPORTED_MODELS.map((model) => ({
    value: model,
    label: `${model.charAt(0).toUpperCase() + model.slice(1)} (${formatModelSize(LOCAL_WHISPER.MODEL_SIZES[model])})`
  }))

/**
 * SettingsOverlay - Full-screen settings dialog
 *
 * Features:
 * - Portal rendering to #portal-root
 * - Full-screen overlay with backdrop
 * - Escape closes Settings while it is the topmost overlay (#229)
 * - Focus management for accessibility
 * - Logging settings section
 */
export function SettingsOverlay() {
  const { isOpen, closeSettings, focusSection } = useSettingsStore()

  // Register a 'settings' occluder while the overlay is open so the native
  // preview WebContentsView hides behind a still frame (design §1.8). Called
  // unconditionally before any early return; useOccluder no-ops while inactive.
  useOccluder('settings', isOpen)

  const {
    settings,
    updateLoggingLevel,
    updatePreserveLineBreaks,
    updateGitStatusPollingEnabled,
    updateGitStatusPollingInterval,
    updateTranscriptionBackend,
    updateWhisperModel
  } = useGlobalSettingsStore()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)

  // Platform gate for local whisper support.
  //
  //   - macOS (arm64 or x64) — universal binary via whisper-build release
  //   - Windows x64 — signed-SHA-pinned zip via whisper-build release
  //   - Windows ARM64 — upstream has no ARM64 binary; route to OpenAI API
  //   - Linux, others — no binary shipped
  //
  // Mirrors `classifyPlatform()` in src/main/services/whisper-assets.ts.
  const whisperPlatform = window.api.utils.getPlatform()
  const whisperArch = window.api.utils.getArch()
  const isLocalWhisperSupported =
    whisperPlatform === 'darwin' ||
    (whisperPlatform === 'win32' && whisperArch === 'x64')

  // API key state for transcription section
  const [hasApiKey, setHasApiKey] = useState(false)

  // Whisper model management state
  const [installedModels, setInstalledModels] = useState<WhisperModel[]>([])
  const [modelDownloading, setModelDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<{ percent: number; downloadedBytes: number; totalBytes: number } | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  // Text of the always-mounted status region: throttled progress, then the outcome
  const [downloadAnnouncement, setDownloadAnnouncement] = useState('')
  const lastAnnounced = useRef<Announced | null>(null)
  // Set by Cancel; also stops a model download the binary step had not started yet
  const cancelRequested = useRef(false)
  // Where focus goes when the download ends and the control that held it is gone
  const focusAfterDownload = useRef<'download' | 'model' | null>(null)
  const downloadControlsRef = useRef<HTMLDivElement>(null)
  const downloadButtonRef = useRef<HTMLButtonElement>(null)
  const modelSelectRef = useRef<HTMLSelectElement>(null)
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)

  // Logs folder path for display in settings
  const [logsDir, setLogsDir] = useState<string>('')

  /**
   * Check if an API key is stored on overlay open.
   * Avoids polling -- checks once when the overlay becomes visible.
   */
  useEffect(() => {
    if (!isOpen) return
    window.api.transcription.hasApiKey()
      .then((result) => setHasApiKey(result))
      .catch(() => setHasApiKey(false))
  }, [isOpen])

  /**
   * Load logs directory path when overlay opens.
   */
  useEffect(() => {
    if (!isOpen) return
    loggingGateway.getLogsDir()
      .then((dir) => setLogsDir(dir))
      .catch(() => setLogsDir(''))
  }, [isOpen])

  /**
   * Load installed whisper models when overlay opens.
   */
  useEffect(() => {
    if (!isOpen) return
    window.api.whisper.listModels()
      .then((result) => {
        if (result.success && result.models) {
          const installed = result.models
            .filter((m) => m.installed)
            .map((m) => m.name)
          setInstalledModels(installed)
        }
      })
      .catch(() => setInstalledModels([]))
  }, [isOpen])

  /**
   * Subscribe to whisper download progress while overlay is open.
   */
  useEffect(() => {
    if (!isOpen) return undefined
    const cleanup = window.api.whisper.onDownloadProgress((progress) => {
      setDownloadProgress(progress)
      const percent = Math.round(progress.percent)
      const now = Date.now()
      if (shouldAnnounceProgress(lastAnnounced.current, percent, now)) {
        lastAnnounced.current = { percent, at: now }
        setDownloadAnnouncement(`Downloading, ${percent}%`)
      }
    })
    return cleanup
  }, [isOpen])

  /**
   * Hand focus on when a download ends and the control that held it went away:
   * the Cancel button (to Download) or, once the model is ready, both buttons
   * (to the model select).
   */
  useEffect(() => {
    if (modelDownloading || !focusAfterDownload.current) return
    const target = focusAfterDownload.current === 'model' ? modelSelectRef.current : downloadButtonRef.current
    focusAfterDownload.current = null
    target?.focus()
  }, [modelDownloading, installedModels])

  /**
   * Open logs folder in the system file manager.
   */
  const handleOpenLogsFolder = useCallback(async () => {
    try {
      const result = await loggingGateway.openLogsFolder()
      if (result) {
        logger.error('Failed to open logs folder', undefined, { reason: result })
      }
    } catch (err) {
      logger.error('Failed to open logs folder', err instanceof Error ? err : undefined)
    }
  }, [])

  /**
   * Handle whisper model download.
   */
  const handleDownloadModel = useCallback(async () => {
    const model = settings?.transcription.whisperModel
    if (!model || modelDownloading) return

    setModelDownloading(true)
    setDownloadProgress({ percent: 0, downloadedBytes: 0, totalBytes: 0 })
    setDownloadError(null)
    cancelRequested.current = false
    lastAnnounced.current = null
    setDownloadAnnouncement('Download started')
    let outcome: 'ready' | 'cancelled' | 'failed' = 'failed'
    try {
      // Ensure binary is available before downloading the model
      const binaryResult = await window.api.whisper.ensureBinary()
      if (binaryResult.cancelled || (binaryResult.success && cancelRequested.current)) {
        outcome = 'cancelled'
        return
      }
      if (!binaryResult.success) {
        const errorMsg = binaryResult.error || 'Binary setup failed'
        setDownloadError(errorMsg)
        logger.warn('Failed to ensure whisper binary', { error: binaryResult.error })
        return
      }

      const result = await window.api.whisper.ensureModel(model)
      if (result.success) {
        outcome = 'ready'
        setInstalledModels((prev) => prev.includes(model) ? prev : [...prev, model])
      } else if (result.cancelled) {
        outcome = 'cancelled'
      } else {
        const errorMsg = result.error || 'Download failed'
        setDownloadError(errorMsg)
        logger.warn('Failed to download whisper model', { error: result.error })
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Download failed'
      setDownloadError(errorMsg)
      logger.error('Failed to download whisper model', error instanceof Error ? error : undefined)
    } finally {
      // An error is announced by its own alert; the status region says the rest
      if (outcome === 'ready') setDownloadAnnouncement('Model ready')
      else if (outcome === 'cancelled') setDownloadAnnouncement('Download cancelled')
      else setDownloadAnnouncement('')
      if (downloadControlsRef.current?.contains(document.activeElement)) {
        focusAfterDownload.current = outcome === 'ready' ? 'model' : 'download'
      }
      setModelDownloading(false)
      setDownloadProgress(null)
    }
  }, [settings?.transcription.whisperModel, modelDownloading])

  /**
   * Cancel the running download. The main process deletes the partial file and
   * the pending ensure call resolves as cancelled.
   */
  const handleCancelDownload = useCallback(() => {
    cancelRequested.current = true
    window.api.whisper.cancelDownload().catch((error: unknown) => {
      logger.warn('Failed to cancel whisper download', { error: String(error) })
    })
  }, [])

  /**
   * Save API key on input blur.
   * Stores the key via the preload bridge and updates the local state.
   */
  const handleSaveApiKey = useCallback(
    async (e: React.FocusEvent<HTMLInputElement>) => {
      const value = e.target.value.trim()
      if (!value || value.length < 8) return

      try {
        const result = await window.api.transcription.setApiKey(value)
        if (result.success) {
          setApiKeyError(null)
          setHasApiKey(true)
          // Clear the input after successful save
          e.target.value = ''
        } else {
          setApiKeyError(result.error ?? 'The key could not be saved.')
          logger.warn('Failed to save API key', { error: result.error })
        }
      } catch (error) {
        logger.error('Failed to save API key', error instanceof Error ? error : undefined)
      }
    },
    []
  )

  /**
   * Clear stored API key.
   */
  const handleClearApiKey = useCallback(async () => {
    try {
      const result = await window.api.transcription.clearApiKey()
      if (result.success) {
        setHasApiKey(false)
      } else {
        logger.warn('Failed to clear API key', { error: result.error })
      }
    } catch (error) {
      logger.error('Failed to clear API key', error instanceof Error ? error : undefined)
    }
  }, [])

  // Store the currently focused element when overlay opens
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement
    }
  }, [isOpen])

  // Focus close button when overlay opens – unless a section was asked for,
  // in which case that section moves focus to its own heading (#250).
  useEffect(() => {
    if (!isOpen || focusSection) return undefined

    const timer = setTimeout(() => {
      closeButtonRef.current?.focus()
    }, FOCUS_DELAY_MS)

    return () => clearTimeout(timer)
  }, [isOpen, focusSection])

  // Escape closes Settings only while Settings is the topmost overlay: a
  // dialog opened over it (the Cmd+Q quit prompt, a confirm from a section)
  // takes Escape first, and one press must not close both (#229).
  useOverlayStackEntry(containerRef, {
    active: isOpen,
    // The token `.settings-overlay` paints with, so every dialog (10000+)
    // ranks above Settings for Escape exactly as it paints above it.
    zIndex: '--z-modal',
    onEscape: closeSettings
  })

  // Restore focus when overlay closes
  useEffect(() => {
    if (!isOpen && previousActiveElement.current) {
      previousActiveElement.current.focus()
      previousActiveElement.current = null
    }
  }, [isOpen])

  if (!isOpen) return null

  const portalRoot = document.getElementById('portal-root')
  if (!portalRoot) {
    logger.error('SettingsOverlay: #portal-root element not found')
    return null
  }

  const overlayContent = (
    <div className="settings-overlay" data-testid={TEST_IDS.SETTINGS_OVERLAY}>
      <div
        ref={containerRef}
        className="settings-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        data-testid={TEST_IDS.SETTINGS_CONTAINER}
      >
        <div className="settings-header">
          <h1 id="settings-title" className="settings-title">
            Settings
          </h1>
          <button
            ref={closeButtonRef}
            className="settings-close-btn"
            onClick={closeSettings}
            aria-label="Close settings"
            title="Close settings"
            data-testid={TEST_IDS.SETTINGS_BTN_CLOSE}
          >
            <X size={20} strokeWidth={1.5} />
          </button>
        </div>
        <div className="settings-content">
          <div className="settings-body">
            <section className="settings-section" data-testid={TEST_IDS.SETTINGS_SECTION_EDITOR}>
              <h2 className="settings-section-title">Editor</h2>
              <div className="settings-row">
                <div className="settings-field">
                  <label htmlFor="preserve-line-breaks" className="settings-label">
                    Preserve line breaks
                  </label>
                  <p className="settings-description">
                    Show single line breaks in preview (converts to &lt;br&gt; tags)
                  </p>
                </div>
                <input
                  type="checkbox"
                  id="preserve-line-breaks"
                  className="settings-checkbox"
                  checked={settings?.editor.preserveLineBreaks ?? false}
                  onChange={(e) => updatePreserveLineBreaks(e.target.checked)}
                  disabled={!settings}
                  data-testid={TEST_IDS.SETTINGS_TOGGLE_LINE_BREAKS}
                />
              </div>
            </section>

            <section className="settings-section" data-testid={TEST_IDS.SETTINGS_SECTION_GIT}>
              <h2 className="settings-section-title">Git status</h2>
              <div className="settings-row">
                <div className="settings-field">
                  <label htmlFor="git-polling-enabled" className="settings-label">
                    Enable polling fallback
                  </label>
                  <p className="settings-description">
                    Periodically check for git changes when file watchers may be unreliable
                  </p>
                </div>
                <input
                  type="checkbox"
                  id="git-polling-enabled"
                  className="settings-checkbox"
                  checked={settings?.gitStatus.pollingEnabled ?? true}
                  onChange={(e) => updateGitStatusPollingEnabled(e.target.checked)}
                  disabled={!settings}
                  data-testid={TEST_IDS.SETTINGS_TOGGLE_POLLING}
                />
              </div>
              <div className="settings-row">
                <div className="settings-field">
                  <label htmlFor="git-polling-interval" className="settings-label">
                    Polling interval
                  </label>
                  <p className="settings-description">
                    How often to check for changes (lower = more responsive, higher = less CPU)
                  </p>
                </div>
                <select
                  id="git-polling-interval"
                  className="settings-select"
                  value={settings?.gitStatus.pollingInterval ?? 5000}
                  onChange={(e) => updateGitStatusPollingInterval(Number(e.target.value))}
                  disabled={!settings || !settings.gitStatus.pollingEnabled}
                  data-testid={TEST_IDS.SETTINGS_SELECT_POLLING_INTERVAL}
                >
                  {POLLING_INTERVAL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <section className="settings-section" data-testid={TEST_IDS.SETTINGS_SECTION_LOGGING}>
              <h2 className="settings-section-title">Logging</h2>
              <div className="settings-row">
                <div className="settings-field">
                  <label htmlFor="log-level" className="settings-label">
                    Log level
                  </label>
                  <p className="settings-description">Minimum severity level for file logging</p>
                </div>
                <select
                  id="log-level"
                  className="settings-select"
                  value={settings?.logging.level ?? 'info'}
                  onChange={(e) => {
                    // Validate with Zod instead of type assertion (Issue #74 review fix)
                    const result = LoggingLevelSchema.safeParse(e.target.value)
                    if (result.success) {
                      updateLoggingLevel(result.data)
                    } else {
                      logger.warn('Invalid log level selected', { value: e.target.value })
                    }
                  }}
                  disabled={!settings}
                  data-testid={TEST_IDS.SETTINGS_SELECT_LOG_LEVEL}
                >
                  {LOG_LEVEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings-row">
                <div className="settings-field">
                  <label className="settings-label">Logs folder</label>
                  <p className="settings-description" data-testid={TEST_IDS.SETTINGS_LOGS_FOLDER_PATH}>
                    {logsDir}
                  </p>
                </div>
                <button
                  className="settings-btn-secondary"
                  data-testid={TEST_IDS.SETTINGS_BTN_OPEN_LOGS}
                  onClick={handleOpenLogsFolder}
                >
                  Open
                </button>
              </div>
            </section>

            <section className="settings-section" data-testid={TEST_IDS.SETTINGS_SECTION_TRANSCRIPTION}>
              <h2 className="settings-section-title">Transcription</h2>
              <div className="settings-row">
                <div className="settings-field">
                  <label htmlFor="transcription-backend" className="settings-label">
                    Backend
                  </label>
                  <p className="settings-description">
                    Service used for audio-to-text transcription
                  </p>
                </div>
                <select
                  id="transcription-backend"
                  className="settings-select"
                  value={settings?.transcription.backend ?? 'openai'}
                  onChange={(e) => {
                    const result = TranscriptionBackendSchema.safeParse(e.target.value)
                    if (result.success) {
                      setDownloadError(null)
                      updateTranscriptionBackend(result.data)
                    } else {
                      logger.warn('Invalid transcription backend selected', { value: e.target.value })
                    }
                  }}
                  disabled={!settings}
                  data-testid={TEST_IDS.SETTINGS_SELECT_TRANSCRIPTION_BACKEND}
                >
                  <option value="openai">OpenAI</option>
                  <option value="local" disabled={!isLocalWhisperSupported}>
                    {isLocalWhisperSupported
                      ? 'Local (whisper.cpp)'
                      : whisperPlatform === 'win32' && whisperArch === 'arm64'
                        ? 'Local (macOS / Windows x64 only – ARM64 not supported)'
                        : 'Local (macOS / Windows x64 only)'}
                  </option>
                </select>
              </div>

              {/* OpenAI backend: API key management */}
              {settings?.transcription.backend === 'openai' && (
                <div className="settings-row">
                  <div className="settings-field">
                    <label htmlFor="openai-api-key" className="settings-label">
                      OpenAI API key
                    </label>
                    <p className="settings-description">
                      {hasApiKey ? 'API key is configured' : 'Required for transcription'}
                    </p>
                  </div>
                  <div className="settings-api-key-controls">
                    {hasApiKey ? (
                      <button
                        className="settings-btn-secondary"
                        onClick={handleClearApiKey}
                        data-testid={TEST_IDS.SETTINGS_BTN_CLEAR_API_KEY}
                      >
                        Remove key
                      </button>
                    ) : (
                      <input
                        type="password"
                        id="openai-api-key"
                        className="settings-input"
                        placeholder="sk-..."
                        onBlur={handleSaveApiKey}
                        data-testid={TEST_IDS.SETTINGS_INPUT_API_KEY}
                      />
                    )}
                  </div>
                </div>
              )}
              {settings?.transcription.backend === 'openai' && apiKeyError && (
                <div className="settings-row">
                  <p
                    className="settings-inline-error"
                    data-testid={TEST_IDS.SETTINGS_API_KEY_ERROR}
                  >
                    {apiKeyError}
                  </p>
                </div>
              )}

              {/* Local backend: whisper model selection and download */}
              {settings?.transcription.backend === 'local' && (
                <>
                  <div className="settings-row">
                    <div className="settings-field">
                      <label htmlFor="whisper-model" className="settings-label">
                        Whisper model
                      </label>
                      <p className="settings-description">
                        Larger models are more accurate but slower and use more memory.
                        First-time setup downloads a small (~8 MB) verified whisper.cpp
                        binary in addition to the selected model.
                      </p>
                    </div>
                    <select
                      id="whisper-model"
                      className="settings-select"
                      value={settings.transcription.whisperModel ?? 'base'}
                      onChange={(e) => {
                        const result = WhisperModelSchema.safeParse(e.target.value)
                        if (result.success) {
                          updateWhisperModel(result.data)
                          setDownloadError(null)
                        } else {
                          logger.warn('Invalid whisper model selected', { value: e.target.value })
                        }
                      }}
                      ref={modelSelectRef}
                      disabled={modelDownloading}
                      data-testid={TEST_IDS.SETTINGS_SELECT_WHISPER_MODEL}
                    >
                      {WHISPER_MODEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="settings-row">
                    <div className="settings-field">
                      <label className="settings-label">
                        Model status
                      </label>
                      <p
                        className="settings-description"
                        data-testid={TEST_IDS.SETTINGS_WHISPER_MODEL_STATUS}
                      >
                        {modelDownloading && downloadProgress
                          ? `Downloading... (${Math.round(downloadProgress.percent)}%)`
                          : installedModels.includes(settings.transcription.whisperModel ?? 'base')
                            ? 'Ready'
                            : 'Model not downloaded'}
                      </p>
                    </div>
                    <div className="settings-api-key-controls" ref={downloadControlsRef}>
                      {installedModels.includes(settings.transcription.whisperModel ?? 'base') ? (
                        <span className="settings-status-ready">Ready</span>
                      ) : (
                        <>
                          {/* aria-disabled, not disabled: a disabled button drops
                              the focus of the user who just pressed it */}
                          <button
                            ref={downloadButtonRef}
                            className="settings-btn-secondary"
                            onClick={handleDownloadModel}
                            aria-disabled={modelDownloading || undefined}
                            data-testid={TEST_IDS.SETTINGS_BTN_WHISPER_MODEL}
                          >
                            {modelDownloading ? 'Downloading...' : 'Download model'}
                          </button>
                          {modelDownloading && (
                            <button
                              className="settings-btn-secondary"
                              onClick={handleCancelDownload}
                              data-testid={TEST_IDS.SETTINGS_BTN_WHISPER_CANCEL}
                            >
                              Cancel
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {/* Mounted before any download starts, so a screen reader hears
                      their updates (design/system/components/feedback, decision three):
                      progress and outcome as a status, a failure as an alert */}
                  <div
                    role="status"
                    className="settings-sr-only"
                    data-testid={TEST_IDS.SETTINGS_WHISPER_DOWNLOAD_LIVE}
                  >
                    {downloadAnnouncement}
                  </div>
                  <div
                    role="alert"
                    className="settings-sr-only"
                    data-testid={TEST_IDS.SETTINGS_WHISPER_DOWNLOAD_ALERT}
                  >
                    {downloadError ?? ''}
                  </div>
                  {downloadError && (
                    <div className="settings-row">
                      <p
                        className="settings-inline-error"
                        data-testid={TEST_IDS.SETTINGS_WHISPER_DOWNLOAD_ERROR}
                      >
                        {downloadError}
                      </p>
                    </div>
                  )}
                </>
              )}
            </section>

            <ImportToolsSection />

            <HtmlPreviewSection />
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(overlayContent, portalRoot)
}
