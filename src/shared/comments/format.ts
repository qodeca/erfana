// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The v1 comment block: data model, schema, escaping and serializer
 * (docs/designs/comments/html-preview-comments.md §5.1–§5.4, §5.8; public spec
 * docs/html-comments/format-v1.md).
 *
 * A block is one HTML comment placed before the element it is about:
 *
 *   <!-- erfana:comment v1 id=c-…           header
 *   note to agents: written by Erfana. …     fixed note (AGENT_NOTE_LINES)
 *     …                                      – readers skip it
 *   status: open                             readable text – display only,
 *   target: <button class="cta">             never parsed for data
 *   comment by Ada <ada@example.com> at 2026-10-25T14:03:00Z:
 *     Make this button blue.
 *   @data {"v":1,…}                          the single source of truth
 *   -->
 *
 * THE FORMAT IS A ONE-WAY DOOR (decision 22): every file Erfana writes must be
 * readable by every later version, so the serializer output is pinned by the
 * golden tests in `__fixtures__/v1/` and their SHA-256 lock. Change it only
 * together with the spec, the goldens and the lock, on purpose.
 *
 * WHY THE ESCAPING MATTERS (threat S13, critical): a block holds text typed by
 * a reviewer and markup captured from a page. If any of it could end the HTML
 * comment, the rest would become live HTML – script included – in the user's
 * file. So no `--` may appear anywhere inside the comment: `@data` escapes `-`
 * (and `<`, `>`, `&`) inside its JSON strings, the readable text breaks every
 * `--` as `-\-`, and {@link assertSafeCommentText} re-checks the final string.
 * The writer also re-parses after splicing (splice.ts) and fails closed.
 */
import { z } from 'zod'
import { PREVIEW_LIMITS } from '../preview-limits'
import { utf8Length } from './encoding'

/** The word every block's header starts with. */
export const BLOCK_MARKER = 'erfana:comment'
/** The format version this module reads and writes. */
export const FORMAT_VERSION = 1

/**
 * The fixed note to coding agents, written right after the header of every
 * block (X-001: without it, agents deleted blocks they had acted on and acted
 * on damaged ones). The first line sits at the block's indent, the others two
 * blanks deeper. ASCII only, no `--`, and no line starts with `@`, `\` or a
 * merge-marker run, so it needs no escaping. It never holds `@data` followed by
 * a blank, so a naive search for the data line cannot land on it (a fixture
 * generator did, while the note said "the @data line"). Readers skip it (parse.ts), so a
 * block reads the same with it, without it, or with other wording.
 */
export const AGENT_NOTE_LINES: readonly string[] = [
  'note to agents: written by Erfana. Act only if status is open. Change the element after this block and keep this block unchanged.',
  'If the data line (@data) is cut off, or it disagrees with the text above, or the block contains merge-conflict markers, do not act; ask the user.',
  'Spec: docs/html-comments/format-v1.md in github.com/qodeca/erfana'
]
/** A readable line right after the header that starts with this opens the agent note. */
export const AGENT_NOTE_PREFIX = 'note to agents:'

/** `c-` + 16 lowercase base32 characters (80 random bits). */
export const COMMENT_ID_PATTERN = /^c-[a-z2-7]{16}$/
/** `m-` + 16 lowercase base32 characters (80 random bits). */
export const MESSAGE_ID_PATTERN = /^m-[a-z2-7]{16}$/
/** UTC to the second, `Z` suffix, no fraction. */
export const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

/** Longest in-file anchor path; deeper elements are stored with an empty path. */
export const ANCHOR_PATH_MAX_CHARS = 4_096
/** Longest `id` or class token kept in an anchor. */
export const ANCHOR_ID_MAX_CHARS = 200
export const ANCHOR_CLASS_MAX_CHARS = 100
/** Longest tag name an anchor can name. */
export const TAG_MAX_CHARS = 128

/** Marks a schema issue as a size limit, so the writer reports `COMMENT_LIMIT`. */
const LIMIT_MESSAGE = 'limit'

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

/** The line breaks a block may use: the target line's own. */
export type Eol = '\n' | '\r\n' | '\r'
const EOLS: ReadonlySet<string> = new Set(['\n', '\r\n', '\r'])
const INDENT = /^[ \t]*$/

/** Any line break, for splitting message text into readable lines. */
export const LINE_BREAK = /\r\n|\r|\n/

