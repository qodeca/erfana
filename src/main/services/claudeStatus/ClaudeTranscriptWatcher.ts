// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ClaudeTranscriptWatcher — external folder watcher that owns the watched-dir
 * set for the Claude status bar (#216).
 *
 * It watches `~/.claude/projects/<ENC>` directories which live OUTSIDE the
 * project root, so it is DELIBERATELY not routed through DirectoryWatcherService
 * (which hard-restricts watching to the project tree). Per the design §10
 * "watcher owns the dir set" remediation, all de-dup / refcount logic lives here
 * behind a narrow `watchDir/unwatchDir/onChange` interface (DIP): the service
 * asks to watch a dir for a consumer; the watcher creates exactly one watch
 * per dir and closes it when the last consumer leaves.
 *
 * One non-recursive `fs.watch` on the folder, never one per transcript: chokidar
 * watched every file on its own, and on macOS each of those holds a kqueue
 * descriptor, so a long-lived project folder with hundreds of sessions held
 * hundreds of handles. A folder watch reports appends to the files directly in
 * it on macOS, Linux and Windows. Events are filtered by name: anything under a
 * `subagents/` segment and any non-`.jsonl` name is dropped so sidechain or
 * excluded writes never trigger a reparse (design §10 performance).
 *
 * A folder that does not exist yet, or whose watch died (Node closes the
 * handle before it emits `error` – EPERM on Windows when the folder is
 * deleted), keeps its consumers and is tried again: on the next `watchDir`
 * (the service calls it on every refresh) and after a back-off of
 * {@link REARM_DELAY_MS}, doubling to {@link REARM_MAX_DELAY_MS}. A watch that
 * comes back reports one change, since transcripts may have been written
 * while nothing listened.
 *
 * Events are coalesced per dir over a short window before the single
 * `onChange(dir)` callback fires, so a burst of writes produces one refresh.
 *
 * Robustness: this watcher NEVER throws outward — watch errors are swallowed
 * (logged) and watching continues; `closeAll` is safe to call repeatedly.
 *
 * @see docs/designs/context-meter/216-claude-status-bar.md §3, §4, §7, §10
 */
import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../LoggingService'

/** Coalescing window for transcript-dir events (ms). */
const COALESCE_WINDOW_MS = 250

/** First delay before a missing or dead folder watch is tried again (ms). */
export const REARM_DELAY_MS = 5_000

/** Longest delay between two re-arm attempts (ms). */
export const REARM_MAX_DELAY_MS = 60_000

/** Path segment whose subtree (sidechain/subagent transcripts) is excluded. */
const SUBAGENTS_SEGMENT = 'subagents'

/** Transcript file extension; non-matching paths are ignored by the watcher. */
const TRANSCRIPT_EXT = '.jsonl'

/** The part of `fs.FSWatcher` this watcher uses. */
export interface FolderWatchHandle {
  close(): void
  on(event: 'error', listener: (error: unknown) => void): unknown
}

/**
 * Injected folder-watch signature (defaults to a non-recursive `fs.watch`). The
 * listener gets the changed entry's name, or null when the platform has none.
 */
/** Injected `stat` (defaults to `fs.promises.stat`); only `ino` is read. */
type StatFn = (dir: string) => Promise<{ ino: number }>

type WatchFn = (
  dir: string,
  listener: (eventType: string, filename: string | null) => void
) => FolderWatchHandle

const watchFolder: WatchFn = (dir, listener) =>
  fs.watch(dir, { persistent: true, recursive: false, encoding: 'utf8' }, listener)

/** Internal per-dir watcher state with its refcount set and coalesce timer. */
interface WatchedDir {
  /** The folder watch for this dir; null while the folder is missing or the watch died. */
  watcher: FolderWatchHandle | null
  /** Pending re-arm attempt, while `watcher` is null. */
  rearmTimer: NodeJS.Timeout | null
  /** Delay before the next re-arm attempt; doubles per failure, reset on success. */
  rearmDelayMs: number
  /** Consumers (terminalIds) keeping this dir alive; refcount. */
  consumers: Set<string>
  /** Pending coalesce timer; non-null while a burst is being collected. */
  coalesceTimer: NodeJS.Timeout | null
  /** The folder's inode when the watch was armed; a different one means it was replaced */
  ino?: number
  /** When `watchDir` last checked a live watch against the folder (ms) */
  lastCheckAt: number
}

/**
 * Drops any path under a `subagents/` segment and any path that is not a
 * `.jsonl` file. Extension-less entries (directories) are NOT ignored here;
 * {@link isTranscriptEventName} adds the extension requirement for events.
 *
 * Exported for direct unit testing (design §1 test plan).
 */
export function shouldIgnoreTranscriptPath(targetPath: string): boolean {
  // Normalize separators so the segment test works on any platform.
  const segments = targetPath.split(/[\\/]/)
  if (segments.includes(SUBAGENTS_SEGMENT)) return true

  // Only filter files (entries that have an extension). Allow extension-less
  // entries (directories) through; event names also need the extension.
  const base = segments[segments.length - 1] ?? ''
  const ext = path.extname(base)
  if (ext.length === 0) return false

  return ext !== TRANSCRIPT_EXT
}

/**
 * Whether a folder-watch event names a transcript. A null name (the platform
 * did not say which entry changed) counts, so a real change is never missed.
 */
export function isTranscriptEventName(filename: string | null): boolean {
  if (filename === null) return true
  return !shouldIgnoreTranscriptPath(filename) && path.extname(filename) === TRANSCRIPT_EXT
}

/**
 * External folder watcher for Claude transcript dirs. One instance is owned by
 * ClaudeStatusService.
 */
export class ClaudeTranscriptWatcher {
  /** Active watchers keyed by absolute dir path. */
  private readonly dirs = new Map<string, WatchedDir>()

  /** The single change callback registered by the service. */
  private onChangeCb: ((dir: string) => void) | null = null

  /** Injected folder watch (real by default; mocked in tests). */
  private readonly watchFn: WatchFn
  private readonly statFn: StatFn

  constructor(opts?: { watch?: WatchFn; stat?: StatFn }) {
    this.watchFn = opts?.watch ?? watchFolder
    this.statFn = opts?.stat ?? ((dir) => fs.promises.stat(dir))
  }

  /**
   * Register the single change callback the service uses. Calling again replaces
   * the previous callback.
   */
  onChange(cb: (dir: string) => void): void {
    this.onChangeCb = cb
  }

  /**
   * Begin watching `dir` on behalf of `consumerId`. Refcounted by dir: the
   * folder watch is created only for the FIRST consumer; subsequent
   * consumers of the same dir just join the set (no second watcher). Calling
   * it again for a live watch is a no-op; for a missing or dead one it tries
   * to arm the watch again at once.
   */
  watchDir(dir: string, consumerId: string): void {
    let entry = this.dirs.get(dir)
    if (!entry) {
      entry = {
        watcher: null,
        rearmTimer: null,
        rearmDelayMs: REARM_DELAY_MS,
        consumers: new Set(),
        coalesceTimer: null,
        lastCheckAt: 0
      }
      this.dirs.set(dir, entry)
      entry.consumers.add(consumerId)
      this.arm(dir, entry, false)
      return
    }
    entry.consumers.add(consumerId)
    if (entry.watcher === null) this.arm(dir, entry, true)
    else this.checkLive(dir, entry)
  }

  /**
   * Drop `consumerId` from `dir`'s refcount. When the consumer set empties the
   * folder watch is closed and the dir entry removed. Idempotent: safe if the
   * dir or the consumer is unknown.
   */
  unwatchDir(dir: string, consumerId: string): void {
    const entry = this.dirs.get(dir)
    if (!entry) return

    entry.consumers.delete(consumerId)
    if (entry.consumers.size > 0) return

    this.closeEntry(dir, entry)
  }

  /**
   * Close every watcher and clear all timers. Safe to call repeatedly
   * (the map is emptied on the first call). Used on service dispose.
   */
  async closeAll(): Promise<void> {
    const entries = Array.from(this.dirs.entries())
    this.dirs.clear()
    for (const [dir, entry] of entries) this.releaseEntry(dir, entry)
  }

  /**
   * Try to open the folder watch. On failure – a folder Claude has not
   * created yet (ENOENT) included – keep the entry and its consumers and try
   * again after the back-off. `notify`: report one change once it is armed.
   */
  private arm(dir: string, entry: WatchedDir, notify: boolean): void {
    if (entry.rearmTimer) {
      clearTimeout(entry.rearmTimer)
      entry.rearmTimer = null
    }
    let watcher: FolderWatchHandle
    try {
      watcher = this.watchFn(dir, (_eventType, filename) => {
        if (isTranscriptEventName(filename)) this.scheduleChange(dir)
      })
    } catch (error) {
      // Never throw outward — the bar updates on terminal activity and explicit
      // refreshes meanwhile. Log only the dir basename — the full absolute path
      // would leak host filesystem layout into log files. A missing folder is
      // the normal state before Claude's first message, so it logs at debug.
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      const log = code === 'ENOENT' ? logger.debug : logger.warn
      log.call(logger, 'ClaudeTranscriptWatcher: failed to create watcher', {
        dir: path.basename(dir),
        error: error instanceof Error ? error.message : String(error)
      })
      this.scheduleRearm(dir, entry)
      return
    }

    entry.watcher = watcher
    entry.rearmDelayMs = REARM_DELAY_MS
    watcher.on('error', (error: unknown) => {
      // Node has already closed the handle: drop it, keep the consumers, and
      // try again later (design §7 fail-soft).
      logger.warn('ClaudeTranscriptWatcher: watcher error', {
        dir: path.basename(dir),
        error: error instanceof Error ? error.message : String(error)
      })
      if (this.dirs.get(dir) !== entry || entry.watcher !== watcher) return
      entry.watcher = null
      this.closeQuietly(watcher, dir)
      this.scheduleRearm(dir, entry)
    })
    entry.ino = undefined
    entry.lastCheckAt = Date.now()
    void this.statFn(dir).then(
      (stats) => {
        if (entry.watcher === watcher) entry.ino = stats.ino
      },
      () => {}
    )
    if (notify) this.scheduleChange(dir)
  }

  /**
   * On macOS and Linux a deleted (or deleted and re-created) folder may leave
   * its watch silent without an `error`. At most once per {@link REARM_DELAY_MS},
   * a `watchDir` on a live watch compares the folder's inode with the one at
   * arm time, off the main thread; gone or different, the watch is re-armed.
   */
  private checkLive(dir: string, entry: WatchedDir): void {
    const now = Date.now()
    if (now - entry.lastCheckAt < REARM_DELAY_MS) return
    entry.lastCheckAt = now
    const watcher = entry.watcher
    void this.statFn(dir).then(
      (stats) => {
        if (entry.watcher !== watcher || entry.ino === undefined || stats.ino === entry.ino) return
        this.rearmDead(dir, entry)
      },
      () => {
        if (entry.watcher === watcher) this.rearmDead(dir, entry)
      }
    )
  }

  private rearmDead(dir: string, entry: WatchedDir): void {
    if (this.dirs.get(dir) !== entry || entry.watcher === null) return
    const dead = entry.watcher
    entry.watcher = null
    this.closeQuietly(dead, dir)
    this.arm(dir, entry, true)
  }

  private scheduleRearm(dir: string, entry: WatchedDir): void {
    if (entry.rearmTimer) return
    const delay = entry.rearmDelayMs
    entry.rearmDelayMs = Math.min(delay * 2, REARM_MAX_DELAY_MS)
    entry.rearmTimer = setTimeout(() => {
      entry.rearmTimer = null
      if (this.dirs.get(dir) !== entry || entry.watcher !== null) return
      this.arm(dir, entry, true)
    }, delay)
    // A pending retry must never keep the process alive at quit
    entry.rearmTimer.unref?.()
  }

  /**
   * Coalesce a burst of FS events for `dir` into a single `onChange(dir)` fired
   * after {@link COALESCE_WINDOW_MS} of quiet.
   */
  private scheduleChange(dir: string): void {
    const entry = this.dirs.get(dir)
    if (!entry) return

    if (entry.coalesceTimer) clearTimeout(entry.coalesceTimer)
    entry.coalesceTimer = setTimeout(() => {
      entry.coalesceTimer = null
      // Re-check: the dir may have been unwatched during the coalesce window.
      if (!this.dirs.has(dir)) return
      try {
        this.onChangeCb?.(dir)
      } catch (error) {
        logger.warn('ClaudeTranscriptWatcher: onChange callback threw', {
          dir: path.basename(dir),
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }, COALESCE_WINDOW_MS)
  }

  /** Close one dir's watcher, clear its timers, and drop it from the map. */
  private closeEntry(dir: string, entry: WatchedDir): void {
    this.dirs.delete(dir)
    this.releaseEntry(dir, entry)
  }

  private releaseEntry(dir: string, entry: WatchedDir): void {
    if (entry.coalesceTimer) {
      clearTimeout(entry.coalesceTimer)
      entry.coalesceTimer = null
    }
    if (entry.rearmTimer) {
      clearTimeout(entry.rearmTimer)
      entry.rearmTimer = null
    }
    const watcher = entry.watcher
    entry.watcher = null
    if (watcher) this.closeQuietly(watcher, dir)
  }

  private closeQuietly(watcher: FolderWatchHandle, dir: string): void {
    try {
      watcher.close()
    } catch (error) {
      logger.warn('ClaudeTranscriptWatcher: error closing watcher', {
        dir: path.basename(dir),
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
