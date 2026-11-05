// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The Markdown tab's "auto-refresh stopped" notice (#464).
 *
 * Shown when the tab can no longer follow its file on disk – the watch never
 * started, or the watcher failed – so a stale preview is never silent. It
 * takes the conflict bar's look (same warning colours and button) and the
 * image viewer's wording, so the two tab kinds say it the same way.
 */
import { AlertTriangle, RefreshCw } from 'lucide-react'
import './FileConflictNotification.css'

/** The notice's text, shared with its tests. */
export const WATCH_STOPPED_COPY = {
  title: 'Auto-refresh stopped',
  subtitle: 'Changes made on disk no longer show here. Choose Reload to read the file again and restart auto-refresh.',
  reload: 'Reload'
} as const

/** Test ids, kept here: the shared `testids.ts` is at its size limit. */
export const WATCH_STOPPED_TEST_IDS = {
  notice: 'file-watch-stopped-notice',
  reload: 'file-watch-stopped-btn-reload'
} as const

interface WatchStoppedNoticeProps {
  fileName: string
  /** Restart the watch and re-read the file */
  onReload: () => void
}

export function WatchStoppedNotice({ fileName, onReload }: WatchStoppedNoticeProps): JSX.Element {
  return (
    <div className="file-conflict-notification" role="alert" data-testid={WATCH_STOPPED_TEST_IDS.notice}>
      <div className="file-conflict-content">
        <AlertTriangle className="file-conflict-icon" size={18} strokeWidth={2} />
        <div className="file-conflict-message">
          <span className="file-conflict-title">
            {WATCH_STOPPED_COPY.title} for <strong>{fileName}</strong>
          </span>
          <span className="file-conflict-subtitle">{WATCH_STOPPED_COPY.subtitle}</span>
        </div>
      </div>
      <div className="file-conflict-actions">
        <button
          className="file-conflict-btn file-conflict-btn-primary"
          // Wrapped so the click event never reaches onReload as an argument
          onClick={() => onReload()}
          data-testid={WATCH_STOPPED_TEST_IDS.reload}
        >
          <RefreshCw size={14} strokeWidth={2} />
          {WATCH_STOPPED_COPY.reload}
        </button>
      </div>
    </div>
  )
}
