// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments in renderer-hosted previews – IPC payload schemas (spec 024
 * architecture note 001 § 4, § 8 C17, C18; 024-NFR-005 items 4 and 5).
 *
 * Every object is `.strict()` and every new field has a named cap, shared
 * with the HTML schemas where the two overlap (paths, tags, quotes, keys,
 * message text, the view). What a file's comments look like, every thread
 * operation and a save's answer are the HTML family's own definitions
 * (`comment-common-schema.ts`).
 *
 * Trust model: the renderer names a panel and a file it has open; main
 * confines the path, checks the file is open in that panel of the sender's
 * window, and mints every key. An `add` names a draft token main minted for
 * that window, panel and file (`file-comment:openDraft`) and the target as
 * the preview's adapter describes it; thread operations name keys only.
 * Never an author: main reads it from its own settings.
 */
import { z } from 'zod'
import { codePointLength, ANCHOR_ID_MAX_CHARS, ANCHOR_PATH_MAX_CHARS } from '../comments/format'
import { SEL_CONTEXT_MAX_CHARS, SEL_EXACT_MAX_CHARS } from '../comments/anchorSel'
import { utf8Length } from '../comments/encoding'
import { MARKDOWN_COMMENT_MAX_BYTES } from '../markdownComments/markdownLimits'
import { PREVIEW_LIMITS } from '../preview-limits'
import {
  COMMENT_PATH_MAX_CHARS,
  CommentFileViewSchema,
  CommentMessageTextSchema,
  CommentReasonedRefusalSchema,
  commentThreadOpSchemas,
  type CommentReasonedRefusal,
  type CommentSaveResult
} from './comment-common-schema'
import {
  CommentKeySchema,
  CommentPickViewSchema,
  CommentTagNameSchema
} from './preview-comment-page-schema'
import { COMMENT_DRAFT_TOKEN_PATTERN } from './preview-comment-schema'
import { PanelIdSchema } from './preview-schema'

/**
 * Characters (and UTF-8 bytes) of the editor's unsaved text sent for display:
 * the largest file any kind of this family parses – Markdown's limit (C18),
 * not the 25 MB comment file limit, so a renderer cannot make main encode
 * and hand the worker text no kind would parse. A kind added to the family
 * with a larger limit raises this (shared code cannot read main's registry).
 */
export const FILE_COMMENT_BUFFER_MAX_CHARS = MARKDOWN_COMMENT_MAX_BYTES
/** Highest 1-based source line a pick may name. */
export const FILE_COMMENT_LINE_MAX = 10_000_000
/** Highest ordinal a pick may name: which target with its tag on its first line. */
export const FILE_COMMENT_ORDINAL_MAX = 100_000
/** A `baseHash`: SHA-256 of the rendered file text, lower-case hex. */
export const FILE_COMMENT_BASE_HASH_PATTERN = /^[0-9a-f]{64}$/

/** A string of at most `max` code points (and so at most `2 × max` UTF-16 units). */
const codePoints = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max * 2)
    .refine(text => codePointLength(text) <= max, { message: 'too long' })

/** An absolute file path as the renderer's tabs spell it; main confines it. */
const FilePathSchema = z.string().min(1).max(COMMENT_PATH_MAX_CHARS)

/** A target's stored text and the text around it (the quote shape of `@data`). */
const QuoteSchema = z
  .object({
    exact: codePoints(1, PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS),
    prefix: codePoints(0, PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS),
    suffix: codePoints(0, PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS)
  })
  .strict()

/** The selected words (`anchor.sel`'s caps); the file kind decides whether they are a valid selection. */
export const FileCommentSelSchema = z
  .object({
    exact: codePoints(1, SEL_EXACT_MAX_CHARS),
    prefix: codePoints(0, SEL_CONTEXT_MAX_CHARS),
    suffix: codePoints(0, SEL_CONTEXT_MAX_CHARS)
  })
  .strict()

/** The target a preview's adapter describes (`PickedTarget`, architecture note § 3, C7). */
export const PickedTargetSchema = z
  .object({
    lineStart: z.number().int().min(1).max(FILE_COMMENT_LINE_MAX),
    lineEnd: z.number().int().min(1).max(FILE_COMMENT_LINE_MAX),
    tag: CommentTagNameSchema,
    ordinal: z.number().int().min(0).max(FILE_COMMENT_ORDINAL_MAX),
    quote: QuoteSchema.optional(),
    id: z.string().min(1).max(ANCHOR_ID_MAX_CHARS).optional(),
    path: z.string().max(ANCHOR_PATH_MAX_CHARS).optional(),
    baseHash: z.string().regex(FILE_COMMENT_BASE_HASH_PATTERN).optional()
  })
  .strict()
  .refine(target => target.lineEnd >= target.lineStart, { message: 'a target ends on or after its first line' })
