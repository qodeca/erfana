import { AlertTriangle, RefreshCw, X } from 'lucide-react'
import './FileConflictNotification.css'

interface FileConflictNotificationProps {
  fileName: string
  onReload: () => void
  onKeepLocal: () => void
  onDismiss: () => void
}

export function FileConflictNotification({
  fileName,
  onReload,
  onKeepLocal,
  onDismiss
}: FileConflictNotificationProps) {
  return (
    <div className="file-conflict-notification">
      <div className="file-conflict-content">
        <AlertTriangle className="file-conflict-icon" size={18} strokeWidth={2} />
        <div className="file-conflict-message">
          <span className="file-conflict-title">
            <strong>{fileName}</strong> changed on disk
          </span>
          <span className="file-conflict-subtitle">
            Your version may be outdated. Choose an action:
          </span>
        </div>
      </div>
      <div className="file-conflict-actions">
        <button
          className="file-conflict-btn file-conflict-btn-primary"
          onClick={onReload}
          title="Reload file from disk and discard local changes"
        >
          <RefreshCw size={14} strokeWidth={2} />
          Reload from Disk
        </button>
        <button
          className="file-conflict-btn file-conflict-btn-secondary"
          onClick={onKeepLocal}
          title="Keep your local version"
        >
          Keep My Version
        </button>
        <button
          className="file-conflict-btn file-conflict-btn-dismiss"
          onClick={onDismiss}
          title="Dismiss this notification"
          aria-label="Dismiss"
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
