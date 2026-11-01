// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The overlay's element label (docs/designs/comments/html-preview-comments.md §10.2,
 * §10.10; test J-001; owner decision 2026-11-01, differences table D-03, D-05):
 * plain words, `Section · “Buy now”`, within 40 characters, plus a suffix –
 * ` · script` for a JS-built element, ` · frame other.html` for a same-project
 * frame, ` · 2 comments`, ` · refused frame` or ` · inline frame` for a frame
 * that is not commentable inside. The code (`button#buy.cta.primary`: at most
 * two classes then `…`) and the size stay apart: the view shows them only while
 * Alt is held, the one hover a label the pointer cannot reach can offer.
 *
 * The page gives no line number here (D-34), so the part's opening words tell
 * nested parts apart. They, like the ids and classes, are page text: only ever
 * set as `textContent`, never parsed as markup, and never sent to main.
 */
import { LABEL_MAX_CHARS, LABEL_MAX_CLASSES } from './constants'
import type { Box } from './geometry'

/** The styled runs of a label: the kind word (accent), the rest (paper), the code and the size (muted). */
export interface LabelParts {
  readonly tag: string
  readonly rest: string
  readonly code: string
  readonly size: string
}

/** What a label says beyond the element's own name. */
export type LabelSuffix =
  | { readonly kind: 'none' }
  | { readonly kind: 'script' }
  | { readonly kind: 'frame'; readonly file: string }
  | { readonly kind: 'refused-frame' }
  | { readonly kind: 'inline-frame' }

/** The HTML Preview's `{kind}` word (`commentCopyWords.ts`, HTML_NOUN), as a label starts it. */
const KIND_WORD = 'Section'
const ELLIPSIS = '…'
/** The quote marks and separator around the opening words: ` · “` and `”`. */
const WORDS_FRAME_CHARS = 5
/** Text a reader never sees as words. */
const UNREAD_PARENTS: ReadonlySet<string | undefined> = new Set(['script', 'style', 'noscript', 'template'])

/** `text` cut to `max` characters, ending in `…` when it was longer. */
function cut(text: string, max: number): string {
  const chars = [...text]
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}${ELLIPSIS}`
}

/** `#id.cls1.cls2…` – the id and at most two classes. */
function nameOf(element: Element): string {
  const id = element.id === '' ? '' : `#${element.id}`
  const classes = [...element.classList]
  const shown = classes.slice(0, LABEL_MAX_CLASSES).map(name => `.${name}`).join('')
  return `${id}${shown}${classes.length > LABEL_MAX_CLASSES ? ELLIPSIS : ''}`
}

function suffixText(suffix: LabelSuffix): string {
  switch (suffix.kind) {
    case 'script':
      return ' · script'
    case 'frame':
      return ` · frame ${suffix.file}`
    case 'refused-frame':
      return ' · refused frame'
    case 'inline-frame':
      return ' · inline frame'
    default:
      return ''
  }
}

function commentsText(count: number): string {
  if (count <= 0) return ''
  return count === 1 ? ' · 1 comment' : ` · ${count} comments`
}

/**
 * The first `room` characters of the words in `element`, and no more of the
 * page than that: this runs as the pointer moves, over elements of any size.
 * Controls and format characters go, so a bidi control cannot reorder the label.
 */
function openingWords(element: Element, room: number): string {
  const walker = element.ownerDocument.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */)
  let words = ''
  while ([...words].length <= room) {
    // SHOW_TEXT yields only text nodes, each below `element`, so each has a parent.
    const node = walker.nextNode() as Text | null
    if (node === null) break
    if (UNREAD_PARENTS.has(node.parentElement?.localName)) continue
    words = `${words} ${node.data.replace(/[\p{Cc}\p{Cf}]/gu, ' ')}`.replace(/\s+/g, ' ').trimStart()
  }
  return cut(words.trimEnd(), room).replace(/ …$/, ELLIPSIS)
}

/**
 * The label of `element`, sized from `box` (its border box).
 *
 * @param comments - Open comments on the element's pin, if it has one.
 */
export function labelOf(
  element: Element,
  box: Box,
  suffix: LabelSuffix,
  comments: number
): LabelParts {
  // The suffix says what the element is; its opening words give way to it.
  const after = `${suffixText(suffix)}${commentsText(comments)}`
  const room = LABEL_MAX_CHARS - KIND_WORD.length - [...after].length
  const words = room > WORDS_FRAME_CHARS ? openingWords(element, room - WORDS_FRAME_CHARS) : ''
  const rest = cut(`${words === '' ? '' : ` · “${words}”`}${after}`, LABEL_MAX_CHARS - KIND_WORD.length)
  return {
    tag: KIND_WORD,
    rest,
    code: cut(`${element.localName}${nameOf(element)}`, LABEL_MAX_CHARS),
    size: `${Math.round(box.width)}×${Math.round(box.height)}`
  }
}

/** The label as one line of text (a pin's label). Never sent to main: the live region words main's facts (S-L-A). */
export function labelText(parts: LabelParts): string {
  return `${parts.tag}${parts.rest}`
}

/** The file name a frame's `src` names (`docs/other.html` → `other.html`). */
export function frameFileOf(src: string): string {
  try {
    const { pathname } = new URL(src)
    const name = pathname.slice(pathname.lastIndexOf('/') + 1)
    return cut(decodeURIComponent(name), LABEL_MAX_CHARS)
  } catch {
    return ''
  }
}
