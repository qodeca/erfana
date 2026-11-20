// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * One tab's "follow the file on disk" (#478): the freshness core.
 *
 * A tracker owns one subscription at a time (a fresh id per subscribe), the
 * last stamp the tab shows, and the one {@link FreshnessState} every notice
 * reads. Its adapter supplies only an {@link UpdateRule} – how to read, whether
 * to read now, how to apply – so the same tracker serves the editor, the image
 * viewer, Markdown preview images, the HTML preview and comment watches.
 *
 * What it guarantees (plan § 3.2):
 * - catch-up: after every `started` / `restarted`, a version that differs from
 *   the tab's (or a change buffered before `started`) is read – G3;
 * - every triggered read settles first and retries a failure 3× (P3, L2); a
 *   change's own read does not, but must find the stamp the writes settled at;
 *   a burst is throttled leading + trailing (P1, P2);
 * - a missing file is confirmed before the tab shows it deleted (G4, F27), and
 *   any sign of it coming back re-subscribes and reads (F11, G5) – so does a
 *   file back by the confirm after main dropped the watch (S1);
 * - `check(reason)` (shown, focus, resume, a save, the limited poll) probes
 *   against the last stamp and does nothing when the content is the same
 *   (S1, N3, G8, L4);
 * - one automatic restart after the watch ends, then `stopped(reason)`.
 *
 * Pure: the source, the clock and the id generator are injected.
 *
 * @module shared/freshness/FreshnessTracker
 */
import type { Clock, TimerHandle } from '../clock'
import type {
  CheckReason,
  ContentState,
  FileStamp,
  FreshnessSource,
  FreshnessState,
  LiveRefresh,
  ReadOutcome,
  SubscribeReply,
  UpdateRule,
  WatchEvent,
  WatchState,
  WatchStopReason,
} from './freshnessTypes'
import { isSameContent } from './stamp'
import { createThrottle, type Throttle } from './throttle'
import { TIMING_PROFILES, type TimingProfile, type TimingProfileName } from './timingProfiles'
import { DeletedWatch, type Presence } from './trackerDeleted'
import {
  WatchIds,
  isProjectEnd,
  isQuietRefusal,
  stopReasonForEnd,
  stopReasonForRefusal,
  subscribeSafely,
  type SubscribePurpose,
} from './trackerRestart'
import { TrackerReads, type ReadMode } from './trackerReads'

/** What a tracker is built from. */
export interface FreshnessTrackerOptions<V> {
  readonly filePath: string
  readonly profile: TimingProfileName
  readonly source: FreshnessSource
  readonly clock: Clock
  readonly rule: UpdateRule<V>
  /** Mints a subscription id (a UUID in production). */
  readonly newId: () => string
}

/** The content of a tab that cannot show its file is read-only and never autosaves (F1, F33). */
export function isContentBlocked(state: FreshnessState): boolean {
  return state.content.kind === 'unavailable'
}

const INITIAL_STATE: FreshnessState = { watch: { kind: 'active', live: 'full' }, content: { kind: 'fresh' } }

function sameWatch(a: WatchState, b: WatchState): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'active' && b.kind === 'active') return a.live === b.live
  if (a.kind === 'stopped' && b.kind === 'stopped') return a.reason === b.reason
  return true
}

