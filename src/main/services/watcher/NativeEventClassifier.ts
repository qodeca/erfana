// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * NativeEventClassifier – the bounded `lstat` queue behind the Windows native
 * directory watcher (#211, design D2).
 *
 * `fs.watch` reports only `rename` or `change` plus a name; the watcher's
 * consumers need `add` / `addDir` / `unlink` / `unlinkDir` / `change`. Each
 * raw event is classified by one `lstat` (no symlink follow), with:
 *
 * - at most {@link DEFAULT_MAX_IN_FLIGHT} stats in flight – half of libuv's
 *   default thread pool, so file open and the tree walk keep their slots;
 * - one queue entry per path (folded when the platform is case-insensitive),
 *   where `recheck` wins over `rename`, which wins over `change`;
 * - a path that changes again while its `lstat` is in flight is classified
 *   once more after the first result, never twice at the same time;
 * - a backlog cap: past {@link DEFAULT_MAX_PENDING} queued paths new events
 *   are dropped and `onBacklogOverflow` runs once, so the caller can resync;
 * - removal collapse: a `rename` (or `recheck`) for a path with queued
 *   descendants jumps the queue; when it is gone the classifier emits one
 *   `unlinkDir`, drops the queued descendants without a stat, and drops any
 *   descendant queued later until the queue drains. Only `unlinkDir` prunes a
 *   deleted folder's children downstream, and Windows reports a deleted
 *   folder's own removals only in part.
 *
 * | Raw       | `lstat` result                         | Emitted                  |
 * |-----------|----------------------------------------|--------------------------|
 * | `rename`  | file or symlink                        | `add`                    |
 * | `rename`  | directory                              | `addDir`                 |
 * | `rename`  | `ENOENT` / `ENOTDIR`                   | `unlinkDir` for a known folder, else `unlink` |
 * | `rename`  | `EPERM` / `EBUSY`, path has open watch | `locked` (caller closes and re-checks) |
 * | `rename`  | any other error                        | `add`                    |
 * | `change`  | not a directory                        | `change`                 |
 * | `change`  | directory, `ENOENT` / `ENOTDIR`        | nothing                  |
 * | `change`  | any other error                        | `change`                 |
 * | `recheck` | directory                              | `addDir`                 |
 * | `recheck` | anything else, any error               | `unlinkDir`              |
 *
 * `recheck` is the one `lstat` the watcher runs after closing a handle (D15).
 * It is never dropped by the backlog cap or by {@link NativeEventClassifier.clear},
 * because its answer decides what happens to that closed handle.
 *
 * Paths are opaque strings to this class: the watcher passes root-relative
 * `/`-separated paths; ancestors are found at `/` or `\`. A listener that
 * throws is logged by code only, and the queue keeps moving.
 */
import { logger } from '../LoggingService'

/** Raw event kinds, in rising priority when one path has several. */
export type NativeRawEventKind = 'change' | 'rename' | 'recheck'

/** What a classified event means to the watcher. */
export type NativeClassifiedType = 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change' | 'locked'

export interface NativeClassifiedEvent {
  readonly type: NativeClassifiedType
  /** The path as last enqueued (its latest spelling). */
  readonly path: string
  /** The raw kind that was classified. */
  readonly source: NativeRawEventKind
  /** For `locked` only: `EPERM` or `EBUSY`. */
  readonly code?: string
}

/** The part of `fs.Stats` the classifier reads. */
export interface NativeLstatResult {
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

export interface NativeEventClassifierOptions {
  /** `lstat` without following links; rejects with a Node error carrying `code`. */
  readonly lstat: (path: string) => Promise<NativeLstatResult>
  /** Whether a gone path was a folder the watcher knows (a watch or a listing entry). */
  readonly isKnownFolder: (path: string) => boolean
  /** Whether the path has an open watch – selects the `EPERM` / `EBUSY` row. */
  readonly hasOpenWatch?: (path: string) => boolean
  /** Fold keys to lower case when `false`. */
  readonly caseSensitive: boolean
  readonly maxInFlight?: number
  readonly maxPending?: number
  readonly onEvent: (event: NativeClassifiedEvent) => void
  /** Runs once each time the backlog cap trips (again only after a drain or `clear`). */
  readonly onBacklogOverflow: () => void
}

/** Stats in flight at once: half of libuv's default four-thread pool. */
export const DEFAULT_MAX_IN_FLIGHT = 2
/** Queued paths before new events are dropped and a resync is asked for. */
export const DEFAULT_MAX_PENDING = 10_000
/** Folders remembered from emitted `addDir`s, so their removal is an `unlinkDir`. */
const MAX_REMEMBERED_FOLDERS = 10_000

const KIND_RANK: Readonly<Record<NativeRawEventKind, number>> = { change: 0, rename: 1, recheck: 2 }
const GONE_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR'])
const LOCKED_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY'])
const SLASH = 0x2f
const BACKSLASH = 0x5c

interface QueueEntry {
  readonly key: string
  path: string
  kind: NativeRawEventKind
  /** Descendants were queued while this entry waited (it is a folder). */
  hadDescendants: boolean
  generation: number
}

interface InFlightEntry extends QueueEntry {
  /** A further event for this path, classified after this result. */
  again: NativeRawEventKind | null
}

function strongerKind(a: NativeRawEventKind | null, b: NativeRawEventKind): NativeRawEventKind {
  return a !== null && KIND_RANK[a] >= KIND_RANK[b] ? a : b
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'UNKNOWN'
}

/** Every proper ancestor of `key` (split at `/` or `\`), nearest first. */
function ancestorKeys(key: string): string[] {
  const ancestors: string[] = []
  for (let index = key.length - 1; index > 0; index--) {
    const char = key.charCodeAt(index)
    if (char === SLASH || char === BACKSLASH) ancestors.push(key.slice(0, index))
  }
  return ancestors
}

function isDescendantKey(key: string, ancestor: string): boolean {
  if (key.length <= ancestor.length || !key.startsWith(ancestor)) return false
  const char = key.charCodeAt(ancestor.length)
  return char === SLASH || char === BACKSLASH
}

export class NativeEventClassifier {
  private readonly lstat: (path: string) => Promise<NativeLstatResult>
  private readonly isKnownFolder: (path: string) => boolean
  private readonly hasOpenWatch: (path: string) => boolean
  private readonly caseSensitive: boolean
  private readonly maxInFlight: number
  private readonly maxPending: number
  private readonly onEvent: (event: NativeClassifiedEvent) => void
  private readonly onBacklogOverflow: () => void

  /** FIFO of waiting paths (Map keeps insertion order). */
  private readonly pending = new Map<string, QueueEntry>()
  /** Keys that jumped the queue; may hold keys no longer pending. */
  private priority: string[] = []
  private readonly inFlight = new Map<string, InFlightEntry>()
  /** Ancestor key → number of its descendants queued or in flight. */
  private readonly queuedBelow = new Map<string, number>()
  /** Folders reported gone since the queue last drained. */
  private readonly removedFolders = new Set<string>()
  private readonly rememberedFolders = new Set<string>()
  private generation = 0
  private backlogTripped = false
  private disposed = false

  constructor(options: NativeEventClassifierOptions) {
    this.lstat = options.lstat
    this.isKnownFolder = options.isKnownFolder
    this.hasOpenWatch = options.hasOpenWatch ?? ((): boolean => false)
    this.caseSensitive = options.caseSensitive
    this.maxInFlight = Math.max(1, options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT)
    this.maxPending = Math.max(1, options.maxPending ?? DEFAULT_MAX_PENDING)
    this.onEvent = options.onEvent
    this.onBacklogOverflow = options.onBacklogOverflow
  }

  /** Paths waiting for a stat slot. */
  get pendingCount(): number {
    return this.pending.size
  }

  /** Stats running now (never above `maxInFlight`). */
  get inFlightCount(): number {
    return this.inFlight.size
  }

  /** Queue one raw event for classification. */
  enqueue(path: string, kind: NativeRawEventKind): void {
    if (this.disposed) return
    const key = this.caseSensitive ? path : path.toLowerCase()
    // A re-check always runs: its answer decides the fate of a closed handle.
    if (kind !== 'recheck' && this.isUnderRemovedFolder(key)) return

    const flying = this.inFlight.get(key)
    if (flying) {
      flying.again = strongerKind(flying.again, kind)
      flying.path = path
      return
    }

    const queued = this.pending.get(key)
    if (queued) {
      queued.path = path
      if (KIND_RANK[kind] > KIND_RANK[queued.kind]) {
        queued.kind = kind
        queued.generation = this.generation
        if (this.shouldJump(key, kind)) this.priority.push(key)
      }
      return
    }

    if (kind !== 'recheck' && this.pending.size >= this.maxPending) {
      this.tripBacklog()
      return
    }
    this.addPending({ key, path, kind, hadDescendants: false, generation: this.generation })
    this.pump()
  }

  /**
   * Drop every queued `rename` / `change` and ignore the results of those in
   * flight – a resync re-reads the tree, which covers them. Re-checks stay.
   */
  clear(): void {
    if (this.disposed) return
    this.generation++
    const rechecks = [...this.pending.values()].filter(entry => entry.kind === 'recheck')
    this.pending.clear()
    this.queuedBelow.clear()
    this.priority = []
    for (const flying of this.inFlight.values()) {
      if (flying.again !== 'recheck') flying.again = null
      this.countBelow(flying.key, 1)
    }
    for (const entry of rechecks) this.addPending(entry)
    this.removedFolders.clear()
    this.backlogTripped = false
  }

  /** Stop for good: nothing is stat'ed or emitted afterwards. */
  dispose(): void {
    this.disposed = true
    this.pending.clear()
    this.priority = []
    this.inFlight.clear()
    this.queuedBelow.clear()
    this.removedFolders.clear()
    this.rememberedFolders.clear()
  }

  private shouldJump(key: string, kind: NativeRawEventKind): boolean {
    return kind === 'recheck' || (kind === 'rename' && (this.queuedBelow.get(key) ?? 0) > 0)
  }

  private addPending(entry: QueueEntry): void {
    const below = this.queuedBelow.get(entry.key) ?? 0
    if (below > 0) entry.hadDescendants = true
    this.pending.set(entry.key, entry)
    this.countBelow(entry.key, 1)
    if (this.shouldJump(entry.key, entry.kind)) this.priority.push(entry.key)
  }

  /** Drop a waiting entry without classifying it. */
  private dropPending(entry: QueueEntry): void {
    this.pending.delete(entry.key)
    this.countBelow(entry.key, -1)
  }

  /** Count an entry (queued or in flight) under each of its ancestors. */
  private countBelow(key: string, delta: 1 | -1): void {
    for (const ancestor of ancestorKeys(key)) {
      const count = (this.queuedBelow.get(ancestor) ?? 0) + delta
      if (count > 0) this.queuedBelow.set(ancestor, count)
      else this.queuedBelow.delete(ancestor)
      if (delta > 0) {
        const waiting = this.pending.get(ancestor) ?? this.inFlight.get(ancestor)
        if (waiting) waiting.hadDescendants = true
      }
    }
  }

  private tripBacklog(): void {
    if (this.backlogTripped) return
    this.backlogTripped = true
    this.onBacklogOverflow()
  }

  private isUnderRemovedFolder(key: string): boolean {
    if (this.removedFolders.size === 0) return false
    return ancestorKeys(key).some(ancestor => this.removedFolders.has(ancestor))
  }

  private takeNext(): QueueEntry | undefined {
    while (this.priority.length > 0) {
      const entry = this.pending.get(this.priority.shift() as string)
      if (entry) {
        this.pending.delete(entry.key) // still counted below its ancestors while in flight
        return entry
      }
    }
    const first = this.pending.values().next()
    if (first.done) return undefined
    this.pending.delete(first.value.key)
    return first.value
  }

  private pump(): void {
    while (!this.disposed && this.inFlight.size < this.maxInFlight) {
      const entry = this.takeNext()
      if (!entry) break
      this.start(entry)
    }
    if (this.pending.size === 0 && this.inFlight.size === 0) {
      this.removedFolders.clear()
      this.backlogTripped = false
    }
  }

  private start(entry: QueueEntry): void {
    const flying: InFlightEntry = { ...entry, again: null }
    this.inFlight.set(entry.key, flying)
    let result: Promise<NativeLstatResult>
    try {
      result = this.lstat(entry.path)
    } catch (error) {
      result = Promise.reject(error)
    }
    result.then(
      stats => this.finish(flying, stats, undefined),
      (error: unknown) => this.finish(flying, undefined, errorCode(error))
    )
  }

  /**
   * Runs as the stat's promise callback: a listener that throws must neither
   * become an unhandled rejection nor stall the queue behind it.
   */
  private finish(flying: InFlightEntry, stats: NativeLstatResult | undefined, code: string | undefined): void {
    if (this.disposed || this.inFlight.get(flying.key) !== flying) return
    this.inFlight.delete(flying.key)
    this.countBelow(flying.key, -1)
    try {
      if (flying.kind === 'recheck' || flying.generation === this.generation) {
        this.report(flying, stats, code)
      }
    } catch (error) {
      logger.warn('Native classifier: listener failed', { code: errorCode(error) })
    } finally {
      // Even after a listener threw: the later change must still be classified
      if (flying.again !== null && !this.disposed) this.enqueue(flying.path, flying.again)
      this.pump()
    }
  }

  private report(entry: InFlightEntry, stats: NativeLstatResult | undefined, code: string | undefined): void {
    const isDirectory = stats !== undefined && stats.isDirectory() && !stats.isSymbolicLink()
    if (entry.kind === 'recheck') {
      if (isDirectory) this.emit('addDir', entry)
      else this.reportGone(entry, true)
      return
    }
    if (stats) {
      if (entry.kind === 'change') {
        if (!isDirectory) this.emit('change', entry)
      } else if (isDirectory) {
        this.rememberFolder(entry.key)
        this.emit('addDir', entry)
      } else {
        this.emit('add', entry)
      }
      return
    }
    const failure = code ?? 'UNKNOWN'
    if (GONE_CODES.has(failure)) {
      if (entry.kind === 'rename') this.reportGone(entry, false)
      return
    }
    if (entry.kind === 'rename' && LOCKED_CODES.has(failure) && this.hasOpenWatch(entry.path)) {
      this.emit('locked', entry, failure)
      return
    }
    this.emit(entry.kind === 'rename' ? 'add' : 'change', entry)
  }

  private reportGone(entry: InFlightEntry, knownFolder: boolean): void {
    // Covered by the ancestor's `unlinkDir` – unless it is a re-check, whose
    // answer the watcher is waiting for.
    if (!knownFolder && this.isUnderRemovedFolder(entry.key)) return
    const folder =
      knownFolder ||
      entry.hadDescendants ||
      (this.queuedBelow.get(entry.key) ?? 0) > 0 ||
      this.rememberedFolders.has(entry.key) ||
      this.isKnownFolder(entry.path)
    if (!folder) {
      this.emit('unlink', entry)
      return
    }
    this.rememberedFolders.delete(entry.key)
    if (entry.key !== '') {
      this.removedFolders.add(entry.key)
      this.dropQueuedBelow(entry.key)
    }
    this.emit('unlinkDir', entry)
  }

  private dropQueuedBelow(folderKey: string): void {
    if ((this.queuedBelow.get(folderKey) ?? 0) === 0) return
    for (const entry of [...this.pending.values()]) {
      if (isDescendantKey(entry.key, folderKey)) this.dropPending(entry)
    }
  }

  private rememberFolder(key: string): void {
    if (this.rememberedFolders.has(key)) return
    if (this.rememberedFolders.size >= MAX_REMEMBERED_FOLDERS) {
      const oldest = this.rememberedFolders.values().next()
      if (!oldest.done) this.rememberedFolders.delete(oldest.value)
    }
    this.rememberedFolders.add(key)
  }

  private emit(type: NativeClassifiedType, entry: InFlightEntry, code?: string): void {
    const event: NativeClassifiedEvent =
      code === undefined
        ? { type, path: entry.path, source: entry.kind }
        : { type, path: entry.path, source: entry.kind, code }
    this.onEvent(event)
  }
}
