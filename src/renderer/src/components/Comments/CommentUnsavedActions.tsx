// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – the two ways on from unsaved edits, in a new comment and in a
 * thread (decision 13, C-26; 024-FR-015): Go to tab always, and Save {file}
 * unless the file also changed on disk, where saving would overwrite that
 * outside edit.
 *
 * @module components/Comments/CommentUnsavedActions
 */
import { COPY } from './commentCopy'
import { DialogButton } from './CommentParts'
import { TEST_IDS } from '../../constants/testids'

/** Props for {@link CommentUnsavedActions}. */
export interface CommentUnsavedActionsProps {
  /** The file's name, as the Save button says it. */
  readonly file: string
  readonly conflict: boolean
  readonly onGoToTab: () => void
  readonly onSave: () => void
}

/**
 * The banner's buttons.
 *
 * @param props - {@link CommentUnsavedActionsProps}
 * @returns Go to tab, then Save {file} when it is safe.
 */
export function CommentUnsavedActions({ file, conflict, onGoToTab, onSave }: CommentUnsavedActionsProps): React.JSX.Element {
  return (
    <>
      <DialogButton variant="secondary" testId={TEST_IDS.COMMENT_UNSAVED_GO_TO_TAB} onClick={onGoToTab}>
        {COPY.goToTab}
      </DialogButton>
      {!conflict && (
        <DialogButton variant="secondary" onClick={onSave} testId={TEST_IDS.COMMENT_UNSAVED_SAVE}>
          {`Save ${file}`}
        </DialogButton>
      )}
    </>
  )
}
