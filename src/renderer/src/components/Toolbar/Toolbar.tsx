import './Toolbar.css'

export function Toolbar() {
  return (
    <div className="toolbar">
      <div className="toolbar-section toolbar-left">
        <div className="toolbar-title">Erfana</div>
      </div>

      <div className="toolbar-section toolbar-center">
        {/* Future: breadcrumbs or file path */}
      </div>

      <div className="toolbar-section toolbar-right">
        {/* Future: additional controls */}
      </div>
    </div>
  )
}
