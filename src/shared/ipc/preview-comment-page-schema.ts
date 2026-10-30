// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – the page's signals to main
 * (`preview-page:commentHello`, `…Pick`, `…Anchors`) and the bounded
 * primitives every comment payload is built from
 * (docs/designs/comments/html-preview-comments.md §8, §9.1 S3, S7; tests I-001 –
 * I-005, SEC-05).
 *
 * These come from an untrusted page, through its preload. They carry enums, a
 * token, a pin key, numbers and – for a JS-built element – a path, a tag, a
 * quote and a snapshot. Never a file path or an offset: main decides the file
 * from its own frame record. Never text main would say to the reader either: a
 * keyboard-picker step names its element by token, and main words it from its
 * own table (security review S-L-A).
 *
 * Split from `preview-comment-schema.ts`, which re-exports every name here, so
 * importers keep one module to import from.
 */
import { z } from 'zod'
import { PREVIEW_LIMITS } from '../preview-limits'
import { ELEMENT_TOKEN_PATTERN, utf8Length } from '../htmlComments'
import { TAG_MAX_CHARS, codePointLength } from '../comments/format'
import { SEL_CONTEXT_MAX_CHARS, SEL_EXACT_MAX_CHARS } from '../comments/anchorSel'

/** Characters in a main-minted key: pin, frame, file, thread and block keys. */
export const COMMENT_KEY_MAX_CHARS = 40
/** Characters of a tag name in a pick (§8 caps the JS-built element's tag at 32). */
export const PICK_RUNTIME_TAG_MAX_CHARS = 32
/** Keys in each list of one anchors report (§8). */
export const COMMENT_ANCHOR_KEYS_MAX = 500
/** Other pins' keys one stack pin's click names (spec 024 C-17; `PIN_STACK_KEYS_MAX` in the preload). */
export const COMMENT_PICK_STACK_MAX = 20

const MAX_VIEW_PX = 1_000_000
const MAX_RECT_PX = 10_000_000

/** A main-minted key (pin, frame, file, thread, block). */
export const CommentKeySchema = z.string().min(1).max(COMMENT_KEY_MAX_CHARS).regex(/^[\w-]+$/)
const coordinate = z.number().min(-MAX_RECT_PX).max(MAX_RECT_PX)
const extent = z.number().min(0).max(MAX_RECT_PX)
/** A tag name as a pick or an event may carry it. */
export const CommentTagNameSchema = z.string().min(1).max(TAG_MAX_CHARS).regex(/^[A-Za-z][\w.:-]*$/)
/** A JS-built element's tag. */
export const CommentRuntimeTagSchema = CommentTagNameSchema.max(PICK_RUNTIME_TAG_MAX_CHARS)
/** A `pathBelow` path: `tag:nth-of-type(n)` segments joined by ` > `, or `''`. */
const RUNTIME_PATH = /^(?:[A-Za-z][\w.:-]*:nth-of-type\(\d{1,6}\)(?: > [A-Za-z][\w.:-]*:nth-of-type\(\d{1,6}\))*)?$/
const quotePart = z.string().max(PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS)
/** What the keyboard picker reached (§10.10 "Announce"): an element, the top of the page, or a leaf. */
export const CommentPickerSaySchema = z.enum(['showing', 'top', 'no-child', 'last', 'first'])

/** A point in CSS pixels (a pick's `screen` or `point`, a menu point). */
export const CommentPointSchema = z.object({ x: coordinate, y: coordinate }).strict()
export type CommentPoint = z.infer<typeof CommentPointSchema>

/** A border box in a frame's CSS pixels. */
export const CommentBoxSchema = z.object({ x: coordinate, y: coordinate, w: extent, h: extent }).strict()
export type CommentBox = z.infer<typeof CommentBoxSchema>

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
    tag: CommentRuntimeTagSchema,
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

/** At most `max` code points (and never more than twice that in UTF-16 units). */
const codePoints = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max * 2)
    .refine(text => codePointLength(text) <= max, { message: 'too long' })

/**
 * The words selected in the page when a pick was made (spec 024 024-FR-004):
 * `anchor.sel`'s caps, as `file-comment:*` carries them. Page text, never
 * trusted: main looks the words up in its own parse of the file and keeps
 * them only when they are there (`commentWordsCore.ts`).
 */
export const CommentPickSelSchema = z
  .object({
    exact: codePoints(1, SEL_EXACT_MAX_CHARS),
    prefix: codePoints(0, SEL_CONTEXT_MAX_CHARS),
    suffix: codePoints(0, SEL_CONTEXT_MAX_CHARS)
  })
  .strict()
