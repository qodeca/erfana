// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The address bar (spec 025, 025-FR-002, 025-FR-051; design § Address bar and
 * the Origin field card, `proposed`).
 *
 * - **At rest** it shows the address main sent – the pending one only for a
 *   navigation the user started – split by main's formatter: the scheme only
 *   when not `https`, subdomain labels dimmed, the registrable domain
 *   brightest, the port when not default, the path quiet and cut from its
 *   end. The input keeps the full address underneath, so a click selects it.
 * - **Editing** keeps what the user typed (a draft) until Enter, Esc or the
 *   field loses focus unchanged. Nothing about the text leaves the renderer
 *   before Enter (025-FR-002); main classifies it again on `navigate`.
 * - **Esc** restores the current address and returns focus to the page
 *   (025-FR-051). While an input method composes, Esc and Enter belong to it.
 * - **A refused address** shows as a field error under the navigation row
 *   (`errorId`); the panel clears it on the next edit.
 * - **Suggestions** (025-FR-063, commit 19) list matches from the project's
 *   address history while the user types, over the page's still image. The
 *   field is a combobox: ↓ and ↑ move through the rows, Enter loads the row
 *   reached (or the typed text when none is), and the first Esc closes the
 *   list before the next restores the address.
 */
import { forwardRef, useId, useState } from 'react'
import { fitOriginParts, type FittedOrigin } from '../../../../../shared/browser/originFormat'
import { useOriginFit } from './useOriginFit'
import { AddressSuggestions, suggestionId, useAddressSuggestions } from './AddressSuggestions'
import type { SuggestionOption } from './addressSuggestions.logic'
import type { StillSurface } from './useStillSurface'
import { CircleAlert, File, TriangleAlert } from 'lucide-react'
import type { BrowserTabState } from '../../../stores/useBrowserTabStore'
import {
  addressDisplay,
  securityBadge,
  shownAddress,
  type AddressDisplay
} from './browserPanel.logic'

/** Props for {@link AddressBar}. */
export interface AddressBarProps {
  readonly state: BrowserTabState | null
  /**
   * Enter with non-empty text (trimmed), or a chosen suggestion (`history`);
   * resolves `true` once main started the load, which ends the draft.
   */
  readonly onSubmit: (input: string, source?: 'address' | 'history') => Promise<boolean>
  /** Esc: the address is restored; the panel returns focus to the page. */
  readonly onEscape: () => void
  /** The text changed: the panel clears a refusal. */
  readonly onEdit: () => void
  /** The id of the refusal message, while one shows. */
  readonly errorId: string | null
  /** The chips at the field's end (commit 18). */
  readonly children?: React.ReactNode
  /** The page's still image under the suggestion list (commit 19). */
  readonly suggestStill?: StillSurface
}

const BADGE_ICON = { size: 14, strokeWidth: 2, 'aria-hidden': true } as const

/**
 * The resting display. A web origin is drawn fitted to the field's width
 * (`useOriginFit`): subdomain labels leave from the front, so a long host can
 * never push its registrable domain out of view; the path takes what is left.
 */
function DisplayText({
  display,
  fitted
}: {
  readonly display: AddressDisplay
  readonly fitted: FittedOrigin | null
}): JSX.Element | null {
  if (display.kind === 'empty') return null
  if (display.kind === 'text') return <span className="erf-brw-address__path">{display.text}</span>
  const shown = fitted ?? fitOriginParts(display.parts, Number.POSITIVE_INFINITY)
  return (
    <>
      {shown.scheme !== '' && <span className="erf-brw-address__dim">{shown.scheme}</span>}
      {shown.subdomain !== '' && <span className="erf-brw-address__dim">{shown.subdomain}</span>}
      <span className="erf-brw-address__domain">{shown.registrableDomain}</span>
      {shown.port !== '' && <span className="erf-brw-address__dim">{shown.port}</span>}
      {display.path !== '' && <span className="erf-brw-address__path">{display.path}</span>}
    </>
  )
}

/**
 * The tab's address and search field.
 *
 * @param props - {@link AddressBarProps}
 * @param ref - The input, for Ctrl/Cmd+L and F6 focus
 * @returns The field with its badge
 */
