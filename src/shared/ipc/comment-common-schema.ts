// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comment IPC schemas both channel families share – the HTML Preview's
 * `preview:comment*` and the renderer-hosted previews' `file-comment:*`
 * (spec 024 architecture note 001 § 4; docs/designs/comments/html-preview-comments.md
 * §8, §10.4).
 *
 * One definition of what a file's comments look like on the wire
 * ({@link CommentFileViewSchema}), of every operation on an existing thread
 * ({@link commentThreadOpSchemas}) and of a save's answer
 * ({@link CommentSaveResultSchema}), so the two families cannot drift.
 * `preview-comment-schema.ts` re-exports the names it always exported, so its
 * importers and its characterisation pin are unchanged.
 *
 * Every object is `.strict()`, every string and list is capped, every number
 * bounded. zod v4: `z.enum(ErrorCode)` – never `z.nativeEnum`.
 */
import { z } from 'zod'
import { ErrorCode } from '../errors'
import { PREVIEW_LIMITS } from '../preview-limits'
import { MESSAGE_ID_PATTERN, TAG_MAX_CHARS, visibleInline } from '../comments/format'
import { CommentKeySchema as KeySchema } from './preview-comment-page-schema'
import { PanelIdSchema } from './preview-schema'

/** Characters of one file path in a comment payload. */
export const COMMENT_PATH_MAX_CHARS = 4_096
/** Characters of a damaged block's raw text sent to the renderer; longer is cut and flagged. */
export const COMMENT_RAW_PREVIEW_MAX_CHARS = 65_536
/** Characters of one line a rebuild confirmation shows (OD-05); longer is cut. */
export const REBUILD_LINE_MAX_CHARS = 2_000
/** Differing lines a rebuild confirmation lists at most (OD-05). */
export const REBUILD_LINES_MAX = 32

/** A message's text: 1 to `COMMENT_MESSAGE_MAX_CHARS` code points, not blank. */
export const CommentMessageTextSchema = z
  .string()
  .min(1)
  .max(PREVIEW_LIMITS.COMMENT_MESSAGE_MAX_CHARS * 2)
  .refine(text => text.trim() !== '', { message: 'empty' })
  .refine(text => [...text].length <= PREVIEW_LIMITS.COMMENT_MESSAGE_MAX_CHARS, { message: 'too long' })
/** SHA-256 (hex) of a block's bytes as the window read them: the compare-and-swap key. */
export const CommentRawHashSchema = z.string().regex(/^[0-9a-f]{64}$/)
const MessageIdSchema = z.string().regex(MESSAGE_ID_PATTERN)

/**
 * Why a comment read or write did nothing – the finer reason next to a
 * refusal's `code` (C-19). Main's own list (`commentRefusals.ts`) is this
 * enum; the renderer words it (`commentCopy`). Never a path or comment text.
 */
export const CommentRefusalReasonSchema = z.enum([
  // Where the file is
  'not-absolute',
  'outside-project',
  'excluded',
  'not-html',
  'kind-mismatch',
  'alternate-stream',
  'short-name',
  // What the file is
  'missing',
  'link',
  'too-large',
  'encoding',
  'conflict-markers',
  'unterminated-block',
  'too-many-blocks',
  'read-only',
  'not-owner',
  // The write
  'unsaved-source',
  'identity',
  'target-moved',
  'block-changed',
  'limit',
  'meta-charset',
  'invalid',
  'verify-failed',
  'changed',
  'unsupported-fs',
  'busy',
  'parse-failed',
  'io',
  /** No slot kept the file's rendering (spec 024 § 5, C25). */
  'render-changed',
  /** The target lies inside a START/END region another tool generates (024-FR-023). */
  'generated-region',
  /** The target is the file's frontmatter, which is never commentable (M6). */
  'frontmatter',
  /** The file on disk differed from what was written when it was read again after the rename (C12). */
  'changed-during-save',
  // The request (file-comment family)
  /** The sender is not Erfana's own top-level window. */
  'untrusted-sender',
  /** The payload failed its strict schema. */
  'bad-request',
  /** The file is not open in that panel of the sender's window (C17). */
  'not-open',
  /** A draft token or key that is unknown, used, or bound to another window, panel or file. */
  'key-invalid',
  /** A draft older than its time to live. */
  'draft-expired',
  /** Comments are off in Settings for this file's preview (024-FR-022). */
  'comments-off',
  /** The thread already holds `COMMENT_MAX_REPLIES` replies (C-19). */
  'replies',
  /** The write would make the file larger than `COMMENT_FILE_MAX_BYTES` (C-19). */
  'file-size',
  /** The picked part of an HTML page cannot hold a comment: `html`, `head`, template content (menu matrix M-08). */
  'not-commentable'
])
export type CommentRefusalReason = z.infer<typeof CommentRefusalReasonSchema>

