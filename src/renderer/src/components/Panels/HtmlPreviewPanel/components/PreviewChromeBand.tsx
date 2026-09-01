// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The HTML preview's toolbar, and the place remote hosts are approved.
 *
 * TWO JOBS.
 *
 * 1. It is the preview's toolbar: Find on the left, the permission chip on the
 *    right, laid out and styled like `MarkdownToolbar` so the two previews in
 *    this app do not look like two different products.
 * 2. It is where a blocked remote host is approved. A permission decision
 *    outlives the message that raised it, so it belongs on the preview's own
 *    chrome rather than floating over an unrelated part of the app.
 *
 * WHAT WAS DELIBERATELY REMOVED, so nobody restores it as a "fix".
 *
 * This bar used to carry the words "Preview — content below is not Erfana" and a
 * 2px accent seam, and both were the documented mitigation for UI spoofing
 * (`docs/security.md`, residual risk 8). The project owner withdrew both in
 * favour of a conventional toolbar. Nothing on screen names the boundary any
 * more, and the remaining 1px neutral rule is weak against a light page — a page
 * drawing a convincing fake Erfana dialog inside its own rectangle now has one
 * fewer cue working against it. `docs/security.md` records that as accepted.
 *
 * What still holds, and must keep holding: this bar is ALWAYS present, and it is
 * a flow sibling ABOVE `.html-preview-page-area` rather than an overlay on it,
 * so the previewed page still has nowhere to paint that could cover it. Making
 * it conditional, or absolutely positioned, would remove the last thing left.
 *
 * WHAT THIS REPLACED. Each blocked host used to raise its own toast over the file
 * tree, capped at three. A page reaching four hosts produced three stacked walls
 * of identical text — and the fourth host could not be approved at all, because
 * the app had run out of toasts. That cap was the only thing bounding the list,
 * so it was load-bearing by accident.
 *
 * @see design/system/components/permission-band/index.html - status="decided"
 * @see design/product/html-approval/index.html - the nine-state journey
 */
import { Search } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useReducer, useRef } from 'react'

import './PreviewChromeBand.css'

import {
  INITIAL_BAND_STATE,
  bandReducer,
  chipAccessibleName,
  countsLabel,
  selectBandRows
} from '../permissionBand.logic'
import { PreviewBandConfirm } from './PreviewBandConfirm'
import { PreviewBandRow } from './PreviewBandRow'
import type { PreviewApproveResult } from '../../../../../../shared/ipc/preview-types'
import type { PreviewBlockedHost } from '../../../../stores/usePreviewStore'

/** Props for {@link PreviewChromeBand}. */
export interface PreviewChromeBandProps {
  /** Every host this panel has seen refused, in first-seen order. */
  readonly blockedHosts: readonly PreviewBlockedHost[]
  /** Hosts approved for this panel's PROJECT, mirrored from main. */
  readonly allowedHosts: readonly string[]
  /** Main hit its per-view cap, so the list is not the whole story. */
  readonly blockedHostsTruncated?: boolean
  /**
   * The previewed page is hidden because it did not prove it moved out of the
   * way. Renders the fail-safe strip; the hiding itself is not ours.
   */
  readonly paused?: boolean
  /** Focused by the panel on a forwarded Escape when the find bar is closed. */
  readonly chipRef?: React.RefObject<HTMLButtonElement>
  /**
   * The previewed page has proved it moved out of the space the list occupies,
   * or has been hidden — either way there is nothing of it over these controls.
   *
   * Until then the list renders at its FULL HEIGHT with the rows
   * `visibility: hidden`. That reserves the layout, which is what makes the page
   * move at all, while painting nothing and putting nothing in the tab order or
   * the accessibility tree. `display: none` and conditional rendering both bring
   * back the deadlock — no rows, no growth, nothing to prove — and `opacity: 0`
   * still hit-tests, so a click would land on a control nobody can see.
   */
  readonly controlsAllowed?: boolean
  /**
   * Open find-in-page. Optional only so the band can be rendered in isolation by
   * tests and by the design cards; the panel always supplies it, and the button
   * is not rendered without it rather than rendering a control that does nothing.
   */
  readonly onFind?: () => void
  /** Approve one host. Resolves with the IPC result — the band renders failure. */
  readonly onApprove: (host: string) => Promise<PreviewApproveResult>
  /** The list opened or closed, so the panel can re-measure. */
  readonly onExpandedChange?: (expanded: boolean) => void
}

