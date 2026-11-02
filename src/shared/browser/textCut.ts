// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Cutting text at a whole-character boundary (spec 025, 025-FR-026,
 * 025-FR-033, panel finding T18).
 *
 * "Whole character" means a user-perceived character (an extended grapheme
 * cluster): a cut never falls inside a surrogate pair, an emoji ZWJ sequence,
 * a flag or a letter with its combining marks. Uses `Intl.Segmenter`, which
 * both Node and Chromium ship, so main and renderer cut alike.
 */

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * How far before the limit a cut looks for a boundary. A grapheme cluster
 * longer than this (a pathological run of combining marks) falls back to a
 * code-point boundary, so the cut is still bounded and never splits a pair.
 */
const BOUNDARY_WINDOW = 256

/** True for the high (leading) half of a UTF-16 surrogate pair. */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

/** The largest index ≤ `max` that does not split a surrogate pair. */
function codePointBoundary(text: string, max: number): number {
  return max > 0 && isHighSurrogate(text.charCodeAt(max - 1)) ? max - 1 : max
}

/**
 * `text` cut to at most `maxCodeUnits` UTF-16 code units, ending on a whole
 * character. Returns `text` unchanged when it already fits.
 */
export function cutAtCodeUnits(text: string, maxCodeUnits: number): string {
  if (text.length <= maxCodeUnits) return text
  if (maxCodeUnits <= 0) return ''
  const start = Math.max(0, maxCodeUnits - BOUNDARY_WINDOW)
  // Segment a window that reaches past the limit, so the cluster that
  // straddles it is seen whole; boundaries far from `start` do not depend on
  // where the window began.
  const window = text.slice(start, maxCodeUnits + BOUNDARY_WINDOW)
  let best = -1
  for (const { index } of segmenter.segment(window)) {
    const at = start + index
    if (at > maxCodeUnits) break
    if (at > start || start === 0) best = at
  }
  // best === 0: the first character alone is longer than the limit, so no
  // whole character fits. best === -1: no boundary inside the window.
  const end = best >= 0 ? best : codePointBoundary(text, maxCodeUnits)
  return text.slice(0, end)
}

/** Number of user-perceived characters in `text`. */
export function graphemeCount(text: string): number {
  return Array.from(segmenter.segment(text)).length
}

/**
 * `text` cut to its first `maxGraphemes` user-perceived characters. Returns
 * `text` unchanged when it already fits.
 */
export function cutAtGraphemes(text: string, maxGraphemes: number): string {
  if (maxGraphemes <= 0) return ''
  let n = 0
  for (const { index } of segmenter.segment(text)) {
    if (n === maxGraphemes) return text.slice(0, index)
    n++
  }
  return text
}
