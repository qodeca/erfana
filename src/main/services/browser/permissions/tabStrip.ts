// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One browser tab's strip, main side (spec 025, 025-FR-019, 025-FR-020,
 * 025-FR-054; ADR 0011; design `site-prompts.html`).
 *
 * The strip is a set of rows above the page. This module decides what is in
 * it and tells the owning window through `browser-tab:strip` events (`add`,
 * `change`, `withdraw`); the renderer draws the rows.
 *
 * - **Prompts** (`permission`, `download`, `signIn`) need an answer. Each kind shows one
 *   request at a time; later ones queue behind it and the row carries how
 *   many wait ("+1 waiting"). Two requests at once queue one after the other.
 * - **The gap.** When a prompt row goes – answered, or removed by its owner –
 *   its kind shows nothing for {@link STRIP_QUEUE_GAP_MS}, so a press meant
 *   for one request can never land on the next.
 * - **The input guard, in main.** The renderer blocks a row's buttons for
 *   500 ms after it appears or changes; main enforces the same rule on its
 *   own clock: an answer that arrives less than {@link STRIP_INPUT_GUARD_MS}
 *   after the row was shown is ignored, and the row stays. A `change` that
 *   only updates the waiting count keeps `shownAt` – main's guard restarts
 *   only when the request itself changes. The guard that follows restored
 *   focus is the renderer's alone: main cannot see focus.
 * - **Notices** (`fullscreen`, `pointerLock`) have no answers and go after
 *   {@link STRIP_NOTICE_MS}; a second notice of the same kind restarts it.
 * - **Withdrawn.** {@link TabStrip.withdrawAll} – the page navigated or
 *   crashed, the tab closed – takes every row away; each pending request is
 *   settled `withdrawn`, which its owner treats as denied.
 *
 * Every timer runs on the injected clock, so tests move time instead of
 * waiting for it.
 */
import { randomUUID } from 'node:crypto'
import type { Clock, TimerHandle } from '../../../../shared/clock'
import type { z } from 'zod'
import type { StripAnswer, StripEvent, StripFieldsSchema, StripRow } from '../../../../shared/ipc/browser-tab-schema'
import { logger } from '../../LoggingService'

/** An answer within this many ms of the row appearing or changing is ignored (025-FR-019). */
export const STRIP_INPUT_GUARD_MS = 500
/** After a prompt row goes, its kind shows nothing for this long (025-FR-019). */
export const STRIP_QUEUE_GAP_MS = 300
/** How long a fullscreen or pointer-lock notice shows (025-FR-019). */
export const STRIP_NOTICE_MS = 4000

/** Row kinds that queue and wait for an answer. */
export type PromptKind = 'permission' | 'download' | 'signIn'
/** Row kinds that show for a while and need no answer. */
export type NoticeKind = 'fullscreen' | 'pointerLock'

/**
 * A prompt row as its owner describes it; the strip adds the id, the waiting
 * count and the time. `takesFocus` defaults to false (only a sign-in box after
 * a user-started navigation takes focus, 025-FR-022).
 */
export type PromptSpec = Omit<StripRow, 'requestId' | 'kind' | 'waiting' | 'shownAt' | 'takesFocus'> & {
  readonly kind: PromptKind
  readonly takesFocus?: boolean
}

/** The fields a row's answer may carry (a sign-in box's user name and password). Never logged. */
export type StripFields = z.infer<typeof StripFieldsSchema>

/** How a prompt ended: answered (with the row's fields, if any), or withdrawn without an answer. */
export type PromptOutcome = { readonly answer: StripAnswer; readonly fields?: StripFields } | { readonly withdrawn: true }

/** What {@link TabStrip.answer} did with an answer. */
export type AnswerResult = 'accepted' | 'guarded' | 'unknown' | 'invalid'

export interface TabStripDeps {
  readonly tabId: string
  readonly clock: Clock
  readonly emit: (event: StripEvent) => void
  /** Mints row ids; a random id by default. */
  readonly newId?: () => string
}

interface Pending {
  readonly id: string
  readonly spec: PromptSpec
  readonly settle: (outcome: PromptOutcome) => void
  shownAt: number | null
}

interface Lane {
  shown: Pending | null
  readonly queue: Pending[]
  gap: TimerHandle | undefined
}

interface ShownNotice {
  readonly id: string
  timer: TimerHandle | undefined
}

/** A row id the IPC schema accepts: 32 hex characters. */
function randomRowId(): string {
  return randomUUID().replaceAll('-', '')
}

export class TabStrip {
  private readonly lanes = new Map<PromptKind, Lane>()
  private readonly notices = new Map<NoticeKind, ShownNotice>()
  private disposed = false

  constructor(private readonly deps: TabStripDeps) {}

  /**
   * Queue a prompt; `settle` is called once, with the answer or `withdrawn`.
   * Returns the row id, which {@link remove} takes.
   */
  ask(spec: PromptSpec, settle: (outcome: PromptOutcome) => void): string {
    const id = (this.deps.newId ?? randomRowId)()
    if (this.disposed) {
      safeSettle(settle, { withdrawn: true })
      return id
    }
    const lane = this.lane(spec.kind)
    lane.queue.push({ id, spec, settle, shownAt: null })
    if (lane.shown === null) this.pump(spec.kind)
    else this.emitRow('change', lane.shown, lane)
    return id
  }

  /**
   * Take a request away without settling it – its owner already answered it
   * another way (a saved decision now covers it). A shown row goes, and its
   * kind waits out the gap.
   */
  remove(id: string): void {
    for (const [kind, lane] of this.lanes) {
      if (lane.shown?.id === id) {
        this.takeShown(kind, lane)
        return
      }
      const index = lane.queue.findIndex((p) => p.id === id)
      if (index >= 0) {
        lane.queue.splice(index, 1)
        if (lane.shown !== null) this.emitRow('change', lane.shown, lane)
        return
      }
    }
  }