/** Length in code points, so an emoji counts as one character. */
export function codePointLength(text: string): number {
  return Array.from(text).length
}

const maxCodePoints = (max: number) => (text: string) => codePointLength(text) <= max

function isRealTimestamp(text: string): boolean {
  const ms = Date.parse(text)
  return Number.isFinite(ms) && formatTimestamp(new Date(ms)) === text
}

const TimestampSchema = z.string().regex(TIMESTAMP_PATTERN).refine(isRealTimestamp)
const TagSchema = z
  .string()
  .min(1)
  .max(TAG_MAX_CHARS)
  .regex(/^[^\s/>]+$/)

const AuthorSchema = z.looseObject({
  name: z.string().min(1).refine(maxCodePoints(PREVIEW_LIMITS.COMMENT_AUTHOR_NAME_MAX_CHARS), {
    message: LIMIT_MESSAGE
  }),
  email: z.string().min(1).max(PREVIEW_LIMITS.COMMENT_AUTHOR_EMAIL_MAX_CHARS).optional(),
  /** `agent` is reserved for later versions (decision 10); v1 writes `human`. */
  role: z.enum(['human', 'agent'])
})

const quotePart = z.string().max(PREVIEW_LIMITS.COMMENT_QUOTE_MAX_CHARS)
const TextQuoteSchema = z.looseObject({
  exact: quotePart.min(1),
  prefix: quotePart,
  suffix: quotePart
})

const RuntimeAnchorSchema = z.looseObject({
  path: z.string().max(PREVIEW_LIMITS.COMMENT_RUNTIME_PATH_MAX_CHARS),
  tag: TagSchema,
  quote: TextQuoteSchema.optional(),
  snapshot: z
    .string()
    .refine(s => utf8Length(s) <= PREVIEW_LIMITS.COMMENT_SNAPSHOT_MAX_BYTES, {
      message: LIMIT_MESSAGE
    })
    .optional(),
  truncated: z.literal(true).optional(),
  snapshotSource: z.literal('page')
})

const AnchorSchema = z.looseObject({
  tag: TagSchema,
  id: z.string().min(1).max(ANCHOR_ID_MAX_CHARS).optional(),
  cls: z
    .array(z.string().min(1).max(ANCHOR_CLASS_MAX_CHARS).regex(/^\S+$/))
    .max(PREVIEW_LIMITS.COMMENT_MAX_CLASSES)
    .optional(),
  path: z.string().max(ANCHOR_PATH_MAX_CHARS),
  quote: TextQuoteSchema.optional(),
  runtime: RuntimeAnchorSchema.optional()
})

const MAX_VIEW_PX = 1_000_000
const coordinate = z.number().min(-MAX_VIEW_PX).max(MAX_VIEW_PX)
const ViewSchema = z.looseObject({
  w: z.number().int().min(0).max(MAX_VIEW_PX),
  h: z.number().int().min(0).max(MAX_VIEW_PX),
  dpr: z.number().positive().max(16),
  x: coordinate,
  y: coordinate,
  hash: z.string().max(PREVIEW_LIMITS.COMMENT_VIEW_HASH_MAX_CHARS).optional()
})

const MessageSchema = z.looseObject({
  id: z.string().regex(MESSAGE_ID_PATTERN),
  by: AuthorSchema,
  at: TimestampSchema,
  text: z.string().min(1).refine(maxCodePoints(PREVIEW_LIMITS.COMMENT_MESSAGE_MAX_CHARS), {
    message: LIMIT_MESSAGE
  }),
  edited: TimestampSchema.optional()
})

/**
 * The `@data` object (§5.3). Every object is loose: fields a later version
 * adds are kept through an edit (decision 22, U-016), never dropped.
 */
export const CommentDataSchema = z
  .looseObject({
    v: z.literal(FORMAT_VERSION),
    id: z.string().regex(COMMENT_ID_PATTERN),
    status: z.enum(['open', 'resolved']),
    resolved: z.looseObject({ by: AuthorSchema, at: TimestampSchema }).optional(),
    anchor: AnchorSchema,
    view: ViewSchema,
    msgs: z
      .array(MessageSchema)
      .min(1)
      .max(PREVIEW_LIMITS.COMMENT_MAX_REPLIES + 1)
  })
  .superRefine((data, ctx) => {
    if ((data.status === 'resolved') !== (data.resolved !== undefined)) {
      ctx.addIssue({ code: 'custom', message: '`resolved` must be present exactly when resolved' })
    }
    if (new Set(data.msgs.map(m => m.id)).size !== data.msgs.length) {
      ctx.addIssue({ code: 'custom', message: 'message ids must be unique' })
    }
  })

