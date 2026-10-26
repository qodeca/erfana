// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – what opens the comment window
 * (docs/designs/html-preview-comments.md §7.3, §7.4, §7.7).
 *
 * @module HtmlPreviewPanel/comments/commentWindowTypes
 */
import {
  COMMENT_DRAFT_TOKEN_PATTERN,
  type CommentDraftOpened
} from '../../../../../../shared/ipc/preview-comment-schema'

/** A draft event of kind `menu` or `open`. */
export type ElementDraft = Extract<CommentDraftOpened, { kind: 'menu' | 'open' }>
/** A draft event of kind `icon` (a pin). */
export type PinDraft = Extract<CommentDraftOpened, { kind: 'icon' }>
/** The element a new comment goes on. */
export type DraftTarget = NonNullable<ElementDraft['target']>

/** The file a window is about, as main described it. */
export interface WindowFile {
  readonly fileKey: string
  readonly displayPath: string
  readonly filePath: string
  readonly frame: boolean
}

/** Where focus goes when the window closes (§10.4 "Focus"). */
export type WindowOpener = 'page' | 'drawer'

/** What the comment window is showing. */
export type CommentWindowRequest =
  | {
      readonly kind: 'new'
      readonly panelId: string
      readonly draftToken: string
      readonly target: DraftTarget
      readonly file: WindowFile
      readonly point: { readonly x: number; readonly y: number }
      readonly opener: WindowOpener
    }
  | {
      readonly kind: 'threads'
      readonly panelId: string
      readonly fileKey: string
      readonly threadKeys: readonly string[]
      readonly blockKeys: readonly string[]
      readonly point: { readonly x: number; readonly y: number }
      readonly opener: WindowOpener
      /**
       * A pin's draft on its element, when main sent one: the thread view's
       * "New comment" adds a thread there. Absent from a drawer row.
       */
      readonly draftToken?: string
      /** The pin's file, as main described it (with `draftToken`). */
      readonly file?: WindowFile
      /** The element the pin's draft is on, as main described it (with `draftToken`). */
      readonly target?: DraftTarget
    }

/**
 * The draft token a pin event carries, if a well-formed one is there
 * (docs/designs/html-preview-comments.md §10.4 "[New comment]").
 *
 * Main's events are not schema-parsed again in the renderer; a malformed
 * token would only be refused at save, after the reader typed a comment, so
 * it is dropped here and "New comment" is simply not offered.
 *
 * @param draft - A pin's draft event.
 * @returns The token, or `undefined`.
 */
export function pinDraftToken(draft: PinDraft): string | undefined {
  const token = draft.draftToken
  return token !== undefined && COMMENT_DRAFT_TOKEN_PATTERN.test(token) ? token : undefined
}

/**
 * The session key a typed draft is kept under: one per element per tab.
 *
 * @param request - A new-comment request.
 * @returns A stable key for `commentDrafts`.
 */
export function draftKeyOf(request: Extract<CommentWindowRequest, { kind: 'new' }>): string {
  const { target, file, panelId } = request
  return [
    panelId,
    file.fileKey,
    target.line,
    target.tag,
    target.elementId ?? '',
    target.runtime?.tag ?? ''
  ].join('|')
}
