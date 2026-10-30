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
import { TAG_MAX_CHARS } from '../comments/format'
import { SPOKEN_EXCERPT_MAX_CODE_POINTS, isSpokenExcerpt } from '../comments/spokenExcerpt'
import {
  COMMENT_PATH_MAX_CHARS,
  CommentFileViewSchema,
  CommentMessageTextSchema as MessageTextSchema,
  commentThreadOpSchemas
} from './comment-common-schema'
import type { CommentSaveResult } from './comment-common-schema'
import {
  CommentKeySchema as KeySchema,
  CommentPickerSaySchema as PickerSaySchema,
  CommentPickSelSchema,
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
  CommentPickSelSchema,
  CommentPickViewSchema,
  CommentPointSchema,
  PICK_RUNTIME_TAG_MAX_CHARS
} from './preview-comment-page-schema'
export type { CommentAnchors, CommentBox, CommentOverlayLoss, CommentPick } from './preview-comment-page-schema'
export type { CommentPickRuntime, CommentPickSel, CommentPickView, CommentPoint } from './preview-comment-page-schema'
// One definition with the file-comment family (spec 024 architecture note 001 § 4).
export {
  COMMENT_PATH_MAX_CHARS,
  COMMENT_RAW_PREVIEW_MAX_CHARS,
  CommentFileViewSchema,
  CommentSaveResultSchema,
  CommentThreadViewSchema
} from './comment-common-schema'
export type { CommentFileView, CommentSaveResult, CommentThreadView } from './comment-common-schema'

/** A draft token: 128 random bits as lower-case hex. */
export const COMMENT_DRAFT_TOKEN_PATTERN = /^[0-9a-f]{32}$/
/** A draft's element key: an opaque 128-bit digest main mints from the file and the element's place in it. */
export const COMMENT_DRAFT_KEY_PATTERN = /^[0-9a-f]{32}$/
/** Files one window may report as holding unsaved editor changes. */
export const COMMENT_UNSAVED_SOURCES_MAX = 500
/**
 * Characters of a target's text a draft carries for the words of a new
 * comment (spec 024 024-FR-004, C-07 "Narrow to words"). A longer text is
 * sent as the part around the selected words, or not at all.
 */
export const COMMENT_WORDS_TEXT_MAX_CHARS = 10_000

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

/**
 * `preview:commentCommand` – "Show on page" (§7.10), or keep an open
 * new-comment window's draft alive (spec 024 C-14.2; main caps a draft's whole
 * life, `commentKeyStore.ts` `DRAFT_MAX_AGE_MS`).
 */
export const CommentCommandRequestSchema = z.discriminatedUnion('command', [
  z.object({ panelId: PanelIdSchema, command: z.literal('reveal'), threadKey: KeySchema }).strict(),
  z
    .object({ panelId: PanelIdSchema, command: z.literal('keep-draft'), draftToken: z.string().regex(COMMENT_DRAFT_TOKEN_PATTERN) })
    .strict()
])
export type CommentCommandRequest = z.infer<typeof CommentCommandRequestSchema>

