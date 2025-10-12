import { LucideIcon } from 'lucide-react'
import { ActivityBarBadge } from './ActivityBarBadge'

interface ActivityBarItemProps {
  icon: LucideIcon
  label: string
  tooltip: string
  active: boolean
  badge?: number | string | null
  onClick: () => void
  side: 'left' | 'right'
}

export function ActivityBarItem({
  icon: Icon,
  tooltip,
  active,
  badge,
  onClick,
  side
}: ActivityBarItemProps) {
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
    >
      <div className="activity-bar-item-icon">
        <Icon size={24} strokeWidth={1.5} />
      </div>
      {badge !== null && badge !== undefined && <ActivityBarBadge value={badge} />}
    </div>
  )
}