export type CommentData = z.infer<typeof CommentDataSchema>
export type CommentAuthor = z.infer<typeof AuthorSchema>
export type CommentAnchor = z.infer<typeof AnchorSchema>
export type RuntimeAnchor = z.infer<typeof RuntimeAnchorSchema>
export type TextQuote = z.infer<typeof TextQuoteSchema>
export type CommentView = z.infer<typeof ViewSchema>
export type CommentMessage = z.infer<typeof MessageSchema>

/** True when a schema issue is a size limit rather than a malformed value. */
export function isLimitIssue(issue: { code: string; message: string }): boolean {
  return issue.code === 'too_big' || issue.message === LIMIT_MESSAGE
}

// ---------------------------------------------------------------------------
// Ids and time
// ---------------------------------------------------------------------------

/** A source of cryptographically random bytes (injectable for tests). */
export type RandomBytes = (length: number) => Uint8Array

/** `crypto.getRandomValues`, available in Node, Electron main and every renderer. */
export const cryptoRandomBytes: RandomBytes = length =>
  globalThis.crypto.getRandomValues(new Uint8Array(length))

/** `length` lowercase base32 characters; one random byte each, so unbiased (256 = 8 × 32). */
export function randomBase32(length: number, random: RandomBytes = cryptoRandomBytes): string {
  let out = ''
  for (const byte of random(length)) out += BASE32_ALPHABET[byte & 31]
  return out
}

/** A new thread id, `c-` + 16 base32 characters. */
export function mintCommentId(random?: RandomBytes): string {
  return `c-${randomBase32(16, random)}`
}

/** A new message id, `m-` + 16 base32 characters. */
export function mintMessageId(random?: RandomBytes): string {
  return `m-${randomBase32(16, random)}`
}

/** UTC to the second: `2026-10-25T14:03:00Z`. Independent of the host time zone. */
export function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// ---------------------------------------------------------------------------
// Escaping (§5.4)
// ---------------------------------------------------------------------------

/** A JSON string literal as `JSON.stringify` writes it. Linear: the two alternatives start differently. */
const JSON_STRING_LITERAL = /"(?:[^"\\]|\\[^])*"/g

/** `\uXXXX` regex escape of one UTF-16 code unit, built from its number. */
function unitEscape(code: number): string {
  return `\\u${code.toString(16).padStart(4, '0')}`
}

/** A regex character-class range between two code units. */
function unitRange(from: number, to: number): string {
  return `${unitEscape(from)}-${unitEscape(to)}`
}

/**
 * The joiners ordinary text needs, kept raw although they are format or
 * default-ignorable characters: ZWNJ and ZWJ (Persian and Indic shaping, emoji
 * sequences) and the text and emoji presentation selectors VS15 and VS16.
 */
const TEXT_JOINERS = `[${unitRange(0x200c, 0x200d)}${unitRange(0xfe0e, 0xfe0f)}]`

/**
 * Characters invisible to a reader, or able to reorder or hide what they see,
 * by Unicode property (a `u`-flag pattern): format characters (Cf – the
 * Arabic letter mark, zero-width space, LRM and RLM, the bidi embeddings,
 * overrides and isolates, the BOM, the tag characters U+E0000–E007F), private
 * use (Co), the line and paragraph separators, and every default-ignorable
 * code point (the word joiner, variation selectors, Hangul fillers) – minus
 * {@link TEXT_JOINERS}. Unassigned code points are deliberately NOT in it:
 * which ones are unassigned changes with the Unicode version, and a newer
 * Erfana must render the readable text of a block exactly as an older one
 * did, or the block would read as `readable-mismatch`. Written as escapes and
 * numbers, so this source file holds no invisible character itself.
 */
const INVISIBLE = `(?!${TEXT_JOINERS})[\\p{Cf}\\p{Co}\\p{Zl}\\p{Zp}\\p{Default_Ignorable_Code_Point}]`

