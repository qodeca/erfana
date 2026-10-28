// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – pure text helpers for Erfana's comment chrome
 * (docs/designs/html-preview-comments.md §10.2, §10.4, §10.10; R-016, R-017).
 *
 * Everything here is a pure function of its arguments – the clock and the
 * locale are parameters – so the window, the drawer and their tests format
 * text the same way.
 *
 * NOTE: the control-character sets are built from code-point NUMBERS, never
 * from `\u` escapes in a regex literal: an editor or a tool that "helpfully"
 * turns an escape into the raw character would hide the very characters this
 * module exists to make visible (threat S18).
 *
 * @module HtmlPreviewPanel/comments/commentFormat
 */

/** Characters in one message (main counts code points, `PREVIEW_LIMITS.COMMENT_MESSAGE_MAX_CHARS`). */
export const COMMENT_MAX_CHARS = 4_000
/** The counter starts warning here (§3 "Message length"). */
export const COMMENT_WARN_CHARS = 3_600
/** Characters an element label may take before it is cut with `…` (§10.2). */
export const LABEL_MAX_CHARS = 40
/** Classes a label shows before `…` (§10.2). */
export const LABEL_MAX_CLASSES = 2

/**
 * Invisible characters that reorder or hide text: zero-width spaces and
 * joiners, the bidi marks, embeddings, overrides and isolates, the Arabic
 * letter mark and the BOM. Inclusive code-point ranges.
 */
const INVISIBLE_CONTROL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x061c, 0x061c],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff]
]

/**
 * Whether a code point is an invisible bidi or zero-width control (threat S18).
 *
 * @param codePoint - One Unicode code point.
 * @returns `true` for the characters {@link splitVisibleControls} draws as tokens.
 */
export function isInvisibleControl(codePoint: number): boolean {
  return INVISIBLE_CONTROL_RANGES.some(([from, to]) => codePoint >= from && codePoint <= to)
}

/**
 * Whether a code point is a C0/C1 control other than tab and the line breaks.
 *
 * @param codePoint - One Unicode code point.
 * @returns `true` for NUL, the other C0 controls, DEL and the C1 range.
 */
export function isStrippedControl(codePoint: number): boolean {
  if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) return false
  return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)
}

/**
 * Whether text holds a character a name or an email may not carry: any
 * control (tabs and line breaks included) or an invisible bidi control
 * (SEC-18; main refuses the same on write).
 *
 * @param text - The value to check.
 * @returns `true` when the value must be refused.
 */
export function hasForbiddenIdentityCharacter(text: string): boolean {
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || isInvisibleControl(cp)) return true
  }
  return false
}

/**
 * A message as it is sent to main: NUL and the other controls stripped (tab
 * and line breaks kept), CRLF and CR folded to LF, and the ends trimmed
 * (§10.4 "trimmed; NUL/control characters stripped"). Bidi controls are KEPT –
 * they are the author's text; main escapes them in the file and the reader
 * sees them as tokens.
 *
 * @param text - What the reviewer typed.
 * @returns The text to save.
 *
 * @example
 * ```ts
 * sanitizeMessage('  Fix\r\nthis\u0000  ') // 'Fix\nthis'
 * ```
 */
export function sanitizeMessage(text: string): string {
  let out = ''
  for (const char of text.replace(/\r\n?/g, '\n')) {
    if (!isStrippedControl(char.codePointAt(0) ?? 0)) out += char
  }
  return out.trim()
}

/**
 * Characters as main counts them: code points, so an emoji counts once.
 *
 * @param text - Any text.
 * @returns Its length in code points.
 */
export function countCharacters(text: string): number {
  return Array.from(text).length
}

/** Where the counter is: under the warning line, in it, or over the limit. */
export type CounterState = 'ok' | 'near' | 'over'

/**
 * The counter's state for `count` characters (§3: counter from 3,600).
 *
 * @param count - Characters typed.
 * @returns `'over'` past 4,000, `'near'` from 3,600, else `'ok'`.
 */
export function counterState(count: number): CounterState {
  if (count > COMMENT_MAX_CHARS) return 'over'
  if (count >= COMMENT_WARN_CHARS) return 'near'
  return 'ok'
}

/** One run of a message as it is drawn: text, or a visible token for a control. */
export type TextSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'control'; readonly code: string }

/**
 * Splits text into plain runs and visible tokens for each invisible control
 * (R-017, threat S18), so `Rename to invoice<RLO>fdp.exe` cannot silently read as
 * `exe.pdf`.
 *
 * @param text - A message or a name, as stored.
 * @returns Segments in order; a control becomes `{ kind: 'control', code: 'U+202E' }`.
 *
 * @example
 * ```ts
 * splitVisibleControls('a' + String.fromCodePoint(0x202e) + 'b')
 * // [{kind:'text',text:'a'}, {kind:'control',code:'U+202E'}, {kind:'text',text:'b'}]
 * ```
 */
