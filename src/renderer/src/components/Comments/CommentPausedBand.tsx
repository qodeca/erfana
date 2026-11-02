// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The paused band above a preview, in both previews (024-FR-015, state table
 * F-02, F-03, differences D-24): one sentence and one way on. It sits above
 * the preview in the page flow, never over its content.
 *
 * @module components/Comments/CommentPausedBand
 */
import { CommentBanner, DialogButton } from './CommentParts'
import { TEST_IDS } from '../../constants/testids'
import './CommentWindow.css'
import './CommentPausedBand.css'

/** Props for {@link CommentPausedBand}. */
export interface CommentPausedBandProps {
  readonly text: string
  /** The file also changed on disk (F-03). */
  readonly conflict: boolean
  /** The button's words: Save {file}, or the way to the editor. */
  readonly actionLabel: string
  readonly onAction: () => void
}

/**
 * The band.
 *
 * @param props - {@link CommentPausedBandProps}
 * @returns An info band (F-02) or a warning band (F-03).
 */
export function CommentPausedBand({ text, conflict, actionLabel, onAction }: CommentPausedBandProps): React.JSX.Element {
  return (
    <div className="erf-comment-paused-band" data-testid={TEST_IDS.COMMENT_HOST_PAUSED} data-state={conflict ? 'conflict' : 'paused'}>
      <CommentBanner
        kind={conflict ? 'warning' : 'info'}
        actions={
          <DialogButton
            variant="secondary"
            onClick={onAction}
            testId={conflict ? TEST_IDS.COMMENT_HOST_PAUSED_GO_TO_EDITOR : TEST_IDS.COMMENT_HOST_PAUSED_SAVE}
          >
            {actionLabel}
          </DialogButton>
        }
      >
        {text}
      </CommentBanner>
    </div>
  )
}
