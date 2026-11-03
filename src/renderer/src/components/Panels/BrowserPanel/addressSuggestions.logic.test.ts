// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { SEARCH_ROW_TEXT_MAX, SUGGESTION_ROWS, suggestionLabel, suggestionOptions } from './addressSuggestions.logic'

describe('suggestionOptions (025-FR-063)', () => {
  it('shows nothing for blank text', () => {
    expect(suggestionOptions('   ', ['https://a.test/'])).toEqual([])
  })

  it('lists history rows, leaves the typed address out and adds the search row for searched text', () => {
    expect(suggestionOptions('how to fix', ['https://fix.test/', 'how to fix'])).toEqual([
      { kind: 'history', url: 'https://fix.test/' },
      { kind: 'search', text: 'how to fix' }
    ])
  })

  it('adds no search row for an address and caps the history rows', () => {
    const many = Array.from({ length: SUGGESTION_ROWS + 3 }, (_, i) => `https://example.test/${i}`)
    const rows = suggestionOptions('example.test', many)
    expect(rows).toHaveLength(SUGGESTION_ROWS)
    expect(rows.every(row => row.kind === 'history')).toBe(true)
  })
})

describe('suggestionLabel', () => {
  it('shows the address, and quotes the search text cut at 60 characters', () => {
    expect(suggestionLabel({ kind: 'history', url: 'https://a.test/' })).toBe('https://a.test/')
    expect(suggestionLabel({ kind: 'search', text: 'cats' })).toBe('Search DuckDuckGo for "cats"')
    const long = 'a'.repeat(SEARCH_ROW_TEXT_MAX + 5)
    expect(suggestionLabel({ kind: 'search', text: long })).toBe(`Search DuckDuckGo for "${'a'.repeat(SEARCH_ROW_TEXT_MAX)}…"`)
    expect(suggestionLabel({ kind: 'search', text: 'a'.repeat(SEARCH_ROW_TEXT_MAX) })).toBe(
      `Search DuckDuckGo for "${'a'.repeat(SEARCH_ROW_TEXT_MAX)}"`
    )
  })
})
