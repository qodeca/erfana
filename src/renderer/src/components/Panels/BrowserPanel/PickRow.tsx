// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The pick row (spec 025, 025-FR-025, 025-FR-026, 025-FR-060, 025-FR-061,
 * 025-FR-065; design § Anatomy zone 3 and § Pick row, deck *Pick banner,
 * label and notes*, *Send notice*; ADR 0011 decision 5: always reserved;
 * commit 19). Under the navigation row, in the order **Pick element**, the
 * status slot, a spacer, the width preset (commit 20, `WidthPresetMenu`) and
 * the target chooser.
 *
 * - **Pick element** toggles pick mode (`aria-pressed`); on an empty tab or
 *   an Erfana page it is `aria-disabled` and its press shows "Load a page to
 *   pick an element". Its tooltip names both uses of Ctrl/Cmd+E (025-AC-081).
 * - **The status slot** shows, in order of priority: the send notice (5 s,
 *   paused under the pointer or keyboard focus), a note (4 s or 2 s), the
 *   banner for where keyboard focus is – its later clauses fold first as the
 *   row narrows – and the "Page paused" or "Still image" chip, then the
 *   "1 site request waiting" chip (S-28). The slot has no live role: the
 *   tab's hidden polite region (`PickAnnouncer`) says what the design lists,
 *   never the hover label (M-45). The hover label is read here from the
 *   store, so a hover moving across the page re-renders this row only.
 * - **The target chooser** opens over the page's still image.
 * - While the panel or the dialog is open (`surface`), the row marks
 *   `data-surface`: the width preset leaves and the target folds, so the
 *   banner's first clause never clips (025-FR-065, `PickRow.css`).
 * - **Tooltips** of both toolbar rows draw inside this row's band
 *   (`ToolbarTooltip`); while one shows, the send notice's 5 s pause.
 *
 * The row is an F6 zone (`data-brw-zone="pick"`).
 */
import { forwardRef, useEffect, useRef, useState } from 'react'
import { FileText, SquareMousePointer, SquareTerminal } from 'lucide-react'
import { useBrowserPickStore, type PickTabView } from '../../../stores/useBrowserPickStore'
import { browserShortcut } from './browserShortcuts'
import { heldRequestsText, NOTE_TEXT, noteDuration, pickBanner, type PickPlace } from './pickRow.logic'
import type { SendNotice as SendNoticeFacts } from './useBrowserPick'
import { BROWSER_TEST_IDS } from './browserTestIds'
import { tooltipProps } from './ToolbarTooltip'

/** How long the send notice shows (025-FR-060). */
export const SEND_NOTICE_MS = 5000

/** Props for {@link PickRow}. */
export interface PickRowProps {
  readonly tabId: string | null
  /** The tab's pick state, without the hover label – this row reads that itself. */
  readonly pick: PickTabView
  /** A web page is shown: pick mode may start. */
  readonly live: boolean
  readonly place: PickPlace
  /** The page area shows a still image (panel or dialog open, page not paused). */
  readonly still: boolean
  /** Site requests held while the menu or dialog is open (S-28); 0 when none. */
  readonly heldRequests?: number
  readonly notice: SendNoticeFacts | null
  readonly onToggle: () => void
  readonly onShowTerminal: () => void
  readonly onOpenCapture: (contextPath: string) => void
  readonly onNoticeDone: () => void
  /** The target chooser. */
  readonly target: React.ReactNode
  /** The width preset menu button; folds by CSS (`PickRow.css`). */
  readonly widthPreset?: React.ReactNode
  /** The prompt-actions panel or the instruction dialog is open over the page. */
  readonly surface?: 'none' | 'panel' | 'dialog'
  /** The toolbar tooltip bubble, drawn in this row's band. */
  readonly tooltip?: React.ReactNode
  /** A toolbar tooltip shows: the send notice's timer pauses under it. */
  readonly tooltipOpen?: boolean
}

