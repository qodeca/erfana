// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useGlobalSettingsStore } from '../../../stores/useGlobalSettingsStore'
import { useScreenReaderSupport } from '../../../hooks/useTerminalScreenReaderMode'
import { isMacOS, isWindows } from '../../../utils/platform'
import { logger } from '../../../utils/logger'
import { TEST_IDS } from '../../../constants/testids'
import {
  TerminalScreenReaderModeSchema,
  type TerminalScreenReaderMode
} from '../../../../../shared/ipc/global-settings-schema'

/** Options in display order; Auto first because it is the default */
const SCREEN_READER_MODE_OPTIONS: ReadonlyArray<{ value: TerminalScreenReaderMode; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
]

/**
 * The sentence under the control: what the current choice does right now.
 *
 * @param mode - The selected mode
 * @param detected - Whether the OS reports a screen reader (`null` while asking)
 * @param platformReports - Whether this platform reports screen readers at all
 * @returns One plain sentence for the status line
 */
export function screenReaderStatusText(
  mode: TerminalScreenReaderMode,
  detected: boolean | null,
  platformReports: boolean
): string {
  if (mode === 'on') return 'On for every terminal.'
  if (mode === 'off') return 'Off for every terminal.'
  if (!platformReports) {
    return 'This system does not tell Erfana when a screen reader runs, so Auto stays off. Choose On to use one.'
  }
  if (detected === null) return 'Checking for a screen reader…'
  return detected ? 'A screen reader is running, so it is on.' : 'No screen reader is running, so it is off.'
}

/**
 * TerminalSection – the terminal's screen-reader mode override (lens review [23]).
 *
 * Renders inside {@link SettingsOverlay} as one more `settings-section`,
 * reusing the overlay's shared classes (the decided Form card: one visible
 * `<label for>`, the description and status tied in with `aria-describedby`).
 * Bound to `terminal.screenReaderMode` in global settings; every open
 * terminal follows a change at once.
 *
 * @returns The terminal settings section
 *
 * @example
 * ```tsx
 * <TerminalSection />
 * ```
 */
export function TerminalSection(): JSX.Element {
  const { settings, updateTerminalScreenReaderMode } = useGlobalSettingsStore()
  const detected = useScreenReaderSupport()
  // Electron reports assistive technology on macOS and Windows only
  const platformReports = isMacOS() || isWindows()
  const mode = settings?.terminal?.screenReaderMode ?? 'auto'

  return (
    <section className="settings-section" data-testid={TEST_IDS.SETTINGS_SECTION_TERMINAL}>
      <h2 className="settings-section-title">Terminal</h2>
      <div className="settings-row">
        <div className="settings-field">
          <label htmlFor="terminal-screen-reader-mode" className="settings-label">
            Screen reader mode
          </label>
          <p id="terminal-screen-reader-mode-description" className="settings-description">
            Lets VoiceOver, NVDA and other screen readers read terminal output. Auto turns it on
            while the system reports a screen reader.
          </p>
          <p
            id="terminal-screen-reader-mode-status"
            className="settings-description"
            data-testid={TEST_IDS.SETTINGS_SCREEN_READER_STATUS}
          >
            {screenReaderStatusText(mode, detected, platformReports)}
          </p>
        </div>
        <select
          id="terminal-screen-reader-mode"
          className="settings-select"
          value={mode}
          onChange={(e) => {
            const result = TerminalScreenReaderModeSchema.safeParse(e.target.value)
            if (result.success) {
              void updateTerminalScreenReaderMode(result.data)
            } else {
              logger.warn('Invalid screen reader mode selected', { value: e.target.value })
            }
          }}
          disabled={!settings}
          aria-describedby="terminal-screen-reader-mode-description terminal-screen-reader-mode-status"
          data-testid={TEST_IDS.SETTINGS_SELECT_SCREEN_READER_MODE}
        >
          {SCREEN_READER_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </section>
  )
}
