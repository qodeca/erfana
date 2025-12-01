import { getPanelsBySide } from './activityBarConfig'
import { ActivityBarItem } from './ActivityBarItem'
import './ActivityBar.css'

interface ActivityBarProps {
  side: 'left' | 'right'
  activePanel: string | null
  onPanelClick: (panelId: string) => void
  projectPath: string | null
}

export function ActivityBar({ side, activePanel, onPanelClick, projectPath }: ActivityBarProps) {
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
