// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The "Pop-up blocked" row of one browser tab (spec 025, 025-FR-011 rule 3,
 * 025-FR-054; design `site-prompts.html`).
 *
 * Shown in the tab's strip – never in the toolbar – when the popup blocker
 * stopped an open. **Allow once** opens the blocked address; **Always allow
 * for this site** saves the site's exception and opens it too; the close
 * button (`dismiss`) only hides the row. Main enforces the strip's 500 ms
 * input guard ({@link GuardedStripRow}).
 *
 * One row per tab: further blocked opens while it shows keep the row (and
 * its guard) and replace the address it would open, so **Allow once** opens
 * the most recent one. The row names the site that tried (the requester
 * line); a blocked open from another site changes the row, which restarts
 * the guard. A new document in the tab takes the row away.
 *
 * Electron cannot re-create a refused window with its `window.opener` link,
 * so the address opens as a new tab under the `page` source.
 */
import type { Clock } from '../../../../shared/clock'
import type { StripEvent, StripRow } from '../../../../shared/ipc/browser-tab-schema'
import type { AnswerResult } from '../permissions/tabStrip'
import { GuardedStripRow } from '../dialogs/guardedStripRow'

/** The row's text, a one-line clause with no full stop (spec "Fixed sentences"). */
export const POPUP_BLOCKED_TEXT = 'Pop-up blocked'

/** A blocked open: what would have opened, and the site that tried. */
export interface BlockedOpen {
  readonly url: string
  /** The opener page's origin, the key of **Always allow for this site**. */
  readonly siteOrigin: string
  readonly requester: StripRow['requester']
}

export interface PopupBlockedRowDeps {
  readonly tabId: string
  readonly clock: Pick<Clock, 'now'>
  readonly emit: (event: StripEvent) => void
  /** Open `open.url` as a new tab (**Allow once** and **Always allow**). */
  readonly openOnce: (open: BlockedOpen) => void
  /** Save the site's exception (**Always allow for this site**). */
  readonly alwaysAllow: (siteOrigin: string) => void
  readonly newId?: () => string
}

export class PopupBlockedRow {
  private readonly row: GuardedStripRow
  private latest: BlockedOpen | null = null

  constructor(private readonly deps: PopupBlockedRowDeps) {
    this.row = new GuardedStripRow({ tabId: deps.tabId, clock: deps.clock, emit: deps.emit, newId: deps.newId })
  }

  get isShown(): boolean {
    return this.row.isShown
  }

  /** An open was blocked: show the row, or keep it and remember this open. */
  blocked(open: BlockedOpen): void {
    this.latest = open
    this.row.show({
      kind: 'popupBlocked',
      text: POPUP_BLOCKED_TEXT,
      answers: ['allowOnce', 'alwaysAllow', 'dismiss'],
      takesFocus: false,
      requester: open.requester
    })
  }

  /** A strip answer; `null` when `requestId` is not this row. */
  answer(requestId: string, answer: StripRow['answers'][number]): AnswerResult | null {
    return this.row.answer(requestId, answer, (given) => {
      const open = this.latest
      this.latest = null
      if (open === null || given === 'dismiss') return
      if (given === 'alwaysAllow') this.deps.alwaysAllow(open.siteOrigin)
      this.deps.openOnce(open)
    })
  }

  /** A new document, or the tab closed: the row goes. */
  hide(): void {
    this.latest = null
    this.row.hide()
  }
}
