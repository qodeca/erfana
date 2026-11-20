// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * mainFreshnessSource - the {@link FreshnessSource} of a main-process
 * consumer (#478, plan S17, decisions 3, 8, F2): the HTML preview's page and
 * sub-files, and the comment watches.
 *
 * Each source is one **in-process owner** on `FileWatcherService` – the one
 * watch layer – so its subscriptions share the layer's buckets and waitlist
 * (`preview` 16 per owner / 64 in all, `comments` 64), the project-switch
 * suspension, the health round and the wake re-arm. Events arrive through the
 * owner's callback, never over IPC; `onCheck` is how a power resume reaches
 * the owner's trackers (decision 22).
 *
 * Paths handed in are real paths the caller's own confinement already
 * resolved (`confinePath`, `confineCommentFile` – decision 11); the watch
 * layer checks them again on every arm, and every probe and read here checks
 * again first, with the arm's own check (`recheckTarget`, SEC2): a name now
 * linked out of the project is never opened or hashed – it answers
 * `unsupported`, and this owner's watches on it end `outside-project`. Probes
 * and reads go through the process-wide `fileStamper` (hash cache, one hash
 * per path – F22, F24).
 *
 * A file on a network or WSL volume is followed `limited` (G7, decision 46):
 * the `started` reply – or the `started` event of a queued watch – says so, as
 * the window handler's does.
 *
 * Only the read-only port: nothing here pauses a watch or writes (decision 7).
 *
 * @module services/freshness/mainFreshnessSource
 */
import { randomUUID } from 'node:crypto'
import type {
  FileStamp,
  LiveRefresh,
  FreshnessSource,
  ProbeReply,
  ReadOutcome,
  SubscribeReply,
  SubscribeRequest,
  TextReadReply,
  WatchEvent,
  WatchEventListener
} from '../../../shared/freshness/freshnessTypes'
import { redactedLogError } from '../../utils/redactUserInput'
import { fileWatcherService } from '../FileWatcherService'
import { logger } from '../LoggingService'
import type { CheckedTarget, RecheckAnswer } from '../watcher/armWatch'
import { ownerKeyOf, type SubscribeInput, type WatchOwner } from '../watcher/watchTypes'
import { fileStamper, type FileStamper } from './fileStamp'
import { probeFile } from './probeFile'
import { readText } from './textRead'
import { volumeKind, type VolumeKind } from './volumeKind'

/** The slice of `FileWatcherService` a main source drives. */
export interface MainWatchLayer {
  subscribe(input: SubscribeInput): Promise<SubscribeReply>
  unsubscribe(owner: WatchOwner, watchId: string): Promise<void>
  dropOwner(ownerKey: string): Promise<void>
  /** The arm's own check of a path: real path inside the project, a regular file; `unresolved` when `realpath` failed. */
  recheckTarget(realPath: string): Promise<RecheckAnswer>
}

/** What a main source is built from; everything but the name has a production default. */
export interface MainFreshnessSourceOptions {
  /** What the owner is, for diagnostics (`preview-entry`, `preview-pool`, `comments`); a unique suffix is added. */
  readonly ownerName: string
  readonly watcher?: MainWatchLayer
  readonly stamper?: FileStamper
  /** A power resume asked every in-process owner to check its files (decision 22). */
  readonly onCheck?: () => void
  /** The volume a real path lives on; `volumeKind` by default. */
  readonly volumeKind?: (real: string) => Promise<VolumeKind>
}

/** A main-side source: one in-process owner on the watch layer. */
export interface MainFreshnessSource extends FreshnessSource {
  /** The owner id the watch layer counts this source's subscriptions under. */
  readonly ownerId: string
  /** The file's version as a stamp, re-confined first (see {@link readStampOutcome}). */
  readStamp(realPath: string): Promise<ReadOutcome<FileStamp>>
  /** End every subscription of this owner; nothing is heard afterwards, and a later subscribe is refused. */
  dispose(): Promise<void>
}

/** Builds a main source; the composition roots inject it so tests can pass a fake. */
export type MainFreshnessSourceFactory = (options: MainFreshnessSourceOptions) => MainFreshnessSource

/** Create a main source on `FileWatcherService` (or the injected watch layer). */
export function createMainFreshnessSource(options: MainFreshnessSourceOptions): MainFreshnessSource {
  const watcher = options.watcher ?? fileWatcherService
  const stamper = options.stamper ?? fileStamper
  const kindOf = options.volumeKind ?? ((real: string) => volumeKind(real))
  const ownerId = `${options.ownerName}:${randomUUID()}`
  const listeners = new Set<WatchEventListener>()
  /** Live and queued subscriptions → their path, so a refused re-check ends the watches on it. */
  const paths = new Map<string, string>()
  /** Subscriptions on a network or WSL volume: their `started` event says `limited`. */
  const limited = new Set<string>()
  let disposed = false

  const forget = (watchId: string): void => {
    paths.delete(watchId)
    limited.delete(watchId)
  }

  const deliver = (event: WatchEvent): void => {
    if (disposed) return
    if (event.kind === 'ended') forget(event.watchId)
    const seen = event.kind === 'started' && limited.has(event.watchId) ? { ...event, liveRefresh: 'limited' as const } : event
    for (const listener of [...listeners]) {
      try {
        listener(seen)
      } catch (error) {
        logger.error('A main freshness listener failed', redactedLogError(error))
      }
    }
  }

  const owner: WatchOwner = {
    kind: 'process',
    ownerId,
    onEvent: deliver,
    onCheck: () => {
      if (!disposed) options.onCheck?.()
    }
  }

  /** How live refresh can be for `real`: `limited` on a network or WSL volume. */
  const liveRefreshOf = async (real: string): Promise<LiveRefresh> =>
    (await kindOf(real).catch(() => 'local' as const)) === 'local' ? 'full' : 'limited'

  /**
   * The arm's check again before `realPath` is opened (SEC2). `null` = go on;
   * otherwise the refusal. Only `unsupported` and a path resolved outside the
   * project end this owner's watches on it, as the layer ends a watch whose
   * file left the project; `missing` is a delete, and `unresolved` (a
   * `realpath` errno – a Windows delete-pending file answers EPERM) is neither
   * shown inside nor outside, so it opens nothing and ends nothing (R2-1).
   */
  const refusalOf = async (realPath: string): Promise<Exclude<RecheckAnswer, CheckedTarget> | null> => {
    const checked = await watcher.recheckTarget(realPath)
    if (typeof checked !== 'string') return null
    if (checked === 'unsupported' || checked === 'outside-project') {
      for (const [watchId, path] of [...paths]) {
        if (path !== realPath) continue
        deliver({ watchId, kind: 'ended', reason: checked })
        void watcher.unsubscribe(owner, watchId).catch(() => undefined)
      }
    }
    return checked
  }

  return {
    ownerId,
    async subscribe(request: SubscribeRequest): Promise<SubscribeReply> {
      if (disposed) return { status: 'refused', code: 'WATCH_FAILED' }
      const reply = await watcher.subscribe({ owner, ...request })
      // Disposed while the subscribe was answering: it must not outlive its owner
      if (disposed && reply.status !== 'refused') {
        await watcher.unsubscribe(owner, request.watchId)
        return { status: 'refused', code: 'WATCH_FAILED' }
      }
      if (reply.status === 'refused') return { status: 'refused', code: reply.code }
      paths.set(request.watchId, request.filePath)
      if ((await liveRefreshOf(request.filePath)) === 'limited') limited.add(request.watchId)
      if (reply.status === 'started' && limited.has(request.watchId)) return { ...reply, liveRefresh: 'limited' }
      return reply
    },
    async unsubscribe(watchId) {
      forget(watchId)
      await watcher.unsubscribe(owner, watchId)
    },
    async probe(filePath, knownHash): Promise<ProbeReply> {
      const refusal = await refusalOf(filePath)
      if (refusal === 'missing') return { status: 'missing' }
      if (refusal === 'unresolved') return { status: 'unreadable', code: refusal }
      if (refusal !== null) return { status: 'unsupported', code: refusal }
      return probeFile(filePath, knownHash, stamper)
    },
    async readText(filePath): Promise<TextReadReply> {
      const refusal = await refusalOf(filePath)
      if (refusal === 'missing') return { status: 'missing' }
      if (refusal === 'unresolved') return { status: 'busy' }
      if (refusal !== null) return { status: 'unsupported' }
      return readText(filePath, { stamper })
    },
    async readStamp(realPath): Promise<ReadOutcome<FileStamp>> {
      const refusal = await refusalOf(realPath)
      if (refusal === 'missing') return { status: 'missing' }
      if (refusal === 'unresolved') return { status: 'busy' }
      if (refusal !== null) return { status: 'failed' }
      return readStampOutcome(realPath, stamper)
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async dispose() {
      if (disposed) return
      disposed = true
      listeners.clear()
      paths.clear()
      limited.clear()
      await watcher.dropOwner(ownerKeyOf(owner))
    }
  }
}

/**
 * Read a file as a stamp: the version a main tracker follows when what it
 * shows is "the file as it is now" (the preview reloads it, the comment
 * drawer lists it again), so no bytes need to travel.
 *
 * @param realPath - the file's real path (confinement is the caller's job)
 */
export async function readStampOutcome(realPath: string, stamper: FileStamper = fileStamper): Promise<ReadOutcome<FileStamp>> {
  const result = await stamper.stamp(realPath)
  switch (result.status) {
    case 'ok':
      return { status: 'ok', version: result.stamp, stamp: result.stamp }
    case 'busy':
      return { status: 'busy' }
    case 'missing':
      return { status: 'missing' }
    case 'unreadable':
    case 'unsupported':
      return { status: 'failed' }
  }
}
