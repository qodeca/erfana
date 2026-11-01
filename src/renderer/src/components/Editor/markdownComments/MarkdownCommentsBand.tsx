// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown Preview's words for the shared paused band (024-FR-015,
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
import { CommentPausedBand } from '../../Comments/CommentPausedBand'
import { MD_SURFACE_COPY } from '../../Comments/commentCopyWords'

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
    <CommentPausedBand
      text={conflict ? MD_SURFACE_COPY.pausedConflict(file) : MD_SURFACE_COPY.paused(file)}
      conflict={conflict}
      actionLabel={conflict ? MD_SURFACE_COPY.goToEditor : MD_SURFACE_COPY.saveFile(file)}
      onAction={conflict ? onGoToEditor : onSave}
    />
  )
}
