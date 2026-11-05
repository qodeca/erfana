// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useGlobalSettingsStore } from '../../../stores/useGlobalSettingsStore'
import { isFollowActiveTabEnabled } from '../../../../../shared/ipc/global-settings-schema'

const TOGGLE_ID = 'project-tree-follow-active-tab'
const DESCRIPTION_ID = `${TOGGLE_ID}-description`
const TITLE_ID = 'settings-project-tree-title'

/**
 * ProjectTreeSection - the Project tree block of {@link SettingsOverlay} (#453),
 * placed right after Editor: **Follow the active tab**
 * (`projectTree.followActiveTab`, default on, global only).
 *
 * Wording and placement are the owner-decided ones from
 * docs/designs/project-tree/settings-row.html. The project tree reads the
 * value live, so a change applies without a restart. Reuses the overlay's
 * shared global CSS classes.
 *
 * @returns The Project tree settings section.
 */
export function ProjectTreeSection(): JSX.Element {
  const { settings, updateProjectTreeFollowActiveTab } = useGlobalSettingsStore()
  const enabled = isFollowActiveTabEnabled(settings ?? {})

  return (
    <section className="settings-section" aria-labelledby={TITLE_ID}>
      <h2 id={TITLE_ID} className="settings-section-title">Project tree</h2>
      <div className="settings-row">
        <div className="settings-field">
          <label htmlFor={TOGGLE_ID} className="settings-label">
            Follow the active tab
          </label>
          <p id={DESCRIPTION_ID} className="settings-description">
            When you switch to a file or preview tab, the project tree opens its folders, scrolls to the
            file and underlines it.
          </p>
        </div>
        <input
          type="checkbox"
          id={TOGGLE_ID}
          className="settings-checkbox"
          checked={enabled}
          onChange={(e) => updateProjectTreeFollowActiveTab(e.target.checked)}
          disabled={!settings}
          aria-describedby={DESCRIPTION_ID}
        />
      </div>
    </section>
  )
}
