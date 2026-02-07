import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'
import { LoggingLevelSchema, type LoggingLevel } from '../../../../shared/ipc/global-settings-schema'
import { TranscriptionBackendSchema } from '../../../../shared/ipc/transcription-schema'
import { logger } from '../../utils/logger'
import { TEST_IDS } from '../../constants/testids'
import './SettingsOverlay.css'

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

/**
 * SettingsOverlay - Full-screen settings dialog
 *
 * Features:
 * - Portal rendering to #portal-root
 * - Full-screen overlay with backdrop
 * - Keyboard handling (Escape key)
 * - Focus management for accessibility
 * - Logging settings section
 */
export function SettingsOverlay() {
  const { isOpen, closeSettings } = useSettingsStore()
  const {
    settings,
    updateLoggingLevel,
    updatePreserveLineBreaks,
    updateGitStatusPollingEnabled,
    updateGitStatusPollingInterval,
    updateTranscriptionBackend
  } = useGlobalSettingsStore()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)

  // API key state for transcription section
  const [hasApiKey, setHasApiKey] = useState(false)

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
   * Save API key on input blur.
   * Stores the key via the preload bridge and updates the local state.
   */
  const handleSaveApiKey = useCallback(
    async (e: React.FocusEvent<HTMLInputElement>) => {
      const value = e.target.value.trim()
      if (!value) return

      try {
        const result = await window.api.transcription.setApiKey(value)
        if (result.success) {
          setHasApiKey(true)
          // Clear the input after successful save
          e.target.value = ''
        } else {
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

  // Focus close button when overlay opens
  useEffect(() => {
    if (!isOpen) return undefined

    const timer = setTimeout(() => {
      closeButtonRef.current?.focus()
    }, FOCUS_DELAY_MS)

    return () => clearTimeout(timer)
  }, [isOpen])

  // Keyboard event handler (Escape key)
  useEffect(() => {
    if (!isOpen) return undefined

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeSettings()
      }
    }

    // Add listener with capture to ensure it runs before other handlers
    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [isOpen, closeSettings])

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
                      updateTranscriptionBackend(result.data)
                    } else {
                      logger.warn('Invalid transcription backend selected', { value: e.target.value })
                    }
                  }}
                  disabled={!settings}
                  data-testid={TEST_IDS.SETTINGS_SELECT_TRANSCRIPTION_BACKEND}
                >
                  <option value="openai">OpenAI</option>
                </select>
              </div>
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
            </section>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(overlayContent, portalRoot)
}