export function PreviewChromeBand({
  blockedHosts,
  allowedHosts,
  blockedHostsTruncated = false,
  paused = false,
  chipRef,
  controlsAllowed = true,
  onFind,
  onApprove,
  onExpandedChange
}: PreviewChromeBandProps): React.JSX.Element {
  const [state, dispatch] = useReducer(bandReducer, INITIAL_BAND_STATE)
  const listId = useId()
  const confirmId = useId()

  const fallbackChipRef = useRef<HTMLButtonElement>(null)
  const chip = chipRef ?? fallbackChipRef
  const firstAllowRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(
    () => selectBandRows(blockedHosts, allowedHosts),
    [blockedHosts, allowedHosts]
  )

  const confirmingHost =
    state.mode.kind === 'confirming' || state.mode.kind === 'approving'
      ? state.mode.host
      : null

  /*
   * While a confirm is open the other rows step aside.
   *
   * Found by clicking the card, not by reasoning: with all six rows present the
   * confirm block was clipped by the list's scroll clamp, so Cancel and Confirm
   * sat off-screen — an irreversible question with no visible way to answer it.
   * Showing one row keeps the whole question on screen, and matches the rule that
   * this is one deliberate decision at a time.
   */
  const visibleBlocked = confirmingHost
    ? rows.blocked.filter(row => row.host === confirmingHost)
    : rows.blocked
  const visibleAllowed = confirmingHost ? [] : rows.allowed

  useEffect(() => {
    onExpandedChange?.(state.expanded)
  }, [state.expanded, onExpandedChange])

  /*
   * Opening with the keyboard moves focus to the first Allow; opening with the
   * mouse does not, because the pointer already knows where it is.
   */
  useEffect(() => {
    if (state.expanded && state.openedByKeyboard && controlsAllowed) {
      firstAllowRef.current?.focus()
    }
  }, [state.expanded, state.openedByKeyboard, controlsAllowed])

  const approve = useCallback(
    async (host: string): Promise<void> => {
      dispatch({ type: 'approveStarted', host })
      const result = await onApprove(host)
      if (result.ok) {
        dispatch({ type: 'approveSucceeded', host })
      } else {
        dispatch({ type: 'approveFailed', host, errorCode: result.errorCode })
      }
      // Success: the row this came from no longer exists, so the chip is the only
      // correct place. Failure: the row is back, with its Allow button — but the
      // ref points at whichever row is now first, so the chip is the honest
      // destination in both cases rather than a guess at identity.
      chip.current?.focus()
    },
    [onApprove, chip]
  )

  /*
   * Arrow keys move between ALLOW BUTTONS, not rows.
   *
   * The stylesheet defines `:focus-visible` for the chip and for Allow, and for
   * nothing else — a focusable row would be a tab stop with no focus indicator,
   * and adding one means a second way to paint a focus ring, which the Menu card
   * spent a paragraph arguing against. Allowed and non-approvable rows are still
   * read in a screen reader's browse mode, and the chip's counts announce them.
   */
  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const buttons = Array.from(
      scrollRef.current?.querySelectorAll<HTMLButtonElement>('[data-band-allow]') ?? []
    )
    if (buttons.length === 0) return
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'ArrowDown'
        ? Math.min(index + 1, buttons.length - 1)
        : Math.max(index - 1, 0)
    event.preventDefault()
    buttons[index === -1 ? 0 : next].focus()
  }

  const onBandKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') return
    // The confirm box handles its own Escape and stops propagation, so reaching
    // here means the list is open with no question on it.
    if (!state.expanded) return
    event.preventDefault()
    // Do NOT let this reach the panel, or one Escape would both close the
    // confirm and close the find bar.
    event.stopPropagation()
    dispatch({ type: 'collapse' })
    chip.current?.focus()
  }

  const rovingHost = visibleBlocked.find(row => row.state === 'allow')?.host ?? null

  return (
    <div className="erf-band" onKeyDown={onBandKeyDown}>
      {/*
        Mounted for the panel's whole life and empty until it has something to
        say. A live region created at the same moment as its content is not
        announced — so this element existing early is the mechanism, not decoration.

        Deliberately NOT announced here: a newly blocked host. A polite region
        firing on every block is a toast with extra steps, and "nothing pops up"
        is the whole point of the band.
      */}
      <div className="erf-band__announce" role="status" aria-live="polite">
        {state.announcement}
      </div>

      <div className="erf-band__bar" role="toolbar" aria-label="Preview">
        {/*
          Find, matching MarkdownToolbar's search button exactly — same icon at
          the same size, same accessible name, same shortcut in the tooltip. The
          find bar itself is shared: both panels open the same `SearchBar`, this
          one over a Chromium `findInPage` provider.

          The keyboard route existed long before this button did. Cmd/Ctrl+F has
          always worked here, including while focus is inside the native view,
          which swallows renderer keys and needs the accelerator forwarded. The
          button only makes a working feature discoverable.
        */}
        {onFind !== undefined && (
          <button
            type="button"
            className="erf-band__tool"
            aria-label="Find"
            title="Find (Cmd/Ctrl+F)"
            data-testid="preview-band-find"
            onClick={onFind}
          >
            <Search size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
        <span className="erf-band__spacer" />
        <button
          ref={chip}
          type="button"
          className={`erf-band__chip${state.failure ? ' erf-band__chip--failed' : ''}`}
          aria-expanded={state.expanded}
          aria-controls={state.expanded ? listId : undefined}
          aria-label={chipAccessibleName(rows.counts)}
          data-testid="preview-band-chip"
          onClick={event => {
            // Keyboard activation of a <button> dispatches a click with
            // `detail === 0`; a real pointer press reports 1 or more. That is the
            // only way to tell the two apart from one handler.
            dispatch({ type: 'toggle', byKeyboard: event.detail === 0 })
          }}
        >
          <span>{countsLabel(rows.counts)}</span>
          <span className="erf-band__chip-caret" aria-hidden="true">
            {state.expanded ? '▾' : '▸'}
          </span>
        </button>
      </div>

      {/*
        The fail-safe. A page that never yields never confirms it moved, and
        silence has to mean "assume it is still covering you" — so the page is
        hidden rather than trusted, and this says why in plain words.
      */}
      <div className="erf-band__paused" hidden={!paused}>
        <span aria-hidden="true">⚠</span>
        <span>Paused the page so this list cannot be covered.</span>
      </div>

      <div
        className="erf-band__list"
        id={listId}
        hidden={!state.expanded}
        data-unproven={!controlsAllowed || undefined}
      >
        <div className="erf-band__scroll" ref={scrollRef} onKeyDown={onListKeyDown}>
          {visibleBlocked.length > 0 && (
            <div className="erf-band__section">
              {confirmingHost ? 'Approving' : 'Blocked on load'}
            </div>
          )}
          {visibleBlocked.map(row => (
            <div key={row.host}>
              <PreviewBandRow
                row={row}
                failureText={state.failure?.host === row.host ? state.failure.text : null}
                confirming={confirmingHost === row.host}
                confirmId={confirmId}
                isRovingTarget={row.host === rovingHost}
                allowRef={row.host === rovingHost ? firstAllowRef : undefined}
                onAllow={host => dispatch({ type: 'allowClicked', host })}
              />
              {confirmingHost === row.host && (
                <PreviewBandConfirm
                  host={row.host}
                  kinds={row.kinds}
                  busy={state.mode.kind === 'approving'}
                  onCancel={() => {
                    dispatch({ type: 'cancelConfirm' })
                    chip.current?.focus()
                  }}
                  onConfirm={() => void approve(row.host)}
                />
              )}
            </div>
          ))}

          {blockedHostsTruncated && !confirmingHost && (
            <div className="erf-band__section">
              Only the first hosts are listed — this page asked for more.
            </div>
          )}

          {visibleAllowed.length > 0 && (
            <div className="erf-band__section">Allowed in this project</div>
          )}
          {visibleAllowed.map(row => (
            <PreviewBandRow
              key={row.host}
              row={row}
              failureText={null}
              confirming={false}
              confirmId={null}
              isRovingTarget={false}
              allowRef={undefined}
              onAllow={() => {}}
            />
          ))}

          {rows.blocked.length === 0 && rows.allowed.length === 0 && (
            <div className="erf-band__section">No remote hosts requested</div>
          )}
        </div>
      </div>
    </div>
  )
}
