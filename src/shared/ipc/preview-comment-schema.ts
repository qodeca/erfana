// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – IPC payload schemas
 * (docs/designs/comments/html-preview-comments.md §8, §9.1 S3, S7, S23; tests I-001 –
 * I-005, SEC-05).
 *
 * Every object is `.strict()`, every string and list is capped, every number
 * is bounded (zod 4's `z.number()` already refuses `NaN` and `±Infinity`).
 *
 * - **Page signals** (`preview-page:comment*`) come from an untrusted page,
 *   through its preload: `preview-comment-page-schema.ts`, re-exported here
 *   with the bounded primitives every payload is built from.
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
import { MESSAGE_ID_PATTERN, visibleInline } from '../htmlComments'
import { TAG_MAX_CHARS } from '../comments/format'
import {
  CommentKeySchema as KeySchema,
  CommentPickerSaySchema as PickerSaySchema,
  CommentPointSchema,
  CommentRuntimeTagSchema as RuntimeTagSchema,
  CommentTagNameSchema as TagNameSchema
} from './preview-comment-page-schema'
import { PanelIdSchema } from './preview-schema'

export {
  COMMENT_ANCHOR_KEYS_MAX,
  COMMENT_KEY_MAX_CHARS,
  CommentAnchorsSchema,
  CommentBoxSchema,
  CommentHelloSchema,
  CommentOverlayLossSchema,
  CommentPickRuntimeSchema,
  CommentPickSchema,
  CommentPickViewSchema,
  CommentPointSchema,
  PICK_RUNTIME_TAG_MAX_CHARS
} from './preview-comment-page-schema'
export type { CommentAnchors, CommentBox, CommentOverlayLoss, CommentPick } from './preview-comment-page-schema'
export type { CommentPickRuntime, CommentPickView, CommentPoint } from './preview-comment-page-schema'

/** A draft token: 128 random bits as lower-case hex. */
export const COMMENT_DRAFT_TOKEN_PATTERN = /^[0-9a-f]{32}$/
/** A draft's element key: an opaque 128-bit digest main mints from the file and the element's place in it. */
export const COMMENT_DRAFT_KEY_PATTERN = /^[0-9a-f]{32}$/
/** Files one window may report as holding unsaved editor changes. */
export const COMMENT_UNSAVED_SOURCES_MAX = 500
/** Characters of one such path. */
export const COMMENT_PATH_MAX_CHARS = 4_096
/** Characters of a damaged block's raw text sent to the renderer; longer is cut and flagged. */
export const COMMENT_RAW_PREVIEW_MAX_CHARS = 65_536

// ---------------------------------------------------------------------------
// Renderer → main
// ---------------------------------------------------------------------------

/**
 * Why comments are unavailable for the page on screen (§10.10 "Unavailable"): the feature flag is off for this
 * tab, the page or a frame is over `COMMENT_FILE_MAX_BYTES`, not UTF-8, over the element cap, or could not be
 * prepared (an unknown request kind, a parse that failed, a source that already carries the token attribute),
 * or the page fights the overlay (removes it, or rewrites itself with `document.open()`).
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
      unavailable: CommentUnavailableReasonSchema.optional(),
      /** Files the list left out: past its file count or its byte budget (`commentListBuilder.ts`). */
      unread: z.number().int().min(1).optional()
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

/**
 * A draft, as the renderer holds it: the single-use token, the element key the
 * window keeps typed text under for the session (§10.4 "Draft restored"), and
 * what the window shows for the element. All three or none.
 */
const DraftSchema = {
  draftToken: z.string().regex(COMMENT_DRAFT_TOKEN_PATTERN).optional(),
  draftKey: z.string().regex(COMMENT_DRAFT_KEY_PATTERN).optional(),
  target: CommentDraftTargetViewSchema.optional()
}

/**
 * `preview:commentDraftOpened` (§7.3, §7.4, §7.7). No reason rides along when
 * there is no draft – the menu's only refusal is "Can't comment here" – and no
 * unsaved-source flag: the window's own guard follows the editor tab live
 * (§19 "Draft event fields").
 */
export const CommentDraftOpenedSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        panelId: PanelIdSchema,
        kind: z.enum(['menu', 'open']),
        /** Host-window CSS pixels, already clamped to the panel. */
        point: CommentPointSchema,
        ...DisplaySchema,
        /** Absent: the menu shows a disabled "Can't comment here". */
        ...DraftSchema
      })
      .strict(),
    z
      .object({
        panelId: PanelIdSchema,
        kind: z.literal('icon'),
        point: CommentPointSchema,
        ...DisplaySchema,
        threadKeys: z.array(KeySchema).max(PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE),
        blockKeys: z.array(KeySchema).max(PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE),
        /**
         * "New comment" on the pin's element: a draft minted as a menu's is, with
         * what the window shows for it. Absent when the element cannot take one now.
         */
        ...DraftSchema
      })
      .strict()
  ])
  .refine(
    event => {
      const none = event.draftToken === undefined
      return (event.draftKey === undefined) === none && (event.target === undefined) === none
    },
    { message: 'a draft comes with its key and its target' }
  )
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

