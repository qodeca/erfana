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
 * excluded writes never trigger a reparse (design §10 performance). A folder
 * that does not exist yet is not watched – as before, the bar then updates on
 * terminal activity and explicit refreshes only.
 *
 * Events are coalesced per dir over a short window before the single
 * `onChange(dir)` callback fires, so a burst of writes produces one refresh.
 *
 * Robustness: this watcher NEVER throws outward — watch errors are swallowed
 * (logged) and watching continues; `closeAll` is safe to call repeatedly.
 *
 * @see docs/designs/216-claude-status-bar.md §3, §4, §7, §10
 */
import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../LoggingService'

/** Coalescing window for transcript-dir events (ms). */
const COALESCE_WINDOW_MS = 250

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
type WatchFn = (
  dir: string,
  listener: (eventType: string, filename: string | null) => void
) => FolderWatchHandle

const watchFolder: WatchFn = (dir, listener) =>
  fs.watch(dir, { persistent: true, recursive: false, encoding: 'utf8' }, listener)

/** Internal per-dir watcher state with its refcount set and coalesce timer. */
interface WatchedDir {
  /** The folder watch for this dir. */
  watcher: FolderWatchHandle
  /** Consumers (terminalIds) keeping this dir alive; refcount. */
  consumers: Set<string>
  /** Pending coalesce timer; non-null while a burst is being collected. */
  coalesceTimer: NodeJS.Timeout | null
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

  constructor(opts?: { watch?: WatchFn }) {
    this.watchFn = opts?.watch ?? watchFolder
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
   * consumers of the same dir just join the set (no second watcher).
   */
  watchDir(dir: string, consumerId: string): void {
    const existing = this.dirs.get(dir)
    if (existing) {
      existing.consumers.add(consumerId)
      return
    }

    let watcher: FolderWatchHandle
    try {
      watcher = this.watchFn(dir, (_eventType, filename) => {
        if (isTranscriptEventName(filename)) this.scheduleChange(dir)
      })
    } catch (error) {
      // ENOENT included: a folder Claude has not created yet is not watched
      // Never throw outward — a failed watch leaves the bar simply not updating
      // live; an explicit refresh still works.
      // Log only the dir basename — the full absolute path would leak host
      // filesystem layout into log files (the transcript root is under the
      // user's home dir).
      logger.warn('ClaudeTranscriptWatcher: failed to create watcher', {
        dir: path.basename(dir),
        error: error instanceof Error ? error.message : String(error)
      })
      return
    }

    const entry: WatchedDir = {
      watcher,
      consumers: new Set([consumerId]),
      coalesceTimer: null
    }
    this.dirs.set(dir, entry)

    watcher.on('error', (error: unknown) => {
      // Swallow watch errors and keep going (design §7 fail-soft).
      logger.warn('ClaudeTranscriptWatcher: watcher error', {
        dir: path.basename(dir),
        error: error instanceof Error ? error.message : String(error)
      })
    })
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
   * Close every watcher and clear all coalesce timers. Safe to call repeatedly
   * (the map is emptied on the first call). Used on service dispose.
   */
  async closeAll(): Promise<void> {
    const entries = Array.from(this.dirs.entries())
    this.dirs.clear()

    await Promise.all(
      entries.map(async ([, entry]) => {
        if (entry.coalesceTimer) {
          clearTimeout(entry.coalesceTimer)
          entry.coalesceTimer = null
        }
        try {
          entry.watcher.close()
        } catch (error) {
          logger.warn('ClaudeTranscriptWatcher: error closing watcher', {
            error: error instanceof Error ? error.message : String(error)
          })
        }
      })
    )
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

  /** Close one dir's watcher, clear its timer, and drop it from the map. */
  private closeEntry(dir: string, entry: WatchedDir): void {
    if (entry.coalesceTimer) {
      clearTimeout(entry.coalesceTimer)
      entry.coalesceTimer = null
    }
    this.dirs.delete(dir)
    try {
      entry.watcher.close()
    } catch (error) {
      logger.warn('ClaudeTranscriptWatcher: error closing watcher', {
        dir: path.basename(dir),
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
