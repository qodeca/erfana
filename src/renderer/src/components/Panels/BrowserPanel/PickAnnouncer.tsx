// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The browser tab's one always-mounted, visually hidden polite region for
 * pick and send (spec 025, 025-FR-025, 025-FR-027, 025-FR-060; design
 * § Announcements, M-45). The visible status slot has no live role, so the
 * hovered element's label and every banner rewrite stay silent; this region
 * says only what the design lists: pick mode on and off, each refinement
 * ("Picked {tag}, {size spoken}.") and its end notes, "Page paused." once,
 * and the send with its fallback route named (`pickAnnouncement`).
 *
 * Each sentence replaces the region's child under a new key, so the same
 * sentence said twice in a row is still announced.
 */
import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { IDLE_PICK, useBrowserPickStore, type BrowserPickTab } from '../../../stores/useBrowserPickStore'
import { pickAnnouncement, type PickAnnounceFacts } from './pickRow.logic'
import { BROWSER_TEST_IDS } from './browserTestIds'

/** Props for {@link PickAnnouncer}. */
export interface PickAnnouncerProps {
  readonly tabId: string | null
  /** The send notice's sentence while it shows, else `null`. */
  readonly sent: string | null
}

/** The facts of `tab` the region speaks about – never its hover label. */
function storeFacts(tab: BrowserPickTab): Omit<PickAnnounceFacts, 'sent'> {
  const capture = tab.capture
  return {
    on: tab.on,
    frozen: tab.frozen,
    captureId: capture?.captureId ?? null,
    changedAt: capture?.changedAt ?? null,
    name: capture?.summary.name ?? null,
    size: capture?.summary.size ?? null,
    note: tab.note,
    noteSeq: tab.noteSeq
  }
}

function sameFacts(a: PickAnnounceFacts, b: PickAnnounceFacts): boolean {
  return (Object.keys(a) as Array<keyof PickAnnounceFacts>).every(key => a[key] === b[key])
}

/**
 * Renders the region.
 *
 * @param props - {@link PickAnnouncerProps}
 * @returns The hidden live region
 */
export function PickAnnouncer({ tabId, sent }: PickAnnouncerProps): JSX.Element {
  const fromStore = useBrowserPickStore(useShallow(s => storeFacts(tabId === null ? IDLE_PICK : (s.byTab.get(tabId) ?? IDLE_PICK))))
  const facts: PickAnnounceFacts = { ...fromStore, sent }
  const [seen, setSeen] = useState(facts)
  const [said, setSaid] = useState({ text: '', seq: 0 })
  // A change of state is said once, adjusted during render (React's pattern for state derived from a change).
  if (!sameFacts(seen, facts)) {
    setSeen(facts)
    const text = pickAnnouncement(seen, facts)
    if (text !== null) setSaid(prev => ({ text, seq: prev.seq + 1 }))
  }
  return (
    <span className="erf-brw-hidden" aria-live="polite" data-testid={BROWSER_TEST_IDS.PICK_ANNOUNCER}>
      <span key={said.seq}>{said.text}</span>
    </span>
  )
}