const RefusedSchema = z.object({ ok: z.literal(false), code: z.enum(ErrorCode) }).strict()

/** A refusal with its code and, optionally, its finer reason (C-19). */
export const CommentReasonedRefusalSchema = RefusedSchema.extend({ reason: CommentRefusalReasonSchema.optional() }).strict()
export type CommentReasonedRefusal = z.infer<typeof CommentReasonedRefusalSchema>

/** A save's answer: the thread written (`null` when the block is gone), or a refusal with its reason. */
export const CommentSaveResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      threadKey: KeySchema.nullable(),
      /**
       * The selected words were not kept – main's own parse did not find them
       * once – so the comment is on the whole target (024-FR-004). The window
       * says so before it closes.
       */
      wordsDropped: z.literal(true).optional()
    })
    .strict(),
  CommentReasonedRefusalSchema
])
export type CommentSaveResult = z.infer<typeof CommentSaveResultSchema>

const threadTarget = { panelId: PanelIdSchema, fileKey: KeySchema, threadKey: KeySchema, rawHash: CommentRawHashSchema }

/**
 * Every operation on an existing thread or damaged block, named by main-minted
 * keys only (C17) – never a path, an offset or an author. Both families' save
 * requests are a discriminated union of their own `add` and these.
 */
export const commentThreadOpSchemas = [
  // `resolve`: "Reply and resolve" – the reply and the resolve in one write (comments-v2 C-13).
  z.object({ ...threadTarget, op: z.literal('reply'), text: CommentMessageTextSchema, resolve: z.literal(true).optional() }).strict(),
  z
    .object({ ...threadTarget, op: z.literal('editMessage'), messageId: MessageIdSchema, text: CommentMessageTextSchema })
    .strict(),
  z.object({ ...threadTarget, op: z.literal('deleteMessage'), messageId: MessageIdSchema }).strict(),
  z.object({ ...threadTarget, op: z.literal('setStatus'), status: z.enum(['open', 'resolved']) }).strict(),
  z.object({ ...threadTarget, op: z.literal('deleteThread') }).strict(),
  z
    .object({
      panelId: PanelIdSchema,
      op: z.literal('deleteBlock'),
      fileKey: KeySchema,
      blockKey: KeySchema,
      rawHash: CommentRawHashSchema
    })
    .strict(),
  // OD-05 "Rebuild from data…": re-render a hand-damaged block's readable lines from its valid
  // `@data`; `status: 'resolved'` is "Mark resolved" (the status its line claims), `'open'` "Keep open".
  z
    .object({
      panelId: PanelIdSchema,
      op: z.literal('rebuildBlock'),
      fileKey: KeySchema,
      blockKey: KeySchema,
      rawHash: CommentRawHashSchema,
      status: z.enum(['open', 'resolved']).optional()
    })
    .strict()
] as const

const TimestampSchema = z.string().max(32)
/** An author as the renderer shows it; the email only when the file has one. */
const AuthorViewSchema = z.object({ name: z.string().max(400), email: z.string().max(1_000).optional() }).strict()

const MessageViewSchema = z
  .object({
    id: MessageIdSchema,
    by: AuthorViewSchema,
    at: TimestampSchema,
    text: z.string().max(PREVIEW_LIMITS.COMMENT_MESSAGE_MAX_CHARS * 2),
    edited: TimestampSchema.optional()
  })
  .strict()