export function splitVisibleControls(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let run = ''
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0
    if (!isInvisibleControl(cp)) {
      run += char
      continue
    }
    if (run !== '') segments.push({ kind: 'text', text: run })
    run = ''
    segments.push({ kind: 'control', code: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` })
  }
  if (run !== '') segments.push({ kind: 'text', text: run })
  return segments
}

/**
 * Untrusted text for an ATTRIBUTE value (`title`, `aria-label`), with every
 * invisible control spelled as the same `⟨U+202E⟩` token `VisibleText` draws
 * (R-017, SEC-19). An attribute cannot hold a token span, and a raw override
 * there would reorder the tooltip or the spoken name.
 *
 * @param text - A name, an email or a label, as stored.
 * @returns The text with each control replaced by its visible token.
 *
 * @example
 * ```ts
 * visibleString('a' + String.fromCodePoint(0x202e) + 'b') // 'a⟨U+202E⟩b'
 * ```
 */
export function visibleString(text: string): string {
  return splitVisibleControls(text)
    .map(segment => (segment.kind === 'text' ? segment.text : `⟨${segment.code}⟩`))
    .join('')
}

/** What an element label is built from: the shape main sends for threads and drafts. */
export interface LabelSource {
  readonly tag: string
  readonly elementId?: string
  readonly classes?: readonly string[]
}

/**
 * The element label of §10.2: `button#buy.cta.primary`, at most two classes
 * then `…`, at most 40 characters.
 *
 * @param source - Tag, id and classes.
 * @returns The label, e.g. `'section#pricing'`.
 */
export function elementLabel(source: LabelSource): string {
  const tag = source.tag.toLowerCase()
  const classes = source.classes ?? []
  let rest = source.elementId ? `#${source.elementId}` : ''
  rest += classes
    .slice(0, LABEL_MAX_CLASSES)
    .map(c => `.${c}`)
    .join('')
  if (classes.length > LABEL_MAX_CLASSES) rest += '…'
  const label = tag + rest
  if (countCharacters(label) <= LABEL_MAX_CHARS) return label
  return `${[...label].slice(0, LABEL_MAX_CHARS - 1).join('')}…`
}

/**
 * The in-file ancestor a script-built element's comment is saved before, as
 * §10.10 writes it: `<section id="pricing">`.
 *
 * @param source - The in-file element.
 * @returns The start tag as the reader sees it.
 */
export function ancestorTag(source: LabelSource): string {
  const tag = source.tag.toLowerCase()
  if (source.elementId) return `<${tag} id="${source.elementId}">`
  const classes = source.classes ?? []
  if (classes.length > 0) return `<${tag} class="${classes.slice(0, LABEL_MAX_CLASSES).join(' ')}">`
  return `<${tag}>`
}

/**
 * English singular / plural for a counted noun.
 *
 * @param count - How many.
 * @param one - The singular, e.g. `'reply'`.
 * @param many - The plural, e.g. `'replies'`.
 * @returns `'1 reply'`, `'0 replies'`, `'2 replies'`.
 */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** Midnight of the local calendar day `date` falls on, as a timestamp. */
function localDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * Absolute local time of a comment (§10.4, R-016): "Today, 14:32",
 * "Yesterday, 09:10", "25 Oct, 14:32", and the year when it is not this
 * year. Never relative ("5 minutes ago"), so it never counts up.
 *
 * @param at - The stored UTC timestamp (ISO 8601) or a `Date`.
 * @param now - The clock – injected so tests and cards are stable.
 * @param locale - BCP 47 locale for `Intl.DateTimeFormat`; the runtime's by default.
 * @returns The printed time; the input unchanged when it is not a valid date.
 *
 * @example
 * ```ts
 * formatCommentTime('2026-10-26T13:32:00Z', new Date(2026, 9, 26, 15), 'en-GB') // 'Today, 14:32' in UTC+1
 * ```
 */
export function formatCommentTime(at: string | Date, now: Date, locale?: string): string {
  const date = typeof at === 'string' ? new Date(at) : at
  if (Number.isNaN(date.getTime())) return typeof at === 'string' ? at : ''
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)
  // Calendar days, not 24-hour spans: 23:50 yesterday is "Yesterday" at 00:10.
  // Rounded, because a day across a DST change is 23 or 25 hours long.
  const days = Math.round((localDay(now) - localDay(date)) / 86_400_000)
  if (days === 0) return `Today, ${time}`
  if (days === 1) return `Yesterday, ${time}`
  const sameYear = date.getFullYear() === now.getFullYear()
  const day = new Intl.DateTimeFormat(
    locale,
    sameYear
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' }
  ).format(date)
  return `${day}, ${time}`
}
