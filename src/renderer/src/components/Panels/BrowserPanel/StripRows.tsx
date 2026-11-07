// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The strip above a browser tab's page (spec 025, 025-FR-054; design § Anatomy
 * zone 5, § Site prompts; Site prompts card, proposed): the refused-address
 * error first, then one row per kind in the fixed order, each drawn by
 * {@link StripRow}. Answers go to main with `answerStrip`.
 *
 * - **Where focus goes** when a row that held it goes (H-10): to the next row
 *   as a group – never a granting button – with that row's input guard
 *   re-armed; with no row left, to the page area.
 * - **Announcements**: each arriving row is said once in this tab's polite
 *   region (deck *Announce – prompt arrives*). Every other announcement ends
 *   in a no-break space, so a row whose words match the last one still
 *   changes the region and is said again.
 * - **Answers** resolve with whether main took them, so a row waiting on its
 *   answer (the sign-in box) can recover when main refused it or the call failed.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useLatestRef } from '../../../hooks/useLatestRef'
import type { StripAnswer } from '../../../../../shared/ipc/browser-tab-schema'
import type { ShownStripRow } from '../../../stores/useBrowserChromeStore'
import { browserTabGateway } from '../../../services/browserTabGateway'
import { logger } from '../../../utils/logger'
import { arrivalAnnouncement, sortStripRows } from './stripRows.logic'
import { StripRow, type StripFields } from './StripRow'
import { BROWSER_TEST_IDS } from './browserTestIds'
import './StripRows.css'

const NO_BREAK_SPACE = '\u00a0'

/** Props for {@link StripRows}. */
export interface StripRowsProps {
  readonly tabId: string | null
  readonly rows: readonly ShownStripRow[]
  /** The refused-address message (the first strip row), or `null`. */
  readonly refused: string | null
  /** The refused message's element id, which the address field points at. */
  readonly refusedId: string
  /** Focus the page area: the last row went while it held focus. */
  readonly onEmpty: () => void
}

/**
 * Renders the strip.
 *
 * @param props - {@link StripRowsProps}
 * @returns The strip, or nothing when it is empty
 */
export function StripRows({ tabId, rows, refused, refusedId, onEmpty }: StripRowsProps): JSX.Element | null {
  const sorted = sortStripRows(rows)
  const [announcement, setAnnouncement] = useState({ text: '', count: 0 })
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set())
  const containerRef = useRef<HTMLDivElement>(null)
  const sortedRef = useLatestRef(sorted)
  const onEmptyRef = useLatestRef(onEmpty)
  // A row that held focus is leaving: its index among the rows before it went.
  const pendingRestore = useRef<{ index: number; requestId: string } | null>(null)

  // Say each new row once (derived from the rows, not mirrored through an effect).
  const fresh = sorted.find(shown => !seen.has(shown.row.requestId))
  if (fresh !== undefined) {
    setSeen(new Set([...seen, ...sorted.map(shown => shown.row.requestId)]))
    // The same words again would leave the live region unchanged, and unsaid.
    const count = announcement.count + 1
    setAnnouncement({ text: `${arrivalAnnouncement(fresh.row)}${count % 2 === 0 ? NO_BREAK_SPACE : ''}`, count })
  }

  const onLeaving = useCallback(
    (requestId: string) => {
      const index = sortedRef.current.findIndex(shown => shown.row.requestId === requestId)
      pendingRestore.current = { index: Math.max(0, index), requestId }
    },
    [sortedRef]
  )

  // After the leaving row's cleanup: the next row as a group (its focus handler
  // re-arms its guard), never a granting button; with no row left, the page area.
  useLayoutEffect(() => {
    const pending = pendingRestore.current
    if (pending === null) return
    pendingRestore.current = null
    const remaining = sorted.filter(shown => shown.row.requestId !== pending.requestId)
    const target = remaining[pending.index] ?? remaining[remaining.length - 1]
    if (target === undefined) {
      onEmptyRef.current()
      return
    }
    const id = CSS.escape(target.row.requestId)
    containerRef.current?.querySelector<HTMLElement>(`[data-request-id="${id}"]`)?.focus()
  })

  /** Send an answer; resolves with whether main took it, never rejects. */
  const answer = useCallback(
    (requestId: string, given: StripAnswer, fields?: StripFields): Promise<boolean> => {
      if (tabId === null) return Promise.resolve(false)
      return browserTabGateway.answerStrip({ tabId, requestId, answer: given, ...(fields === undefined ? {} : { fields }) }).then(
        (result) => result === 'accepted',
        (error: unknown) => {
          logger.warn('Browser strip answer failed', { error: error instanceof Error ? error.message : String(error) })
          return false
        }
      )
    },
    [tabId]
  )

  return (
    <>
      <span className="erf-brw-hidden" aria-live="polite" data-testid={BROWSER_TEST_IDS.STRIP_ANNOUNCER}>
        {announcement.text}
      </span>
      {(refused !== null || sorted.length > 0) && (
        <div ref={containerRef} className="erf-site-prompts" data-testid={BROWSER_TEST_IDS.STRIP}>
          {refused !== null && (
            <p id={refusedId} className="erf-brw-refused" role="alert" data-testid={BROWSER_TEST_IDS.REFUSED}>
              <span className="erf-brw-hidden">Error: </span>
              {refused}
            </p>
          )}
          {sorted.map(shown => (
            <StripRow
              key={shown.row.requestId}
              row={shown.row}
              since={shown.since}
              onAnswer={(given, fields) => answer(shown.row.requestId, given, fields)}
              onLeavingWithFocus={() => onLeaving(shown.row.requestId)}
            />
          ))}
        </div>
      )}
    </>
  )
}