/**
 * Characters escaped inside `@data` strings. `JSON.stringify` already escapes
 * C0 controls and lone surrogates; these are the rest that could end the
 * comment (`<`, `>`, `-`), confuse an HTML-aware reader (`&`), break a
 * JavaScript reader (U+2028/2029) or hide text from a human (C1 and the
 * invisible characters above).
 */
const JSON_ESCAPED = new RegExp(`[<>&\\-${unitRange(0x7f, 0x9f)}]|${INVISIBLE}`, 'gu')

/**
 * Characters the readable text shows as `\uXXXX`: C0 and C1 controls (tab
 * kept), lone surrogates (which UTF-8 cannot store; under the `u` flag `Cs`
 * matches only an unpaired one) and the invisible characters above.
 */
const READABLE_ESCAPED = new RegExp(
  `[${unitRange(0x00, 0x08)}${unitEscape(0x0b)}${unitEscape(0x0c)}${unitRange(0x0e, 0x1f)}` +
    `${unitRange(0x7f, 0x9f)}\\p{Cs}]|${INVISIBLE}`,
  'gu'
)

/** Inline contexts (names, tag summaries) also escape tab and line breaks. */
const INLINE_BREAKS = /[\t\n\r]/g

/** A readable line whose first non-blank characters would look like data or a merge marker. */
const LEAD_NEEDS_ESCAPE = /^(?:@|\\|<{7}|={7}|>{7}|\|{7})/

/** `\uXXXX` for every UTF-16 code unit of `ch` – two for a character past U+FFFF, such as a tag character. */
function unicodeEscape(ch: string): string {
  let escaped = ''
  for (let i = 0; i < ch.length; i++) escaped += unitEscape(ch.charCodeAt(i))
  return escaped
}

/** `--` → `-\-`, repeatedly, so no two dashes ever touch. */
function breakDashes(text: string): string {
  return text.replace(/-(?=-)/g, '-\\')
}

/** Escape the JSON text of `@data` so it can sit inside an HTML comment; `JSON.parse` reverses it. */
export function escapeJsonForComment(json: string): string {
  return json.replace(JSON_STRING_LITERAL, literal => literal.replace(JSON_ESCAPED, unicodeEscape))
}

/** Escape a value shown inside one readable line (an author, a tag summary). */
export function escapeReadableInline(text: string): string {
  return breakDashes(visibleInline(text))
}

/**
 * A value from a file, made safe to show on one line with nothing hidden: the
 * characters the readable part escapes – controls, lone surrogates, bidi
 * marks, overrides and isolates, every other invisible character – and line
 * breaks become a visible `\uXXXX`. Unlike {@link escapeReadableInline} it
 * leaves dashes alone: it is for the screen, not for the file.
 */
export function visibleInline(text: string): string {
  return text.replace(READABLE_ESCAPED, unicodeEscape).replace(INLINE_BREAKS, unicodeEscape)
}

/**
 * Escape one line of message text for the readable part. Besides the
 * character escapes and `-\-`, a line whose first non-blank characters are
 * `@`, `\` or a merge-marker run gets a `\` in front of them, so it can never
 * be taken for the `@data` line or a conflict marker.
 */
export function escapeReadableLine(line: string): string {
  const escaped = breakDashes(line.replace(READABLE_ESCAPED, unicodeEscape))
  const lead = /^[ \t]*/.exec(escaped)![0]
  const rest = escaped.slice(lead.length)
  return LEAD_NEEDS_ESCAPE.test(rest) ? `${lead}\\${rest}` : escaped
}

/**
 * Whether `block` is exactly one HTML comment that cannot end early or open a
 * new one: `<!--`, then text with no `--` that does not start with `>` or `->`
 * and does not end with `-`, then `-->`.
 */
export function isSafeCommentText(block: string): boolean {
  const inner = block.slice(4, -3)
  return (
    block.length >= 7 &&
    block.startsWith('<!--') &&
    block.endsWith('-->') &&
    !inner.includes('--') &&
    !inner.startsWith('>') &&
    !inner.startsWith('->') &&
    !inner.endsWith('-')
  )
}

/**
 * Throws when `block` could end its comment early or open a new one. It is a
 * last line of defence behind the escaping above, so it should never fire.
 */
export function assertSafeCommentText(block: string): void {
  if (!isSafeCommentText(block)) throw new Error('htmlComments: serialized block could end its HTML comment early')
}

