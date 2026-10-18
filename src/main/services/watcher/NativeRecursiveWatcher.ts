// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * NativeRecursiveWatcher – one directory watcher per project on Windows,
 * built on Node's own `fs.watch` (#211, design D1, D2, D3, D15).
 *
 * **Plan (D1).** The root is watched non-recursively. Every direct child
 * folder of a *split folder* gets one recursive watch, unless it is itself a
 * split folder, where the rule repeats one level down. Split folders are the
 * root plus every proper ancestor of a split path (exclude path entries and
 * walk hints). Dropped children (excluded, hidden, ignored) and links get no
 * handle at all, so their churn never fills a Windows change buffer. Past a
 * cap a folder keeps one recursive watch and the plan reports `planCapped`;
 * a plan pass opens every direct child before it expands any split one, so
 * the cap collapses a deeper folder, never a later sibling. A split folder
 * whose listing fails (other than as gone) also keeps one recursive watch,
 * and is planned again at the next resync (at most `reopenLimit` times per
 * `reopenWindowMs`).
 * Every handle is opened under `realpathSync.native(root)` (the root as given
 * when that fails other than as gone); emitted paths are joined onto the
 * caller's root string.
 *
 * **Events (D2).** A raw event is dropped by `shouldDrop` before any work,
 * then classified by one `lstat` in {@link NativeEventClassifier}. A new
 * direct child folder of a split folder is reported (`addDir`) only once its
 * own watch is open. A parent's `rename` of a watched folder retires that
 * watch at once – Windows keeps a renamed folder's handle and reports its
 * later changes under the old name – and the classified result decides what
 * follows.
 *
 * **Lost events (D3).** A `null` filename is a buffer overflow. On a split
 * folder's watch the folder is re-listed and only the differences are
 * emitted (a re-list that fails requests a `resync`); on a recursive watch a `resync` is requested, debounced (1 s
 * quiet, 5 s maximum wait). The backlog cap requests one the same way.
 *
 * **A watched folder's own removal (D15).** libuv reports it on the folder's
 * own handle as `rename` with its absolute `\\?\` path, about 70,000 times a
 * second until the handle is closed. The first such event closes the handle
 * inside the same callback, before any other work; later ones return at the
 * first line. One re-check `lstat` follows: only a readable directory (a new
 * folder the old handle cannot see) is watched again, at most
 * `reopenLimit` times per path per `reopenWindowMs`; anything else is gone.
 *
 * Events: `add`, `addDir`, `unlink`, `unlinkDir`, `change` (absolute path),
 * `error` (a Node-style error whose message carries only the code), `ready`
 * (after the plan), `resync` (reason), `overflow` (one per lost batch, for
 * metrics). Nothing is emitted after {@link NativeRecursiveWatcher.close}.
 * Log lines carry codes and counts, never paths.
 *
 * The drop test and the split paths use paths relative to `root`, with `/`
 * separators; the caller maps them to project-relative paths. Backslashes in
 * reported names are separators: this backend runs on Windows only (D6).
 */
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import { logger } from '../LoggingService'
import type { DirectoryWatchHandle, DirectoryWatchResyncReason } from './directoryWatchBackend'
import {
  NativeEventClassifier,
  type NativeClassifiedEvent,
  type NativeLstatResult
} from './NativeEventClassifier'

/** Debounce of a resync: quiet time after the last request. */
export const DEFAULT_RESYNC_QUIET_MS = 1000
/** Debounce of a resync: longest wait after the first request. */
export const DEFAULT_RESYNC_MAX_WAIT_MS = 5000
/** Re-opens of one path allowed per window (D15). */
export const DEFAULT_REOPEN_LIMIT = 3
export const DEFAULT_REOPEN_WINDOW_MS = 60_000
/** Most native handles one project may hold (D1). */
export const DEFAULT_MAX_HANDLES = 512
/** Split paths used: 64 exclude path entries plus 64 walk hints (D1). */
export const DEFAULT_MAX_SPLIT_PATHS = 128
/** Deepest split path, in segments (D1). */
export const DEFAULT_MAX_SPLIT_DEPTH = 16

const WARN_INTERVAL_MS = 10_000
const NAMESPACE_PREFIX = '\\\\?\\'
const UNC_NAMESPACE_PREFIX = '\\\\?\\UNC\\'
const NAME_SEPARATORS = /[\\/]/

/** The part of an `fs.FSWatcher` the watcher uses. */
export interface NativeWatchHandle {
  close(): void
  on(event: 'error', listener: (error: Error) => void): unknown
}

export type NativeWatchListener = (eventType: string, filename: string | null) => void

export type NativeFsWatch = (
  path: string,
  options: { recursive: boolean; persistent: boolean },
  listener: NativeWatchListener
) => NativeWatchHandle

/** The part of an `fs.Dirent` the plan reads. */
export interface NativeDirEntry {
  readonly name: string
  isDirectory(): boolean
  isFile(): boolean
  isSymbolicLink(): boolean
}

export interface NativeWatchCaps {
  readonly maxSplitPaths?: number
  readonly maxSplitDepth?: number
  readonly maxHandles?: number
}

export interface NativeRecursiveWatcherOptions {
  /** Whether a root-relative `/`-separated path is dropped (never `''`). */
  readonly shouldDrop: (rel: string) => boolean
  /** Exclude path entries, then walk hints – root-relative, `/`-separated. */
  readonly splitPaths: readonly string[]
  /** The caller already left split inputs out (reported as `planCapped`). */
  readonly splitInputsCapped?: boolean
  readonly caseSensitive: boolean
  readonly caps?: NativeWatchCaps
  readonly fsWatch?: NativeFsWatch
  readonly lstat?: (path: string) => Promise<NativeLstatResult>
  readonly readdir?: (path: string) => Promise<readonly NativeDirEntry[]>
  readonly realpathNative?: (path: string) => string
  readonly now?: () => number
  readonly resyncQuietMs?: number
  readonly resyncMaxWaitMs?: number
  readonly reopenLimit?: number
  readonly reopenWindowMs?: number
}

/** The plan's size, for the `ready` log line. */
export interface NativeWatchPlanStats {
  readonly handles: number
  readonly recursiveWatches: number
  readonly splitFolders: number
  readonly planCapped: boolean
  /** Duration of the initial plan; `null` until `ready`. */
  readonly elapsedMs: number | null
}

type WatchState = 'open' | 'retired' | 'rechecking' | 'closed'
type RecheckCause = 'self' | 'locked' | 'error'

interface WatchRecord {
  readonly key: string
  rel: string
  readonly recursive: boolean
  /** The watched real path, normalised for the self-event test. */
  readonly selfKey: string
  handle: NativeWatchHandle | null
  state: WatchState
  recheckCause: RecheckCause
}

interface ListedEntry {
  readonly name: string
  readonly kind: 'dir' | 'other'
}

interface SplitListing {
  rel: string
  readonly entries: Map<string, ListedEntry>
}

type OpenResult = { readonly ok: true; readonly record: WatchRecord } | { readonly ok: false; readonly code: string }
type ListResult = { readonly entries: ListedEntry[] } | { readonly code: string }

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'UNKNOWN'
}

function codedError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: ${message}`), { code })
}

