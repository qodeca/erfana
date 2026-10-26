// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – IPC payload schemas
 * (docs/designs/html-preview-comments.md §8, §9.1 S3, S7, S23; tests I-001 –
 * I-005, SEC-05).
 *
 * Every object is `.strict()`, every string and list is capped, every number
 * is bounded (zod 4's `z.number()` already refuses `NaN` and `±Infinity`).
 *
 * - **Page signals** (`preview-page:comment*`) come from an untrusted page,
 *   through its preload. They carry enums, a token, a pin key, numbers and –
 *   for a JS-built element – a path, a tag, a quote and a snapshot. Never a
 *   file path or an offset: main decides the file from its own frame record.
 * - **Renderer requests** come from Erfana's own window, after
 *   `isTrustedPreviewSender`. They name a panel and main-minted opaque keys
 *   (draft tokens, `fileKey`, `threadKey`, `blockKey`) bound to that window,
 *   panel and view – never a path, an offset or an author (§7.5 step 2).
 * - **Results and events** are composed by main and re-validated before they
 *   leave, as `emit.ts` does for the other preview events.
 *
 * zod v4: `z.enum(ErrorCode)` – never `z.nativeEnum`.
 */
import { z } from 'zod'
import { ErrorCode } from '../errors'
import { PREVIEW_LIMITS } from '../preview-limits'
import { ELEMENT_TOKEN_PATTERN, MESSAGE_ID_PATTERN, utf8Length } from '../htmlComments'
import { TAG_MAX_CHARS } from '../htmlComments/format'
import { PanelIdSchema } from './preview-schema'

/** Characters in a main-minted key: pin, frame, file, thread and block keys. */
export const COMMENT_KEY_MAX_CHARS = 40
/** A draft token: 128 random bits as lower-case hex. */
export const COMMENT_DRAFT_TOKEN_PATTERN = /^[0-9a-f]{32}$/
/** Characters of a tag name in a pick (§8 caps the JS-built element's tag at 32). */
export const PICK_RUNTIME_TAG_MAX_CHARS = 32
/** Keys in each list of one anchors report (§8). */
export const COMMENT_ANCHOR_KEYS_MAX = 500
/** Files one window may report as holding unsaved editor changes. */
export const COMMENT_UNSAVED_SOURCES_MAX = 500
/** Characters of one such path. */
export const COMMENT_PATH_MAX_CHARS = 4_096
/** Characters of a damaged block's raw text sent to the renderer; longer is cut and flagged. */
export const COMMENT_RAW_PREVIEW_MAX_CHARS = 65_536

const MAX_VIEW_PX = 1_000_000
const MAX_RECT_PX = 10_000_000

const KeySchema = z.string().min(1).max(COMMENT_KEY_MAX_CHARS).regex(/^[\w-]+$/)
const coordinate = z.number().min(-MAX_RECT_PX).max(MAX_RECT_PX)
const extent = z.number().min(0).max(MAX_RECT_PX)
const TagNameSchema = z.string().min(1).max(TAG_MAX_CHARS).regex(/^[A-Za-z][\w.:-]*$/)
const RuntimeTagSchema = TagNameSchema.max(PICK_RUNTIME_TAG_MAX_CHARS)
/** A `pathBelow` path: `tag:nth-of-type(n)` segments joined by ` > `, or `''`. */
const RUNTIME_PATH = /^(?:[A-Za-z][\w.:-]*:nth-of-type\(\d{1,6}\)(?: > [A-Za-z][\w.:-]*:nth-of-type\(\d{1,6}\))*)?$/
const quotePart = z.string().max(PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS)

/** A point in CSS pixels (a pick's `screen` or `point`, a menu point). */
export const CommentPointSchema = z.object({ x: coordinate, y: coordinate }).strict()
export type CommentPoint = z.infer<typeof CommentPointSchema>

/** A border box in a frame's CSS pixels. */
export const CommentBoxSchema = z.object({ x: coordinate, y: coordinate, w: extent, h: extent }).strict()
export type CommentBox = z.infer<typeof CommentBoxSchema>

// ---------------------------------------------------------------------------
// Page → main (`preview-page:commentHello`, `…Pick`, `…Anchors`)
// ---------------------------------------------------------------------------

/** `preview-page:commentHello`: carries nothing. */
export const CommentHelloSchema = z.object({}).strict()

/** The frame's viewport and scroll at pick time (§5.3 `view`). */
export const CommentPickViewSchema = z
  .object({
    w: z.number().int().min(0).max(MAX_VIEW_PX),
    h: z.number().int().min(0).max(MAX_VIEW_PX),
    dpr: z.number().positive().max(16),
    x: z.number().min(-MAX_VIEW_PX).max(MAX_VIEW_PX),
    y: z.number().min(-MAX_VIEW_PX).max(MAX_VIEW_PX),
    hash: z.string().min(2).max(PREVIEW_LIMITS.COMMENT_VIEW_HASH_MAX_CHARS).startsWith('#').optional()
  })
  .strict()
export type CommentPickView = z.infer<typeof CommentPickViewSchema>

/** A JS-built element below its tokened ancestor (§5.3 `runtime`). */
export const CommentPickRuntimeSchema = z
  .object({
    path: z.string().max(PREVIEW_LIMITS.COMMENT_RUNTIME_PATH_MAX_CHARS).regex(RUNTIME_PATH),
    tag: RuntimeTagSchema,
    quote: z.object({ exact: quotePart.min(1), prefix: quotePart, suffix: quotePart }).strict().optional(),
    snapshot: z
      .string()
      .max(PREVIEW_LIMITS.COMMENT_SNAPSHOT_MAX_BYTES)
      .refine(s => utf8Length(s) <= PREVIEW_LIMITS.COMMENT_SNAPSHOT_MAX_BYTES)
      .optional(),
    truncated: z.literal(true).optional()
  })
  .strict()
export type CommentPickRuntime = z.infer<typeof CommentPickRuntimeSchema>

/** `preview-page:commentPick` (§8, §19 R3-5, R3-8). */
export const CommentPickSchema = z
  .object({
    kind: z.enum(['menu', 'open', 'icon', 'parent', 'exit']),
    via: z.enum(['pointer', 'keyboard']),
    /** The element's token, or its nearest tokened ancestor's. */
    token: z.string().regex(ELEMENT_TOKEN_PATTERN).optional(),
    /** The tokened element's `localName`; must equal the tag main recorded for the token. */
    tag: TagNameSchema.optional(),
    /** A pin's key (`icon`). */
    key: KeySchema.optional(),
    /** A pointer pick: the trusted event's `screenX/Y`. */
    screen: CommentPointSchema.optional(),
    /** A keyboard pick: the element's top-left + 4 px, frame CSS pixels. */
    point: CommentPointSchema.optional(),
    /** The selected element's border box, frame CSS pixels: where the fresh still's ring is checked. */
    box: CommentBoxSchema.optional(),
    ws: z.enum(['collapse', 'preserve']).optional(),
    runtime: CommentPickRuntimeSchema.optional(),
    view: CommentPickViewSchema
  })
  .strict()
  .refine(pick => pick.kind !== 'icon' || pick.key !== undefined, { message: 'a pin pick names its key' })
  .refine(pick => pick.runtime === undefined || pick.token !== undefined, {
    message: 'a runtime element is described below a tokened ancestor'
  })
export type CommentPick = z.infer<typeof CommentPickSchema>

/** Why a frame's overlay gave up (the preload's `anchors.ts`). */
export const CommentOverlayLossSchema = z.enum(['document-replaced', 'overlay-removed'])
export type CommentOverlayLoss = z.infer<typeof CommentOverlayLossSchema>

/** `preview-page:commentAnchors`: which pins' elements are rendered now; overlay loss. */
export const CommentAnchorsSchema = z
  .object({
    visible: z.array(KeySchema).max(COMMENT_ANCHOR_KEYS_MAX),
    hidden: z.array(KeySchema).max(COMMENT_ANCHOR_KEYS_MAX),
    overlay: z.literal('unavailable').optional(),
    reason: CommentOverlayLossSchema.optional()
  })
  .strict()
export type CommentAnchors = z.infer<typeof CommentAnchorsSchema>

// ---------------------------------------------------------------------------
// Renderer → main
// ---------------------------------------------------------------------------

/**
 * Why comments are unavailable for the page on screen (§10.10 "Unavailable"):
 * the feature flag is off for this tab, the page or a frame is over 4 MB, not
 * UTF-8, over the element cap, or could not be prepared (an unknown request
 * kind, a parse that failed, a source that already carries the token
 * attribute), or the page fights the overlay (removes it, or rewrites itself
 * with `document.open()`).
 */
export const CommentUnavailableReasonSchema = z.enum([
  'disabled',
  'too-large',
  'encoding',
  'page-too-large',
  'prepare-failed',
  'overlay-removed',
  'document-replaced'
])
export type CommentUnavailableReason = z.infer<typeof CommentUnavailableReasonSchema>

/** `preview:commentSetMode` – both values, every time (`showIcons` is per tab, §3). */
export const CommentSetModeRequestSchema = z
  .object({ panelId: PanelIdSchema, on: z.boolean(), showIcons: z.boolean() })
  .strict()
export type CommentSetModeRequest = z.infer<typeof CommentSetModeRequestSchema>

/** Any request that names only a panel (`preview:commentList`). */
export const CommentPanelRequestSchema = z.object({ panelId: PanelIdSchema }).strict()
export type CommentPanelRequest = z.infer<typeof CommentPanelRequestSchema>

/** `preview:commentCommand` – "Show on page" (§7.10). */
export const CommentCommandRequestSchema = z
  .object({ panelId: PanelIdSchema, command: z.literal('reveal'), threadKey: KeySchema })
  .strict()
export type CommentCommandRequest = z.infer<typeof CommentCommandRequestSchema>

const MessageTextSchema = z
  .string()
  .min(1)
  .max(PREVIEW_LIMITS.COMMENT_MESSAGE_MAX_CHARS * 2)
  .refine(text => text.trim() !== '', { message: 'empty' })
  .refine(text => [...text].length <= PREVIEW_LIMITS.COMMENT_MESSAGE_MAX_CHARS, { message: 'too long' })
const RawHashSchema = z.string().regex(/^[0-9a-f]{64}$/)
const MessageIdSchema = z.string().regex(MESSAGE_ID_PATTERN)

const threadTarget = { panelId: PanelIdSchema, fileKey: KeySchema, threadKey: KeySchema, rawHash: RawHashSchema }

/** `preview:commentSave` – one operation; the author comes from main's settings, never from here. */
export const CommentSaveRequestSchema = z.discriminatedUnion('op', [
  z
    .object({
      panelId: PanelIdSchema,
      op: z.literal('add'),
      draftToken: z.string().regex(COMMENT_DRAFT_TOKEN_PATTERN),
      text: MessageTextSchema
    })
    .strict(),
  z.object({ ...threadTarget, op: z.literal('reply'), text: MessageTextSchema }).strict(),
  z
    .object({ ...threadTarget, op: z.literal('editMessage'), messageId: MessageIdSchema, text: MessageTextSchema })
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
      rawHash: RawHashSchema
    })
    .strict()
])
export type CommentSaveRequest = z.infer<typeof CommentSaveRequestSchema>

