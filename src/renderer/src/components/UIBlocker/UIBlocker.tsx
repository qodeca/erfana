import { useProjectStore } from '../../stores/useProjectStore'
import './UIBlocker.css'

/**
 * UIBlocker Component
 *
 * Global overlay that blocks ALL user interactions when a critical operation
 * is in progress (e.g., native folder selection dialog is open).
 *
 * Prevents:
 * - Mouse clicks (left, right, middle)
 * - Context menus
 * - Keyboard input
 * - Scrolling
 * - Any other user interactions
 *
 * Visible when: isProjectChanging === true
 */
export function UIBlocker() {
  const isProjectChanging = useProjectStore((state) => state.isProjectChanging)

  if (!isProjectChanging) {
    return null
  }

  return (
    <div
      className="ui-blocker"
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => e.preventDefault()}
      onDoubleClick={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onMouseUp={(e) => e.preventDefault()}
      onKeyDown={(e) => e.preventDefault()}
      onKeyUp={(e) => e.preventDefault()}
      onWheel={(e) => e.preventDefault()}
      title="Waiting for folder selection..."
    >
      <div className="ui-blocker-content">
        <div className="ui-blocker-spinner"></div>
        <div className="ui-blocker-message">Waiting for folder selection...</div>
      </div>
    </div>
  )
}
