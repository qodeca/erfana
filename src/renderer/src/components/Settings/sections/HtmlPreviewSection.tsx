// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useGlobalSettingsStore } from '../../../stores/useGlobalSettingsStore'
import { TEST_IDS } from '../../../constants/testids'

/**
 * HtmlPreviewSection - global on/off switch for HTML execution (Issue #74, AC21).
 *
 * Renders inside {@link SettingsOverlay} as one more `settings-section`, reusing
 * the overlay's shared global CSS classes (no dedicated stylesheet). The toggle
 * is bound to `htmlPreview.enabled` in global settings and reads/writes it through
 * {@link useGlobalSettingsStore}.
 *
 * Turning it off makes `.html` files open as source only: the main process reacts
 * to the settings change and destroys every live preview view, and no new preview
 * process is created while it stays off.
 *
 * @returns The HTML preview settings section.
 *
 * @example
 * ```tsx
 * <HtmlPreviewSection />
 * ```
 */
export function HtmlPreviewSection(): JSX.Element {
  const { settings, updateHtmlPreviewEnabled } = useGlobalSettingsStore()

  // Optional chaining on `htmlPreview` as well as `settings`: the field defaults
  // to `true` in the schema, but a settings object that predates the field (or a
  // partial test fixture) must not throw here — it falls back to enabled.
  const enabled = settings?.htmlPreview?.enabled ?? true

  return (
    <section className="settings-section" data-testid={TEST_IDS.SETTINGS_SECTION_HTML_PREVIEW}>
      <h2 className="settings-section-title">HTML preview</h2>
      <div className="settings-row">
        <div className="settings-field">
          <label htmlFor="html-preview-enabled" className="settings-label">
            Run HTML files
          </label>
          <p id="html-preview-enabled-description" className="settings-description">
            Open <code>.html</code> files as a live, running page. When off, they open as
            source only and no preview process is created.
          </p>
        </div>
        <input
          type="checkbox"
          id="html-preview-enabled"
          className="settings-checkbox"
          checked={enabled}
          onChange={(e) => updateHtmlPreviewEnabled(e.target.checked)}
          disabled={!settings}
          aria-describedby="html-preview-enabled-description"
          data-testid={TEST_IDS.SETTINGS_TOGGLE_HTML_PREVIEW}
        />
      </div>
    </section>
  )
}
