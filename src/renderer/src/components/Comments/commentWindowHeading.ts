// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – what the comment window says about its request: the
 * heading (title, context line, note) and the new comment a pin's thread view
 * can switch to (docs/designs/comments/html-preview-comments.md §10.10 "Window titles",
 * "Context line"). Pure: no React, no bridge.
 *
 * @module HtmlPreviewPanel/comments/commentWindowHeading
 */
import { COPY, SCRIPT_BUILT_TEXT, frameFileText } from './commentCopy'
import { HTML_WORDS, type CommentWords } from './commentCopyWords'
import { WINDOW_COPY, headingQuote } from './commentWindowCopy'
import type { CommentWindowRequest } from './commentWindowTypes'
import type { selectThreads } from './ThreadsView'

/** The window's heading for each view. */
export interface Heading {
  readonly title: string
  readonly context: string | null
  readonly note: string | null
  /** The HTML target's selector, for tests and tooling: the reader no longer sees it. */
  readonly target?: string
}

/**
 * The new-comment request "New comment" in a pin's thread view opens: a new
 * thread on the element the pin stands for, with the draft and the target
 * main sent with the pin – the target is main's description of the element
 * as it is in the file now, so the context line names it exactly as a
 * right-click would. `null` when there is no such draft (a drawer row, or
 * main sent none) or the file takes no new comment.
 *
 * @param request - The window's request.
 * @param selection - What the list holds for it.
 * @returns The request, or `null`.
 */
export function newCommentFrom(
  request: CommentWindowRequest,
  selection: ReturnType<typeof selectThreads>
): Extract<CommentWindowRequest, { kind: 'new' }> | null {
  return takesNewComment(selection) ? newCommentOnPin(request) : null
}

/** Whether the file takes a new comment: at its limit, replies and resolves work and a new comment does not (F-04). */
function takesNewComment(selection: ReturnType<typeof selectThreads>): boolean {
  return selection !== null && selection.file.writable && selection.file.addRefusal === undefined
}

/**
 * What the window's "New comment" does, in both previews: the HTML Preview
 * switches to the draft main sent with the pin; a host that mints drafts itself
 * opens one on demand from the target (I-4, P-F05). Only a window opened on its
 * target has one, so a drawer row or a step key offers none.
 *
 * @param request - The window's request.
 * @param selection - What the list holds for it.
 * @param onNewComment - Switches the window to a new-comment request.
 * @param onNewOnTarget - Opens a new comment on the target the window opened on.
 * @returns The action, or `null` when none is offered.
 */
export function newCommentAction(
  request: CommentWindowRequest,
  selection: ReturnType<typeof selectThreads>,
  onNewComment?: (request: Extract<CommentWindowRequest, { kind: 'new' }>) => void,
  onNewOnTarget?: () => void
): (() => void) | null {
  if (!takesNewComment(selection)) return null
  if (onNewOnTarget !== undefined) return onNewOnTarget
  const next = newCommentOnPin(request)
  return next === null || onNewComment === undefined ? null : () => onNewComment(next)
}

/**
 * The new comment a pin's draft stands for, whatever the file says: the caller
 * knows it takes one.
 *
 * @param request - The window's request.
 * @returns The request, or `null` when it carries no whole draft.
 */
export function newCommentOnPin(request: CommentWindowRequest): Extract<CommentWindowRequest, { kind: 'new' }> | null {
  if (request.kind !== 'threads') return null
  const { draftToken, draftKey, file, target } = request
  if (draftToken === undefined || draftKey === undefined || file === undefined || target === undefined) {
    return null
  }
  return {
    kind: 'new',
    panelId: request.panelId,
    draftToken,
    draftKey,
    target,
    file,
    point: request.point,
    opener: request.opener
  }
}

/**
 * The title, context line and note for a request (§10.10 "Window titles",
 * "Context line").
 *
 * @param request - The window's request.
 * @param selection - What the list holds for it.
 * @param words - The preview's words; the Markdown Preview names a kind, never a tag (C-03, A-02).
 * @returns The heading; the window draws its text with `VisibleText`.
 */
export function headingOf(
  request: CommentWindowRequest,
  selection: ReturnType<typeof selectThreads>,
  words: CommentWords = HTML_WORDS
): Heading {
  if (request.kind === 'new') {
    const { target, file } = request
    if (words.preview !== 'html') {
      const title = words.newCommentTitle(target) + headingText(target.tag, request.words?.text)
      return { title, context: words.context(target, file.displayPath), note: null }
    }
    const note = target.runtime
      ? SCRIPT_BUILT_TEXT
      : file.frame
        ? frameFileText(file.displayPath)
        : null
    // The owner's plain wording, 2026-10-31: no tag or selector in the window.
    return {
      title: words.newCommentTitle(target.tag),
      context: `${file.displayPath}, line ${target.line}`,
      note,
      target: words.label(target)
    }
  }
  if (selection === null) return { title: 'Comments', context: null, note: null }
  const file = selection.file.displayPath
  const first = selection.threads[0]
  if (first === undefined) {
    const line = selection.damaged[0]?.line ?? selection.newer[0]?.line ?? 1
    return { title: COPY.damagedComment, context: `${file}, line ${line}`, note: null }
  }
  // C-05: a lost target says so on the context line; where the comment itself is follows the banner.
  const lost = selection.threads.length > 0 && selection.threads.every(thread => !thread.attached && thread.status === 'open')
  if (words.preview !== 'html') {
    const title = words.threadsTitle(first, selection.threads.length) + headingText(first.tag, first.quote)
    const context = lost ? WINDOW_COPY.notFoundContext(words.noun(first), file) : words.context(first, file)
    return { title, context, note: null }
  }
  return {
    title: words.threadsTitle(first, selection.threads.length),
    context: lost ? WINDOW_COPY.notFoundContext('Section', file) : `${file}, line ${first.line}`,
    note: selection.file.frame ? frameFileText(file) : null
  }
}

/**
 * C-03: a Markdown title names a heading by its text, cut at 40 characters –
 * 'Comments on H2 heading “Next steps”'. Other kinds add nothing.
 *
 * @param tag - The target's tag.
 * @param text - The heading's text, as stored or as rendered.
 * @returns ` “text”`, or `''`.
 */
export function headingText(tag: string, text: string | undefined): string {
  return /^h[1-6]$/i.test(tag) ? headingQuote(text) : ''
}
