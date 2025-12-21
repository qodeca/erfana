import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'
import type { LoggingLevel } from '../../../../shared/ipc/global-settings-schema'
import { logger } from '../../utils/logger'
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
  const { settings, updateLoggingLevel, updatePreserveLineBreaks } = useGlobalSettingsStore()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)

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
    <div className="settings-overlay" data-testid="settings-overlay">
      <div className="settings-container" role="dialog" aria-modal="true" aria-labelledby="settings-title">
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
          >
            <X size={20} strokeWidth={1.5} />
          </button>
        </div>
        <div className="settings-content">
          <div className="settings-body">
            <section className="settings-section">
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
                />
              </div>
            </section>

            <section className="settings-section">
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
                  onChange={(e) => updateLoggingLevel(e.target.value as LoggingLevel)}
                  disabled={!settings}
                >
                  {LOG_LEVEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(overlayContent, portalRoot)
}