/** One thread, read from disk (§10.4). Text and emails reach the renderer only. */
export const CommentThreadViewSchema = z
  .object({
    threadKey: KeySchema,
    rawHash: CommentRawHashSchema,
    status: z.enum(['open', 'resolved']),
    resolved: z.object({ by: AuthorViewSchema, at: TimestampSchema }).strict().optional(),
    /** 1-based line of the block in the file. */
    line: z.number().int().min(1),
    /** `tag#id.class` of the stored anchor (§10.2 label rules applied by the renderer). */
    tag: z.string().max(TAG_MAX_CHARS),
    elementId: z.string().max(200).optional(),
    classes: z.array(z.string().max(100)).max(PREVIEW_LIMITS.COMMENT_MAX_CLASSES),
    /** Found in the file now (else "Not found"). */
    attached: z.boolean(),
    /** Found, but not rendered right now ("Not visible now", decision 30). */
    notVisible: z.boolean(),
    /**
     * The element's text as the block stored it – "It was attached to:" (§10.10).
     * One line with nothing hidden: invisible and bidi characters arrive as a
     * visible `\uXXXX` (`visibleInline`), never raw.
     */
    quote: z
      .string()
      .min(1)
      .max(PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS)
      .refine(text => visibleInline(text) === text)
      .optional(),
    /** A JS-built target: its tag and path below the in-file element, and its snapshot's size. */
    runtime: z
      .object({
        tag: z.string().max(TAG_MAX_CHARS),
        path: z.string().max(PREVIEW_LIMITS.COMMENT_RUNTIME_PATH_MAX_CHARS),
        snapshotBytes: z.number().int().min(0).optional(),
        truncated: z.literal(true).optional()
      })
      .strict()
      .optional(),
    messages: z.array(MessageViewSchema).min(1).max(PREVIEW_LIMITS.COMMENT_MAX_REPLIES + 1),
    /**
     * Derived, never written (comments-v2 C-06; state table S-03, S-04): the
     * target's text is not what the comment stored (`changed`), or the words
     * a selection comment is about are gone from it (`words`). `was` is the
     * stored text, `now` the text there now – absent when no words are found.
     * Both visible like `quote`.
     */
    change: z
      .object({
        state: z.enum(['changed', 'words']),
        was: z
          .string()
          .max(PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS)
          .refine(text => visibleInline(text) === text),
        now: z
          .string()
          .max(PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS)
          .refine(text => visibleInline(text) === text)
          .optional()
      })
      .strict()
      .optional()
  })
  .strict()
export type CommentThreadView = z.infer<typeof CommentThreadViewSchema>

const DamageReasonSchema = z.enum([
  'no-data',
  'bad-json',
  'schema',
  'limits',
  'readable-mismatch',
  'conflict-marker',
  'duplicate-id',
  'in-template',
  'id-mismatch',
  'unterminated'
])

/** One file's comments: the page's, a same-project frame's (decision 15), or a text preview's file. */
export const CommentFileViewSchema = z
  .object({
    fileKey: KeySchema,
    /** Project-relative, `/`-separated – for "Saved inside {file}". */
    displayPath: z.string().max(COMMENT_PATH_MAX_CHARS),
    /** Absolute, in project space: the spelling the editor's tabs use (dirty guard, §7.8). */
    filePath: z.string().max(COMMENT_PATH_MAX_CHARS),
    /** A frame's file rather than the page's own. */
    frame: z.boolean(),
    writable: z.boolean(),
    readOnlyReason: z
      .enum(['encoding', 'conflict-markers', 'too-large', 'too-many-blocks', 'unterminated-block', 'link', 'missing'])
      .optional(),
    threads: z.array(CommentThreadViewSchema).max(PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE),
    damaged: z
      .array(
        z
          .object({
            blockKey: KeySchema,
            rawHash: CommentRawHashSchema,
            reason: DamageReasonSchema,
            line: z.number().int().min(1),
            raw: z.string().max(COMMENT_RAW_PREVIEW_MAX_CHARS),
            rawTruncated: z.literal(true).optional(),
            /**
             * OD-05: the block's `@data` is valid and only its readable lines or
             * header id disagree with it (`readable-mismatch`, `id-mismatch`), so
             * it can be rebuilt from the data. `lines` pairs each differing line
             * as the file has it and as the data renders it; `claims: 'resolved'`
             * when only the `status:` line differs and it says resolved.
             */
            rebuild: z
              .object({
                lines: z
                  .array(z.object({ file: z.string().max(REBUILD_LINE_MAX_CHARS), data: z.string().max(REBUILD_LINE_MAX_CHARS) }).strict())
                  .min(1)
                  .max(REBUILD_LINES_MAX),
                claims: z.literal('resolved').optional()
              })
              .strict()
              .optional()
          })
          .strict()
      )
      .max(PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE),
    newer: z
      .array(z.object({ blockKey: KeySchema, version: z.number().int().min(2), line: z.number().int().min(1) }).strict())
      .max(PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE)
  })
  .strict()
export type CommentFileView = z.infer<typeof CommentFileViewSchema>
