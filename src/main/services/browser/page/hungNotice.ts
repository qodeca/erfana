// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The hung-page notice of one browser tab (spec 025, 025-FR-056, 025-FR-054;
 * solution design § 6.3).
 *
 * "This page is not responding." with **Wait** and **Reload**, as a row in
 * the tab's strip above the page, which stays visible behind it. The hang
 * probe (`cdp/browserHangProbe.ts`) decides when the page is hung; this row
 * only shows and goes:
 *
 * - **Input guard** (025-FR-019, as every strip row): an answer within
 *   {@link STRIP_INPUT_GUARD_MS} of the row appearing is ignored on main's
 *   own clock, and the row stays.
 * - **Wait** closes the row; the probe shows it again after another 5 s if
 *   the page still does not answer. **Reload** closes it and reloads.
 * - The row has its own id, so an answer naming another row is not its.
 *
 * Sent as `browser-tab:strip` events (`add`, `withdraw`) like the site rows.
 */
import { randomUUID } from 'node:crypto'
import type { Clock } from '../../../../shared/clock'
import type { StripAnswer, StripEvent } from '../../../../shared/ipc/browser-tab-schema'
import { STRIP_INPUT_GUARD_MS, type AnswerResult } from '../permissions/tabStrip'

/** The notice's text, with its full stop (spec "Fixed sentences"). */
export const HUNG_NOTICE_TEXT = 'This page is not responding.'

export interface HungNoticeDeps {
  readonly tabId: string
  readonly clock: Pick<Clock, 'now'>
  readonly emit: (event: StripEvent) => void
  readonly onWait: () => void
  readonly onReload: () => void
  /** Mints row ids; random by default. */
  readonly newId?: () => string
}

export class HungNotice {
  private shown: { readonly id: string; readonly at: number } | null = null

  constructor(private readonly deps: HungNoticeDeps) {}

  get isShown(): boolean {
    return this.shown !== null
  }

  /** Show the row; nothing when it already shows. */
  show(): void {
    if (this.shown !== null) return
    const id = (this.deps.newId ?? (() => randomUUID().replaceAll('-', '')))()
    const at = this.deps.clock.now()
    this.shown = { id, at }
    this.deps.emit({
      tabId: this.deps.tabId,
      op: 'add',
      row: { requestId: id, kind: 'hung', text: HUNG_NOTICE_TEXT, answers: ['wait', 'reload'], takesFocus: false, shownAt: at }
    })
  }

  /** Take the row away (the page answered, navigated, crashed, or the tab closed). */
  hide(): void {
    const shown = this.shown
    if (shown === null) return
    this.shown = null
    this.deps.emit({ tabId: this.deps.tabId, op: 'withdraw', requestId: shown.id })
  }

  /**
   * An answer to a strip row; `null` when `requestId` is not this row.
   */
  answer(requestId: string, answer: StripAnswer): AnswerResult | null {
    const shown = this.shown
    if (shown === null || shown.id !== requestId) return null
    if (answer !== 'wait' && answer !== 'reload') return 'invalid'
    if (this.deps.clock.now() - shown.at < STRIP_INPUT_GUARD_MS) return 'guarded'
    this.hide()
    if (answer === 'wait') this.deps.onWait()
    else this.deps.onReload()
    return 'accepted'
  }
}
