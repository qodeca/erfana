// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * mainTrackedWatch - one main-side file followed by a freshness tracker
 * (#478, plan S17/S19, decisions 41, 48, F2): the HTML preview's page file
 * and each document whose comments a drawer shows (C4).
 *
 * The tracker runs on a {@link MainFreshnessSource} (an in-process owner on
 * `FileWatcherService`), with the profile's timings and bucket. Its version is
 * the file's stamp: the consumer re-reads the file itself (the preview
 * reloads the page, the comment service lists it again), so no bytes travel.
 * What the consumer hears:
 *
 * - `onChange` – the file has new content: a write, a catch-up after the watch
 *   started or restarted (G3, G1, G8), a check that found a change (S1, L4),
 *   or the file back after a delete (F11);
 * - `onDeleted` – the file is gone, confirmed after the profile's window (G4);
 * - `onProblem` – the watch stopped for good (`stopped`, after the one
 *   automatic restart – G5), is waiting for a slot (`queued` – G9, F32), the
 *   file cannot be read (`unreadable`, after the retries – L2), or it lives on
 *   a network or WSL volume, where only the checks are trusted (`limited` – G7).
 *
 * The tracker checks on window focus (`mainFreshnessRegistry`), on a power
 * resume (the owner's `onCheck`) and when shown again ({@link TrackedWatchHandle.setVisible}).
 *
 * @module services/freshness/mainTrackedWatch
 */
import { randomUUID } from 'node:crypto'
import { realClock, type Clock } from '../../../shared/clock'
import type { Checkable } from '../../../shared/freshness/freshnessRegistry'
import { FreshnessTracker } from '../../../shared/freshness/FreshnessTracker'
import type { CheckReason, FileStamp, FreshnessState, ReadOutcome } from '../../../shared/freshness/freshnessTypes'
import type { TimingProfileName } from '../../../shared/freshness/timingProfiles'
import { redactedLogError } from '../../utils/redactUserInput'
import { logger } from '../LoggingService'
import { registerMainTracker } from './mainFreshnessRegistry'
import { createMainFreshnessSource, type MainFreshnessSourceFactory } from './mainFreshnessSource'

/** Something the consumer should say about the watch (§ 3.6 of the plan). */
export type TrackedWatchProblem = 'stopped' | 'queued' | 'unreadable' | 'limited'

/** What a tracked watch tells its consumer. */
export interface TrackedWatchHandlers {
  onChange(): void
  onDeleted(): void
  onProblem?(problem: TrackedWatchProblem): void
}

/** A followed file; `close` ends it, and nothing is reported afterwards. */
export interface TrackedWatchHandle {
  close(): Promise<void>
  /** Check the file against the last version seen (focus, resume, shown). */
  check(reason: CheckReason): void
  /** Shown again: check (S1). */
  setVisible(visible: boolean): void
  /** Follow again with a new subscription and report the file as it is now (a Reload). */
  reload(): Promise<void>
  /** The tracker's state (tests, diagnostics). */
  state(): FreshnessState
}

/** Main-side profiles; window profiles go through `file-watch:subscribe`. */
export type MainTrackedProfile = Extract<TimingProfileName, 'preview' | 'comments'>

/** Seams; every one has a production default. */
export interface TrackedWatchOptions {
  readonly profile: MainTrackedProfile
  readonly createSource?: MainFreshnessSourceFactory
  /** Reads the file's version; its stamp through the source (re-confined, SEC2) by default. */
  readonly read?: (realPath: string) => Promise<ReadOutcome<FileStamp>>
  /**
   * The stamp of the version the consumer shows; once the watch is live, a
   * disk that differs from it is one change (G3). `undefined` = not known, so
   * that catch-up always reports a change. The file's probed stamp by default.
   */
  readonly baseline?: () => Promise<FileStamp | undefined>
  readonly clock?: Clock
  readonly newId?: () => string
  readonly register?: (member: Checkable) => () => void
}

/** Which consumer callback a state change calls, if any. */
function problemOf(previous: FreshnessState, next: FreshnessState): TrackedWatchProblem | 'deleted' | null {
  if (next.content.kind === 'deleted' && previous.content.kind !== 'deleted') return 'deleted'
  if (next.content.kind === 'unavailable' && previous.content.kind !== 'unavailable') return 'unreadable'
  if (next.watch.kind === 'active' && next.watch.live === 'limited') {
    return previous.watch.kind === 'active' && previous.watch.live === 'limited' ? null : 'limited'
  }
  if (next.watch.kind === previous.watch.kind) return null
  // A project closing ends the consumer with it: nothing to say (§ 3.6)
  if (next.watch.kind === 'stopped' && next.watch.reason !== 'project-closed') return 'stopped'
  if (next.watch.kind === 'queued') return 'queued'
  return null
}

/**
 * Follow `realPath` with a tracker.
 *
 * @param realPath - a real path the caller's confinement resolved
 */
export function createTrackedFileWatch(
  realPath: string,
  handlers: TrackedWatchHandlers,
  options: TrackedWatchOptions
): TrackedWatchHandle {
  let closed = false
  let tracker: FreshnessTracker<FileStamp> | null = null
  const source = (options.createSource ?? createMainFreshnessSource)({
    ownerName: options.profile,
    onCheck: () => tracker?.check('resume')
  })
  let previous: FreshnessState = { watch: { kind: 'active', live: 'full' }, content: { kind: 'fresh' } }

  const report = (call: () => void): void => {
    if (closed) return
    try {
      call()
    } catch (error) {
      logger.error('A file watch consumer failed', redactedLogError(error))
    }
  }

  const followed = new FreshnessTracker<FileStamp>({
    filePath: realPath,
    profile: options.profile,
    source,
    clock: options.clock ?? realClock,
    newId: options.newId ?? randomUUID,
    rule: {
      read: () => (options.read ? options.read(realPath) : source.readStamp(realPath)),
      readNow: () => true,
      apply: () => {
        report(() => handlers.onChange())
        return 'applied'
      },
      onState: (state) => {
        const problem = problemOf(previous, state)
        previous = state
        if (problem === 'deleted') report(() => handlers.onDeleted())
        else if (problem !== null) report(() => handlers.onProblem?.(problem))
      }
    }
  })
  tracker = followed
  const unregister = (options.register ?? registerMainTracker)(followed)

  // By default the baseline is the version on disk now, which the consumer
  // shows: a write after it, before the watch is live, is caught up (G3)
  const baseline =
    options.baseline ??
    (() =>
      source
        .probe(realPath)
        .then((reply) => (reply.status === 'same' || reply.status === 'changed' ? reply.stamp : undefined)))
  void baseline()
    .catch(() => undefined)
    .then((stamp) => (closed ? undefined : followed.begin(stamp)))

  return {
    async close() {
      if (closed) return
      closed = true
      unregister()
      followed.dispose()
      await source.dispose()
    },
    check: (reason) => {
      if (!closed) followed.check(reason)
    },
    setVisible: (visible) => {
      if (!closed) followed.setVisible(visible)
    },
    reload: () => (closed ? Promise.resolve() : followed.reload()),
    state: () => followed.getState()
  }
}
