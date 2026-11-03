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
 *   row narrows – and the "Page paused" or "Still image" chip. A polite live
 *   region says it.
 * - **The target chooser** opens over the page's still image.
 *
 * The row is an F6 zone (`data-brw-zone="pick"`).
 */
import { forwardRef, useEffect, useRef, useState } from 'react'
import { FileText, SquareMousePointer, SquareTerminal } from 'lucide-react'
import { useBrowserPickStore, type BrowserPickTab } from '../../../stores/useBrowserPickStore'
import { browserShortcut } from './browserShortcuts'
import { NOTE_TEXT, noteDuration, pickBanner, type PickPlace } from './pickRow.logic'
import type { SendNotice as SendNoticeFacts } from './useBrowserPick'
import { BROWSER_TEST_IDS } from './browserTestIds'

/** How long the send notice shows (025-FR-060). */
export const SEND_NOTICE_MS = 5000

/** Props for {@link PickRow}. */
export interface PickRowProps {
  readonly tabId: string | null
  readonly pick: BrowserPickTab
  /** A web page is shown: pick mode may start. */
  readonly live: boolean
  readonly place: PickPlace
  /** The page area shows a still image (panel or dialog open, page not paused). */
  readonly still: boolean
  readonly notice: SendNoticeFacts | null
  readonly onToggle: () => void
  readonly onShowTerminal: () => void
  readonly onOpenCapture: (contextPath: string) => void
  readonly onNoticeDone: () => void
  /** The target chooser. */
  readonly target: React.ReactNode
  /** The width preset menu button; folds by CSS (`PickRow.css`). */
  readonly widthPreset?: React.ReactNode
}

/** The send notice, with its 5 s that pause while the pointer or focus is on it. */
function SendNoticeSlot({
  notice,
  onShowTerminal,
  onOpenCapture,
  onDone
}: {
  readonly notice: SendNoticeFacts
  readonly onShowTerminal: () => void
  readonly onOpenCapture: (contextPath: string) => void
  readonly onDone: () => void
}): JSX.Element {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused
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

  // A note replaces the banner's later clauses for its time, then goes (a newer note restarts it).
  useEffect(() => {
    if (pick.note === null || tabId === null) return
    const seq = pick.noteSeq
    const timer = setTimeout(() => useBrowserPickStore.getState().clearNote(tabId, seq), noteDuration(pick.note))
    return () => clearTimeout(timer)
  }, [pick.note, pick.noteSeq, tabId])

  const banner = pick.on || pick.capture !== null ? pickBanner(place, shortcut.label, pick.label) : null
  const note = pick.note === null ? null : NOTE_TEXT[pick.note]
  const chip = pick.capture === null ? null : pick.frozen ? 'Page paused' : props.still ? 'Still image' : null
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
      data-testid={BROWSER_TEST_IDS.PICK_ROW}
    >
      <button
        type="button"
        className="erf-brw-pickbtn"
        aria-pressed={pick.on}
        aria-disabled={live ? undefined : true}
        aria-keyshortcuts={shortcut.aria}
        title={tooltip}
        onClick={props.onToggle}
      >
        <SquareMousePointer size={16} strokeWidth={2} aria-hidden="true" />
        <span className="erf-brw-pickbtn__label">Pick element</span>
      </button>
      <span className="erf-brw-status" aria-live="polite" data-testid={BROWSER_TEST_IDS.PICK_STATUS}>
        {notice !== null ? (
          <SendNoticeSlot notice={notice} onShowTerminal={props.onShowTerminal} onOpenCapture={props.onOpenCapture} onDone={props.onNoticeDone} />
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
            {chip !== null && <span className="erf-brw-chip">{chip}</span>}
          </span>
        ) : note !== null ? (
          <span className="erf-brw-banner-line">{note}</span>
        ) : null}
      </span>
      <span className="erf-brw-spacer" />
      {props.widthPreset}
      {props.target}
    </div>
  )
})
