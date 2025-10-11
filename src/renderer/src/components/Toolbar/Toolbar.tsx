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
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" clipRule="evenodd" d="M1.5 1h11l.5.5v13l-.5.5h-11l-.5-.5v-13l.5-.5zM2 14h4V2H2v12zm5 0h6V2H7v12z"/>
          </svg>
        </button>

        <button
          className={`toolbar-icon-button ${panelStates.terminal ? 'active' : ''}`}
          onClick={() => onTogglePanel('terminal')}
          title="Toggle Panel (⌘J)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" clipRule="evenodd" d="M1.5 1h13l.5.5v10l-.5.5h-13l-.5-.5v-10l.5-.5zm.5 10h12V2H2v9zm0 2v1h12v-1H2z"/>
          </svg>
        </button>

        <button
          className={`toolbar-icon-button ${panelStates.git ? 'active' : ''}`}
          onClick={() => onTogglePanel('git')}
          title="Toggle Secondary Sidebar"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" clipRule="evenodd" d="M14.5 1h-11l-.5.5v13l.5.5h11l.5-.5v-13l-.5-.5zM14 14H10V2h4v12zM9 14H3V2h6v12z"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
