// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The paused band at the top of the Markdown Preview (spec 024 024-FR-015,
 * 024-AC-016; state table F-02, F-03; comments-v2 C-09; differences D-24).
 *
 * While an editor holds unsaved edits to the file, the preview draws that
 * unsaved text, so a comment would land on the wrong block: comments pause.
 * The band says so and offers the way on – **Save {file}**, or, when the
 * file also changed on disk, **Go to editor** (saving then would overwrite
 * the outside edit). It sits above the preview, never over its content.
 *
 * @module Editor/markdownComments/MarkdownCommentsBand
 */
import { CommentBanner, DialogButton } from '../../Comments/CommentParts'
import { MD_SURFACE_COPY } from '../../Comments/commentCopyWords'
import { TEST_IDS } from '../../../constants/testids'
import '../../Comments/CommentWindow.css'
import './MarkdownCommentsBand.css'

/** Props for {@link MarkdownCommentsBand}. */
export interface MarkdownCommentsBandProps {
  /** The file's name as the reader knows it. */
  readonly file: string
  /** The file also changed on disk (F-03). */
  readonly conflict: boolean
  readonly onSave: () => void
  readonly onGoToEditor: () => void
}

/**
 * The band.
 *
 * @param props - {@link MarkdownCommentsBandProps}
 * @returns An info band (F-02) or a warning band (F-03).
 */
export function MarkdownCommentsBand({ file, conflict, onSave, onGoToEditor }: MarkdownCommentsBandProps): React.JSX.Element {
  return (
    <div className="erf-md-comments-band" data-testid={TEST_IDS.COMMENT_HOST_PAUSED} data-state={conflict ? 'conflict' : 'paused'}>
      <CommentBanner
        kind={conflict ? 'warning' : 'info'}
        actions={
          conflict ? (
            <DialogButton variant="secondary" onClick={onGoToEditor} testId={TEST_IDS.COMMENT_HOST_PAUSED_GO_TO_EDITOR}>
              {MD_SURFACE_COPY.goToEditor}
            </DialogButton>
          ) : (
            <DialogButton variant="secondary" onClick={onSave} testId={TEST_IDS.COMMENT_HOST_PAUSED_SAVE}>
              {MD_SURFACE_COPY.saveFile(file)}
            </DialogButton>
          )
        }
      >
        {conflict ? MD_SURFACE_COPY.pausedConflict(file) : MD_SURFACE_COPY.paused(file)}
      </CommentBanner>
    </div>
  )
}
