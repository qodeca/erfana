// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Delete confirmation and the deleted-state probe of a tracker (#478, plan
 * decisions 38–39, F11, F27).
 *
 * - Confirm: a `deleted` event or a read/probe that finds no file waits
 *   `deleteConfirmMs` (500 ms) and asks again. Still missing: the tab shows
 *   the file deleted. Back: it was a delete + recreate (an atomic save, a
 *   `git checkout`, a folder rebuilt – G4), the banner never shows and the
 *   tracker reads the new version.
 * - Probe: while deleted, ask every 500 ms, backing off to 2 s; the first
 *   "exists" takes the file-back path (new id, subscribe, catch-up read).
 *
 * @module shared/freshness/trackerDeleted
 */
import type { Clock, TimerHandle } from '../clock'
import type { DeletedProbeTiming } from './timingProfiles'

/** What a presence probe found. */
export type Presence = 'exists' | 'missing' | 'unknown'

/** What {@link DeletedWatch} drives. */
export interface DeletedWatchDeps {
  readonly clock: Clock
  /** 0 = confirm at once (profiles with no confirm window). */
  readonly confirmMs: number
  /** `null` = no probe loop (the tab relies on change events and checks). */
  readonly probe: DeletedProbeTiming | null
  readonly presence: () => Promise<Presence>
  /** The file is confirmed gone: show it deleted. */
  readonly onConfirmed: () => void
  /** The file was back by the confirm (`exists`), or the probe could not tell (`unknown`). */
  readonly onStillThere: (presence: Exclude<Presence, 'missing'>) => void
  /** The file came back while deleted: take the file-back path. */
  readonly onBack: () => void
}

/** The confirm timer and the deleted-state probe loop of one tracker. */
export class DeletedWatch {
  private confirmTimer: TimerHandle | undefined
  private probeTimer: TimerHandle | undefined
  private probeDelayMs = 0
  /** Bumped by `stop`, so an answer to an older ask is ignored. */
  private epoch = 0

  constructor(private readonly deps: DeletedWatchDeps) {}

  get confirming(): boolean {
    return this.confirmTimer !== undefined
  }

  get probing(): boolean {
    return this.probeTimer !== undefined
  }

  /** Start the confirm window, unless one is running. */
  confirm(): void {
    if (this.confirmTimer !== undefined) return
    const epoch = this.epoch
    this.confirmTimer = this.deps.clock.setTimeout(() => {
      this.confirmTimer = undefined
      void this.ask().then((presence) => {
        if (epoch !== this.epoch) return
        if (presence === 'missing') this.deps.onConfirmed()
        else this.deps.onStillThere(presence)
      })
    }, this.deps.confirmMs)
  }

  /** Start probing for the file to come back. */
  startProbing(): void {
    if (this.deps.probe === null || this.probeTimer !== undefined) return
    this.probeDelayMs = this.deps.probe.firstMs
    this.scheduleProbe()
  }

  private scheduleProbe(): void {
    const timing = this.deps.probe
    if (timing === null) return
    const epoch = this.epoch
    this.probeTimer = this.deps.clock.setTimeout(() => {
      // `probing` stays true through the ask, so no second loop starts; the ask never rejects (C3)
      void this.ask().then((presence) => {
        if (epoch !== this.epoch) return
        this.probeTimer = undefined
        if (presence === 'exists') {
          this.deps.onBack()
          return
        }
        this.probeDelayMs = Math.min(this.probeDelayMs * 2, timing.maxMs)
        this.scheduleProbe()
      })
    }, this.probeDelayMs)
  }

  /** Ask whether the file is there; a rejected ask cannot tell (C3). */
  private ask(): Promise<Presence> {
    return this.deps.presence().catch((): Presence => 'unknown')
  }

  /** Stop the confirm window and the probe loop; pending answers are ignored. */
  stop(): void {
    this.epoch += 1
    this.deps.clock.clearTimeout(this.confirmTimer)
    this.deps.clock.clearTimeout(this.probeTimer)
    this.confirmTimer = undefined
    this.probeTimer = undefined
  }
}
