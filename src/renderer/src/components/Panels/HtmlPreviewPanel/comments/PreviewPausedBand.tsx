// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – the paused band above the page (024-FR-015, spec
 * 024 state table F-02, F-03, differences D-24, open decision 9): the same
 * band as the Markdown Preview, so one mental model covers both. The page
 * shows the file on disk, not the unsaved text, so the conflict sentence is
 * the one worded for a tab, and it offers Go to tab.
 *
 * A flow sibling above the page area, as the toolbar is: the native page view
 * paints over anything laid on top of it, and its box follows this one's height.
 *
 * @module HtmlPreviewPanel/comments/PreviewPausedBand
 */
import { useCommentDirtyGuard } from '../../../../hooks/useCommentDirtyGuard'
import { getBasename } from '../../../../utils/fileUtils'
import { COPY, unsavedConflictText } from '../../../Comments/commentCopy'
import { MD_SURFACE_COPY } from '../../../Comments/commentCopyWords'
import { visibleString } from '../../../Comments/commentFormat'
import { CommentPausedBand } from '../../../Comments/CommentPausedBand'

/**
 * The band, while an editor in this window holds unsaved edits to the page.
 *
 * @param props - `filePath`: the page's file, project-space.
 * @returns The band, or nothing.
 */
export function PreviewPausedBand({ filePath }: { readonly filePath: string }): React.JSX.Element | null {
  const guard = useCommentDirtyGuard(filePath)
  if (guard.state === 'clean') return null
  const file = visibleString(getBasename(filePath))
  const conflict = guard.state === 'conflict'
  return (
    <CommentPausedBand
      text={conflict ? unsavedConflictText(file) : MD_SURFACE_COPY.paused(file)}
      conflict={conflict}
      actionLabel={conflict ? COPY.goToTab : MD_SURFACE_COPY.saveFile(file)}
      onAction={conflict ? guard.goToTab : () => void guard.save()}
    />
  )
}