function sameContentState(a: ContentState, b: ContentState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export class FreshnessTracker<V> {
  private readonly profile: TimingProfile
  private readonly ids: WatchIds
  private readonly throttle: Throttle
  private readonly deleted: DeletedWatch
  private readonly reads: TrackerReads<V>
  private readonly listeners = new Set<() => void>()
  private readonly stopEvents: () => void
  private state: FreshnessState = INITIAL_STATE
  private stamp: FileStamp | undefined
  private disposed = false
  private visible = true
  private limitedTimer: TimerHandle | undefined
  private checking = false
  /** A check asked for while one ran: run once more after it, so none is lost (S3). */
  private recheck = false
  /** The running file-back: a second sign of the file joins it (C4). */
  private fileBackRun: Promise<void> | null = null

  constructor(private readonly options: FreshnessTrackerOptions<V>) {
    this.profile = TIMING_PROFILES[options.profile]
    this.ids = new WatchIds(options.newId)
    this.reads = new TrackerReads<V>({
      filePath: options.filePath,
      clock: options.clock,
      profile: this.profile,
      source: options.source,
      rule: options.rule,
      isDisposed: () => this.disposed,
      onDeferred: () => {
        if (this.state.content.kind !== 'deleted') this.setContent({ kind: 'changed', mode: 'deferred' })
      },
      onOutcome: (outcome, forced) => this.onReadOutcome(outcome, forced),
    })
    // A trailing read comes up to a window after its change; a writer may have started since (P3)
    this.throttle = createThrottle(options.clock, this.profile.throttleMs, (late) =>
      this.scheduleRead(late ? 'trailing' : 'event')
    )
    this.deleted = new DeletedWatch({
      clock: options.clock,
      confirmMs: this.profile.deleteConfirmMs ?? 0,
      probe: this.profile.deletedProbe,
      presence: () => this.presence(),
      onConfirmed: () => this.enterDeleted(),
      // Main dropped a watch it saw deleted: the recreated file needs a new one (S1). An
      // unknown answer reads instead; a read that finds no file confirms again.
      onStillThere: (presence) =>
        this.ids.dead && presence === 'exists' ? void this.fileBack() : this.scheduleRead('catch-up'),
      onBack: () => {
        void this.fileBack()
      },
    })
    this.stopEvents = options.source.onEvent((event) => this.onEvent(event))
  }

  // ---- public surface -------------------------------------------------------

  /** The state object every notice reads (stable between changes, for `useSyncExternalStore`). */
  getState(): FreshnessState {
    return this.state
  }

  /** Listen to state changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The stamp of the version the tab shows (or adopted). */
  get lastStamp(): FileStamp | undefined {
    return this.stamp
  }

  /** The current subscription id (for the save add-on's pause). */
  get watchId(): string | null {
    return this.ids.current
  }

  /**
   * Start following, from the version the tab already shows (`baseline`, the
   * stamp of its initial read). Without a baseline the catch-up always reads.
   */
  async begin(baseline?: FileStamp): Promise<void> {
    this.stamp = baseline
    await this.subscribeNew('begin')
  }

  /**
   * Check the file against the last stamp (shown, focus, resume, after a save,
   * limited poll). Every reason does the same; it names the trigger for callers and logs.
   */
  check(_reason: CheckReason): void {
    if (this.disposed) return
    if (this.state.content.kind === 'changed' && this.state.content.mode === 'deferred' && this.options.rule.readNow()) {
      this.scheduleRead('check')
      return
    }
    if (this.checking) {
      this.recheck = true
      return
    }
    this.checking = true
    void this.runChecks()
  }

  /** Reload from disk: a new subscription and a forced, settled read that ignores "held". */
  async reload(): Promise<void> {
    if (this.disposed) return
    this.reads.cancel()
    this.throttle.cancel()
    this.ids.resetRestart()
    await this.subscribeNew('reload')
    this.scheduleRead('forced')
  }

  /** Keep my version (and Dismiss): adopt the disk's current stamp, so autosave may write (N6). */
  async keepLocal(): Promise<void> {
    const reply = await this.options.source.probe(this.options.filePath, this.stamp?.hash).catch(() => null)
    if (this.disposed) return
    if (reply?.status === 'missing') {
      this.deleted.confirm()
      return
    }
    if (reply?.status === 'same' || reply?.status === 'changed') this.stamp = reply.stamp
    this.setContent({ kind: 'fresh' })
  }

  /** Adopt a stamp as the tab's own version (a save that wrote it – N1). */
  adoptStamp(stamp: FileStamp): void {
    this.stamp = stamp
    if (this.state.content.kind !== 'deleted') this.setContent({ kind: 'fresh' })
  }

  /** Put the tab in conflict (an autosave given up because the disk changed – F16). */
  markChangedOnDisk(notSaved: boolean): void {
    this.setContent({ kind: 'changed', mode: 'held', notSaved })
  }

  /** The tab became visible or hidden: a shown tab checks; a visible limited tab polls (G7). */
  setVisible(visible: boolean): void {
    const wasVisible = this.visible
    this.visible = visible
    this.updateLimitedPoll()
    if (visible && !wasVisible) this.check('shown')
  }

  /** Stop following: unsubscribe, clear every timer, drop pending reads. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.reads.cancel()
    this.throttle.cancel()
    this.deleted.stop()
    this.options.clock.clearInterval(this.limitedTimer)
    this.limitedTimer = undefined
    this.stopEvents()
    const id = this.ids.clear()
    if (id !== null) void this.options.source.unsubscribe(id).catch(() => undefined)
    this.listeners.clear()
  }

  // ---- state ----------------------------------------------------------------

  private setState(next: FreshnessState): void {
    if (sameWatch(next.watch, this.state.watch) && sameContentState(next.content, this.state.content)) return
    this.state = next
    this.updateLimitedPoll()
    this.options.rule.onState?.(next)
    for (const listener of [...this.listeners]) listener()
  }

  private setWatch = (watch: WatchState): void => this.setState({ ...this.state, watch })
  private setContent = (content: ContentState): void => this.setState({ ...this.state, content })

  private updateLimitedPoll(): void {
    const pollMs = this.profile.limitedPollMs
    const want =
      !this.disposed &&
      pollMs !== null &&
      this.visible &&
      this.state.watch.kind === 'active' &&
      this.state.watch.live === 'limited'
    if (want && this.limitedTimer === undefined && pollMs !== null) {
      this.limitedTimer = this.options.clock.setInterval(() => this.check('limited-poll'), pollMs)
    } else if (!want && this.limitedTimer !== undefined) {
      this.options.clock.clearInterval(this.limitedTimer)
      this.limitedTimer = undefined
    }
  }

  // ---- subscriptions --------------------------------------------------------

  /**
   * Subscribe with a new id (the old one is dropped). `stopReason` is what a
   * refusal shows when the code says nothing more specific.
   */
  private async subscribeNew(
    purpose: SubscribePurpose,
    stopReason: WatchStopReason = 'restart-failed'
  ): Promise<SubscribeReply | null> {
    const { id, previous } = this.ids.mint()
    if (previous !== null) void this.options.source.unsubscribe(previous).catch(() => undefined)
    const reply = await subscribeSafely(this.options.source, {
      watchId: id,
      filePath: this.options.filePath,
      profile: this.options.profile,
    })
    if (this.disposed || !this.ids.isCurrent(id)) {
      if (reply.status !== 'refused') void this.options.source.unsubscribe(id).catch(() => undefined)
      return null
    }
    this.onSubscribeReply(reply, purpose, stopReason)
    return reply
  }

  private onSubscribeReply(reply: SubscribeReply, purpose: SubscribePurpose, stopReason: WatchStopReason): void {
    if (reply.status === 'started') {
      this.onStarted(reply.stamp, reply.liveRefresh, purpose !== 'reload' && purpose !== 'file-back')
      return
    }
    if (reply.status === 'queued') {
      this.setWatch({ kind: 'queued' })
      return
    }
    if (isQuietRefusal(reply.code)) return
    if (reply.code === 'NOT_FOUND') {
      this.ids.markDead()
      this.deleted.confirm()
      return
    }
    if (purpose === 'begin' && this.ids.takeRestart()) {
      void this.subscribeNew('restart')
      return
    }
    this.ids.clear()
    this.setWatch({ kind: 'stopped', reason: stopReasonForRefusal(reply.code, stopReason) })
  }

  /** The current subscription is live: catch up when the disk differs from the tab (G3). */
  private onStarted(stamp: FileStamp, live: LiveRefresh, catchUp: boolean): void {
    const buffered = this.ids.markStarted()
    this.setWatch({ kind: 'active', live })
    if (!catchUp) return
    if (buffered || this.stamp === undefined || !isSameContent(stamp, this.stamp)) this.scheduleRead('catch-up')
  }

  private onEvent(event: WatchEvent): void {
    if (this.disposed || !this.ids.isCurrent(event.watchId)) return
    switch (event.kind) {
      case 'started':
        this.onStarted(event.stamp, event.liveRefresh, true)
        return
      case 'restarted':
        this.ids.markStarted()
        if (this.state.watch.kind !== 'active') this.setWatch({ kind: 'active', live: 'full' })
        this.scheduleRead('catch-up')
        return
      case 'ended':
        this.onEnded(event.reason)
        return
      case 'changed':
      case 'deleted':
        if (event.kind === 'changed') this.reads.noteChange(event.stamp)
        this.onChange(event.kind, event.kind === 'changed' && event.forced === true)
    }
  }

  private onChange(kind: 'changed' | 'deleted', forced = false): void {
    // A queued watch promoted onto a gone file hears `deleted` before `started`, then main drops it (S7)
    const queuedGone = kind === 'deleted' && this.state.watch.kind === 'queued'
    if (!this.ids.started && !queuedGone) {
      this.ids.buffer()
      return
    }
    if (this.state.content.kind === 'deleted') {
      // Gone again after a deferred file-back stopped the probe: the watch is dead, probe again (V4)
      if (kind === 'deleted') this.ids.markDead()
      if (kind === 'changed') void this.fileBack()
      else this.deleted.startProbing()
      return
    }
    if (kind === 'changed') {
      this.throttle.trigger(forced)
      return
    }
    this.ids.markDead()
    this.deleted.confirm()
  }

  private onEnded(reason: Parameters<typeof stopReasonForEnd>[0]): void {
    if (isProjectEnd(reason)) {
      this.ids.clear()
      this.setWatch({ kind: 'stopped', reason: 'project-closed' })
      return
    }
    if (this.ids.takeRestart()) {
      void this.subscribeNew('restart', stopReasonForEnd(reason))
      return
    }
    this.ids.clear()
    this.setWatch({ kind: 'stopped', reason: stopReasonForEnd(reason) })
  }

  // ---- deleted ----------------------------------------------------------------

  /** Is the file there? A rejected probe cannot tell (C3). */
  private async presence(): Promise<Presence> {
    const reply = await this.options.source.probe(this.options.filePath).catch(() => null)
    if (reply?.status === 'missing') return 'missing'
    return reply?.status === 'same' || reply?.status === 'changed' ? 'exists' : 'unknown'
  }

  private enterDeleted(): void {
    if (this.disposed) return
    this.setContent({ kind: 'deleted' })
    this.deleted.startProbing()
  }

  /**
   * The file is back (while deleted, or by the confirm of a dropped watch): new
   * id → subscribe → settled read → rule (F11, G5, S1). Single flight (C4).
   */
  private fileBack(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.fileBackRun ??= this.runFileBack().finally(() => {
      this.fileBackRun = null
    })
    return this.fileBackRun
  }

  private async runFileBack(): Promise<void> {
    this.deleted.stop()
    this.ids.resetRestart()
    // null = disposed or replaced meanwhile: whoever replaced it reads. NOT_FOUND hands the
    // next step to the confirm (R2-3); another refusal stops the watch but still shows the file (G5)
    const reply = await this.subscribeNew('file-back')
    if (reply !== null && !(reply.status === 'refused' && reply.code === 'NOT_FOUND')) this.scheduleRead('catch-up')
  }

  // ---- checks and reads ---------------------------------------------------------

  private async runChecks(): Promise<void> {
    do {
      this.recheck = false
      await this.runCheck().catch(() => undefined)
    } while (this.recheck && !this.disposed)
    this.checking = false
  }

  private async runCheck(): Promise<void> {
    if (this.state.content.kind === 'deleted') {
      if ((await this.presence()) === 'exists') await this.fileBack()
      else this.deleted.startProbing()
      return
    }
    const reply = await this.options.source.probe(this.options.filePath, this.stamp?.hash)
    if (this.disposed) return
    if (reply.status === 'missing') {
      this.deleted.confirm()
      return
    }
    if (reply.status !== 'same' && reply.status !== 'changed') {
      // An unreadable file goes to the read, which retries and shows it; unsupported is main's to end
      if (reply.status === 'unreadable') this.scheduleRead('check')
      return
    }
    // An unreadable tab reads again even when the bytes did not move: the lock may be gone (S6)
    const unreadable = this.state.content.kind === 'unavailable' && this.state.content.reason === 'unreadable'
    if (unreadable || this.stamp === undefined || !isSameContent(reply.stamp, this.stamp)) this.scheduleRead('check')
  }

  private scheduleRead = (mode: ReadMode): void => this.reads.schedule(mode)

  private onReadOutcome(outcome: ReadOutcome<V>, forced: boolean): void {
    switch (outcome.status) {
      case 'ok':
        this.applyVersion(outcome.version, outcome.stamp, forced)
        // The file is there but main dropped the watch: follow it again (R2-4)
        if (this.ids.dead) void this.fileBack()
        return
      case 'missing':
        if (this.state.content.kind === 'deleted') this.deleted.startProbing()
        else this.deleted.confirm()
        return
      case 'failed':
        this.setContent({ kind: 'unavailable', reason: 'unreadable' })
        return
      case 'blocked':
        this.setContent({ kind: 'unavailable', reason: outcome.reason })
        return
      case 'busy':
        return
    }
  }

  private applyVersion(version: V, stamp: FileStamp, forced: boolean): void {
    // The tab's own version (its save, a Restore's write): fresh, whatever the state was (C2)
    if (!forced && this.stamp !== undefined && isSameContent(stamp, this.stamp)) {
      this.stamp = stamp
      this.setContent({ kind: 'fresh' })
      return
    }
    const result = this.options.rule.apply(version, stamp, forced)
    if (result === 'applied') {
      this.stamp = stamp
      this.setContent({ kind: 'fresh' })
      return
    }
    const notSaved = this.state.content.kind === 'changed' && this.state.content.notSaved === true
    this.setContent({ kind: 'changed', mode: 'held', ...(notSaved ? { notSaved } : {}) })
  }
}
