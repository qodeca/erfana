// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ClaudeTranscriptWatcher — external chokidar watcher that owns the watched-dir
 * set for the Claude status bar (#216).
 *
 * It watches `~/.claude/projects/<ENC>` directories which live OUTSIDE the
 * project root, so it is DELIBERATELY not routed through DirectoryWatcherService
 * (which hard-restricts watching to the project tree). Per the design §10
 * "watcher owns the dir set" remediation, all de-dup / refcount logic lives here
 * behind a narrow `watchDir/unwatchDir/onChange` interface (DIP): the service
 * asks to watch a dir for a consumer; the watcher creates exactly one chokidar
 * instance per dir and closes it when the last consumer leaves.
 *
 * chokidar config matches the project convention (v3, FSEvents, ~0 FDs/file):
 * `disableGlobbing:true, ignoreInitial:true, usePolling:false,
 * followSymlinks:false, depth:0`. An `ignored` predicate drops anything under a
 * `subagents/` segment and any non-`.jsonl` file so sidechain/excluded writes
 * never trigger a reparse (design §10 performance).
 *
 * Events are coalesced per dir over a short window before the single
 * `onChange(dir)` callback fires, so a burst of writes produces one refresh.
 *
 * Robustness: this watcher NEVER throws outward — chokidar errors are swallowed
 * (logged) and watching continues; `closeAll` is safe to call repeatedly.
 *
 * @see docs/designs/216-claude-status-bar.md §3, §4, §7, §10
 */
import chokidar, { FSWatcher } from 'chokidar'
import path from 'node:path'
import { logger } from '../LoggingService'

/** Coalescing window for transcript-dir events (ms). */
const COALESCE_WINDOW_MS = 250

/** Path segment whose subtree (sidechain/subagent transcripts) is excluded. */
const SUBAGENTS_SEGMENT = 'subagents'

/** Transcript file extension; non-matching paths are ignored by the watcher. */
const TRANSCRIPT_EXT = '.jsonl'

/** Injected chokidar.watch signature (defaults to the real implementation). */
type WatchFn = typeof chokidar.watch

/** Internal per-dir watcher state with its refcount set and coalesce timer. */
interface WatchedDir {
  /** The chokidar watcher instance for this dir. */
  watcher: FSWatcher
  /** Consumers (terminalIds) keeping this dir alive; refcount. */
  consumers: Set<string>
  /** Pending coalesce timer; non-null while a burst is being collected. */
  coalesceTimer: NodeJS.Timeout | null
}

/**
 * Predicate passed to chokidar's `ignored` option. Drops any path under a
 * `subagents/` segment and any path that is not a `.jsonl` file. Directory
 * entries (no extension) are NOT ignored so chokidar can descend the watched
 * dir; with `depth:0` only the top level is observed anyway.
 *
 * Exported for direct unit testing (design §1 test plan).
 */
export function shouldIgnoreTranscriptPath(targetPath: string): boolean {
  // Normalize separators so the segment test works on any platform.
  const segments = targetPath.split(/[\\/]/)
  if (segments.includes(SUBAGENTS_SEGMENT)) return true

  // Only filter files (entries that have an extension). Allow extension-less
  // entries (directories) through so chokidar can watch the dir itself.
  const base = segments[segments.length - 1] ?? ''
  const ext = path.extname(base)
  if (ext.length === 0) return false

  return ext !== TRANSCRIPT_EXT
}

/**
 * External chokidar watcher for Claude transcript dirs. One instance is owned by
 * ClaudeStatusService.
 */
export class ClaudeTranscriptWatcher {
  /** Active watchers keyed by absolute dir path. */
  private readonly dirs = new Map<string, WatchedDir>()

  /** The single change callback registered by the service. */
  private onChangeCb: ((dir: string) => void) | null = null

  /** Injected chokidar.watch (real by default; mocked in tests). */
  private readonly watchFn: WatchFn

  constructor(opts?: { watch?: WatchFn }) {
    this.watchFn = opts?.watch ?? chokidar.watch
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
   * chokidar watcher is created only for the FIRST consumer; subsequent
   * consumers of the same dir just join the set (no second watcher).
   */
  watchDir(dir: string, consumerId: string): void {
    const existing = this.dirs.get(dir)
    if (existing) {
      existing.consumers.add(consumerId)
      return
    }

    let watcher: FSWatcher
    try {
      watcher = this.watchFn(dir, {
        persistent: true,
        ignoreInitial: true,
        usePolling: false,
        // chokidar pinned to v3 (FSEvents, ~0 FDs/file). disableGlobbing treats
        // the path literally — transcript dirs can contain glob chars.
        disableGlobbing: true,
        followSymlinks: false,
        depth: 0,
        ignored: (p: string) => shouldIgnoreTranscriptPath(p)
      })
    } catch (error) {
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

    const onFsEvent = (): void => this.scheduleChange(dir)
    watcher.on('add', onFsEvent)
    watcher.on('change', onFsEvent)
    watcher.on('unlink', onFsEvent)
    watcher.on('error', (error: unknown) => {
      // Swallow chokidar errors and keep going (design §7 fail-soft).
      logger.warn('ClaudeTranscriptWatcher: watcher error', {
        dir: path.basename(dir),
        error: error instanceof Error ? error.message : String(error)
      })
    })
  }

  /**
   * Drop `consumerId` from `dir`'s refcount. When the consumer set empties the
   * chokidar watcher is closed and the dir entry removed. Idempotent: safe if the
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
          await entry.watcher.close()
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
    void entry.watcher.close().catch((error) => {
      logger.warn('ClaudeTranscriptWatcher: error closing watcher', {
        dir: path.basename(dir),
        error: error instanceof Error ? error.message : String(error)
      })
    })
  }
}
