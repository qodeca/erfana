// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { LucideIcon } from 'lucide-react'
import { ActivityBarBadge } from './ActivityBarBadge'

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
  testId?: string
}

export function ActivityBarItem({
  panelId: _panelId,
  icon: Icon,
  tooltip,
  active,
  badge,
  onClick,
  side,
  testId
}: ActivityBarItemProps) {
  return (
    <div
      className={`activity-bar-item ${active ? 'active' : ''} activity-bar-item-${side}`}
      onClick={onClick}
      title={tooltip}
      role="button"
      aria-label={tooltip}
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
