// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The comment state main sends a frame on `preview-page:commentState`
 * (docs/designs/comments/html-preview-comments.md §8, §10.9, §19 R3-3, R3-4, Rev 4
 * "folded sections").
 *
 * Main is trusted, but the payload is still parsed field by field: anything
 * malformed is dropped rather than drawn, a colour or length that would not
 * be a plain CSS value falls back to its default, and the whole message is
 * ignored when it is not an object with a boolean `mode`. No comment text and
 * no email ever arrives here (§4.1 B1'): pins carry a key, a token and a count.
 */
import {
  MAX_ICONS,
  OPEN_SECTIONS_MAX,
  PICK_TAG_MAX_CHARS,
  PIN_KEY_MAX_CHARS,
  PIN_WORDS_MAX,
  SEL_CONTEXT_MAX_CHARS,
  SEL_EXACT_MAX_CHARS,
  RUNTIME_PATH_MAX_CHARS,
  SECTIONS_SCANNED_MAX,
  TOKEN_PATTERN
} from './constants'

/** The overlay's colours, sizes, spaces and line height, resolved from Erfana's design tokens (§10.9). */
export interface OverlayTheme {
  readonly accent: string
  readonly accentHover: string
  readonly ink: string
  readonly paper: string
  readonly muted: string
  readonly warning: string
  readonly font: string
  readonly size: string
  readonly ring: string
  readonly pinTarget: string
  readonly hairline: string
  readonly space1: string
  readonly space2: string
  readonly space4: string
  readonly leading: string
}

/**
 * The values main resolves from `design-tokens.css`, used until it sends its
 * own. They are literals because the page cannot read Erfana's stylesheet;
 * `state.test.ts` pins each one to the token it mirrors (§10.9), so a token
 * change fails a test instead of drifting.
 */
export const DEFAULT_THEME: OverlayTheme = Object.freeze({
  accent: '#A0A8FF', // --color-accent-primary (--color-brand-violet)
  accentHover: '#8b94ff', // --color-brand-violet-hover
  ink: '#161312', // --color-brand-black
  paper: '#F8FAF8', // --color-brand-white
  muted: '#cccccc', // --color-text-primary (--color-gray-300)
  warning: '#cca700', // --color-warning
  font: "'Cascadia Mono', 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace", // --font-mono
  size: '11px', // --text-sm
  ring: '2px', // --border-width-thick
  pinTarget: '24px', // --btn-height-sm
  hairline: '1px', // --border-width
  space1: '2px', // --space-1
  space2: '4px', // --space-2
  space4: '8px', // --space-4
  leading: '1.375' // --leading-snug
})

/** A JS-built pin target below its tokened ancestor. */
export interface IconRuntime {
  readonly path: string
  readonly tag: string
}

/** One pin: the element is found by `token` (and `runtime`); text never arrives. */
export interface IconState {
  readonly key: string
  readonly token: string
  readonly runtime?: IconRuntime
  /** Open threads on the element; a damaged block counts as one. */
  readonly count: number
  readonly status: 'open' | 'damaged'
  /** The words its open threads are about (spec 024 C-12): page text, which the overlay marks. */
  readonly words?: readonly IconWords[]
  /** C-06: one of its threads' targets changed – the pin is notched. */
  readonly changed?: true
}

/** Marked words: `anchor.sel`'s shape. */
export interface IconWords {
  readonly exact: string
  readonly prefix: string
  readonly suffix: string
}

/** One child frame, in `WebFrameMain.frames` order (§19 R3-4). */
export interface ChildFrameState {
  readonly key: string
  readonly commentable: boolean
}

/** The parsed state of one frame. */
export interface CommentState {
  readonly mode: boolean
  /** False for `srcdoc`, error pages and anything main cannot map: mode only. */
  readonly commentable: boolean
  readonly showIcons: boolean
  readonly icons: readonly IconState[]
  readonly reveal?: string
  readonly restore?: { readonly x: number; readonly y: number }
  /** After a save reload: the `<details>` to open again, by place among the page's `<details>` (§19 Rev 4). */
  readonly openSections?: readonly number[]
  readonly theme: OverlayTheme
  /** Absent: main has not told this frame its children (every iframe is shielded). */
  readonly childFrames?: readonly ChildFrameState[]
  /** Move the keyboard picker to the `<iframe>` of this child (Alt+↑ out of it). */
  readonly focusFrame?: string
  /** Draw nothing while main prints the page to PDF (§4.2 `PreviewExportController`, M-064). */
  readonly hidden?: true
}

/** The state before main has said anything: no mode, no pins. */
export const IDLE_STATE: CommentState = Object.freeze({
  mode: false,
  commentable: false,
  showIcons: false,
  icons: [],
  theme: DEFAULT_THEME
})

const COLOUR = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[0-9.]+%?(\s*[,\s/]\s*[0-9.]+%?){2,3}\s*\))$/
const FONT = /^[\w\s,'"-]{1,200}$/
const LENGTH = /^\d{1,3}(\.\d{1,3})?px$/
/** A unitless line height. */
const RATIO = /^\d(\.\d{1,3})?$/
const TAG = /^[A-Za-z][A-Za-z0-9:-]*$/
const LARGEST_SCROLL = 10_000_000
const MAX_CHILD_FRAMES = 1_000

const THEME_RULES: Readonly<Record<keyof OverlayTheme, RegExp>> = {
  accent: COLOUR,
  accentHover: COLOUR,
  ink: COLOUR,
  paper: COLOUR,
  muted: COLOUR,
  warning: COLOUR,
  font: FONT,
  size: LENGTH,
  ring: LENGTH,
  pinTarget: LENGTH,
  hairline: LENGTH,
  space1: LENGTH,
  space2: LENGTH,
  space4: LENGTH,
  leading: RATIO
}

type Bag = Readonly<Record<string, unknown>>

function isBag(value: unknown): value is Bag {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A key main minted: a short string, never empty. */
function isKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= PIN_KEY_MAX_CHARS
}

function parseTheme(raw: unknown): OverlayTheme {
  if (!isBag(raw)) return DEFAULT_THEME
  const theme: Record<string, string> = { ...DEFAULT_THEME }
  for (const name of Object.keys(THEME_RULES) as Array<keyof OverlayTheme>) {
    const value = raw[name]
    if (typeof value === 'string' && THEME_RULES[name].test(value)) theme[name] = value
  }
  return theme as unknown as OverlayTheme
}

function parseRuntime(raw: unknown): IconRuntime | undefined | null {
  if (raw === undefined) return undefined
  if (!isBag(raw)) return null
  const { path, tag } = raw
  if (typeof path !== 'string' || path.length > RUNTIME_PATH_MAX_CHARS) return null
  if (typeof tag !== 'string' || tag.length > PICK_TAG_MAX_CHARS || !TAG.test(tag)) return null
  return { path, tag }
}

/** A string of at most `max` UTF-16 units (main caps code points; twice that bounds the units). */
function isText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max * 2
}

