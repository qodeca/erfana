// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comment marks: the words a comment is about, marked in the page (spec 024
 * 024-FR-004; comments-v2 C-12, C-17).
 *
 * Main sends each pin's words (`IconState.words`, page text – never comment
 * text). Each is found again in its element's text (`rangeOfWords`); words
 * that are gone or appear twice get no mark. A mark is a box over each line
 * of the words in the overlay's closed shadow root – the page's DOM and its
 * text are never touched, so Find, copy and exports never see it. In comment
 * mode a mark takes clicks like its pin and opens the pin's threads (C-17);
 * outside it the page keeps its clicks.
 *
 * The lookups walk the element's text, so the ranges are cached per pin and
 * found again only after the page changed (`PageWatch.version`) or a new
 * state arrived; their boxes are read on every render, so they follow scroll.
 */
import { clipToViewport, type Box, type Viewport } from './geometry'
import type { ResolvedIcon } from './iconResolver'
import type { IconState, IconWords } from './state'
import { rangeOfWords, rectsOf } from './words'

/** One marked line of words. */
export interface MarkPlacement {
  /** The pin the words belong to: a click on the mark opens its threads. */
  readonly key: string
  readonly element: Element
  /** The line's box, clipped to the viewport. */
  readonly box: Box
}

/** Most mark boxes one render draws (every line of every pin's words). */
export const MAX_MARK_BOXES = 2_000

/** The boxes of every visible pin's words, cached per pin and page version. */
export class MarkResolver {
  private readonly cache = new WeakMap<IconState, { readonly version: number; readonly ranges: readonly Range[] }>()

  constructor(private readonly version: () => number) {}

  /** The marks of `icons` in `viewport`, in pin order. */
  place(icons: readonly ResolvedIcon[], viewport: Viewport): MarkPlacement[] {
    const marks: MarkPlacement[] = []
    for (const { icon, element, visible } of icons) {
      const words = icon.words
      if (!visible || element === undefined || words === undefined) continue
      for (const rect of this.rangesOf(icon, words, element).flatMap(rectsOf)) {
        const box = clipToViewport({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }, viewport)
        if (box !== null) marks.push({ key: icon.key, element, box })
        if (marks.length >= MAX_MARK_BOXES) return marks
      }
    }
    return marks
  }

  /** The words' ranges in `element`, found again only when the page changed. */
  private rangesOf(icon: IconState, words: readonly IconWords[], element: Element): readonly Range[] {
    const version = this.version()
    const cached = this.cache.get(icon)
    if (cached !== undefined && cached.version === version) return cached.ranges
    const ranges = words.map(sel => rangeOfWords(element, sel)).filter((range): range is Range => range !== null)
    this.cache.set(icon, { version, ranges })
    return ranges
  }
}
