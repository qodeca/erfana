import { IDockviewPanelProps } from 'dockview'
import { Home } from 'lucide-react'

export function WelcomePanel(_props: IDockviewPanelProps) {
  return (
    <div className="panel-content" tabIndex={0}>
      <div className="welcome-panel">
        <div className="welcome-content">
          <Home size={64} strokeWidth={1.5} className="welcome-icon" />
          <h2>Welcome to Erfana</h2>
          <p>Open a markdown file from the Explorer to start editing</p>
        </div>
      </div>
    </div>
  )
}
