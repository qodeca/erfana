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
 */
import { forwardRef, useId, useState } from 'react'
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
  /** Enter with non-empty text (trimmed); resolves `true` once main started the load, which ends the draft. */
  readonly onSubmit: (input: string) => Promise<boolean>
  /** Esc: the address is restored; the panel returns focus to the page. */
  readonly onEscape: () => void
  /** The text changed: the panel clears a refusal. */
  readonly onEdit: () => void
  /** The id of the refusal message, while one shows. */
  readonly errorId: string | null
}

const BADGE_ICON = { size: 14, strokeWidth: 2, 'aria-hidden': true } as const

function DisplayText({ display }: { readonly display: AddressDisplay }): JSX.Element | null {
  if (display.kind === 'empty') return null
  if (display.kind === 'text') return <span className="erf-brw-address__path">{display.text}</span>
  const { parts, path } = display
  return (
    <>
      {parts.scheme !== null && <span className="erf-brw-address__dim">{parts.scheme}://</span>}
      {parts.subdomain !== '' && <span className="erf-brw-address__dim">{parts.subdomain}</span>}
      <span className="erf-brw-address__domain">{parts.registrableDomain}</span>
      {parts.port !== null && <span className="erf-brw-address__dim">:{parts.port}</span>}
      {path !== '' && <span className="erf-brw-address__path">{path}</span>}
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
  { state, onSubmit, onEscape, onEdit, errorId },
  ref
) {
  const [draft, setDraft] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const badgeId = `erf-brw-badge-${useId().replace(/[^\w-]/g, '')}`
  const address = shownAddress(state) ?? ''
  const value = draft ?? address
  const badge = state === null ? null : securityBadge(state.security)
  const display = addressDisplay(state)
  const atRest = !focused && draft === null && display.kind !== 'empty'
  const describedBy =
    [badge === null ? null : badgeId, errorId].filter(id => id !== null).join(' ') || undefined

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      const input = value.trim()
      if (input === '') return
      void onSubmit(input).then(loaded => {
        if (loaded) setDraft(null)
      })
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
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
            onEdit()
          }}
          onFocus={event => {
            setFocused(true)
            event.currentTarget.select()
          }}
          onBlur={() => {
            setFocused(false)
            // A draft that changes nothing is not kept: the address shows again.
            if (draft === address) setDraft(null)
          }}
          onKeyDown={onKeyDown}
        />
        {atRest && (
          <span className="erf-brw-address__display" aria-hidden="true">
            <DisplayText display={display} />
          </span>
        )}
      </div>
    </div>
  )
})
