// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { AlertTriangle, RefreshCw, X } from 'lucide-react'
import { TEST_IDS } from '../../constants/testids'
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
    <div className="file-conflict-notification" role="alert" data-testid={TEST_IDS.FILE_CONFLICT_NOTIFICATION}>
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
          data-testid={TEST_IDS.FILE_CONFLICT_BTN_RELOAD}
        >
          <RefreshCw size={14} strokeWidth={2} />
          Reload from Disk
        </button>
        <button
          className="file-conflict-btn file-conflict-btn-secondary"
          onClick={onKeepLocal}
          title="Keep your local version"
          data-testid={TEST_IDS.FILE_CONFLICT_BTN_KEEP}
        >
          Keep My Version
        </button>
        <button
          className="file-conflict-btn file-conflict-btn-dismiss"
          onClick={onDismiss}
          title="Dismiss this notification"
          aria-label="Dismiss"
          data-testid={TEST_IDS.FILE_CONFLICT_BTN_DISMISS}
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
