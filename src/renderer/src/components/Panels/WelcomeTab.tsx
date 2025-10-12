import { Home } from 'lucide-react'
import { IDockviewPanelHeaderProps } from 'dockview'

export function WelcomeTab(_props: IDockviewPanelHeaderProps) {
  return (
    <div className="welcome-tab" title="Home">
      <Home size={16} strokeWidth={2} />
    </div>
  )
}
