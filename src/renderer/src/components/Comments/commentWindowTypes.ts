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
import type { CommentTargetPlace } from '../../../../shared/ipc/comment-common-schema'
import type { NounSource } from './commentTargetNoun'

export type { NounSource } from './commentTargetNoun'

/** A draft event of kind `menu` or `open`. */
export type ElementDraft = Extract<CommentDraftOpened, { kind: 'menu' | 'open' }>
/** A draft event of kind `icon` (a pin). */
export type PinDraft = Extract<CommentDraftOpened, { kind: 'icon' }>
/** The element a new comment goes on. */
export type DraftTarget = NonNullable<ElementDraft['target']>
/**
 * A new comment's target as the window names it: main's description, and –
 * in a renderer-hosted preview – where the block sits when its tag does not
 * name it (C-03: a table row or cell, a diagram), read from the rendered page.
 */
export type NewCommentTarget = DraftTarget & { readonly place?: CommentTargetPlace }

/** The file a window is about, as main described it. */
export interface WindowFile {
  readonly fileKey: string
  readonly displayPath: string
  readonly filePath: string
  readonly frame: boolean
}

/** Where focus goes when the window closes (§10.4 "Focus"). */
export type WindowOpener = 'page' | 'drawer'

/**
 * The target's text and the selected range in it, for a new comment that
 * may be about words (spec 024 024-FR-004; comments-v2 C-07). The text is
 * collapsed as a selection reads it (`shared/comments/selectionWords.ts`);
 * `start === end` means no words are chosen yet.
 */
export interface NewCommentWords {
  readonly text: string
  readonly start: number
  readonly end: number
  /** The selection ran past the target and was cut to it (Markdown: to the block it started in). */
  readonly cut: boolean
}

/** What the comment window is showing. */
export type CommentWindowRequest =
  | {
      readonly kind: 'new'
      readonly panelId: string
      readonly draftToken: string
      /** Main's opaque key for the element: the typed text is kept under it for the session. */
      readonly draftKey: string
      readonly target: NewCommentTarget
      readonly file: WindowFile
      readonly point: { readonly x: number; readonly y: number }
      readonly opener: WindowOpener
      /** The target's text and the selected words; absent where the preview cannot offer words (HTML for now). */
      readonly words?: NewCommentWords
      /** Words were selected but are not in the file as written (HTML, 024-AC-004 (g)): the window says so. */
      readonly wordsMissing?: true
      /**
       * The tag of the target's parent that can hold a comment, when there is
       * one: a render-check refusal offers "Comment on the whole {parent}"
       * (C-19.3, state table W-07).
       */
      readonly parentTag?: NounSource
      /**
       * The pick already knows no comment can be written here – the target is
       * inside a generated START/END region (024-FR-023, W-08): the window
       * opens with the refusal and Save blocked, before anything is typed.
       */
      readonly refused?: 'generated-region'
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
