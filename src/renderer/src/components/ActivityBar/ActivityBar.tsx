import { getPanelsBySide } from './activityBarConfig'
import { ActivityBarItem } from './ActivityBarItem'
import './ActivityBar.css'

interface ActivityBarProps {
  side: 'left' | 'right'
  activePanel: string | null
  onPanelClick: (panelId: string) => void
}

export function ActivityBar({ side, activePanel, onPanelClick }: ActivityBarProps) {
  const panels = getPanelsBySide(side)

  return (
    <div className={`activity-bar activity-bar-${side}`}>
      <div className="activity-bar-items">
        {panels.map((panel) => (
          <ActivityBarItem
            key={panel.id}
            icon={panel.icon}
            label={panel.label}
            tooltip={panel.tooltip}
            active={activePanel === panel.id}
            badge={panel.badge?.()}
            onClick={() => onPanelClick(panel.id)}
            side={side}
          />
        ))}
      </div>
    </div>
  )
}
