// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The one notice a panel shows about its file on disk (#478, plan § 3.6,
 * decision 51, F13, F14).
 *
 * It renders whatever {@link selectNotice} picked – deleted, the conflict bar,
 * content that cannot be shown, a stopped or queued watch, limited live
 * refresh – with the conflict bar's look, and an always-mounted
 * {@link FreshnessStatusRegion} that announces it while the panel is the
 * active tab. Focus never moves when a notice appears (F36 is the known gap:
 * it is not returned when one closes either).
 *
 * @module components/FileConflictNotification/FreshnessNotice
 */
import { AlertTriangle, Info, RefreshCw, X } from 'lucide-react'
import { FileConflictNotification } from './FileConflictNotification'
import { FreshnessStatusRegion } from './FreshnessStatusRegion'
import {
  FRESHNESS_NOTICE_TEST_IDS,
  NOTICE_BUTTON_COPY,
  type NoticeAction,
  type NoticeModel
} from './freshnessNoticeCopy'
import './FileConflictNotification.css'

/** A handler per action the panel supports; an action without one is not shown. */
export type NoticeHandlers = Partial<Record<NoticeAction, () => void>>

interface FreshnessNoticeProps {
  /** The selected notice, or `null` for none. */
  notice: NoticeModel | null
  fileName: string
  handlers: NoticeHandlers
  /** The panel is the tab the user is looking at: only then does the status region speak. */
  isActive: boolean
}

interface ButtonSpec {
  label: string
  testId: string
  primary: boolean
}

const BUTTONS: Readonly<Record<Exclude<NoticeAction, 'reload-from-disk' | 'keep-local' | 'dismiss-conflict'>, ButtonSpec>> = {
  restore: { label: NOTICE_BUTTON_COPY.restore, testId: FRESHNESS_NOTICE_TEST_IDS.restore, primary: true },
  close: { label: NOTICE_BUTTON_COPY.close, testId: FRESHNESS_NOTICE_TEST_IDS.close, primary: false },
  reload: { label: NOTICE_BUTTON_COPY.reload, testId: FRESHNESS_NOTICE_TEST_IDS.reload, primary: true },
  'dismiss-limited': { label: NOTICE_BUTTON_COPY.dismiss, testId: FRESHNESS_NOTICE_TEST_IDS.dismissLimited, primary: false }
}

function NoticeButton({ action, onClick }: { action: keyof typeof BUTTONS; onClick: () => void }): JSX.Element {
  const spec = BUTTONS[action]
  if (action === 'dismiss-limited') {
    return (
      <button
        type="button"
        className="file-conflict-btn file-conflict-btn-dismiss"
        onClick={() => onClick()}
        aria-label={spec.label}
        title={spec.label}
        data-testid={spec.testId}
      >
        <X className="file-conflict-btn-icon" strokeWidth={2} aria-hidden="true" />
      </button>
    )
  }
  return (
    <button
      type="button"
      className={`file-conflict-btn ${spec.primary ? 'file-conflict-btn-primary' : 'file-conflict-btn-secondary'}`}
      // Wrapped so the click event never reaches the handler as an argument
      onClick={() => onClick()}
      data-testid={spec.testId}
    >
      {action === 'reload' && <RefreshCw className="file-conflict-btn-icon" strokeWidth={2} aria-hidden="true" />}
      {spec.label}
    </button>
  )
}

/** Every notice but the conflict bar. */
function PlainNotice({ notice, handlers }: { notice: NoticeModel; handlers: NoticeHandlers }): JSX.Element {
  const Icon = notice.severity === 'info' ? Info : AlertTriangle
  const actions = notice.actions.filter(
    (action): action is keyof typeof BUTTONS => action in BUTTONS && handlers[action] !== undefined
  )
  return (
    <div className="file-conflict-notification" data-severity={notice.severity} data-testid={notice.testId}>
      <div className="file-conflict-content">
        <Icon className="file-conflict-icon" strokeWidth={2} aria-hidden="true" />
        <div className="file-conflict-message">
          <span className="file-conflict-title">{notice.message}</span>
        </div>
      </div>
      {actions.length > 0 && (
        <div className="file-conflict-actions">
          {actions.map((action) => (
            <NoticeButton key={action} action={action} onClick={handlers[action] as () => void} />
          ))}
        </div>
      )}
    </div>
  )
}

export function FreshnessNotice({ notice, fileName, handlers, isActive }: FreshnessNoticeProps): JSX.Element {
  const noop = (): void => undefined
  return (
    <>
      <FreshnessStatusRegion text={isActive ? (notice?.message ?? '') : ''} />
      {notice?.kind === 'conflict' ? (
        <FileConflictNotification
          fileName={fileName}
          notSaved={notice.notSaved}
          onReload={handlers['reload-from-disk'] ?? noop}
          onKeepLocal={handlers['keep-local'] ?? noop}
          onDismiss={handlers['dismiss-conflict'] ?? noop}
        />
      ) : (
        notice && <PlainNotice notice={notice} handlers={handlers} />
      )}
    </>
  )
}