  /**
   * An answer from the renderer. Only the shown row of a kind can be
   * answered, only with one of its own answers, and only once the input
   * guard has passed on main's clock. `fields` go to the row's owner only.
   */
  answer(id: string, answer: StripAnswer, fields?: StripFields): AnswerResult {
    for (const [kind, lane] of this.lanes) {
      const shown = lane.shown
      if (shown === null || shown.id !== id) continue
      if (!shown.spec.answers.includes(answer)) return 'invalid'
      if (shown.shownAt === null || this.deps.clock.now() - shown.shownAt < STRIP_INPUT_GUARD_MS) {
        logger.debug('Ignored a strip answer inside the input guard', { kind })
        return 'guarded'
      }
      this.takeShown(kind, lane)
      safeSettle(shown.settle, fields === undefined ? { answer } : { answer, fields })
      return 'accepted'
    }
    return this.notices.size > 0 && [...this.notices.values()].some((n) => n.id === id) ? 'invalid' : 'unknown'
  }

  /** Show a notice for {@link STRIP_NOTICE_MS}; a second one of the same kind replaces it and restarts the time. */
  notice(kind: NoticeKind, text: string, requester: StripRow['requester']): void {
    if (this.disposed) return
    const existing = this.notices.get(kind)
    const id = existing?.id ?? (this.deps.newId ?? randomRowId)()
    if (existing !== undefined) this.deps.clock.clearTimeout(existing.timer)
    const entry: ShownNotice = existing ?? { id, timer: undefined }
    this.notices.set(kind, entry)
    const row: StripRow = { requestId: id, kind, text, answers: [], takesFocus: false, shownAt: this.deps.clock.now() }
    if (requester !== undefined) row.requester = requester
    this.emit({ tabId: this.deps.tabId, op: existing === undefined ? 'add' : 'change', row })
    entry.timer = this.deps.clock.setTimeout(() => {
      this.notices.delete(kind)
      this.emit({ tabId: this.deps.tabId, op: 'withdraw', requestId: id })
    }, STRIP_NOTICE_MS)
  }

  /** How many prompts of `kind` are shown or queued. */
  pendingCount(kind: PromptKind): number {
    const lane = this.lanes.get(kind)
    return lane === undefined ? 0 : lane.queue.length + (lane.shown === null ? 0 : 1)
  }

  /**
   * The page navigated or crashed: every row goes, and every pending request
   * is settled `withdrawn` (denied).
   */
  withdrawAll(): void {
    const settled: Pending[] = []
    for (const lane of this.lanes.values()) {
      this.deps.clock.clearTimeout(lane.gap)
      lane.gap = undefined
      if (lane.shown !== null) {
        this.emit({ tabId: this.deps.tabId, op: 'withdraw', requestId: lane.shown.id })
        settled.push(lane.shown)
        lane.shown = null
      }
      settled.push(...lane.queue.splice(0))
    }
    for (const [kind, notice] of this.notices) {
      this.deps.clock.clearTimeout(notice.timer)
      this.notices.delete(kind)
      this.emit({ tabId: this.deps.tabId, op: 'withdraw', requestId: notice.id })
    }
    for (const pending of settled) safeSettle(pending.settle, { withdrawn: true })
  }

  /** The tab closed: withdraw everything, emit nothing more. */
  dispose(): void {
    this.disposed = true
    this.withdrawAll()
  }

  private lane(kind: PromptKind): Lane {
    let lane = this.lanes.get(kind)
    if (lane === undefined) {
      lane = { shown: null, queue: [], gap: undefined }
      this.lanes.set(kind, lane)
    }
    return lane
  }

  /** The shown row goes; the kind waits out the gap before showing the next. */
  private takeShown(kind: PromptKind, lane: Lane): void {
    const shown = lane.shown
    if (shown === null) return
    lane.shown = null
    this.emit({ tabId: this.deps.tabId, op: 'withdraw', requestId: shown.id })
    this.deps.clock.clearTimeout(lane.gap)
    lane.gap = this.deps.clock.setTimeout(() => {
      lane.gap = undefined
      this.pump(kind)
    }, STRIP_QUEUE_GAP_MS)
  }

  private pump(kind: PromptKind): void {
    const lane = this.lane(kind)
    if (this.disposed || lane.shown !== null || lane.gap !== undefined) return
    const next = lane.queue.shift()
    if (next === undefined) return
    next.shownAt = this.deps.clock.now()
    lane.shown = next
    this.emitRow('add', next, lane)
  }

  private emitRow(op: 'add' | 'change', pending: Pending, lane: Lane): void {
    const row: StripRow = {
      ...pending.spec,
      requestId: pending.id,
      takesFocus: pending.spec.takesFocus ?? false,
      waiting: lane.queue.length,
      shownAt: pending.shownAt ?? this.deps.clock.now()
    }
    this.emit({ tabId: this.deps.tabId, op, row })
  }

  private emit(event: StripEvent): void {
    if (this.disposed) return
    try {
      this.deps.emit(event)
    } catch (error) {
      logger.warn('A browser strip event could not be sent', { error: String(error) })
    }
  }
}

/** Run a settle callback; one owner's failure never stops the others. */
function safeSettle(settle: (outcome: PromptOutcome) => void, outcome: PromptOutcome): void {
  try {
    settle(outcome)
  } catch (error) {
    logger.error('A browser strip request could not be settled', error instanceof Error ? error : undefined)
  }
}
