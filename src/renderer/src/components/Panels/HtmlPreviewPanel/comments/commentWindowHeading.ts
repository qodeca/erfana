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
import { COPY, frameFileText, scriptBuiltText, threadsTitle } from './commentCopy'
import { ancestorTag, elementLabel } from './commentFormat'
import type { CommentWindowRequest } from './commentWindowTypes'
import type { selectThreads } from './ThreadsView'

/** The window's heading for each view. */
export interface Heading {
  readonly title: string
  readonly context: string | null
  readonly note: string | null
}

/**
 * The new-comment request "New comment" in a pin's thread view opens: a new
 * thread on the element the pin stands for, with the draft and the target
 * main sent with the pin – the target is main's description of the element
 * as it is in the file now, so the context line names it exactly as a
 * right-click would. `null` when there is no such draft (a drawer row, or
 * main sent none) or the file is read-only.
 *
 * @param request - The window's request.
 * @param selection - What the list holds for it.
 * @returns The request, or `null`.
 */
export function newCommentFrom(
  request: CommentWindowRequest,
  selection: ReturnType<typeof selectThreads>
): Extract<CommentWindowRequest, { kind: 'new' }> | null {
  if (request.kind !== 'threads') return null
  const { draftToken, draftKey, file, target } = request
  if (draftToken === undefined || draftKey === undefined || file === undefined || target === undefined) {
    return null
  }
  if (selection === null || !selection.file.writable) return null
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
 * @returns The heading; the window draws its text with `VisibleText`.
 */
export function headingOf(
  request: CommentWindowRequest,
  selection: ReturnType<typeof selectThreads>
): Heading {
  if (request.kind === 'new') {
    const { target, file } = request
    const label = target.runtime ? target.runtime.tag : elementLabel(target)
    const note = target.runtime
      ? scriptBuiltText(ancestorTag(target))
      : file.frame
        ? frameFileText(file.displayPath)
        : null
    return {
      title: COPY.newComment,
      context: `${label} · ${file.displayPath}, line ${target.line}`,
      note
    }
  }
  if (selection === null) return { title: 'Comments', context: null, note: null }
  const file = selection.file.displayPath
  const first = selection.threads[0]
  if (first === undefined) {
    const line = selection.damaged[0]?.line ?? selection.newer[0]?.line ?? 1
    return { title: COPY.damagedComment, context: `${file}, line ${line}`, note: null }
  }
  const label = first.runtime ? first.runtime.tag : elementLabel(first)
  return {
    title: threadsTitle(label, selection.threads.length),
    context: `${label} · ${file}, line ${first.line}`,
    note: selection.file.frame ? frameFileText(file) : null
  }
}
