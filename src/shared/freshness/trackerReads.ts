// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The read pipeline of a tracker (#478, plan decisions 34 and 36, P1–P3, L2).
 *
 * - Single flight: a read asked for while one runs runs once after it (a
 *   `forced` ask wins over any other).
 * - An `event` read, made right after main's write gate, reads at once and
 *   settles only when that read finds the file moving, or no longer at the
 *   stamp the gate saw the writes settle at: the event can reach a busy tab,
 *   or wait behind another read, after a new writer started (P3). Every other
 *   read settles first. A settle that does not end within the gate cap is a
 *   failed attempt (QG-11a K1/V1).
 * - A failed read is retried 3×; Reload and dispose bump the epoch, so a read
 *   started before them is dropped.
 * - A rejected probe or read never escapes: it counts as `unknown` / `failed`.
 *
 * @module shared/freshness/trackerReads
 */
import type { Clock } from '../clock'
import type { FileStamp, FreshnessSource, ReadOutcome, UpdateRule } from './freshnessTypes'
import { readWithRetry } from './readWithRetry'
import { settleRead, type SettleProbe, type SettledOutcome } from './settleRead'
import { isSameStat } from './stamp'
import type { TimingProfile } from './timingProfiles'

/** How a read was triggered: only an `event` read, made right after main's gate, skips the settle. */
export type ReadMode = 'event' | 'trailing' | 'catch-up' | 'check' | 'forced'

/** What the pipeline reads with and reports to. */
export interface TrackerReadsHost<V> {
  readonly filePath: string
  readonly clock: Clock
  readonly profile: TimingProfile
  readonly source: FreshnessSource
  readonly rule: UpdateRule<V>
  isDisposed(): boolean
  /** The rule does not read now (a hidden tab): the change waits. */
  onDeferred(): void
  /** A read finished with an answer; `forced` = it was a Reload's read. */
  onOutcome(outcome: ReadOutcome<V>, forced: boolean): void
}

const FAILED: ReadOutcome<never> = { status: 'failed' }

/**
 * An event read that may not be shown as read: the file moved while it was
 * read, or it is not the version the gate saw the writes settle at.
 */
function needsSettle<V>(outcome: ReadOutcome<V>, settledAt: FileStamp | undefined): boolean {
  if (outcome.status === 'busy') return true
  return outcome.status === 'ok' && settledAt !== undefined && !isSameStat(outcome.stamp, settledAt)
}

/** The single-flight, settled, retried reads of one tracker. */
export class TrackerReads<V> {
  /** Bumped by {@link cancel}: a read started before it is dropped. */
  private epoch = 0
  private reading = false
  private rerun: ReadMode | null = null
  /** The stamp the last `changed` says the writes settled at; none when it brought none. */
  private settledAt: FileStamp | undefined

  constructor(private readonly host: TrackerReadsHost<V>) {}

  /** A `changed` arrived: an event read must find the file at `stamp`, when the change brought one. */
  noteChange(stamp: FileStamp | undefined): void {
    this.settledAt = stamp
  }

  /** Drop the running read's answer and any queued read (Reload, dispose). */
  cancel(): void {
    this.epoch += 1
    this.rerun = null
  }

  /** Read (single-flight; a read asked for while one runs runs once after it). */
  schedule(mode: ReadMode): void {
    if (this.host.isDisposed()) return
    if (mode !== 'forced' && !this.host.rule.readNow()) {
      this.host.onDeferred()
      return
    }
    if (this.reading) {
      this.rerun = this.rerun === 'forced' || mode === 'forced' ? 'forced' : mode
      return
    }
    this.reading = true
    void this.run(mode).finally(() => {
      this.reading = false
      const next = this.rerun
      this.rerun = null
      if (next !== null) this.schedule(next)
    })
  }

  private isCancelled(epoch: number): boolean {
    return this.host.isDisposed() || epoch !== this.epoch
  }

  private async run(mode: ReadMode): Promise<void> {
    const epoch = this.epoch
    const outcome = await readWithRetry(() => this.attempt(mode, epoch), {
      clock: this.host.clock,
      delaysMs: this.host.profile.readRetryDelaysMs,
      isCancelled: () => this.isCancelled(epoch),
    })
    if (outcome === null || this.isCancelled(epoch)) return
    this.host.onOutcome(outcome, mode === 'forced')
  }

  /** The rule's read; a rejection is a failed read (retried, then shown). */
  private readonly read = (): Promise<ReadOutcome<V>> => this.host.rule.read().catch(() => FAILED)

  /** Size and mtime for the settle loop; a rejected probe cannot tell. */
  private readonly settleProbe = async (): Promise<SettleProbe> => {
    try {
      const reply = await this.host.source.probe(this.host.filePath)
      if (reply.status === 'missing') return { status: 'missing' }
      if (reply.status === 'same' || reply.status === 'changed') {
        return { status: 'present', size: reply.stamp.size, mtimeMs: reply.stamp.mtimeMs }
      }
    } catch {
      // The probe could not answer: the read decides
    }
    return { status: 'unknown' }
  }

  /** One read attempt: an event read reads at once; every other read settles first (decision 34). */
  private attempt(mode: ReadMode, epoch: number): Promise<SettledOutcome<V>> {
    const settled = (): Promise<SettledOutcome<V>> =>
      settleRead({
        clock: this.host.clock,
        settleMs: this.host.profile.settleMs,
        capMs: this.host.profile.gateCapMs,
        probe: this.settleProbe,
        read: this.read,
        isCancelled: () => this.isCancelled(epoch),
      })
    if (mode !== 'event') return settled()
    const settledAt = this.settledAt
    return this.read().then((outcome) => (needsSettle(outcome, settledAt) ? settled() : outcome))
  }
}
