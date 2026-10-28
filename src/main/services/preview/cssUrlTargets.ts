// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The targets of the CSS `url(...)` references in a stylesheet or a `style`
 * attribute, for the preview's link extractor (issue #124, security audit).
 *
 * This finds exactly what the extractor's former regex captured –
 * `/url\(\s*(?:'([^']*)'|"([^"]*)"|([^'")]*))\s*\)/gi`, the single-quoted,
 * double-quoted or unquoted target – but in linear time. The regex was
 * quadratic: from every `url(` that no `)` closes it read on to the end of the
 * text before giving up, so 160 KB of `url(` took 6 s on the main thread.
 *
 * Here each search for a closing quote, or for the end of an unquoted target,
 * remembers where it stopped. The `url(` openings it is asked from only move
 * forward, and no text between an opening and that stop can hold the stop
 * character, so a later opening before the stop reuses it rather than reading
 * the same text again.
 */

/** A `url(` opening, in any letter case. */
const URL_OPEN = /url\(/gi

/** A run of whitespace, as `\s` in the former regex. */
const WHITESPACE_RUN = /\s*/y

/** What ends an unquoted target: a quote or the closing parenthesis. */
const UNQUOTED_STOP = /['")]/g

const SINGLE_QUOTE = /'/g
const DOUBLE_QUOTE = /"/g

/** The first index of a stop character at or after `from` (`text.length` if none). */
type ForwardSearch = (from: number) => number

/**
 * A search for `stop` that rereads nothing for a rising `from`: the last hit is
 * still the first one for any `from` between the last search's start and it.
 */
function forwardSearch(text: string, stop: RegExp): ForwardSearch {
  const pattern = new RegExp(stop.source, 'g')
  let searchedFrom = Number.POSITIVE_INFINITY
  let hit = text.length
  return (from) => {
    if (from < searchedFrom || from > hit) {
      pattern.lastIndex = from
      const match = pattern.exec(text)
      searchedFrom = from
      hit = match === null ? text.length : match.index
    }
    return hit
  }
}

function skipWhitespace(text: string, from: number): number {
  WHITESPACE_RUN.lastIndex = from
  WHITESPACE_RUN.exec(text)
  return WHITESPACE_RUN.lastIndex
}

/** A target found after one `url(`, and where the next search resumes. */
interface UrlMatch {
  readonly target: string
  readonly end: number
}

/** The searches one scan shares. */
interface CssSearches {
  readonly singleQuote: ForwardSearch
  readonly doubleQuote: ForwardSearch
  readonly unquotedStop: ForwardSearch
}

/** The reference opened at `open` (just past `url(`), or `null` if nothing closes it. */
function matchAt(css: string, open: number, searches: CssSearches): UrlMatch | null {
  const start = skipWhitespace(css, open)
  const quote = css[start]
  if (quote === "'" || quote === '"') {
    const search = quote === "'" ? searches.singleQuote : searches.doubleQuote
    const close = search(start + 1)
    if (close === css.length) {
      return null
    }
    const after = skipWhitespace(css, close + 1)
    return css[after] === ')' ? { target: css.slice(start + 1, close), end: after + 1 } : null
  }
  // Unquoted: everything up to the first quote or `)`, trailing whitespace
  // included, and only a `)` closes it.
  const stop = searches.unquotedStop(start)
  return css[stop] === ')' ? { target: css.slice(start, stop), end: stop + 1 } : null
}

/**
 * The raw targets of every `url(...)` in `css`, in order, quotes removed and
 * nothing else normalised.
 *
 * @param css - a stylesheet, or the value of a `style` attribute
 */
export function cssUrlTargets(css: string): string[] {
  const searches: CssSearches = {
    singleQuote: forwardSearch(css, SINGLE_QUOTE),
    doubleQuote: forwardSearch(css, DOUBLE_QUOTE),
    unquotedStop: forwardSearch(css, UNQUOTED_STOP)
  }
  const opener = new RegExp(URL_OPEN.source, URL_OPEN.flags)
  const targets: string[] = []
  for (let match = opener.exec(css); match !== null; match = opener.exec(css)) {
    const found = matchAt(css, match.index + match[0].length, searches)
    if (found === null) {
      // As the regex did: try again from the next character.
      opener.lastIndex = match.index + 1
    } else {
      targets.push(found.target)
      opener.lastIndex = found.end
    }
  }
  return targets
}
