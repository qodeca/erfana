// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useGlobalSettingsStore } from '../../../stores/useGlobalSettingsStore'
import { TEST_IDS } from '../../../constants/testids'

/**
 * EditorSection - the Editor block of {@link SettingsOverlay}: Preserve line
 * breaks (`editor.preserveLineBreaks`).
 *
 * Moved out of `SettingsOverlay.tsx` unchanged when #453 added the Project tree
 * section after it: the overlay is at its max-lines baseline. Reuses the
 * overlay's shared global CSS classes.
 *
 * @returns The Editor settings section.
 */
export function EditorSection(): JSX.Element {
  const { settings, updatePreserveLineBreaks } = useGlobalSettingsStore()

  return (
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
  )
}