/** At most {@link PIN_WORDS_MAX} well-formed words; anything else is left out. */
function parseWords(raw: unknown): IconWords[] {
  if (!Array.isArray(raw)) return []
  const words: IconWords[] = []
  for (const item of raw.slice(0, PIN_WORDS_MAX)) {
    if (!isBag(item)) continue
    const { exact, prefix, suffix } = item
    if (!isText(exact, 1, SEL_EXACT_MAX_CHARS) || !isText(prefix, 0, SEL_CONTEXT_MAX_CHARS) || !isText(suffix, 0, SEL_CONTEXT_MAX_CHARS)) continue
    words.push({ exact, prefix, suffix })
  }
  return words
}

function parseIcon(raw: unknown): IconState | null {
  if (!isBag(raw)) return null
  const { key, token, count, status } = raw
  if (!isKey(key) || typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 1_000_000) return null
  if (status !== 'open' && status !== 'damaged') return null
  const runtime = parseRuntime(raw.runtime)
  if (runtime === null) return null
  const words = parseWords(raw.words)
  const changed = raw.changed === true ? { changed: true as const } : {}
  return { key, token, count, status, ...(runtime ? { runtime } : {}), ...(words.length > 0 ? { words } : {}), ...changed }
}

function parseIcons(raw: unknown): IconState[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const icons: IconState[] = []
  for (const item of raw) {
    const icon = parseIcon(item)
    if (icon === null || seen.has(icon.key)) continue
    seen.add(icon.key)
    icons.push(icon)
    if (icons.length === MAX_ICONS) break
  }
  return icons
}

function parseChildFrames(raw: unknown): ChildFrameState[] | undefined {
  if (!Array.isArray(raw) || raw.length > MAX_CHILD_FRAMES) return undefined
  const frames: ChildFrameState[] = []
  for (const item of raw) {
    if (!isBag(item) || !isKey(item.key) || typeof item.commentable !== 'boolean') return undefined
    frames.push({ key: item.key, commentable: item.commentable })
  }
  return frames
}

function parseRestore(raw: unknown): { x: number; y: number } | undefined {
  if (!isBag(raw)) return undefined
  const { x, y } = raw
  const ok = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= LARGEST_SCROLL
  return ok(x) && ok(y) ? { x, y } : undefined
}

/**
 * At most {@link OPEN_SECTIONS_MAX} places, each a whole number below
 * {@link SECTIONS_SCANNED_MAX}; ascending and once each. Any bad entry drops the
 * whole list – main's read never sends one.
 */
function parseOpenSections(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > OPEN_SECTIONS_MAX) return undefined
  if (!raw.every(place => Number.isInteger(place) && place >= 0 && place < SECTIONS_SCANNED_MAX)) return undefined
  return [...new Set(raw as number[])].sort((a, b) => a - b)
}

/** Parse a `commentState` message; `null` when it is not one. */
export function parseCommentState(raw: unknown): CommentState | null {
  if (!isBag(raw) || typeof raw.mode !== 'boolean') return null
  const theme = parseTheme(raw.theme)
  const hidden = raw.hidden === true ? { hidden: true as const } : {}
  // A page served raw after a save reload still gets its open sections back, like its scroll.
  const openSections = parseOpenSections(raw.openSections)
  const sections = openSections ? { openSections } : {}
  if (raw.commentable !== true) {
    return { mode: raw.mode, commentable: false, showIcons: false, icons: [], theme, ...hidden, ...sections }
  }
  const restore = parseRestore(raw.restore)
  const childFrames = parseChildFrames(raw.childFrames)
  return {
    mode: raw.mode,
    commentable: true,
    showIcons: raw.showIcons !== false,
    icons: parseIcons(raw.icons),
    theme,
    ...(isKey(raw.reveal) ? { reveal: raw.reveal } : {}),
    ...(restore ? { restore } : {}),
    ...sections,
    ...(childFrames ? { childFrames } : {}),
    ...(isKey(raw.focusFrame) ? { focusFrame: raw.focusFrame } : {}),
    ...hidden
  }
}

/** A theme length in CSS pixels (`'24px'` → 24). Only {@link LENGTH} values reach here. */
export function pxOf(length: string): number {
  return Number.parseFloat(length)
}