/**
 * Where the keyboard picker stopped, as MAIN's token table has it – the tag main parsed and the line of its start
 * tag; `added`: the element reached lies below it (a script built it). Never page text (security review S-L-A); a
 * parsed tag no tag name can spell is left out.
 */
export const CommentPickerElementSchema = z
  .object({ tag: TagNameSchema.optional(), line: z.number().int().min(1), added: z.literal(true).optional() })
  .strict()
export type CommentPickerElement = z.infer<typeof CommentPickerElementSchema>

/**
 * `preview:commentModeChanged` – Esc in the page (its exit pick) or the shortcut changed the mode; `picker`: it did not –
 * the keyboard picker moved to `say` (`element`: main's own facts), for the window's live region to word (§10.2, §10.8).
 */
export const CommentModeChangedSchema = z
  .object({
    panelId: PanelIdSchema,
    on: z.boolean(),
    reason: z.enum(['escape', 'shortcut', 'picker']),
    say: PickerSaySchema.optional(),
    element: CommentPickerElementSchema.optional()
  })
  .strict()
  .refine(event => (event.reason === 'picker') === (event.say !== undefined), { message: 'only a picker event says' })
  .refine(event => (event.say === 'showing') === (event.element !== undefined), { message: 'a showing step names its element' })
export type CommentModeChanged = z.infer<typeof CommentModeChangedSchema>

/** Every `preview:commentSave` operation. */
export const CommentSaveOpSchema = z.enum([
  'add',
  'reply',
  'editMessage',
  'deleteMessage',
  'setStatus',
  'deleteThread',
  'deleteBlock'
])
export type CommentSaveOp = z.infer<typeof CommentSaveOpSchema>

/**
 * The key a save is named by: the draft token of an `add`, the block key of a
 * `deleteBlock`, the thread key of every other operation – and only that one.
 */
function namedByItsOwnKey(event: {
  readonly op: CommentSaveOp
  readonly draftToken?: string
  readonly threadKey?: string
  readonly blockKey?: string
}): boolean {
  const named = { draftToken: event.draftToken !== undefined, threadKey: event.threadKey !== undefined, blockKey: event.blockKey !== undefined }
  if (event.op === 'add') return named.draftToken && !named.threadKey && !named.blockKey
  if (event.op === 'deleteBlock') return named.blockKey && !named.draftToken && !named.threadKey
  return named.threadKey && !named.draftToken && !named.blockKey
}

/**
 * `preview:commentSaveSettled` (§8, §19 "Save pending settles") – a save that
 * was answered `COMMENT_SAVE_PENDING` settled after all: it wrote (`ok`), or
 * it was refused or failed (`code`, never `COMMENT_SAVE_PENDING` again). The
 * write is named by the request's own key, so the window that sent it – or a
 * later one on the same thread – can tell it apart. Sent only for a save that
 * outlasted its answer: every other save's answer already said how it ended.
 */
export const CommentSaveSettledSchema = z
  .object({
    panelId: PanelIdSchema,
    op: CommentSaveOpSchema,
    draftToken: z.string().regex(COMMENT_DRAFT_TOKEN_PATTERN).optional(),
    threadKey: KeySchema.optional(),
    blockKey: KeySchema.optional(),
    ok: z.boolean(),
    code: z.enum(ErrorCode).optional()
  })
  .strict()
  .refine(event => event.ok === (event.code === undefined), { message: 'a failed write names its code, a landed one none' })
  .refine(event => event.code !== ErrorCode.COMMENT_SAVE_PENDING, { message: 'a settled write is no longer pending' })
  .refine(namedByItsOwnKey, { message: 'a write is named by its own key' })
export type CommentSaveSettled = z.infer<typeof CommentSaveSettledSchema>

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
  onSaveSettled(callback: (payload: CommentSaveSettled) => void): () => void
}