export const AddressBar = forwardRef<HTMLInputElement, AddressBarProps>(function AddressBar(
  { state, onSubmit, onEscape, onEdit, errorId, children, suggestStill },
  ref
) {
  const [draft, setDraft] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(-1)
  /** The text whose list Esc closed: the list stays shut until the text changes. */
  const [dismissed, setDismissed] = useState<string | null>(null)
  const uid = useId().replace(/[^\w-]/g, '')
  const badgeId = `erf-brw-badge-${uid}`
  const listId = `erf-brw-suggest-${uid}`
  const address = shownAddress(state) ?? ''
  const value = draft ?? address
  const badge = state === null ? null : securityBadge(state.security)
  const display = addressDisplay(state)
  const atRest = !focused && draft === null && display.kind !== 'empty'
  const [displayBox, setDisplayBox] = useState<HTMLSpanElement | null>(null)
  const fitted = useOriginFit(displayBox, display.kind === 'web' ? display.parts : null)
  const describedBy =
    [badge === null ? null : badgeId, errorId].filter(id => id !== null).join(' ') || undefined
  const typing = focused && draft !== null && draft !== address && draft !== dismissed ? draft : null
  const options = useAddressSuggestions({ text: typing, still: suggestStill })
  const listOpen = options.length > 0
  const activeIndex = active < options.length ? active : -1

  const submit = (input: string, source: 'address' | 'history'): void => {
    void onSubmit(input, source).then(loaded => {
      if (loaded) setDraft(null)
    })
  }
  const choose = (option: SuggestionOption): void => {
    setActive(-1)
    if (option.kind === 'history') submit(option.url, 'history')
    else submit(option.text, 'address')
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (listOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      // The field's own text is the stop before the first row and after the last (-1).
      const stops = options.length + 1
      setActive(((activeIndex + 1 + step + stops) % stops) - 1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (activeIndex >= 0) {
        choose(options[activeIndex])
        return
      }
      const input = value.trim()
      if (input !== '') submit(input, 'address')
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (listOpen) {
        // The first Esc closes the list only; the next restores the address.
        setDismissed(draft)
        setActive(-1)
        return
      }
      setDraft(null)
      onEscape()
    }
  }

  return (
    <div className={`erf-brw-address${errorId === null ? '' : ' erf-brw-address--invalid'}`}>
      {badge !== null && (
        <span
          className={`erf-brw-address__badge erf-brw-address__badge--${badge.tone}`}
          aria-hidden="true"
        >
          {badge.icon === 'circle-alert' && <CircleAlert {...BADGE_ICON} />}
          {badge.icon === 'triangle-alert' && <TriangleAlert {...BADGE_ICON} />}
          {badge.icon === 'file' && <File {...BADGE_ICON} />}
          <span title={badge.description}>{badge.word}</span>
        </span>
      )}
      {badge !== null && (
        <span id={badgeId} className="erf-brw-hidden">
          {badge.description}
        </span>
      )}
      <div className="erf-brw-address__field">
        <input
          ref={ref}
          type="text"
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listOpen ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? suggestionId(listId, activeIndex) : undefined}
          className={`erf-brw-address__input${atRest ? ' erf-brw-address__input--rest' : ''}`}
          aria-label="Address and search"
          aria-describedby={describedBy}
          aria-invalid={errorId === null ? undefined : true}
          placeholder="Search DuckDuckGo or type an address"
          spellCheck={false}
          autoComplete="off"
          value={value}
          onChange={event => {
            setDraft(event.target.value)
            setActive(-1)
            setDismissed(null)
            onEdit()
          }}
          onFocus={event => {
            setFocused(true)
            event.currentTarget.select()
          }}
          onBlur={() => {
            setFocused(false)
            setActive(-1)
            // A draft that changes nothing is not kept: the address shows again.
            if (draft === address) setDraft(null)
          }}
          onKeyDown={onKeyDown}
        />
        {atRest && (
          <span ref={setDisplayBox} className="erf-brw-address__display" aria-hidden="true">
            <DisplayText display={display} fitted={fitted} />
          </span>
        )}
      </div>
      {children}
      <AddressSuggestions id={listId} options={options} active={activeIndex} onChoose={choose} />
    </div>
  )
})
