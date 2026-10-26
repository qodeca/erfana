// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The overlay's element label (docs/designs/html-preview-comments.md §10.2,
 * §10.10; test J-001): `button#buy.cta.primary 120×40`, at most two classes
 * then `…`, at most 40 characters, plus a suffix – ` · script` for a JS-built
 * element, ` · frame other.html` for a same-project frame, ` · 2 comments`,
 * or `iframe · refused frame` / `iframe · inline frame` for a frame that is
 * not commentable inside.
 *
 * The label is page text (ids and classes come from the page), so it is only
 * ever set as `textContent`, never parsed as markup.
 */
import { LABEL_MAX_CHARS, LABEL_MAX_CLASSES } from './constants'
import type { Box } from './geometry'

/** The three styled runs of a label: the tag (accent), the rest (paper), the size (muted). */
export interface LabelParts {
  readonly tag: string
  readonly rest: string
  readonly size: string
}

/** What a label says beyond the element's own name. */
export type LabelSuffix =
  | { readonly kind: 'none' }
  | { readonly kind: 'script' }
  | { readonly kind: 'frame'; readonly file: string }
  | { readonly kind: 'refused-frame' }
  | { readonly kind: 'inline-frame' }

const ELLIPSIS = '…'

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
  const tag = cut(element.localName, LABEL_MAX_CHARS)
  const room = LABEL_MAX_CHARS - [...tag].length
  // The suffix says what the element is; the id and classes give way to it.
  const after = `${suffixText(suffix)}${commentsText(comments)}`
  const nameRoom = room - [...after].length
  const name = nameRoom > 1 ? cut(nameOf(element), nameRoom) : ''
  const rest = room > 0 ? cut(`${name}${after}`, room) : ''
  return { tag, rest, size: `${Math.round(box.width)}×${Math.round(box.height)}` }
}

/** The label as one line of text, for the live region ("Showing {label}."). */
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
