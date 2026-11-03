// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The address suggestions under the address field (spec 025, 025-FR-063;
 * design § Suggestions, deck *Suggestions*; commit 19).
 *
 * - {@link useAddressSuggestions} asks main's history (`suggest`) for the
 *   typed text – a newer text wins over an older answer – and holds the
 *   page's still image while the list shows, because the list crosses into
 *   the page area (ADR 0011 decision 3).
 * - {@link AddressSuggestions} draws the `listbox`; the field stays the
 *   focus (`aria-activedescendant`), so typing never stops. A row is chosen
 *   by click, or by Enter on the row the arrows reached.
 *
 * Rows hold addresses only, never a stored title (deck *History row*).
 */
import { useEffect, useState } from 'react'
import { History, Search } from 'lucide-react'
import { browserTabGateway } from '../../../services/browserTabGateway'
import { logger } from '../../../utils/logger'
import { suggestionLabel, suggestionOptions, type SuggestionOption } from './addressSuggestions.logic'
import type { StillSurface } from './useStillSurface'

/** Options for {@link useAddressSuggestions}. */
export interface UseAddressSuggestionsOptions {
  /** The text being typed, or `null` when the field is not being edited. */
  readonly text: string | null
  /** The page's still image while the list shows. */
  readonly still?: StillSurface
}

/**
 * The rows for the typed text, shown over the page's still image.
 *
 * @param options - {@link UseAddressSuggestionsOptions}
 * @returns The rows to draw; empty while nothing is typed or the list is waiting for its picture
 */
export function useAddressSuggestions({ text, still }: UseAddressSuggestionsOptions): SuggestionOption[] {
  /** Main's newest answer, and the text it answers. */
  const [answer, setAnswer] = useState<{ text: string; rows: SuggestionOption[] } | null>(null)
  /** The picture under the list is up (or none is needed). */
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (text === null || text.trim() === '') return
    let current = true
    browserTabGateway
      .suggest(text.trim())
      .then(found => {
        if (current) setAnswer({ text, rows: suggestionOptions(text, found.rows.map(row => row.url)) })
      })
      .catch((error: unknown) => {
        logger.warn('Browser address suggestions failed', { error: error instanceof Error ? error.message : String(error) })
        if (current) setAnswer({ text, rows: suggestionOptions(text, []) })
      })
    return () => {
      current = false
    }
  }, [text])

  const rows = text !== null && answer?.text === text ? answer.rows : []
  const wanted = rows.length > 0
  useEffect(() => {
    if (!wanted || still === undefined) return
    let live = true
    still.open(() => {
      if (live) setReady(true)
    })
    return () => {
      live = false
      setReady(false)
      still.close()
    }
  }, [wanted, still])

  return wanted && (still === undefined || ready) ? rows : []
}

/** Props for {@link AddressSuggestions}. */
export interface AddressSuggestionsProps {
  readonly id: string
  readonly options: readonly SuggestionOption[]
  /** The row the arrows reached, or -1. */
  readonly active: number
  readonly onChoose: (option: SuggestionOption) => void
}

/** The DOM id of row `index` of list `listId`. */
export function suggestionId(listId: string, index: number): string {
  return `${listId}-${index}`
}

/**
 * The suggestion list.
 *
 * @param props - {@link AddressSuggestionsProps}
 * @returns The listbox, or nothing without rows
 */
export function AddressSuggestions({ id, options, active, onChoose }: AddressSuggestionsProps): JSX.Element | null {
  if (options.length === 0) return null
  return (
    <ul id={id} className="erf-brw-suggest" role="listbox" aria-label="Suggestions">
      {options.map((option, index) => (
        <li
          key={option.kind === 'history' ? option.url : `search:${option.text}`}
          id={suggestionId(id, index)}
          role="option"
          aria-selected={index === active}
          className={`erf-brw-suggest__row${index === active ? ' erf-brw-suggest__row--active' : ''}`}
          // The field keeps focus: a press here must not blur it before the click lands.
          onMouseDown={event => event.preventDefault()}
          onClick={() => onChoose(option)}
        >
          {option.kind === 'history' ? (
            <History size={14} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Search size={14} strokeWidth={2} aria-hidden="true" />
          )}
          <span className="erf-brw-suggest__text">{suggestionLabel(option)}</span>
        </li>
      ))}
    </ul>
  )
}