/** The send notice, with its 5 s that pause while the pointer or focus is on it. */
function SendNoticeSlot({
  notice,
  onShowTerminal,
  onOpenCapture,
  onDone,
  held
}: {
  readonly notice: SendNoticeFacts
  readonly onShowTerminal: () => void
  readonly onOpenCapture: (contextPath: string) => void
  readonly onDone: () => void
  /** A toolbar tooltip shows in the band (design R2-H5: the 5 s pause under it). */
  readonly held: boolean
}): JSX.Element {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused || held
  // A pause stops the clock; after it only the time left runs (025-FR-060). A new notice starts afresh.
  const remainingRef = useRef(SEND_NOTICE_MS)
  useEffect(() => {
    remainingRef.current = SEND_NOTICE_MS
  }, [notice])
  useEffect(() => {
    if (paused) return
    const started = Date.now()
    const timer = setTimeout(onDone, remainingRef.current)
    return () => {
      clearTimeout(timer)
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - started))
    }
  }, [paused, onDone, notice])
  return (
    <span
      className="erf-brw-notice"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <span className="erf-brw-notice__text">{notice.text}</span>
      <button type="button" className="erf-brw-notice__action" aria-label="Show terminal" onClick={onShowTerminal}>
        <SquareTerminal size={14} strokeWidth={2} aria-hidden="true" />
        <span className="erf-brw-notice__label">Show terminal</span>
      </button>
      <button
        type="button"
        className="erf-brw-notice__action"
        aria-label="Open capture"
        aria-description="Opens the context file in an editor tab"
        onClick={() => onOpenCapture(notice.contextPath)}
      >
        <FileText size={14} strokeWidth={2} aria-hidden="true" />
        <span className="erf-brw-notice__label">Open capture</span>
      </button>
    </span>
  )
}

/**
 * Renders the pick row.
 *
 * @param props - {@link PickRowProps}
 * @param ref - The row, for F6
 * @returns The row
 */
export const PickRow = forwardRef<HTMLDivElement, PickRowProps>(function PickRow(props, ref) {
  const { tabId, pick, live, place, notice } = props
  const shortcut = browserShortcut('pick')
  // Read here, not in the panel: each hovered element re-renders this row alone (performance review).
  const label = useBrowserPickStore(s => (tabId === null ? null : (s.byTab.get(tabId)?.label ?? null)))

  // A note replaces the banner's later clauses for its time, then goes (a newer note restarts it).
  useEffect(() => {
    if (pick.note === null || tabId === null) return
    const seq = pick.noteSeq
    const timer = setTimeout(() => useBrowserPickStore.getState().clearNote(tabId, seq), noteDuration(pick.note))
    return () => clearTimeout(timer)
  }, [pick.note, pick.noteSeq, tabId])

  const banner = pick.on || pick.capture !== null ? pickBanner(place, shortcut.label, label) : null
  const note = pick.note === null ? null : NOTE_TEXT[pick.note]
  const chip = pick.capture === null ? null : pick.frozen ? 'Page paused' : props.still ? 'Still image' : null
  const held = heldRequestsText(props.heldRequests ?? 0)
  const tooltip = pick.on
    ? `Stop picking\n${shortcut.label} starts picking, then picks what is under the mouse`
    : live
      ? `Pick element (${shortcut.label}) – press ${shortcut.label} again to pick what is under the mouse\nMenus stay open while picking – click to pick`
      : 'Load a page to pick an element'

  return (
    <div
      ref={ref}
      className="erf-brw-pick"
      role="group"
      aria-label="Pick and send"
      data-brw-zone="pick"
      data-picking={pick.on ? 'true' : undefined}
      data-notice={notice !== null ? 'true' : undefined}
      data-surface={props.surface === undefined || props.surface === 'none' ? undefined : props.surface}
      data-testid={BROWSER_TEST_IDS.PICK_ROW}
    >
      <button
        type="button"
        className="erf-brw-pickbtn"
        aria-pressed={pick.on}
        aria-disabled={live ? undefined : true}
        aria-keyshortcuts={shortcut.aria}
        {...tooltipProps(tooltip)}
        onClick={props.onToggle}
      >
        <SquareMousePointer size={16} strokeWidth={2} aria-hidden="true" />
        <span className="erf-brw-pickbtn__label">Pick element</span>
      </button>
      <span className="erf-brw-status" data-testid={BROWSER_TEST_IDS.PICK_STATUS}>
        {notice !== null ? (
          <SendNoticeSlot
            notice={notice}
            onShowTerminal={props.onShowTerminal}
            onOpenCapture={props.onOpenCapture}
            onDone={props.onNoticeDone}
            held={props.tooltipOpen === true}
          />
        ) : pick.capturing ? (
          <span className="erf-brw-banner-line">Capturing…</span>
        ) : banner !== null ? (
          <span className="erf-brw-banner-line">
            <span className="erf-brw-banner-line__first">{banner.first}</span>
            {note !== null ? (
              <span className="erf-brw-banner-line__more">{note}</span>
            ) : (
              banner.rest.map((clause, index) => (
                <span key={clause} className={`erf-brw-banner-line__more erf-brw-banner-line__more--${index + 1}`}>
                  {clause}
                </span>
              ))
            )}
            {chip !== null && <span className="erf-brw-tag">{chip}</span>}
            {held !== null && <span className="erf-brw-tag">{held}</span>}
          </span>
        ) : note !== null ? (
          <span className="erf-brw-banner-line">{note}</span>
        ) : null}
      </span>
      <span className="erf-brw-spacer" />
      {props.widthPreset}
      {props.target}
      {props.tooltip}
    </div>
  )
})
