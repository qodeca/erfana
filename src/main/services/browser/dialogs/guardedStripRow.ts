// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One strip row of a browser tab that is not a site request – the
 * "Pop-up blocked" row (025-FR-011) and the leave-page prompt (025-FR-058) –
 * with the strip's main-side rules (025-FR-054, `permissions/tabStrip.ts`):
 *
 * - **Input guard.** An answer within {@link STRIP_INPUT_GUARD_MS} of the row
 *   appearing, or of its content changing, is ignored on main's own clock,
 *   and the row stays.
 * - **Own answers only.** An answer the row does not offer is `invalid`; an
 *   answer naming another row is not this row's (`null`), so the tab service
 *   can ask the next owner.
 * - **One row.** Showing it again with the same content keeps the row and
 *   its guard; new content replaces it (`change`) and restarts the guard.
 *
 * Sent as `browser-tab:strip` events (`add`, `change`, `withdraw`), like the
 * site rows and the hung-page notice.
 */
import { randomUUID } from 'node:crypto'
import type { Clock } from '../../../../shared/clock'
import type { StripAnswer, StripEvent, StripRow } from '../../../../shared/ipc/browser-tab-schema'
import { logger } from '../../LoggingService'
import { STRIP_INPUT_GUARD_MS, type AnswerResult } from '../permissions/tabStrip'

/** What a row shows; the row adds its id and the time. */
export type GuardedRowSpec = Pick<StripRow, 'kind' | 'text' | 'answers' | 'takesFocus' | 'requester'>

export interface GuardedStripRowDeps {
  readonly tabId: string
  readonly clock: Pick<Clock, 'now'>
  readonly emit: (event: StripEvent) => void
  /** Mints row ids; random by default. */
  readonly newId?: () => string
}

interface Shown {
  readonly id: string
  readonly spec: GuardedRowSpec
  readonly at: number
}

function sameSpec(a: GuardedRowSpec, b: GuardedRowSpec): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export class GuardedStripRow {
  private shown: Shown | null = null

  constructor(private readonly deps: GuardedStripRowDeps) {}

  get isShown(): boolean {
    return this.shown !== null
  }

  /** Show `spec`, or change the shown row to it; the same content again changes nothing. */
  show(spec: GuardedRowSpec): void {
    const current = this.shown
    if (current !== null && sameSpec(current.spec, spec)) return
    const id = current?.id ?? (this.deps.newId ?? (() => randomUUID().replaceAll('-', '')))()
    const at = this.deps.clock.now()
    this.shown = { id, spec, at }
    const row: StripRow = { ...withoutUndefined(spec), requestId: id, shownAt: at }
    this.emit({ tabId: this.deps.tabId, op: current === null ? 'add' : 'change', row })
  }

  /** Take the row away; nothing when it is not shown. */
  hide(): void {
    const shown = this.shown
    if (shown === null) return
    this.shown = null
    this.emit({ tabId: this.deps.tabId, op: 'withdraw', requestId: shown.id })
  }

  /**
   * An answer from the owning window. `null` when `requestId` is not this
   * row; otherwise `accepted` (the row goes, `act` runs), `guarded` or `invalid`.
   */
  answer(requestId: string, answer: StripAnswer, act: (answer: StripAnswer) => void): AnswerResult | null {
    const shown = this.shown
    if (shown === null || shown.id !== requestId) return null
    if (!shown.spec.answers.includes(answer)) return 'invalid'
    if (this.deps.clock.now() - shown.at < STRIP_INPUT_GUARD_MS) return 'guarded'
    this.hide()
    act(answer)
    return 'accepted'
  }

  private emit(event: StripEvent): void {
    try {
      this.deps.emit(event)
    } catch (error) {
      logger.warn('A browser strip event could not be sent', { error: String(error) })
    }
  }
}

/** `spec` without keys whose value is `undefined` (the strict row schema refuses them). */
function withoutUndefined(spec: GuardedRowSpec): GuardedRowSpec {
  const { requester, ...rest } = spec
  return requester === undefined ? rest : { ...rest, requester }
}