/** The root is gone or unusable; `EPERM` on the root is reported as `ENOENT` (D15). */
function rootCode(code: string): string {
  return code === 'EPERM' ? 'ENOENT' : code
}

/**
 * The root's real path. A gone root (`ENOENT`, or `EPERM`) throws; any other
 * failure watches the root as given, logged by code only.
 */
function resolveRealRoot(root: string, realpathNative: (target: string) => string): string {
  try {
    return realpathNative(root)
  } catch (error) {
    const code = rootCode(errorCode(error))
    if (code === 'ENOENT') throw codedError(code, 'cannot resolve the watched root')
    logger.warn('Native watcher: resolving the root failed, watching it as given', { code })
    return root
  }
}

function joinRel(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`
}

function parentOf(rel: string): string {
  const index = rel.lastIndexOf('/')
  return index < 0 ? '' : rel.slice(0, index)
}

function baseOf(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1)
}

function isAtOrUnder(key: string, ancestor: string): boolean {
  return ancestor === '' || key === ancestor || key.startsWith(`${ancestor}/`)
}

/** Only an absolute name can be a self-event; a relative one is never joined as absolute. */
function isAbsoluteName(name: string): boolean {
  return path.win32.isAbsolute(name) || name.startsWith('/')
}

/** `\\?\UNC\server\share` → `\\server\share`; `\\?\C:\x` → `C:\x`. */
function stripNamespace(name: string): string {
  if (name.slice(0, UNC_NAMESPACE_PREFIX.length).toUpperCase() === UNC_NAMESPACE_PREFIX) {
    return `\\\\${name.slice(UNC_NAMESPACE_PREFIX.length)}`
  }
  return name.startsWith(NAMESPACE_PREFIX) ? name.slice(NAMESPACE_PREFIX.length) : name
}

export class NativeRecursiveWatcher extends EventEmitter implements DirectoryWatchHandle {
  private readonly root: string
  private readonly realRoot: string
  private readonly shouldDrop: (rel: string) => boolean
  private readonly caseSensitive: boolean
  private readonly fsWatch: NativeFsWatch
  private readonly lstatFn: (path: string) => Promise<NativeLstatResult>
  private readonly readdirFn: (path: string) => Promise<readonly NativeDirEntry[]>
  private readonly now: () => number
  private readonly maxHandles: number
  private readonly resyncQuietMs: number
  private readonly resyncMaxWaitMs: number
  private readonly reopenLimit: number
  private readonly reopenWindowMs: number
  private readonly splitFolderKeys: ReadonlySet<string>
  private readonly classifier: NativeEventClassifier

  private readonly watches = new Map<string, WatchRecord>()
  private readonly listings = new Map<string, SplitListing>()
  /** Folder key → child keys changed by events while that folder is re-listed. */
  private readonly syncing = new Map<string, Set<string>>()
  private readonly syncAgain = new Map<string, boolean>()
  private readonly reopenTimes = new Map<string, number[]>()
  /** Split folders collapsed to one recursive watch after a failed listing (R-M1). */
  private readonly expandFailed = new Set<string>()
  private readonly warnState = new Map<string, { at: number; suppressed: number }>()
  private handleCount = 0
  private unwatchedCount = 0
  private planCapped: boolean
  private planElapsedMs: number | null = null
  private resyncTimer: ReturnType<typeof setTimeout> | null = null
  private resyncPending: { reason: DirectoryWatchResyncReason; firstAt: number } | null = null
  private closed = false

  /**
   * Resolves the root with `realpathNative` and watches it synchronously, so a
   * missing root throws `ENOENT` at once (and `EPERM` is reported as
   * `ENOENT`). Any other resolution failure falls back to the root as given:
   * the watch itself then decides whether the root is usable. The rest of the
   * plan runs asynchronously and ends in `ready`.
   */
  constructor(root: string, options: NativeRecursiveWatcherOptions) {
    super()
    this.root = root
    this.shouldDrop = options.shouldDrop
    this.caseSensitive = options.caseSensitive
    this.fsWatch = options.fsWatch ?? ((target, watchOptions, listener) => fs.watch(target, watchOptions, listener))
    this.lstatFn = options.lstat ?? (target => fs.promises.lstat(target))
    this.readdirFn = options.readdir ?? (target => fs.promises.readdir(target, { withFileTypes: true }))
    this.now = options.now ?? ((): number => Date.now())
    this.maxHandles = options.caps?.maxHandles ?? DEFAULT_MAX_HANDLES
    this.resyncQuietMs = options.resyncQuietMs ?? DEFAULT_RESYNC_QUIET_MS
    this.resyncMaxWaitMs = options.resyncMaxWaitMs ?? DEFAULT_RESYNC_MAX_WAIT_MS
    this.reopenLimit = options.reopenLimit ?? DEFAULT_REOPEN_LIMIT
    this.reopenWindowMs = options.reopenWindowMs ?? DEFAULT_REOPEN_WINDOW_MS
    this.planCapped = options.splitInputsCapped === true
    this.splitFolderKeys = this.buildSplitFolders(options.splitPaths, options.caps)

    const realpathNative = options.realpathNative ?? ((target: string): string => fs.realpathSync.native(target))
    this.realRoot = resolveRealRoot(root, realpathNative)

    this.classifier = new NativeEventClassifier({
      lstat: rel => this.lstatFn(this.toReal(rel)),
      isKnownFolder: rel => this.isKnownDirectory(rel),
      hasOpenWatch: rel => {
        const state = this.watches.get(this.fold(rel))?.state
        return state === 'open' || state === 'retired'
      },
      caseSensitive: this.caseSensitive,
      onEvent: event => this.onClassified(event),
      onBacklogOverflow: () => {
        this.classifier.clear()
        this.requestResync('backlog')
      }
    })

    const opened = this.openWatch('', false)
    if (!opened.ok) throw codedError(rootCode(opened.code), 'cannot watch the root')
    this.run(this.plan())
  }

  /** Close every handle; nothing is emitted afterwards. */
  close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      this.cancelResync()
      this.classifier.dispose()
      for (const record of this.watches.values()) {
        record.state = 'closed'
        this.closeHandle(record)
      }
      this.watches.clear()
      this.listings.clear()
      this.syncing.clear()
      this.syncAgain.clear()
      this.expandFailed.clear()
    }
    return Promise.resolve()
  }

  /** The plan's size – handles, split folders, caps – for the `ready` log line. */
  getPlanStats(): NativeWatchPlanStats {
    let recursiveWatches = 0
    let splitFolders = 0
    for (const record of this.watches.values()) {
      if (record.handle === null) continue
      if (record.recursive) recursiveWatches++
      else splitFolders++
    }
    return {
      handles: this.handleCount,
      recursiveWatches,
      splitFolders,
      planCapped: this.planCapped,
      elapsedMs: this.planElapsedMs
    }
  }

  // ── Plan ────────────────────────────────────────────────────────────────

  private buildSplitFolders(splitPaths: readonly string[], caps: NativeWatchCaps | undefined): Set<string> {
    const maxPaths = caps?.maxSplitPaths ?? DEFAULT_MAX_SPLIT_PATHS
    const maxDepth = caps?.maxSplitDepth ?? DEFAULT_MAX_SPLIT_DEPTH
    const keys = new Set<string>([''])
    let used = 0
    for (const splitPath of splitPaths) {
      const segments = splitPath.split(NAME_SEPARATORS).filter(segment => segment !== '' && segment !== '.')
      if (segments.length === 0 || segments.includes('..')) continue
      if (used >= maxPaths || segments.length > maxDepth) {
        this.planCapped = true
        continue
      }
      used++
      for (let depth = 1; depth < segments.length; depth++) {
        keys.add(this.fold(segments.slice(0, depth).join('/')))
      }
    }
    return keys
  }

  private async plan(): Promise<void> {
    const started = this.now()
    const failure = await this.expand('')
    if (this.closed) return
    if (failure !== null) {
      this.emitError(rootCode(failure), 'cannot list the watched root')
      return
    }
    this.planElapsedMs = this.now() - started
    this.emit('ready')
  }

  /** List a split folder whose non-recursive watch is open and plan its children. */
  private async expand(key: string): Promise<string | null> {
    const record = this.watches.get(key)
    // A recursive watch already covers everything below the folder
    if (!record || record.recursive) return null
    if (!this.listings.has(key)) this.listings.set(key, { rel: record.rel, entries: new Map() })
    return this.syncListing(key, false)
  }

  /**
   * Watch a new direct child folder of a split folder; `addDir` (when `emit`)
   * only once its watch – and for a split folder, its children's – is open.
   * In a plan pass (`deferred`, never with `emit`) a split child is queued
   * there for the caller to expand once every sibling has its watch.
   */
  private async openChild(rel: string, emit: boolean, deferred?: WatchRecord[]): Promise<void> {
    const key = this.fold(rel)
    const existing = this.watches.get(key)
    if (existing) {
      if (emit && existing.state === 'open') this.emitPath('addDir', rel)
      return
    }
    if (this.handleCount >= this.maxHandles) {
      this.planCapped = true
      this.warnLimited('handle-cap', 'Native watcher: handle cap reached, folder left unwatched', {
        maxHandles: this.maxHandles
      })
      if (emit) this.emitPath('addDir', rel)
      return
    }
    const split = this.splitFolderKeys.has(key)
    const opened = this.openWatch(rel, !split)
    if (!opened.ok) {
      // ENOENT: the folder is already gone again, and its removal follows
      if (opened.code === 'ENOENT') return
      this.warnLimited('open-failed', 'Native watcher: a watch failed to open', {
        code: opened.code,
        recursive: !split
      })
      if (emit) this.emitPath('addDir', rel)
      return
    }
    if (split && deferred) deferred.push(opened.record)
    else if (split) await this.expandChild(opened.record)
    if (emit && this.watches.has(key)) this.emitPath('addDir', rel)
  }

  /**
   * Plan a split child's children. A listing that fails for a reason other
   * than the folder being gone (a scanner holding it, say) leaves one
   * recursive watch instead, so nothing below the folder goes unwatched.
   */
  private async expandChild(record: WatchRecord): Promise<void> {
    // A deferred expansion whose record was replaced meanwhile: the new one decides
    if (this.watches.get(record.key) !== record || record.state !== 'open') return
    const failure = await this.expand(record.key)
    if (failure === null || failure === 'ENOENT' || this.closed) return
    // Moved, re-checked or removed meanwhile: that path decides its watch
    if (this.watches.get(record.key) !== record || record.state !== 'open') return
    this.warnLimited('expand-failed', 'Native watcher: listing a split folder failed, watching it recursively', {
      code: failure
    })
    this.expandFailed.add(record.key)
    this.collapse(record.key, record.rel)
  }

  private openWatch(rel: string, recursive: boolean): OpenResult {
    const realPath = this.toReal(rel)
    const record: WatchRecord = {
      key: this.fold(rel),
      rel,
      recursive,
      selfKey: this.selfKeyOf(realPath),
      handle: null,
      state: 'open',
      recheckCause: 'self'
    }
    let handle: NativeWatchHandle
    try {
      handle = this.fsWatch(realPath, { recursive, persistent: true }, (eventType, filename) =>
        this.onRawEvent(record, eventType, filename)
      )
    } catch (error) {
      return { ok: false, code: errorCode(error) }
    }
    record.handle = handle
    this.handleCount++
    handle.on('error', error => this.onHandleError(record, error))
    this.watches.set(record.key, record)
    return { ok: true, record }
  }

  private closeHandle(record: WatchRecord): void {
    const handle = record.handle
    if (handle === null) return
    record.handle = null
    this.handleCount--
    try {
      handle.close()
    } catch (error) {
      this.warnLimited('close-failed', 'Native watcher: closing a watch failed', { code: errorCode(error) })
    }
  }

  /** Close and forget every watch and listing at or under `key`. */
  private removeSubtree(key: string): void {
    for (const record of [...this.watches.values()]) {
      if (!isAtOrUnder(record.key, key)) continue
      record.state = 'closed'
      this.closeHandle(record)
      this.watches.delete(record.key)
    }
    for (const listingKey of [...this.listings.keys()]) {
      if (isAtOrUnder(listingKey, key)) this.listings.delete(listingKey)
    }
  }

  /**
   * Past the handle cap a split folder keeps one recursive watch (D1). When
   * that watch cannot open either, a resync covers the now unwatched folder.
   */
  private collapse(key: string, rel: string): void {
    this.planCapped = true
    this.removeSubtree(key)
    const opened = this.openWatch(rel, true)
    if (opened.ok) return
    if (key === '') {
      this.emitError(rootCode(opened.code), 'cannot watch the root')
      return
    }
    // ENOENT: the folder is already gone again, and its removal follows
    if (opened.code === 'ENOENT') return
    this.warnLimited('open-failed', 'Native watcher: a watch failed to open', { code: opened.code, recursive: true })
    this.requestResync('watch-error')
  }

  // ── Listings (D1, D3) ───────────────────────────────────────────────────

  /**
   * Re-list a split folder and apply the differences; one pass at a time per
   * folder. Resolves to the listing's error code, or `null`.
   */
  private async syncListing(key: string, emit: boolean): Promise<string | null> {
    if (this.syncing.has(key)) {
      this.syncAgain.set(key, emit || this.syncAgain.get(key) === true)
      return null
    }
    let pass: boolean | undefined = emit
    try {
      while (pass !== undefined && !this.closed) {
        const listing = this.listings.get(key)
        if (!listing) return null
        const touched = new Set<string>()
        this.syncing.set(key, touched)
        this.syncAgain.delete(key)
        const listed = await this.listDirectory(listing.rel)
        if ('code' in listed) return listed.code
        if (this.closed || this.listings.get(key) !== listing) return null
        await this.applyListing(key, listing, listed.entries, touched, pass)
        pass = this.syncAgain.get(key)
      }
      return null
    } finally {
      this.syncing.delete(key)
      this.syncAgain.delete(key)
    }
  }

  private async listDirectory(rel: string): Promise<ListResult> {
    let dirents: readonly NativeDirEntry[]
    try {
      dirents = await this.readdirFn(this.toReal(rel))
    } catch (error) {
      const code = errorCode(error)
      logger.debug('Native watcher: listing a folder failed', { code })
      return { code }
    }
    const entries: ListedEntry[] = []
    for (const dirent of dirents) {
      const childRel = joinRel(rel, dirent.name)
      if (this.shouldDrop(childRel)) continue
      let kind: ListedEntry['kind'] | null = 'other'
      if (dirent.isDirectory()) kind = 'dir'
      else if (!dirent.isFile()) kind = await this.confirmKind(childRel)
      if (kind !== null) entries.push({ name: dirent.name, kind })
    }
    return { entries }
  }

  /** A link-typed or untyped entry, confirmed with `lstat`: links are leaves. */
  private async confirmKind(rel: string): Promise<ListedEntry['kind'] | null> {
    try {
      const stats = await this.lstatFn(this.toReal(rel))
      return stats.isDirectory() && !stats.isSymbolicLink() ? 'dir' : 'other'
    } catch {
      return null
    }
  }

  private async applyListing(
    key: string,
    listing: SplitListing,
    entries: readonly ListedEntry[],
    touched: ReadonlySet<string>,
    emit: boolean
  ): Promise<void> {
    const fresh = new Map<string, ListedEntry>()
    for (const entry of entries) fresh.set(this.fold(entry.name), entry)
    for (const [childKey, previous] of [...listing.entries]) {
      if (touched.has(childKey) || fresh.has(childKey)) continue
      listing.entries.delete(childKey)
      this.onListedGone(joinRel(listing.rel, previous.name), previous.kind, emit)
    }
    if (!emit && this.exceedsHandleCap(listing, fresh, touched)) {
      this.collapse(key, listing.rel)
      return
    }
    // A plan pass opens every direct child before expanding any split one, so
    // the handle cap collapses a deeper folder, never a later sibling (D1)
    const deferred: WatchRecord[] | undefined = emit ? undefined : []
    for (const [childKey, entry] of fresh) {
      if (this.closed || this.listings.get(key) !== listing) return
      if (touched.has(childKey)) continue
      await this.applyEntry(listing, childKey, entry, emit, deferred)
    }
    for (const record of deferred ?? []) {
      if (this.closed || this.listings.get(key) !== listing) return
      await this.expandChild(record)
    }
  }

  private exceedsHandleCap(
    listing: SplitListing,
    fresh: ReadonlyMap<string, ListedEntry>,
    touched: ReadonlySet<string>
  ): boolean {
    let needed = 0
    for (const [childKey, entry] of fresh) {
      if (entry.kind !== 'dir' || touched.has(childKey)) continue
      if (!this.watches.has(this.fold(joinRel(listing.rel, entry.name)))) needed++
    }
    return this.handleCount + needed > this.maxHandles
  }

  private async applyEntry(
    listing: SplitListing,
    childKey: string,
    entry: ListedEntry,
    emit: boolean,
    deferred: WatchRecord[] | undefined
  ): Promise<void> {
    const previous = listing.entries.get(childKey)
    listing.entries.set(childKey, entry)
    const childRel = joinRel(listing.rel, entry.name)
    if (previous && previous.kind !== entry.kind) {
      this.onListedGone(joinRel(listing.rel, previous.name), previous.kind, emit)
    }
    const sameKind = previous !== undefined && previous.kind === entry.kind
    const respelled = sameKind && previous.name !== entry.name
    if (entry.kind === 'other') {
      if (emit && (!sameKind || respelled)) this.emitPath('add', childRel)
      return
    }
    const record = this.watches.get(this.fold(childRel))
    if (record?.state === 'retired') {
      await this.resolveRetired(record, childRel, emit, deferred)
    } else if (record) {
      if (respelled) this.respell(record, childRel)
      if (respelled && emit) this.emitPath('addDir', childRel)
    } else if (sameKind) {
      // Known and deliberately unwatched (re-open cap, cap, failed open)
      if (respelled && emit) this.emitPath('addDir', childRel)
    } else {
      await this.openChild(childRel, emit, deferred)
    }
  }

  private onListedGone(rel: string, kind: ListedEntry['kind'], emit: boolean): void {
    if (kind === 'dir') {
      this.removeSubtree(this.fold(rel))
      if (emit) this.emitPath('unlinkDir', rel)
    } else if (emit) {
      this.emitPath('unlink', rel)
    }
  }

  /** A case-only rename: same folded key, new spelling for it and everything under it. */
  private respell(record: WatchRecord, newRel: string): void {
    const oldRel = record.rel
    for (const other of this.watches.values()) {
      if (isAtOrUnder(other.key, record.key)) other.rel = newRel + other.rel.slice(oldRel.length)
    }
    for (const [listingKey, listing] of this.listings) {
      if (isAtOrUnder(listingKey, record.key)) listing.rel = newRel + listing.rel.slice(oldRel.length)
    }
  }

  /** Record a classified change in the parent split folder's listing. */
  private updateListing(rel: string, kind: ListedEntry['kind'] | null): void {
    const parentKey = this.fold(parentOf(rel))
    const listing = this.listings.get(parentKey)
    if (!listing) return
    const name = baseOf(rel)
    const childKey = this.fold(name)
    if (kind === null) listing.entries.delete(childKey)
    else listing.entries.set(childKey, { name, kind })
    this.syncing.get(parentKey)?.add(childKey)
  }

  // ── Raw events (D4, D15) ────────────────────────────────────────────────

  private onRawEvent(record: WatchRecord, eventType: string, filename: string | null): void {
    // First line: a retired or closed handle costs nothing (the D15 flood)
    if (record.state !== 'open') {
      // A retired handle still open until its old name is classified floods
      // just the same if its folder is then deleted: close it on the first
      // absolute name, after which this branch is two comparisons
      if (record.handle !== null && filename !== null && isAbsoluteName(filename)) this.closeHandle(record)
      return
    }
    if (filename !== null && isAbsoluteName(filename)) {
      if (this.selfKeyOf(stripNamespace(filename)) === record.selfKey) this.onSelfEvent(record)
      return
    }
    if (filename === null) {
      this.onOverflow(record)
      return
    }
    const rel = this.childRelOf(record.rel, filename)
    if (rel === null || this.shouldDrop(rel)) return
    if (eventType === 'rename') this.retireWatchAt(this.fold(rel), record)
    else if (this.isKnownDirectory(rel)) return // folder timestamp noise
    this.classifier.enqueue(rel, eventType === 'rename' ? 'rename' : 'change')
  }

  /** The watched folder itself was deleted: close before anything else, then re-check. */
  private onSelfEvent(record: WatchRecord): void {
    record.state = 'rechecking'
    record.recheckCause = 'self'
    this.closeHandle(record)
    this.classifier.enqueue(record.rel, 'recheck')
  }

  private onHandleError(record: WatchRecord, error: Error): void {
    if (record.state !== 'open' || this.closed) return
    record.state = 'rechecking'
    record.recheckCause = 'error'
    this.closeHandle(record)
    this.warnLimited('watch-error', 'Native watcher: a watch reported an error', {
      code: errorCode(error),
      recursive: record.recursive
    })
    this.classifier.enqueue(record.rel, 'recheck')
  }

  private onOverflow(record: WatchRecord): void {
    this.emit('overflow')
    if (!record.recursive && this.listings.has(record.key)) {
      // A re-list that fails (other than as gone) cannot say what was lost
      this.run(
        this.syncListing(record.key, true).then(code => {
          if (code !== null && code !== 'ENOENT') this.requestResync('overflow')
        })
      )
      return
    }
    this.requestResync('overflow')
  }

  /**
   * A parent's `rename` of a watched folder: its handle follows the moved
   * folder and would report under the old name, so stop listening at once.
   */
  private retireWatchAt(key: string, source: WatchRecord): void {
    const target = this.watches.get(key)
    if (!target || target === source || target.state !== 'open') return
    for (const record of this.watches.values()) {
      if (record.state === 'open' && isAtOrUnder(record.key, key)) record.state = 'retired'
    }
  }

  // ── Classified events (D2) ──────────────────────────────────────────────

  private onClassified(event: NativeClassifiedEvent): void {
    if (this.closed) return
    const rel = event.path
    const record = this.watches.get(this.fold(rel))
    if (event.source === 'recheck') {
      if (record?.state === 'rechecking') this.finishRecheck(record, event.type === 'addDir')
      return
    }
    switch (event.type) {
      case 'change':
        this.emitPath('change', rel)
        return
      case 'locked':
        this.onLocked(rel, record)
        return
      case 'add':
        if (record && record.state !== 'rechecking') this.onListedGone(rel, 'dir', true)
        this.updateListing(rel, 'other')
        this.emitPath('add', rel)
        return
      case 'addDir':
        this.onDirAdded(rel, record)
        return
      default:
        if (record) this.removeSubtree(record.key)
        this.updateListing(rel, null)
        this.emitPath(event.type, rel)
    }
  }

  private onDirAdded(rel: string, record: WatchRecord | undefined): void {
    const parentKey = this.fold(parentOf(rel))
    if (!this.listings.has(parentKey)) {
      this.emitPath('addDir', rel) // inside a recursive watch
      return
    }
    if (record && (record.state === 'retired' || baseOf(record.rel) !== baseOf(rel))) {
      // Renamed back, re-created, or renamed in case only: the listing decides
      this.run(this.syncListing(parentKey, true))
      return
    }
    this.updateListing(rel, 'dir')
    this.run(this.openChild(rel, true))
  }

  private onLocked(rel: string, record: WatchRecord | undefined): void {
    if (!record || (record.state !== 'open' && record.state !== 'retired')) {
      this.emitPath('add', rel)
      return
    }
    record.state = 'rechecking'
    record.recheckCause = 'locked'
    this.closeHandle(record)
    this.classifier.enqueue(record.rel, 'recheck')
  }

  /** The one re-check after a close (D15): only a readable directory is watched again. */
  private finishRecheck(record: WatchRecord, readableDirectory: boolean): void {
    if (readableDirectory) {
      this.reopen(record)
      return
    }
    if (record.key === '') {
      this.removeSubtree('')
      this.classifier.clear()
      this.cancelResync()
      this.emitError('ENOENT', 'the watched root is gone')
      return
    }
    this.removeSubtree(record.key)
    this.updateListing(record.rel, null)
    this.emitPath('unlinkDir', record.rel)
  }

  private async resolveRetired(
    record: WatchRecord,
    rel: string,
    emit: boolean,
    deferred: WatchRecord[] | undefined
  ): Promise<void> {
    this.removeSubtree(record.key)
    if (!this.allowReopen(record.key)) {
      this.reportUnwatched('reopen')
      if (emit) this.emitPath('addDir', rel)
      return
    }
    await this.openChild(rel, emit, deferred)
    this.requestResync('reopen')
  }

  private reopen(record: WatchRecord): void {
    const reason: DirectoryWatchResyncReason = record.recheckCause === 'error' ? 'watch-error' : 'reopen'
    this.watches.delete(record.key)
    if (!this.allowReopen(record.key)) {
      this.reportUnwatched(reason)
      return
    }
    if (record.key === '') {
      this.removeSubtree('')
      const opened = this.openWatch('', false)
      if (!opened.ok) {
        this.emitError(rootCode(opened.code), 'cannot watch the root')
        return
      }
      this.run(this.expand('').then(() => undefined))
    } else {
      this.run(this.openChild(record.rel, false))
    }
    this.requestResync(reason)
  }

  private allowReopen(key: string): boolean {
    const now = this.now()
    const recent = (this.reopenTimes.get(key) ?? []).filter(at => now - at < this.reopenWindowMs)
    const allowed = recent.length < this.reopenLimit
    if (allowed) recent.push(now)
    this.reopenTimes.set(key, recent)
    return allowed
  }

  private reportUnwatched(reason: DirectoryWatchResyncReason): void {
    this.unwatchedCount++
    this.requestResync(reason)
    this.warnLimited('reopen-cap', 'Native watcher: folder left unwatched after repeated re-opens', {
      reopenLimit: this.reopenLimit,
      windowMs: this.reopenWindowMs,
      unwatched: this.unwatchedCount
    })
  }

  // ── Resync (D3) ─────────────────────────────────────────────────────────

  private requestResync(reason: DirectoryWatchResyncReason): void {
    if (this.closed) return
    const now = this.now()
    if (this.resyncPending === null) this.resyncPending = { reason, firstAt: now }
    if (this.resyncTimer !== null) clearTimeout(this.resyncTimer)
    const waited = now - this.resyncPending.firstAt
    const delay = Math.max(0, Math.min(this.resyncQuietMs, this.resyncMaxWaitMs - waited))
    this.resyncTimer = setTimeout(() => this.fireResync(), delay)
  }

  private fireResync(): void {
    const pending = this.resyncPending
    this.resyncTimer = null
    this.resyncPending = null
    if (pending === null || this.closed) return
    // The re-read that answers the resync covers every queued event
    this.classifier.clear()
    this.emit('resync', pending.reason)
    // …but not the plan: re-list the split folders so a folder whose event was
    // cleared still gets its watch, and a retired watch is resolved
    this.run(this.relistAll())
  }

  private cancelResync(): void {
    if (this.resyncTimer !== null) clearTimeout(this.resyncTimer)
    this.resyncTimer = null
    this.resyncPending = null
  }

  private async relistAll(): Promise<void> {
    await this.retryFailedSplits()
    for (const key of [...this.listings.keys()]) {
      if (this.closed) return
      await this.syncListing(key, true)
    }
  }

  /**
   * Re-plan each split folder a failed listing collapsed (R-M1): left
   * recursive, it would keep the excluded churn below it in its buffer for
   * the rest of the session. Gated like a re-open, so a folder that keeps
   * failing is retried at most `reopenLimit` times per `reopenWindowMs`.
   */
  private async retryFailedSplits(): Promise<void> {
    for (const key of [...this.expandFailed]) {
      if (this.closed) return
      const record = this.watches.get(key)
      if (!record || !record.recursive || record.state !== 'open') {
        this.expandFailed.delete(key)
        continue
      }
      if (!this.allowReopen(key)) continue
      this.expandFailed.delete(key)
      this.removeSubtree(key)
      await this.openChild(record.rel, false)
      this.requestResync('reopen')
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private isKnownDirectory(rel: string): boolean {
    if (this.watches.has(this.fold(rel))) return true
    const listing = this.listings.get(this.fold(parentOf(rel)))
    return listing?.entries.get(this.fold(baseOf(rel)))?.kind === 'dir'
  }

  private childRelOf(parentRel: string, filename: string): string | null {
    const segments: string[] = []
    for (const segment of filename.split(NAME_SEPARATORS)) {
      if (segment === '' || segment === '.') continue
      if (segment === '..') return null
      segments.push(segment)
    }
    return segments.length === 0 ? null : joinRel(parentRel, segments.join('/'))
  }

  private fold(value: string): string {
    return this.caseSensitive ? value : value.toLowerCase()
  }

  private selfKeyOf(absolutePath: string): string {
    return this.fold(absolutePath.replace(/\\/g, '/').replace(/\/+$/, ''))
  }

  private toAbs(rel: string): string {
    return rel === '' ? this.root : path.join(this.root, ...rel.split('/'))
  }

  private toReal(rel: string): string {
    return rel === '' ? this.realRoot : path.join(this.realRoot, ...rel.split('/'))
  }

  private emitPath(type: 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change', rel: string): void {
    if (!this.closed) this.emit(type, this.toAbs(rel))
  }

  private emitError(code: string, message: string): void {
    if (this.closed) return
    if (this.listenerCount('error') > 0) this.emit('error', codedError(code, message))
    else logger.warn('Native watcher: error with no listener', { code })
  }

  private warnLimited(key: string, message: string, context: Record<string, unknown>): void {
    const now = this.now()
    const state = this.warnState.get(key)
    if (state && now - state.at < WARN_INTERVAL_MS) {
      state.suppressed++
      return
    }
    logger.warn(message, { ...context, suppressedCount: state?.suppressed ?? 0 })
    this.warnState.set(key, { at: now, suppressed: 0 })
  }

  /** Run a background task; an unexpected failure is logged by code, never thrown. */
  private run(task: Promise<unknown>): void {
    task.catch((error: unknown) => {
      logger.warn('Native watcher: background task failed', { code: errorCode(error) })
    })
  }
}