// ---------------------------------------------------------------------------
// Readable text and the serializer
// ---------------------------------------------------------------------------

function who(author: CommentAuthor): string {
  const name = escapeReadableInline(author.name)
  return author.email ? `${name} <${escapeReadableInline(author.email)}>` : name
}

function tagSummary(anchor: CommentAnchor): string {
  const id = anchor.id ? ` id="${escapeReadableInline(anchor.id)}"` : ''
  const cls = anchor.cls?.length ? ` class="${escapeReadableInline(anchor.cls.join(' '))}"` : ''
  return `<${escapeReadableInline(anchor.tag)}${id}${cls}>`
}

/**
 * For a target stored below its in-file element (§5.6), name that element too,
 * so a reader can find it without decoding `@data`: a JS-built element (with
 * a snapshot, captured from the page) or an in-file element that cannot hold a
 * block itself (an implied `tbody`, an element inside a framework root).
 */
function targetSuffix(anchor: CommentAnchor): string {
  const runtime = anchor.runtime
  if (!runtime) return ''
  const where = runtime.path ? ` at ${escapeReadableInline(runtime.path)}` : ''
  const element = `<${escapeReadableInline(runtime.tag)}>${where}`
  return runtime.snapshot === undefined
    ? ` (comment is about ${element} inside this element)`
    : ` (built by script: ${element} inside this element; snapshot captured from the page)`
}

/**
 * The readable lines of a block, without indentation: the status, the target
 * and every message. The header and the `@data` line are not included.
 */
export function renderReadableLines(data: CommentData): string[] {
  const lines = [
    data.resolved
      ? `status: resolved by ${who(data.resolved.by)} at ${data.resolved.at}`
      : 'status: open',
    `target: ${tagSummary(data.anchor)}${targetSuffix(data.anchor)}`
  ]
  data.msgs.forEach((msg, i) => {
    lines.push(`${i === 0 ? 'comment' : 'reply'} by ${who(msg.by)} at ${msg.at}:`)
    for (const line of msg.text.split(LINE_BREAK)) lines.push(`  ${escapeReadableLine(line)}`)
  })
  return lines
}

/** Indentation and line break of a block: those of the target's line (§5.2). */
export interface BlockLayout {
  readonly indent: string
  readonly eol: Eol
}

/** The readable part of a block as it appears in the file. */
export function renderReadable(data: CommentData, layout: BlockLayout): string {
  return renderReadableLines(data)
    .map(line => layout.indent + line)
    .join(layout.eol)
}

/** The agent note as it appears in a block with this layout. */
export function renderAgentNote(layout: BlockLayout): string {
  return AGENT_NOTE_LINES.map((line, i) => `${layout.indent}${i === 0 ? '' : '  '}${line}`).join(
    layout.eol
  )
}

/** Why a block could not be serialized. */
export type SerializeFailure = 'limit' | 'invalid'

export type SerializeResult =
  | { readonly ok: true; readonly block: string }
  | { readonly ok: false; readonly reason: SerializeFailure }

/**
 * Serialize one block, from `<!--` to `-->`, with no surrounding whitespace.
 *
 * Refuses (never throws for bad input) when the data fails the schema
 * (`invalid`, or `limit` for a size limit) or the block would exceed
 * `COMMENT_BLOCK_MAX_BYTES` (`limit`). Every block it returns therefore parses
 * back as `ok` with equal data (property P-007).
 */
export function serializeBlock(data: CommentData, layout: BlockLayout): SerializeResult {
  if (!INDENT.test(layout.indent) || !EOLS.has(layout.eol)) return { ok: false, reason: 'invalid' }
  const parsed = CommentDataSchema.safeParse(data)
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues.some(isLimitIssue) ? 'limit' : 'invalid' }
  }
  let json: string
  try {
    json = JSON.stringify(data)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  const { indent, eol } = layout
  const block = [
    `<!-- ${BLOCK_MARKER} v${FORMAT_VERSION} id=${data.id}`,
    renderAgentNote(layout),
    renderReadable(data, layout),
    `${indent}@data ${escapeJsonForComment(json)}`,
    `${indent}-->`
  ].join(eol)
  assertSafeCommentText(block)
  if (utf8Length(block) > PREVIEW_LIMITS.COMMENT_BLOCK_MAX_BYTES)
    return { ok: false, reason: 'limit' }
  return { ok: true, block }
}
