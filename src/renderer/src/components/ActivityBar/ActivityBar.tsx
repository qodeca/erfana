// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { Settings } from 'lucide-react'
import { getPanelsBySide } from './activityBarConfig'
import { ActivityBarItem } from './ActivityBarItem'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { TEST_IDS } from '../../constants/testids'
import './ActivityBar.css'

interface ActivityBarProps {
  side: 'left' | 'right'
  activePanel: string | null
  onPanelClick: (panelId: string) => void
  projectPath: string | null
}

export function ActivityBar({ side, activePanel, onPanelClick, projectPath }: ActivityBarProps) {
  const { openSettings } = useSettingsStore()

  // Filter panels: hide those requiring a project when no project is loaded
  const panels = getPanelsBySide(side).filter((panel) => {
    if (panel.requiresProject && !projectPath) return false
    return true
  })

  // Hide entire activity bar if no panels to show
  if (panels.length === 0) {
    return null
  }

  return (
    <div className={`activity-bar activity-bar-${side}`} role="toolbar" aria-label="Activity bar" aria-orientation="vertical" data-testid={TEST_IDS.ACTIVITY_BAR}>
      <div className="activity-bar-items">
        {panels.map((panel) => (
          <ActivityBarItem
            key={panel.id}
            panelId={panel.id}
            icon={panel.icon}
            label={panel.label}
            tooltip={panel.tooltip}
            active={activePanel === panel.id}
            badge={panel.badge?.()}
            onClick={() => onPanelClick(panel.id)}
            side={side}
            testId={panel.testId}
          />
        ))}
      </div>
      {side === 'left' && (
        <div
          className="activity-bar-settings-btn"
          onClick={openSettings}
          title="Settings"
          role="button"
          aria-label="Settings"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openSettings()
            }
          }}
          data-testid={TEST_IDS.ACTIVITY_BAR_BTN_SETTINGS}
        >
          <Settings size={24} strokeWidth={1.5} />
        </div>
      )}
    </div>
  )
}