export type CommentPickSel = z.infer<typeof CommentPickSelSchema>

/** `preview-page:commentPick` (§8, §19 R3-5, R3-8). */
export const CommentPickSchema = z
  .object({
    /**
     * `step`: the keyboard picker moved – nothing is picked; the window's live region says it (§10.8).
     * `context`: the reader's right-click outside comment mode that the page did not cancel (OD-01) – a menu, never a write.
     */
    kind: z.enum(['menu', 'open', 'icon', 'parent', 'exit', 'step', 'context']),
    via: z.enum(['pointer', 'keyboard']),
    /** The element's token, or its nearest tokened ancestor's. */
    token: z.string().regex(ELEMENT_TOKEN_PATTERN).optional(),
    /** The tokened element's `localName`; must equal the tag main recorded for the token. */
    tag: CommentTagNameSchema.optional(),
    /** A pin's key (`icon`). */
    key: CommentKeySchema.optional(),
    /** A stack pin's click (C-17): the keys of the other pins merged into it, in document order. */
    stack: z.array(CommentKeySchema).min(1).max(COMMENT_PICK_STACK_MAX).optional(),
    /** A pointer pick: the trusted event's `screenX/Y`. */
    screen: CommentPointSchema.optional(),
    /** A keyboard pick: the element's top-left + 4 px, frame CSS pixels. */
    point: CommentPointSchema.optional(),
    /** The selected element's border box, frame CSS pixels: where the fresh still's ring is checked. */
    box: CommentBoxSchema.optional(),
    ws: z.enum(['collapse', 'preserve']).optional(),
    runtime: CommentPickRuntimeSchema.optional(),
    /** A `step`: what the picker reached; `showing` names it by `token` – main words it, never the page (S-L-A). */
    say: CommentPickerSaySchema.optional(),
    /** A `showing` step: the element reached lies below the tokened one (a script built it). */
    added: z.literal(true).optional(),
    /** A `menu`, `open` or `context` pick made on a text selection: the words, cut to their first 200 code points. */
    sel: CommentPickSelSchema.optional(),
    /** The selection was longer than 200 code points and `sel.exact` is its start. */
    long: z.literal(true).optional(),
    /** The selection ran past the target and was cut to the element it started in (024-FR-004). */
    crossed: z.literal(true).optional(),
    view: CommentPickViewSchema
  })
  .strict()
  .refine(pick => pick.sel === undefined || (['menu', 'open', 'context'].includes(pick.kind) && pick.token !== undefined), {
    message: 'only a menu, open or context pick on a tokened element carries words'
  })
  .refine(pick => pick.sel !== undefined || (pick.long === undefined && pick.crossed === undefined), {
    message: 'only words are long or crossed'
  })
  .refine(pick => pick.kind !== 'icon' || pick.key !== undefined, { message: 'a pin pick names its key' })
  .refine(pick => pick.stack === undefined || pick.kind === 'icon', { message: 'only a pin pick names a stack' })
  .refine(pick => (pick.kind === 'step') === (pick.say !== undefined), { message: 'only a step says, and it says something' })
  .refine(pick => pick.kind !== 'step' || (pick.say === 'showing') === (pick.token !== undefined), {
    message: 'a showing step names its element by token, and only it does'
  })
  .refine(pick => pick.added === undefined || pick.say === 'showing', { message: 'only a showing step reaches an added element' })
  .refine(pick => pick.runtime === undefined || pick.token !== undefined, { message: 'a runtime element is described below a tokened ancestor' })
export type CommentPick = z.infer<typeof CommentPickSchema>

/** Why a frame's overlay gave up (the preload's `anchors.ts`). */
export const CommentOverlayLossSchema = z.enum(['document-replaced', 'overlay-removed'])
export type CommentOverlayLoss = z.infer<typeof CommentOverlayLossSchema>

/** `preview-page:commentAnchors`: which pins' elements are rendered now; overlay loss. */
export const CommentAnchorsSchema = z
  .object({
    visible: z.array(CommentKeySchema).max(COMMENT_ANCHOR_KEYS_MAX),
    hidden: z.array(CommentKeySchema).max(COMMENT_ANCHOR_KEYS_MAX),
    overlay: z.literal('unavailable').optional(),
    reason: CommentOverlayLossSchema.optional()
  })
  .strict()
export type CommentAnchors = z.infer<typeof CommentAnchorsSchema>
