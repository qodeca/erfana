import { Home } from 'lucide-react'
import { IDockviewPanelHeaderProps } from 'dockview'

export function WelcomeTab(_props: IDockviewPanelHeaderProps) {
  const handleDragStart = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div
      className="welcome-tab"
      title="Home"
      draggable={false}
      onDragStart={handleDragStart}
      onDrag={handleDragStart}
    >
      <Home size={16} strokeWidth={2} />
    </div>
  )
}
