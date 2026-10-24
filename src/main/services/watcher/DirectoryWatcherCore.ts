// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The state every layer of `DirectoryWatcherService` shares, and the rules
 * they all apply: which paths are dropped (#211, D4), which backend builds a
 * watch (D6), and how a notice reaches the watching windows. Split out of the
 * service (finding [65]); the layers above are `DirectoryWatcherRecovery`
 * (errors and restarts), `DirectoryWatcherEvents` (the event pipeline and
 * pauses) and the service itself (the public lifecycle).
 */
import { BrowserWindow } from 'electron'
import { logger } from '../LoggingService'
import { DEFAULT_TREE_HIDDEN_PATTERNS, DEFAULT_WATCHER_IGNORE_PATTERNS } from '../../../shared/constants'
import { ProjectPathFilter, toRootRelative } from '../../utils/projectPathFilter'
import { RateLimitedLogger } from '../../utils/RateLimitedLogger'
import { isAtomicTempName } from '../../utils/atomicWrite'
import type { DirectoryChangedPayload } from '../../../shared/ipc/directory-watch-schema'
import { KnownEntries } from './KnownEntries'
import { WatcherMetrics } from './WatcherMetrics'
import { getPlatformConfig } from './PlatformConfig'
import {
  selectDirectoryWatchBackend,
  type DirectoryWatchBackend,
  type DirectoryWatchHandle,
  type DirectoryWatchResyncReason
} from './directoryWatchBackend'
import { createChokidarWatcher, createNativeWatcher } from './directoryWatchBuilders'
import { DirectoryWatchListeners } from './DirectoryWatchListeners'
import { WatcherHealthLogger } from './WatcherHealthLogger'
import type { DirectoryWatcherServiceOptions, WatchedDirectory } from './directoryWatchTypes'

/** Most resync log lines per window; the rest are counted (#211, D3). */
const RESYNC_LOG_INTERVAL_MS = 10_000

export abstract class DirectoryWatcherCore {
  protected watchedDirectories: Map<string, WatchedDirectory> = new Map()
  protected projectPath: string | null = null
  /**
   * The non-folder entries the tree on screen shows (finding [29]): lets a
   * rename-style save of an existing file count as a content change.
   */
  protected readonly knownEntries = new KnownEntries((rel) => this.foldKey(rel))
  protected isDisposing: boolean = false // Flag to prevent operations during cleanup
  // Session token to guard against late/stale events during project switches
  protected switchVersion = 0

  // Performance metrics (VS Code pattern)
  protected readonly metrics = new WatcherMetrics()

  // Platform configuration
  protected readonly platformConfig = getPlatformConfig()

  // Which paths are not watched and whose events are dropped (#211, design D4):
  // excluded, hidden or ignored. Replaced per project by ProjectService; until
  // then the default hidden and ignore lists, with no exclude list.
  protected pathFilter: ProjectPathFilter = this.createPatternFilter([...DEFAULT_WATCHER_IGNORE_PATTERNS])

  // A burst of lost native events can ask for a resync every few seconds
  protected readonly resyncLogger = new RateLimitedLogger('native-resync', RESYNC_LOG_INTERVAL_MS)

  // The periodic health line (120s), started at the first watch
  protected readonly healthLogger = new WatcherHealthLogger(this.metrics)

  // The watch backend (#211, D6), logged once at the first watch
  protected readonly watchBackend: DirectoryWatchBackend
  private backendLogged = false

  // Removal, lost-removal and coverage listeners (#252)
  protected readonly listeners = new DirectoryWatchListeners()

  constructor(options: DirectoryWatcherServiceOptions = {}) {
    this.watchBackend = options.backend ?? selectDirectoryWatchBackend()
  }

  protected coverageChanged(): void {
    this.listeners.coverageChanged()
  }

  /** A filter with the default hidden names, these ignore patterns and no exclude list. */
  private createPatternFilter(ignorePatterns: readonly string[]): ProjectPathFilter {
    // The filter's root is never read here (see setPathFilter), so none is given
    return new ProjectPathFilter('', {
      hiddenPatterns: DEFAULT_TREE_HIDDEN_PATTERNS,
      ignorePatterns,
      caseSensitive: this.platformConfig.caseSensitive
    })
  }

  /**
   * Whether an event or watch at this absolute path is dropped (#211, D4):
   * excluded, hidden, ignored, or outside the project (fail closed). Paths are
   * made relative to the project root – the tree walk's base, so a watch on a
   * subfolder applies the same list and the project's own parent folders
   * never match – or to the watch root when no project is set. Called by
   * chokidar for every path it meets, so it stays synchronous and cheap.
   */
  protected shouldDropAbs(absPath: string, watchRoot: string): boolean {
    return this.shouldDropRel(toRootRelative(this.projectPath || watchRoot, absPath))
  }

  /**
   * Whether an event at this project-relative path is dropped (`null`:
   * outside the project, always dropped). Counts the exclude matcher's budget
   * overruns this test caused, for the health line.
   */
  private shouldDropRel(relPath: string | null): boolean {
    // atomicWriteText's temp file (a save in flight): never shown, never a reload.
    // Checked first, on the last path segment, so it holds for the chokidar and
    // the native backend alike (both reach the filter through here).
    if (relPath !== null && isAtomicTempName(relPath)) return true
    const filter = this.pathFilter
    const overrunsBefore = filter.excludeMatcher.budgetExceeded
    const dropped = filter.shouldDrop(relPath)
    this.metrics.recordMatcherBudgetExceeded(filter.excludeMatcher.budgetExceeded - overrunsBefore)
    return dropped
  }

  /**
   * The native watcher's drop test (D4, D5) on a path relative to the watch
   * root: deeper than `directoryWatchDepth` (chokidar's rule – a path of n
   * segments when n − 1 > depth), or dropped by the project path filter once
   * mapped to its project-relative form. A `null` prefix fails closed.
   */
  protected shouldDropWatchRel(watchPrefix: string | null, rel: string, depth: number | undefined): boolean {
    if (watchPrefix === null) return true
    if (depth !== undefined && rel.split('/').length - 1 > depth) return true
    return this.shouldDropRel(watchPrefix === '' ? rel : `${watchPrefix}/${rel}`)
  }

  /**
   * Safe logging that handles EPIPE errors during app shutdown
   */
  protected safeLog(message: string): void {
    if (this.isDisposing) return // Don't log during disposal
    try {
      logger.info(message)
    } catch (error) {
      // Suppress EPIPE errors during shutdown
      if (error instanceof Error && !error.message.includes('EPIPE')) {
        // Only re-throw non-EPIPE errors
        throw error
      }
    }
  }

  /** Log the backend once, at the first watch (#211, D6). */
  protected logBackendOnce(): void {
    if (this.backendLogged) return
    this.backendLogged = true
    logger.info('Directory watcher backend selected', { backend: this.watchBackend })
  }

  /** Build the watcher for `dirPath` with the backend chosen at construction (D6). */
  protected createBackendWatcher(dirPath: string, depth: number | undefined): DirectoryWatchHandle {
    if (this.watchBackend !== 'native-recursive') {
      return createChokidarWatcher(dirPath, depth, (path) => this.shouldDropAbs(path, dirPath))
    }
    // `null`: the watch root is outside the project, so every path is dropped
    const watchPrefix = toRootRelative(this.projectPath || dirPath, dirPath)
    return createNativeWatcher(dirPath, {
      filter: this.pathFilter,
      watchPrefix,
      caseSensitive: this.platformConfig.caseSensitive,
      shouldDrop: (rel: string) => this.shouldDropWatchRel(watchPrefix, rel, depth),
      onResync: (reason) => this.handleResync(dirPath, reason),
      onOverflow: () => {
        if (!this.isDisposing) this.metrics.recordNativeOverflow()
      }
    })
  }

  /** The native watcher lost events and cannot say where (#211, D3, D13). */
  protected abstract handleResync(dirPath: string, reason: DirectoryWatchResyncReason): void

  /** Key folding for the record: NFC on macOS, as `toRootRelative` spells it, and the case rule. */
  private foldKey(rel: string): string {
    const spelled = process.platform === 'darwin' ? rel.normalize('NFC') : rel
    return this.platformConfig.caseSensitive ? spelled : spelled.toLowerCase()
  }

  /**
   * Broadcast a zero-event change that asks the tree to re-read. `catchUp`
   * lets it through the renderer's internal-operation gate, because it
   * reports changes the pause dropped rather than the operation's own (#210).
   * Always `structural`: what was lost cannot be known to be content-only.
   */
  protected sendCompensatingRefresh(dirPath: string): void {
    this.notifyWebContents(dirPath, 'directory-watch:changed', {
      dirPath,
      eventCount: 0,
      originalEventCount: 0,
      coalescedCount: 0,
      summary: {},
      structural: true,
      catchUp: true
    } satisfies DirectoryChangedPayload)
  }

  /**
   * Notify all webContents watching this directory
   */
  protected notifyWebContents(
    dirPath: string,
    channel: string,
    data: Record<string, unknown>
  ): void {
    if (this.isDisposing) return // Don't notify during disposal
    const watched = this.watchedDirectories.get(dirPath)
    if (!watched) return
    // Ensure only current-session watchers can publish notifications
    if (watched.version !== this.switchVersion) {
      return
    }

    this.notifyIds(watched.webContentsIds, channel, data)
  }

  /**
   * Send to these webContents ids directly, without the map entry – a restart
   * outcome is sent after the entry is gone (#211, D16). The caller makes sure
   * the notice is not stale.
   */
  protected notifyIds(
    webContentsIds: ReadonlySet<number>,
    channel: string,
    data: Record<string, unknown>
  ): void {
    if (this.isDisposing) return // Don't notify during disposal
    const windows = BrowserWindow.getAllWindows()

    for (const webContentsId of webContentsIds) {
      const window = windows.find((w) => w.webContents.id === webContentsId)
      if (window && !window.isDestroyed()) {
        try {
          window.webContents.send(channel, data)
      } catch (error) {
        // Suppress errors during shutdown (EPIPE, destroyed webContents, etc.)
        if (error instanceof Error && !error.message.includes('destroyed')) {
          this.safeLog(`⚠️  Error sending to webContents: ${error.message}`)
        }
      }
      }
    }
  }
}
