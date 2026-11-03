// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The leave-page prompt of one browser tab (spec 025, 025-FR-058; ADR 0011
 * decision 7; spec change S-31; design `site-prompts.html`).
 *
 * A page with a `beforeunload` handler (and a user gesture on it, which
 * Chromium requires) asks to stay when the user closes the tab, reloads or
 * navigates. Electron asks main synchronously, through `will-prevent-unload`:
 * left alone the unload is cancelled, `preventDefault()` lets it go ahead.
 * The question cannot wait for the user, so:
 *
 * 1. Before an action the user started – close ({@link LeavePageGuard.closeByUser}),
 *    or a load: navigate, Reload, Back, Forward ({@link LeavePageGuard.arm}) –
 *    the tab arms the guard with a way to **repeat** that action.
 * 2. `will-prevent-unload` with an armed action cancels the unload and shows
 *    "Leave this page? Changes may not be saved." with **Leave** and **Stay**
 *    in the strip; the row takes focus on **Stay** (it answers the user's own
 *    action, ADR 0011 decision 10) and keeps the strip's input guard.
 * 3. **Leave** repeats the action with a one-shot pass for the next
 *    `will-prevent-unload` (a close repeats as a close that does not ask);
 *    **Stay** keeps the page.
 *
 * Not asked:
 * - when Erfana closes the tab (quit, window close, project switch – S-31);
 *   those close without `beforeunload` at all;
 * - for an unload the page started itself (a link, a script, a form): there
 *   is no way to repeat it after the user answers, so it goes ahead.
 *
 * A close by the user waits at most {@link LEAVE_CLOSE_TIMEOUT_MS} for the
 * page's `beforeunload` (a hung page never answers) and then closes anyway.
 * The armed action lapses when the load commits or ends.
 */
import type { Clock, TimerHandle } from '../../../../shared/clock'
import type { StripAnswer, StripEvent, StripRow } from '../../../../shared/ipc/browser-tab-schema'
import type { AnswerResult } from '../permissions/tabStrip'
import { GuardedStripRow } from './guardedStripRow'

/** The prompt's text, with its full stop (spec "Fixed sentences"). */
export const LEAVE_PAGE_TEXT = 'Leave this page? Changes may not be saved.'
/** How long a close by the user waits for the page's `beforeunload` before it closes anyway. */
export const LEAVE_CLOSE_TIMEOUT_MS = 3_000

type Listener = (...args: unknown[]) => void

/** The page `webContents` surface the guard uses. */
export interface LeaveContents {
  on(event: string, listener: Listener): unknown
  removeListener(event: string, listener: Listener): unknown
  isDestroyed(): boolean
  close(options: { waitForBeforeUnload: boolean }): void
}

export interface LeavePageGuardDeps {
  readonly tabId: string
  readonly contents: LeaveContents
  readonly clock: Pick<Clock, 'now' | 'setTimeout' | 'clearTimeout'>
  readonly emit: (event: StripEvent) => void
  /** The requester line: the page's origin. */
  readonly requester: () => StripRow['requester']
  /** Close the tab without asking (Leave on a close, or the page never answered). */
  readonly forceClose: () => void
  readonly newId?: () => string
}

export class LeavePageGuard {
  private readonly row: GuardedStripRow
  private armed: (() => void) | null = null
  private pending: (() => void) | null = null
  private passOnce = false
  private closeTimer: TimerHandle | undefined
  private readonly listeners: Array<[string, Listener]> = []

  constructor(private readonly deps: LeavePageGuardDeps) {
    this.row = new GuardedStripRow({ tabId: deps.tabId, clock: deps.clock, emit: deps.emit, newId: deps.newId })
    this.listen('will-prevent-unload', (event) => this.onWillPreventUnload(event as { preventDefault(): void }))
    // The load committed or ended: the armed action and the one-shot pass lapse; the page changed, so the row goes.
    this.listen('did-navigate', () => this.loadSettled(true))
    this.listen('did-stop-loading', () => this.loadSettled(false))
  }

  /** Arm the guard before a load the user started; `repeat` runs that load again. */
  arm(repeat: () => void): void {
    this.armed = repeat
  }

  /** The user closes the tab: run the page's `beforeunload`, and ask if it wants to stay. */
  closeByUser(): void {
    if (this.deps.contents.isDestroyed()) return
    this.armed = () => this.deps.forceClose()
    this.deps.clock.clearTimeout(this.closeTimer)
    this.closeTimer = this.deps.clock.setTimeout(() => {
      this.closeTimer = undefined
      if (!this.row.isShown) this.deps.forceClose()
    }, LEAVE_CLOSE_TIMEOUT_MS)
    this.deps.contents.close({ waitForBeforeUnload: true })
  }

  /** A strip answer; `null` when `requestId` is not the prompt. */
  answer(requestId: string, answer: StripAnswer): AnswerResult | null {
    return this.row.answer(requestId, answer, (given) => {
      const repeat = this.pending
      this.pending = null
      if (given !== 'leave' || repeat === null) return
      this.passOnce = true
      repeat()
    })
  }

  /** The tab closed: stop listening, the row goes. */
  detach(): void {
    this.deps.clock.clearTimeout(this.closeTimer)
    this.closeTimer = undefined
    this.armed = null
    this.pending = null
    this.row.hide()
    if (this.deps.contents.isDestroyed()) return
    for (const [event, listener] of this.listeners) this.deps.contents.removeListener(event, listener)
  }

  private onWillPreventUnload(event: { preventDefault(): void }): void {
    const armed = this.armed
    this.armed = null
    if (this.passOnce || armed === null) {
      // Leave was chosen, or the page started this unload itself: let it go.
      this.passOnce = false
      event.preventDefault()
      return
    }
    this.deps.clock.clearTimeout(this.closeTimer)
    this.closeTimer = undefined
    this.pending = armed
    this.row.show({ kind: 'leavePage', text: LEAVE_PAGE_TEXT, answers: ['leave', 'stay'], takesFocus: true, requester: this.deps.requester() })
  }

  private loadSettled(committed: boolean): void {
    this.armed = null
    this.passOnce = false
    if (committed) {
      this.pending = null
      this.row.hide()
    }
  }

  private listen(event: string, listener: Listener): void {
    this.deps.contents.on(event, listener)
    this.listeners.push([event, listener])
  }
}
