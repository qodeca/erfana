// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure `srcset` attribute parser (Issue #74, work item 7; design §1.4).
 *
 * Extracts the candidate URLs from an `<img srcset>` / `<source srcset>` value.
 * This is a leaf module: it consumes a raw attribute string and returns the URL
 * list only, so `linkExtract` (item 8) can watch every referenced asset.
 *
 * A naive `value.split(',')` is wrong: a comma is legal INSIDE a candidate URL
 * (a `data:` URI carries `;base64,` and further base64 commas), so splitting on
 * commas fragments a single URL into several bogus links. This implements the
 * WHATWG srcset "parse a srcset attribute" tokeniser, which delimits candidates
 * by ASCII whitespace and treats a comma as a candidate separator ONLY at a
 * whitespace/token boundary — the same rule browsers apply.
 *
 * @see https://html.spec.whatwg.org/multipage/images.html#parsing-a-srcset-attribute
 */

/** ASCII whitespace per the HTML spec (space, tab, LF, FF, CR). */
function isAsciiWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\f' || ch === '\r'
}

/**
 * Parse a `srcset` attribute value into its ordered list of candidate URLs.
 *
 * Descriptors (`1x`, `2x`, `100w`, `1.5x`, …) are consumed and discarded — the
 * caller only needs the URLs to resolve and watch. Empty or whitespace-only
 * input yields an empty list. Duplicate URLs are preserved in order (dedup is
 * the caller's concern in `linkExtract`).
 *
 * @param value - the raw `srcset` attribute value
 * @returns the candidate URLs, in document order
 */
export function parseSrcset(value: string): string[] {
  const urls: string[] = []
  const length = value.length
  let pos = 0

  while (pos < length) {
    // 1. Skip any run of leading whitespace and commas separating candidates.
    while (pos < length && (isAsciiWhitespace(value[pos]) || value[pos] === ',')) {
      pos++
    }
    if (pos >= length) break

    // 2. Collect the URL: the maximal run of non-whitespace characters. A comma
    //    inside this run (e.g. a `data:` URI) is part of the URL, not a
    //    separator, because it is not at a whitespace boundary.
    const urlStart = pos
    while (pos < length && !isAsciiWhitespace(value[pos])) {
      pos++
    }
    let url = value.slice(urlStart, pos)

    if (url.endsWith(',')) {
      // 3a. A URL ending in commas has no descriptor; strip the trailing commas.
      url = url.replace(/,+$/, '')
    } else {
      // 3b. Consume the descriptor up to the next top-level comma. Parentheses
      //     are tracked so a comma inside a media-condition cannot end it early.
      while (pos < length && isAsciiWhitespace(value[pos])) {
        pos++
      }
      let inParens = false
      while (pos < length) {
        const ch = value[pos]
        if (inParens) {
          if (ch === ')') inParens = false
        } else if (ch === ',') {
          pos++
          break
        } else if (ch === '(') {
          inParens = true
        }
        pos++
      }
    }

    if (url.length > 0) {
      urls.push(url)
    }
  }

  return urls
}