/** `preview:commentSetUnsavedSources` – the window's dirty editor files, absolute, project space. */
export const CommentUnsavedSourcesRequestSchema = z
  .object({
    paths: z.array(z.string().min(1).max(COMMENT_PATH_MAX_CHARS)).max(COMMENT_UNSAVED_SOURCES_MAX)
  })
  .strict()
export type CommentUnsavedSourcesRequest = z.infer<typeof CommentUnsavedSourcesRequestSchema>

// ---------------------------------------------------------------------------
// Results (main → renderer, re-validated before they leave)
// ---------------------------------------------------------------------------

const RefusedSchema = z.object({ ok: z.literal(false), code: z.enum(ErrorCode) }).strict()

/** `preview:commentSetMode`'s answer. */
export const CommentSetModeResultSchema = z.union([
  z.object({ ok: z.literal(true), on: z.boolean(), showIcons: z.boolean() }).strict(),
  RefusedSchema
])
export type CommentSetModeResult = z.infer<typeof CommentSetModeResultSchema>

/** `preview:commentCommand`'s and `preview:commentSetUnsavedSources`' answer. */
export const CommentAckSchema = z.union([z.object({ ok: z.literal(true) }).strict(), RefusedSchema])
export type CommentAck = z.infer<typeof CommentAckSchema>

