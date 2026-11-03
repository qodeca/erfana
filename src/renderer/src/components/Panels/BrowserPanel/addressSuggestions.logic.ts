// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The address suggestions' rows (spec 025, 025-FR-063; design § Suggestions
 * and deck *Suggestions*; commit 19): matches from the project's own address
 * history – never a remote service – most recent first, then **Search
 * DuckDuckGo for "{text}"** when the typed text would be searched (the
 * address bar's rule 8, `classifyAddressInput`). Nothing about the text
 * leaves the renderer except to main's history lookup (`suggest`).
 */
import { classifyAddressInput } from '../../../../../shared/browser/addressInput'
import { cutAtGraphemes } from '../../../../../shared/browser/textCut'

/** History rows shown under the field at most. */
export const SUGGESTION_ROWS = 8
/** Characters of the typed text the search row quotes (deck: cut at 60). */
export const SEARCH_ROW_TEXT_MAX = 60

/** One row of the list. */
export type SuggestionOption =
  | { readonly kind: 'history'; readonly url: string }
  | { readonly kind: 'search'; readonly text: string }

/**
 * The rows for `typed` given main's history `matches`.
 *
 * @param typed - The field's text
 * @param matches - Main's history rows for it, most recent first
 * @returns At most {@link SUGGESTION_ROWS} history rows, the typed address
 *   itself left out, then the search row when the text would be searched
 *
 * @example
 * ```ts
 * suggestionOptions('local', ['http://localhost:5173/']) // [{ kind: 'history', url: 'http://localhost:5173/' }, { kind: 'search', text: 'local' }]
 * ```
 */
export function suggestionOptions(typed: string, matches: readonly string[]): SuggestionOption[] {
  const text = typed.trim()
  if (text === '') return []
  const rows: SuggestionOption[] = matches
    .filter(url => url !== text)
    .slice(0, SUGGESTION_ROWS)
    .map(url => ({ kind: 'history', url }))
  if (classifyAddressInput(text).kind === 'search') rows.push({ kind: 'search', text })
  return rows
}

/**
 * The visible words of a row.
 *
 * @param option - The row
 * @returns The address, or the search sentence with the text cut at 60 characters
 */
export function suggestionLabel(option: SuggestionOption): string {
  if (option.kind === 'history') return option.url
  const cut = cutAtGraphemes(option.text, SEARCH_ROW_TEXT_MAX)
  return `Search DuckDuckGo for "${cut}${cut.length < option.text.length ? '…' : ''}"`
}
