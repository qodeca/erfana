import { PanelLeft, PanelBottom, PanelRight } from 'lucide-react'
import './Toolbar.css'

interface ToolbarProps {
  onTogglePanel: (panelId: string) => void
  panelStates: {
    fileExplorer: boolean
    terminal: boolean
    git: boolean
  }
}

export function Toolbar({ onTogglePanel, panelStates }: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar-section toolbar-left">
        <div className="toolbar-title">Erfana</div>
      </div>

      <div className="toolbar-section toolbar-center">
        {/* Future: breadcrumbs or file path */}
      </div>

      <div className="toolbar-section toolbar-right">
        <button
          className={`toolbar-icon-button ${panelStates.fileExplorer ? 'active' : ''}`}
          onClick={() => onTogglePanel('fileExplorer')}
          title="Toggle Primary Sidebar (⌘B)"
        >
          <PanelLeft size={16} strokeWidth={2} />
        </button>

        <button
          className={`toolbar-icon-button ${panelStates.terminal ? 'active' : ''}`}
          onClick={() => onTogglePanel('terminal')}
          title="Toggle Panel (⌘J)"
        >
          <PanelBottom size={16} strokeWidth={2} />
        </button>

        <button
          className={`toolbar-icon-button ${panelStates.git ? 'active' : ''}`}
          onClick={() => onTogglePanel('git')}
          title="Toggle Secondary Sidebar"
        >
          <PanelRight size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
