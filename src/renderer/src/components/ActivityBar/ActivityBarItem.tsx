import { LucideIcon } from 'lucide-react'
import { ActivityBarBadge } from './ActivityBarBadge'
import { TEST_IDS } from '../../constants/testids'

/**
 * Maps panel IDs to their corresponding test ID constants.
 * Used to generate data-testid attributes for UI testing.
 */
const PANEL_TEST_ID_MAP: Record<string, string> = {
  project: TEST_IDS.ACTIVITY_BAR_BTN_FILES,
  terminal: TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL
}

interface ActivityBarItemProps {
  /** Unique panel identifier from activityBarConfig */
  panelId: string
  icon: LucideIcon
  label: string
  tooltip: string
  active: boolean
  badge?: number | string | null
  onClick: () => void
  side: 'left' | 'right'
}

export function ActivityBarItem({
  panelId,
  icon: Icon,
  tooltip,
  active,
  badge,
  onClick,
  side
}: ActivityBarItemProps) {
  // Look up the test ID for this panel, fallback to undefined if not mapped
  const testId = PANEL_TEST_ID_MAP[panelId]

  return (
    <div
      className={`activity-bar-item ${active ? 'active' : ''} activity-bar-item-${side}`}
      onClick={onClick}
      title={tooltip}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      data-testid={testId}
    >
      <div className="activity-bar-item-icon">
        <Icon size={24} strokeWidth={1.5} />
      </div>
      {badge !== null && badge !== undefined && <ActivityBarBadge value={badge} />}
    </div>
  )
}