/** `preview:commentSave` – one operation; the author comes from main's settings, never from here. */
export const CommentSaveRequestSchema = z.discriminatedUnion('op', [
  z
    .object({
      panelId: PanelIdSchema,
      op: z.literal('add'),
      draftToken: z.string().regex(COMMENT_DRAFT_TOKEN_PATTERN),
      text: MessageTextSchema,
      /** The words the comment is about (024-FR-004); main keeps them only when they are in its own text of the target. */
      sel: CommentPickSelSchema.optional()
    })
    .strict(),
  ...commentThreadOpSchemas
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
 * The target's text and the selected range in it, from MAIN's parse of the
 * file (spec 024 024-FR-004, C-07): what the window's words and its Narrow to
 * words field show. Collapsed as a selection reads it
 * (`shared/comments/selectionWords.ts`); `start === end`: no words chosen.
 * `cut`: the selection ran past the target and was cut to it.
 */
export const CommentDraftWordsSchema = z
  .object({
    text: z.string().max(COMMENT_WORDS_TEXT_MAX_CHARS),
    start: z.number().int().min(0).max(COMMENT_WORDS_TEXT_MAX_CHARS),
    end: z.number().int().min(0).max(COMMENT_WORDS_TEXT_MAX_CHARS),
    cut: z.boolean()
  })
  .strict()
  .refine(words => words.start <= words.end && words.end <= words.text.length, { message: 'a range inside the text' })
export type CommentDraftWords = z.infer<typeof CommentDraftWordsSchema>

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
        ...DraftSchema,
        /** The pick was made on a text selection: the menu is the selection menu (M-02, M-04). */
        selection: z.literal(true).optional(),
        /** The target's text, and the selected words in it when main found them there (024-FR-004). */
        words: CommentDraftWordsSchema.optional(),
        /** Words were selected, but they are not in the file as written (a script added them): the window says so. */
        wordsMissing: z.literal(true).optional()
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
  .refine(
    event => event.kind === 'icon' || event.draftToken !== undefined || (event.words === undefined && event.wordsMissing === undefined),
    { message: 'words come with a draft' }
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

/** The spoken kind of a picked element (comments-v2 C-10), from main's own table – never page text. */
export const CommentPickerRoleSchema = z.enum([
  'paragraph', 'list item', 'list', 'table', 'table row', 'table cell', 'image', 'button', 'link', 'section', 'article',
  'navigation', 'header', 'footer', 'aside', 'main', 'block quote', 'code block', 'figure', 'form', 'element',
  'heading level 1', 'heading level 2', 'heading level 3', 'heading level 4', 'heading level 5', 'heading level 6'
])
export type CommentPickerRole = z.infer<typeof CommentPickerRoleSchema>

/**
 * Where the keyboard picker stopped, as MAIN's token table has it – the tag main parsed and the line of its start
 * tag; `added`: the element reached lies below it (a script built it). Never page text (security review S-L-A); a
 * parsed tag no tag name can spell is left out. C-10 adds its spoken kind and its open comments, both main's, and
 * its opening words – from MAIN's own parse of the file served, never from the page (`commentWordsCore.ts`).
 */
export const CommentPickerElementSchema = z
  .object({
    tag: TagNameSchema.optional(),
    line: z.number().int().min(1),
    added: z.literal(true).optional(),
    /** C-10: the kind main names the element by (absent for a script-built one). */
    role: CommentPickerRoleSchema.optional(),
    /** C-10: open comments on the element. */
    comments: z.number().int().min(1).max(PREVIEW_LIMITS.COMMENT_MAX_BLOCKS_PER_FILE).optional(),
    /** C-10: the element's first words as main parsed them – whitespace collapsed, at most 60 code points and "…". */
    excerpt: z
      .string()
      .max(2 * SPOKEN_EXCERPT_MAX_CODE_POINTS + 1)
      .refine(isSpokenExcerpt, 'C-10 an excerpt is words: at most 60 code points, and "…" when cut')
      .optional()
  })
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
  'deleteBlock',
  // OD-05: named by its block key, as a block delete is.
  'rebuildBlock'
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
  if (event.op === 'deleteBlock' || event.op === 'rebuildBlock') return named.blockKey && !named.draftToken && !named.threadKey
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
  /** C-14.2: keep the open new-comment window's draft alive. */
  keepDraft(panelId: string, draftToken: string): Promise<CommentAck>
  save(request: CommentSaveRequest): Promise<CommentSaveResult>
  setUnsavedSources(paths: readonly string[]): Promise<CommentAck>
  onDraftOpened(callback: (payload: CommentDraftOpened) => void): () => void
  onCommentsChanged(callback: (payload: CommentsChanged) => void): () => void
  onAnchorStatus(callback: (payload: CommentAnchorStatus) => void): () => void
  onModeChanged(callback: (payload: CommentModeChanged) => void): () => void
  onSaveSettled(callback: (payload: CommentSaveSettled) => void): () => void
}