/** `preview:commentSave`'s answer: the thread written, `null` when the block is gone. */
export const CommentSaveResultSchema = z.union([
  z.object({ ok: z.literal(true), threadKey: KeySchema.nullable() }).strict(),
  RefusedSchema
])
export type CommentSaveResult = z.infer<typeof CommentSaveResultSchema>

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
    rawHash: RawHashSchema,
    status: z.enum(['open', 'resolved']),
    resolved: z.object({ by: AuthorViewSchema, at: TimestampSchema }).strict().optional(),
    /** 1-based line of the block in the file. */
    line: z.number().int().min(1),
    /** `tag#id.class` of the stored anchor (§10.2 label rules applied by the renderer). */
    tag: z.string().max(TAG_MAX_CHARS),
    elementId: z.string().max(200).optional(),
    classes: z.array(z.string().max(100)).max(PREVIEW_LIMITS.COMMENT_MAX_CLASSES),
    /** Found in the file now (else "Element not found"). */
    attached: z.boolean(),
    /** Found, but not rendered right now ("Not visible now", decision 30). */
    notVisible: z.boolean(),
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
    messages: z.array(MessageViewSchema).min(1).max(PREVIEW_LIMITS.COMMENT_MAX_REPLIES + 1)
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

/** One file's comments: the page's, or a same-project frame's (decision 15). */
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
            rawHash: RawHashSchema,
            reason: DamageReasonSchema,
            line: z.number().int().min(1),
            raw: z.string().max(COMMENT_RAW_PREVIEW_MAX_CHARS),
            rawTruncated: z.literal(true).optional()
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

