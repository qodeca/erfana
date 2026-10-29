// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – what opens the comment window
 * (docs/designs/comments/html-preview-comments.md §7.3, §7.4, §7.7).
 *
 * @module HtmlPreviewPanel/comments/commentWindowTypes
 */
import {
  COMMENT_DRAFT_KEY_PATTERN,
  COMMENT_DRAFT_TOKEN_PATTERN,
  type CommentDraftOpened
} from '../../../../shared/ipc/preview-comment-schema'

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
      /** Main's opaque key for the element: the typed text is kept under it for the session. */
      readonly draftKey: string
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
       * The generation of the list stored when the window opened: it closes
       * itself on an empty selection only in a newer list (M2).
       */
      readonly listAfter: number
      /**
       * A pin's draft on its element, when main sent one: the thread view's
       * "New comment" adds a thread there. Absent from a drawer row.
       */
      readonly draftToken?: string
      /** Main's element key for that draft (with `draftToken`). */
      readonly draftKey?: string
      /** The pin's file, as main described it (with `draftToken`). */
      readonly file?: WindowFile
      /** The element the pin's draft is on, as main described it (with `draftToken`). */
      readonly target?: DraftTarget
    }

/**
 * The draft a pin event carries – its token and element key – if well-formed
 * ones are there (docs/designs/comments/html-preview-comments.md §10.4 "[New comment]").
 *
 * Main's events are not schema-parsed again in the renderer; a malformed
 * token would only be refused at save, after the reader typed a comment, so
 * it is dropped here and "New comment" is simply not offered.
 *
 * @param draft - A pin's draft event.
 * @returns The token and key, or `undefined`.
 */
export function pinDraftOf(draft: PinDraft): { readonly draftToken: string; readonly draftKey: string } | undefined {
  const { draftToken, draftKey } = draft
  if (draftToken === undefined || !COMMENT_DRAFT_TOKEN_PATTERN.test(draftToken)) return undefined
  if (draftKey === undefined || !COMMENT_DRAFT_KEY_PATTERN.test(draftKey)) return undefined
  return { draftToken, draftKey }
}

/**
 * The session key a typed draft is kept under: one per element per tab.
 * Main mints the element part (`draftKey`, an opaque digest of the file and
 * the element's place in it), so two elements never share a draft – two
 * id-less `div`s on one line included – and the same element picked again
 * gets its text back.
 *
 * @param request - A new-comment request.
 * @returns A stable key for `commentDrafts`.
 */
export function draftKeyOf(request: Extract<CommentWindowRequest, { kind: 'new' }>): string {
  return ['new', request.panelId, request.draftKey].join('|')
}