export type PickedTargetRequest = z.infer<typeof PickedTargetSchema>

// ---------------------------------------------------------------------------
// Renderer → main
// ---------------------------------------------------------------------------

/**
 * `file-comment:list`. `bufferText` – the editor's unsaved text – is parsed for
 * display only, while it differs from the file; a write always re-reads the disk.
 */
export const FileCommentListRequestSchema = z
  .object({
    panelId: PanelIdSchema,
    filePath: FilePathSchema,
    bufferText: z
      .string()
      .max(FILE_COMMENT_BUFFER_MAX_CHARS)
      .refine(text => utf8Length(text) <= FILE_COMMENT_BUFFER_MAX_CHARS, { message: 'too large' })
      .optional()
  })
  .strict()
export type FileCommentListRequest = z.infer<typeof FileCommentListRequestSchema>

/** `file-comment:openDraft` – a token for one new comment on this file in this panel. */
export const FileCommentOpenDraftRequestSchema = z.object({ panelId: PanelIdSchema, filePath: FilePathSchema }).strict()
export type FileCommentOpenDraftRequest = z.infer<typeof FileCommentOpenDraftRequestSchema>

/** `file-comment:save` – an `add` on a picked target, or one thread operation by keys only. */
export const FileCommentSaveRequestSchema = z.discriminatedUnion('op', [
  z
    .object({
      panelId: PanelIdSchema,
      filePath: FilePathSchema,
      op: z.literal('add'),
      draftToken: z.string().regex(COMMENT_DRAFT_TOKEN_PATTERN),
      target: PickedTargetSchema,
      sel: FileCommentSelSchema.optional(),
      text: CommentMessageTextSchema,
      view: CommentPickViewSchema
    })
    .strict(),
  ...commentThreadOpSchemas
])
export type FileCommentSaveRequest = z.infer<typeof FileCommentSaveRequestSchema>

// ---------------------------------------------------------------------------
// Results and the event (main → renderer, re-validated before they leave)
// ---------------------------------------------------------------------------

/** Where an attached thread's target is now, for the adapter to re-attach to its page. */
export const ThreadPlacementSchema = z
  .object({
    threadKey: CommentKeySchema,
    /** 1-based first source line of the target. */
    line: z.number().int().min(1),
    /** The target's tag, as the kind indexes it. */
    tag: CommentTagNameSchema
  })
  .strict()
export type ThreadPlacement = z.infer<typeof ThreadPlacementSchema>

/** `file-comment:list`'s answer. */
export const FileCommentListResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      file: CommentFileViewSchema,
      placements: z.array(ThreadPlacementSchema).max(PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE)
    })
    .strict(),
  CommentReasonedRefusalSchema
])
export type FileCommentListResult = z.infer<typeof FileCommentListResultSchema>

/** `file-comment:openDraft`'s answer. */
export const FileCommentOpenDraftResultSchema = z.union([
  z.object({ ok: z.literal(true), draftToken: z.string().regex(COMMENT_DRAFT_TOKEN_PATTERN) }).strict(),
  CommentReasonedRefusalSchema
])
export type FileCommentOpenDraftResult = z.infer<typeof FileCommentOpenDraftResultSchema>

/** `file-comment:save`'s answer: the HTML family's. */
export { CommentSaveResultSchema as FileCommentSaveResultSchema } from './comment-common-schema'
export type FileCommentSaveResult = CommentSaveResult

/** `file-comment:changed` – a listed file changed on disk; `stamp` grows with every event. */
export const FileCommentChangedSchema = z
  .object({
    panelId: PanelIdSchema,
    filePath: FilePathSchema,
    stamp: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
  })
  .strict()
export type FileCommentChanged = z.infer<typeof FileCommentChangedSchema>

/** Any refusal of this family. */
export type FileCommentRefusal = CommentReasonedRefusal

/** The `window.api.fileComments` contract (`src/preload/fileCommentsBridge.ts`). */
export interface FileCommentsBridge {
  list(request: FileCommentListRequest): Promise<FileCommentListResult>
  openDraft(request: FileCommentOpenDraftRequest): Promise<FileCommentOpenDraftResult>
  save(request: FileCommentSaveRequest): Promise<FileCommentSaveResult>
  onChanged(callback: (payload: FileCommentChanged) => void): () => void
}