/** `preview:commentList`'s answer. */
export const CommentListResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      files: z.array(CommentFileViewSchema).max(64),
      unavailable: CommentUnavailableReasonSchema.optional()
    })
    .strict(),
  RefusedSchema
])
export type CommentListResult = z.infer<typeof CommentListResultSchema>

// ---------------------------------------------------------------------------
// Events (main → the owning window)
// ---------------------------------------------------------------------------

const DisplaySchema = {
  displayPath: z.string().max(COMMENT_PATH_MAX_CHARS),
  filePath: z.string().max(COMMENT_PATH_MAX_CHARS),
  frame: z.boolean(),
  fileKey: KeySchema
}

/** What the menu and the comment window say about the picked element (§10.4, §10.10 "Context line"). */
export const CommentDraftTargetViewSchema = z
  .object({
    /** The in-file element the block goes before: tag, id, classes, 1-based line. */
    tag: z.string().max(TAG_MAX_CHARS),
    elementId: z.string().max(200).optional(),
    classes: z.array(z.string().max(100)).max(PREVIEW_LIMITS.COMMENT_MAX_CLASSES),
    line: z.number().int().min(1),
    /** The element's start tag as it is on disk, cut to 200 characters. */
    excerpt: z.string().max(200),
    /** A JS-built element (or one inside a framework's hydrated region): its own tag. */
    runtime: z
      .object({
        tag: RuntimeTagSchema,
        snapshotBytes: z.number().int().min(0).optional(),
        truncated: z.literal(true).optional()
      })
      .strict()
      .optional()
  })
  .strict()

/** `preview:commentDraftOpened` (§7.3, §7.4, §7.7). */
export const CommentDraftOpenedSchema = z.discriminatedUnion('kind', [
  z
    .object({
      panelId: PanelIdSchema,
      kind: z.enum(['menu', 'open']),
      /** Host-window CSS pixels, already clamped to the panel. */
      point: CommentPointSchema,
      ...DisplaySchema,
      /** Absent: the menu shows a disabled "Can't comment here". */
      draftToken: z.string().regex(COMMENT_DRAFT_TOKEN_PATTERN).optional(),
      /** Why not, when there is no draft. */
      code: z.enum(ErrorCode).optional(),
      target: CommentDraftTargetViewSchema.optional(),
      /** An editor tab holds unsaved changes for this file (decision 13): Save is blocked. */
      unsavedSource: z.boolean()
    })
    .strict(),
  z
    .object({
      panelId: PanelIdSchema,
      kind: z.literal('icon'),
      point: CommentPointSchema,
      ...DisplaySchema,
      threadKeys: z.array(KeySchema).max(PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE),
      blockKeys: z.array(KeySchema).max(PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE)
    })
    .strict()
])
export type CommentDraftOpened = z.infer<typeof CommentDraftOpenedSchema>

/** `preview:commentsChanged` – the toolbar badge and the unavailable state (§10.1, §10.10). */
export const CommentsChangedSchema = z
  .object({
    panelId: PanelIdSchema,
    counts: z
      .object({
        open: z.number().int().min(0),
        resolved: z.number().int().min(0),
        attention: z.number().int().min(0)
      })
      .strict(),
    unavailable: CommentUnavailableReasonSchema.optional()
  })
  .strict()
export type CommentsChanged = z.infer<typeof CommentsChangedSchema>

/** `preview:commentAnchorStatus` – threads whose element is not rendered right now. */
export const CommentAnchorStatusSchema = z
  .object({ panelId: PanelIdSchema, notVisible: z.array(KeySchema).max(PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE * 4) })
  .strict()
export type CommentAnchorStatus = z.infer<typeof CommentAnchorStatusSchema>

/** `preview:commentModeChanged` – main changed the mode: Esc in the page (its exit pick), or the shortcut. */
export const CommentModeChangedSchema = z
  .object({ panelId: PanelIdSchema, on: z.boolean(), reason: z.enum(['escape', 'shortcut']) })
  .strict()
export type CommentModeChanged = z.infer<typeof CommentModeChangedSchema>

/** The `window.api.previewComments` contract (`src/preload/previewCommentsBridge.ts`). */
export interface PreviewCommentsBridge {
  setMode(request: CommentSetModeRequest): Promise<CommentSetModeResult>
  list(panelId: string): Promise<CommentListResult>
  reveal(panelId: string, threadKey: string): Promise<CommentAck>
  save(request: CommentSaveRequest): Promise<CommentSaveResult>
  setUnsavedSources(paths: readonly string[]): Promise<CommentAck>
  onDraftOpened(callback: (payload: CommentDraftOpened) => void): () => void
  onCommentsChanged(callback: (payload: CommentsChanged) => void): () => void
  onAnchorStatus(callback: (payload: CommentAnchorStatus) => void): () => void
  onModeChanged(callback: (payload: CommentModeChanged) => void): () => void
}
