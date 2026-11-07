// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The find row (spec 025, 025-FR-008; design § Suggestions, find row; deck
 * *Find bar*): Find in page, the count, Previous, Next and Close.
 *
 * - Typing starts a new search (`findNext: true`); Enter and Next move
 *   forward, Shift+Enter and Previous back. The count is main's
 *   `findResult`: "N of M", "0 of 0" with a hidden "No matches".
 * - Previous and Next are `aria-disabled` with "Type to find" while empty.
 * - Esc or Close ends the search, clears the highlights and returns focus to
 *   the page.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import type { FindResultEvent } from '../../../../../shared/ipc/browser-tab-bridge-types'
import { BROWSER_FIND_MAX_CHARS } from '../../../../../shared/ipc/browser-tab-schema'
import { browserTabGateway } from '../../../services/browserTabGateway'
import { logger } from '../../../utils/logger'
import { findCount } from './browserMenus.logic'
import { BROWSER_TEST_IDS } from './browserTestIds'

/** Props for {@link FindRow}. */
export interface FindRowProps {
  readonly tabId: string
  readonly result: FindResultEvent | undefined
  /** Esc or Close: the row goes and focus returns to the page. */
  readonly onClose: () => void
}

const ICON = { size: 16, strokeWidth: 2, 'aria-hidden': true } as const

function warn(error: unknown): void {
  logger.warn('Browser find failed', { error: error instanceof Error ? error.message : String(error) })
}

/**
 * Renders the find row; focuses its field when it opens.
 *
 * @param props - {@link FindRowProps}
 * @returns The row
 */
export function FindRow({ tabId, result, onClose }: FindRowProps): JSX.Element {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const empty = text === ''

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const search = (value: string, forward: boolean, findNext: boolean): void => {
    if (value === '') return
    browserTabGateway.find({ tabId, text: value, forward, findNext }).catch(warn)
  }

  const onChange = (value: string): void => {
    setText(value)
    if (value === '') browserTabGateway.stopFind(tabId).catch(warn)
    else search(value, true, true)
  }

  const close = (): void => {
    browserTabGateway.stopFind(tabId).catch(warn)
    onClose()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      search(text, !event.shiftKey, false)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  const count = empty ? '' : findCount(result)
  const noMatch = !empty && result !== undefined && result.total === 0
  const stepTitle = (name: string, key: string): string => (empty ? 'Type to find' : `${name} (${key})`)

  return (
    <div className="erf-brw-find" role="search" aria-label="Find in page" data-testid={BROWSER_TEST_IDS.FIND_ROW}>
      <input
        ref={inputRef}
        type="search"
        className="erf-brw-find__input"
        aria-label="Find in page"
        placeholder="Find in page"
        maxLength={BROWSER_FIND_MAX_CHARS}
        spellCheck={false}
        value={text}
        onChange={event => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="erf-brw-find__count" aria-hidden="true">
        {count}
      </span>
      <span className="erf-brw-hidden" aria-live="polite">
        {empty || result === undefined ? '' : noMatch ? 'No matches.' : `${count}.`}
      </span>
      <button
        type="button"
        className="erf-brw-tool"
        aria-label="Previous match"
        title={stepTitle('Previous match', 'Shift+Enter')}
        aria-disabled={empty ? true : undefined}
        onClick={() => search(text, false, false)}
      >
        <ChevronUp {...ICON} />
      </button>
      <button
        type="button"
        className="erf-brw-tool"
        aria-label="Next match"
        title={stepTitle('Next match', 'Enter')}
        aria-disabled={empty ? true : undefined}
        onClick={() => search(text, true, false)}
      >
        <ChevronDown {...ICON} />
      </button>
      <button type="button" className="erf-brw-tool" aria-label="Close find" title="Close find (Esc)" onClick={close}>
        <X {...ICON} />
      </button>
    </div>
  )
}
