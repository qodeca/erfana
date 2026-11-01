// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – a thread window while an editor holds unsaved edits to its file
 * (024-FR-015, spec 024 state table F-02, F-03, differences D-24).
 *
 * Both previews pause the same way: the sentence up front, every write off,
 * and working buttons in the window. A modal HTML window covers the band, so
 * the band cannot be the only way on. The guard is asked about the file the
 * window shows, which for HTML may be a frame's own file. The Markdown host
 * passes its own wording, which knows the preview draws the unsaved text.
 *
 * @module components/Comments/useWindowPause
 */
import { useEffect, useRef } from 'react'
import { useCommentDirtyGuard } from '../../hooks/useCommentDirtyGuard'
import { unsavedConflictText } from './commentCopy'
import { MD_SURFACE_COPY } from './commentCopyWords'
import type { ThreadsUnsaved } from './ThreadsView'

/** What the window reads from {@link useWindowPause}. */
export interface WindowPause {
  /** Why writes are off, or `null` when they are on. */
  readonly text: string | null
  /** The banner's ways on, while an editor in this window holds the edits. */
  readonly unsaved: ThreadsUnsaved | undefined
}

/**
 * The window's pause.
 *
 * @param filePath - The shown file, project-space; `null` when the window shows none.
 * @param file - The file's name, its controls as tokens.
 * @param hostText - The host's own sentence (Markdown), else `null`.
 * @param titleRef - Takes focus when the pause ends with focus on a control that went away.
 * @param leave - Close the window without handing focus back, before focus moves to the editor.
 * @param goToUnsaved - The host's way to the edits; the editor tab by default.
 * @returns {@link WindowPause}
 */
export function useWindowPause(
  filePath: string | null,
  file: string,
  hostText: string | null,
  titleRef: React.RefObject<HTMLElement>,
  leave: () => void,
  goToUnsaved?: () => void
): WindowPause {
  const guard = useCommentDirtyGuard(filePath)
  const own = guard.state === 'clean' ? null : guard.state === 'conflict' ? unsavedConflictText(file) : MD_SURFACE_COPY.paused(file)
  const text = hostText ?? own
  // Save {file} is gone with the banner: focus must not fall to <body>.
  const paused = useRef(false)
  useEffect(() => {
    if (paused.current && text === null && document.activeElement === document.body) titleRef.current?.focus()
    paused.current = text !== null
  }, [text, titleRef])
  const unsaved =
    guard.state === 'clean'
      ? undefined
      : {
          conflict: guard.state === 'conflict',
          onSave: () => void guard.save(),
          onGoToTab: () => {
            // Close first, as a new comment does: a modal left open would trap focus away from the editor.
            leave()
            ;(goToUnsaved ?? guard.goToTab)()
          }
        }
  return { text, unsaved }
}
