// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – comment mode while the page's file cannot take a
 * new comment (spec 024 menu matrix M-07 and § 2, comments-v2 C-19.1),
 * mirroring the Markdown host (`useCommentOverlayHost`).
 *
 * The list is read as soon as the page is ready, so this is known before the
 * drawer is ever opened. The page's own file in it decides: read-only for
 * comments (git conflicts, a comment with no end, 500 comments, too large,
 * not UTF-8, a link, gone) makes the mode unavailable. The toggle goes
 * `aria-disabled` with "Comment mode is unavailable: {reason}." as its
 * tooltip; a mode that was on turns off and says the same sentence; asking
 * for it says it again. Existing comments stay reachable through the drawer.
 *
 * @module HtmlPreviewPanel/comments/usePreviewModeBlock
 */
import { useCallback, useEffect } from 'react'
import type { CommentFileView } from '../../../../../../shared/ipc/comment-common-schema'
import { useLatestRef } from '../../../../hooks/useLatestRef'
import { MD_SURFACE_COPY, menuReasonText } from '../../../Comments/commentCopyWords'

/** Options for {@link usePreviewModeBlock}. */
export interface PreviewModeBlockOptions {
  /** Comments are on and the page has loaded: the list is read then, drawer open or not. */
  readonly live: boolean
  /** The page on screen: a new page is read again. */
  readonly filePath: string
  /** Read the list (`commentsChanged` keeps a read list fresh from then on). */
  readonly readList: () => Promise<void>
  /** The files of the list main last sent; the page's own is the one not in a frame. */
  readonly files: readonly CommentFileView[]
  /** Comment mode is on now. */
  readonly mode: boolean
  /** Turn comment mode off. */
  readonly turnOff: () => void
  /** Say a sentence in the polite live region. */
  readonly announce: (text: string) => void
}

/** What the panel does with the block. */
export interface PreviewModeBlock {
  /** The toggle's "Comment mode is unavailable: {reason}." while blocked, else `null`. */
  readonly text: string | null
  /** `true` (and the sentence said) when the mode may not turn on now. */
  readonly refuse: () => boolean
}

/**
 * Why comment mode is unavailable for the page's file, as the menu's reason line words it.
 *
 * @param files - The listed files.
 * @returns The reason line, or `null` while the page's file can take a new comment (or is not listed yet).
 */
export function pageBlockReason(files: readonly CommentFileView[]): string | null {
  const page = files.find(file => !file.frame)
  if (page === undefined || page.writable) return null
  return menuReasonText(page.readOnlyReason ?? 'read-only', page.displayPath)
}

/**
 * Keeps comment mode off while the page's file is read-only for comments.
 *
 * @param options - {@link PreviewModeBlockOptions}
 * @returns {@link PreviewModeBlock}
 */
export function usePreviewModeBlock(options: PreviewModeBlockOptions): PreviewModeBlock {
  const { live, filePath, readList, files, mode } = options
  const reason = pageBlockReason(files)
  const text = reason === null ? null : MD_SURFACE_COPY.modeUnavailable(reason)
  const textRef = useLatestRef(text)
  const actions = useLatestRef({ turnOff: options.turnOff, announce: options.announce })

  useEffect(() => {
    if (live) void readList()
  }, [live, filePath, readList])

  useEffect(() => {
    if (!mode || text === null) return
    actions.current.turnOff()
    actions.current.announce(text)
  }, [mode, text, actions])

  const refuse = useCallback((): boolean => {
    if (textRef.current === null) return false
    actions.current.announce(textRef.current)
    return true
  }, [textRef, actions])

  return { text, refuse }
}
