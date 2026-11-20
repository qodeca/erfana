// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The "changed on disk" conflict bar: the `conflict` entry of the panel's one
 * freshness notice (#478, plan § 3.6). It carries no live-region role of its
 * own – the panel's always-mounted status region announces it (F13) – and it
 * never takes focus.
 */
import { AlertTriangle, RefreshCw, X } from 'lucide-react'
import { TEST_IDS } from '../../constants/testids'
import './FileConflictNotification.css'

interface FileConflictNotificationProps {
  fileName: string
  /** An autosave was given up because of this change: say "Not saved" (F16). */
  notSaved?: boolean
  onReload: () => void
  onKeepLocal: () => void
  /** Works like Keep my version (owner decision N6). */
  onDismiss: () => void
}

export function FileConflictNotification({
  fileName,
  notSaved = false,
  onReload,
  onKeepLocal,
  onDismiss
}: FileConflictNotificationProps) {
  return (
    <div className="file-conflict-notification" data-severity="warning" data-testid={TEST_IDS.FILE_CONFLICT_NOTIFICATION}>
      <div className="file-conflict-content">
        <AlertTriangle className="file-conflict-icon" strokeWidth={2} aria-hidden="true" />
        <div className="file-conflict-message">
          <span className="file-conflict-title">
            {notSaved ? (
              <>
                Not saved – <strong>{fileName}</strong> changed on disk since it was last read.
              </>
            ) : (
              <>
                <strong>{fileName}</strong> changed on disk.
              </>
            )}
          </span>
          <span className="file-conflict-subtitle">
            Your version may be outdated. Choose an action:
          </span>
        </div>
      </div>
      <div className="file-conflict-actions">
        <button
          className="file-conflict-btn file-conflict-btn-primary"
          // Wrapped, not passed straight through: React hands `onClick` the
          // synthetic mouse event, and `onReload` is backed by
          // `useFileWatcher.reloadFromDisk(prefetchedContent?)`. Passing the
          // reference directly fed that event in as the file's new content,
          // and the panel crashed on the next `calculateStats(content)`.
          // TypeScript cannot catch it — a zero-arg signature is assignable to
          // a one-arg handler.
          onClick={() => onReload()}
          title="Reload file from disk and discard local changes"
          data-testid={TEST_IDS.FILE_CONFLICT_BTN_RELOAD}
        >
          <RefreshCw className="file-conflict-btn-icon" strokeWidth={2} aria-hidden="true" />
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
          title="Dismiss – keeps your version, like Keep My Version"
          aria-label="Dismiss – keeps your version"
          data-testid={TEST_IDS.FILE_CONFLICT_BTN_DISMISS}
        >
          <X className="file-conflict-btn-icon" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
