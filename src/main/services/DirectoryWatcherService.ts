// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import chokidar from 'chokidar'
import { BrowserWindow, WebContents, webContents } from 'electron'
import { normalize, resolve, sep } from 'path'
import { settingsService } from './SettingsService'
import { PauseController } from '../utils/PauseController'
import {
  WatcherMetrics,
  EventCoalescer,
  AtomicSaveDetector,
  ThrottledWorker,
  PauseEpisode,
  NativeRecursiveWatcher,
  selectDirectoryWatchBackend,
  getPlatformConfig,
  getPlatformDiagnostics,
  type DirectoryWatchBackend,
  type DirectoryWatchHandle,
  type DirectoryWatchResyncReason,
  type FileChangeEvent,
  type InternalChange
} from './watcher'
import {
  DEFAULT_TREE_HIDDEN_PATTERNS,
  DEFAULT_WATCHER_IGNORE_PATTERNS,
  PAUSE_CONTROLLER
} from '../../shared/constants'
import { logger } from './LoggingService'
import { isSystemDirectory } from '../utils/pathSecurity'
import { isLexicallyInside } from '../utils/projectConfinement'
import { ProjectPathFilter, toRootRelative } from '../utils/projectPathFilter'
import { AppError, ErrorCode } from '../../shared/errors'
import { RateLimitedLogger } from '../utils/RateLimitedLogger'
import { collectMemorySnapshot } from '../utils/processMemorySnapshot'

interface WatchedDirectory {
  dirPath: string
  watcher: DirectoryWatchHandle
  /** Which backend built `watcher`; a native `unlink` is already confirmed by `lstat` (#211, D2). */
  backend: DirectoryWatchBackend
  webContentsIds: Set<number>
  pauseController: PauseController
  throttledWorker: ThrottledWorker<FileChangeEvent>
  atomicSaveDetector: AtomicSaveDetector
  version: number
  /**
   * What the current pause dropped and what re-read it (#210). Exists only
   * while paused: set when `pauseWatch` takes the count to 1, cleared at full
   * resume and on the safety timeout – so its presence is the paused guard.
   */
  pauseEpisode?: PauseEpisode
}

// Git index watching migrated to GitWatcherService (Issue #74)

interface DirectoryChangeEvent {
  type: 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change'
  path: string
}

/** Construction options for {@link DirectoryWatcherService}. */
export interface DirectoryWatcherServiceOptions {
  /**
   * Which backend watches a directory (#211, design D6). Defaults to
   * `selectDirectoryWatchBackend()`: the native recursive watcher on Windows,
   * chokidar elsewhere. Read once, here.
   */
  readonly backend?: DirectoryWatchBackend
}

/** Most resync log lines per window; the rest are counted (#211, D3). */
const RESYNC_LOG_INTERVAL_MS = 10_000

function isPresent<T>(value: T | null): value is T {
  return value !== null
}

export class DirectoryWatcherService {
  private watchedDirectories: Map<string, WatchedDirectory> = new Map()
  private projectPath: string | null = null
  private isDisposing: boolean = false // Flag to prevent operations during cleanup
  // Session token to guard against late/stale events during project switches
  private switchVersion = 0

  // Performance metrics (VS Code pattern)
  private readonly metrics = new WatcherMetrics()

  // Platform configuration
  private readonly platformConfig = getPlatformConfig()

  // Auto-restart with exponential backoff
  private restartAttempts: Map<string, number> = new Map()
  private pendingRestarts: Map<string, NodeJS.Timeout> = new Map()
  private readonly MAX_RESTART_ATTEMPTS = 3
  private readonly RESTART_BASE_DELAY = 800

  // Which paths are not watched and whose events are dropped (#211, design D4):
  // excluded, hidden or ignored. Replaced per project by ProjectService; until
  // then the default hidden and ignore lists, with no exclude list.
  private pathFilter: ProjectPathFilter = this.createPatternFilter([...DEFAULT_WATCHER_IGNORE_PATTERNS])

  // Rate-limited EMFILE logger (max once per 10s to prevent fd feedback loop)
  private readonly emfileLogger = new RateLimitedLogger('emfile', 10000)

  // A burst of lost native events can ask for a resync every few seconds
  private readonly resyncLogger = new RateLimitedLogger('native-resync', RESYNC_LOG_INTERVAL_MS)

  // Health logger interval (120s)
  private healthLogInterval: NodeJS.Timeout | null = null
  // Resync count at the previous health line: only new resyncs mean stress
  private lastNativeResyncs = 0

  // The watch backend (#211, D6), logged once at the first watch
  private readonly watchBackend: DirectoryWatchBackend
  private backendLogged = false

  constructor(options: DirectoryWatcherServiceOptions = {}) {
    this.watchBackend = options.backend ?? selectDirectoryWatchBackend()
  }

  /**
   * Set the project's path filter (called by ProjectService after loading
   * settings). It applies to watches started after the call and to every
   * event queued after it; its own `root` is not read – paths are measured
   * against this service's project root (design D4).
   */
  setPathFilter(filter: ProjectPathFilter): void {
    this.pathFilter = filter
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
  private shouldDropAbs(absPath: string, watchRoot: string): boolean {
    return this.shouldDropRel(toRootRelative(this.projectPath || watchRoot, absPath))
  }

  /**
   * Whether an event at this project-relative path is dropped (`null`:
   * outside the project, always dropped). Counts the exclude matcher's budget
   * overruns this test caused, for the health line.
   */
  private shouldDropRel(relPath: string | null): boolean {
    const filter = this.pathFilter
    const overrunsBefore = filter.excludeMatcher.budgetExceeded
    const dropped = filter.shouldDrop(relPath)
    this.metrics.recordMatcherBudgetExceeded(filter.excludeMatcher.budgetExceeded - overrunsBefore)
    return dropped
  }

  setProjectPath(path: string): void {
    this.projectPath = path
    // Bump session on project changes to drop stale events
    this.switchVersion++
  }
  /**
   * Stop all directory watchers (for project switching)
   */
  async stopAll(): Promise<void> {
    // Bump the session FIRST (as cleanupForWebContentsId does): a late event, or
    // a first start still in flight that fails during the closes below, then
    // sees it is stale and cannot schedule a restart that outlives this call
    this.switchVersion++
    this.safeLog('👁️  Stopping all directory watchers...')
    this.stopHealthLogger()
    this.emfileLogger.reset()
    this.resyncLogger.reset()

    // Clear pending restarts
    for (const timeout of this.pendingRestarts.values()) {
      clearTimeout(timeout)
    }
    this.pendingRestarts.clear()
    this.restartAttempts.clear()

    for (const [, watched] of this.watchedDirectories.entries()) {
      watched.pauseController.dispose()
      watched.throttledWorker.dispose()
      watched.atomicSaveDetector.dispose()
      try {
        await watched.watcher.close()
      } catch {
        // ignore
      }
    }
    this.watchedDirectories.clear()
    this.metrics.setActiveWatchers(0)
  }

  /**
   * Safe logging that handles EPIPE errors during app shutdown
   */
  private safeLog(message: string): void {
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

  /**
   * Start watching a directory for structural changes
   *
   * Security: Uses normalized path comparison and checks for system directories
   * (Issue #74 review fix - aligned with validateProjectPath pattern)
   *
   * When the watcher cannot be built (the native backend throws at once for a
   * root it cannot watch), a restart is scheduled and the error is rethrown
   * (#211): a root that was briefly unavailable recovers, and a deleted one
   * ends in `directory-watch:project-deleted` once the attempts run out.
   */
  async watchDirectory(dirPath: string, webContents: WebContents): Promise<void> {
    // Security: Normalize paths to prevent traversal attacks (Issue #74 review fix)
    const normalizedDirPath = normalize(dirPath)
    const normalizedProjectPath = this.projectPath ? normalize(this.projectPath) : null

    // Security: Check if path is a system directory
    if (isSystemDirectory(normalizedDirPath)) {
      throw new AppError(
        'Cannot watch system or sensitive directories',
        ErrorCode.PATH_SYSTEM_DIR
      )
    }

    // Security: Prevent watching directories outside project
    // Uses normalized paths with separator check to prevent bypasses like /project/../sensitive
    if (normalizedProjectPath && !normalizedDirPath.startsWith(normalizedProjectPath + sep) && normalizedDirPath !== normalizedProjectPath) {
      throw new AppError(
        'Cannot watch directories outside the project directory',
        ErrorCode.PATH_OUTSIDE_PROJECT
      )
    }

    const webContentsId = webContents.id

    // If already watching, just add this webContents
    if (this.watchedDirectories.has(dirPath)) {
      const watched = this.watchedDirectories.get(dirPath)!
      watched.webContentsIds.add(webContentsId)
      this.safeLog(`👁️  Added webContents ${webContentsId} to directory watch: ${dirPath}`)
      return
    }

    this.safeLog(`👁️  Starting directory watch for: ${dirPath}`)
    this.logBackendOnce()
    // Taken before the await below, which a stopAll can overtake
    const session = this.switchVersion

    // Read depth setting (undefined => watch all levels)
    let depth: number | undefined
    try {
      depth = await settingsService.getDirectoryWatchDepth()
    } catch {
      depth = undefined
    }
    // A stopAll (project switch) overtook this start: its watcher would be
    // registered under the new session, for the old project
    if (session !== this.switchVersion) return

    // Built before anything else: the native backend throws at once when the
    // root cannot be watched (ENOENT, D15), and then nothing is left behind.
    // Resolves without waiting for the backend's `ready` (AC5).
    const watcher = this.createWatcherOrScheduleRestart(dirPath, depth, webContentsId, session)

    // Create throttled worker with VS Code values
    const throttledWorker = new ThrottledWorker<FileChangeEvent>(
      {
        maxWorkChunkSize: this.platformConfig.recommendedChunkSize, // 500
        throttleDelay: 200, // VS Code value
        maxBufferedWork: this.platformConfig.recommendedBufferLimit, // 30,000
        collectionDelay: 75 // VS Code: 75ms collection window
      },
      {
        onWork: (events) => this.processEvents(dirPath, events),
        onOverflow: (count) => {
          this.metrics.recordBufferOverflow(count)
          this.safeLog(`⚠️  Buffer overflow: dropped ${count} oldest events for ${dirPath}`)
        }
      }
    )

    const watched: WatchedDirectory = {
      dirPath,
      watcher,
      backend: this.watchBackend,
      webContentsIds: new Set([webContentsId]),
      pauseController: new PauseController({
        timeoutMs: PAUSE_CONTROLLER.SAFETY_TIMEOUT_MS,
        onTimeout: () => this.handlePauseTimeout(dirPath)
      }),
      throttledWorker,
      atomicSaveDetector: new AtomicSaveDetector(),
      version: this.switchVersion
    }

    this.attachWatcherListeners(dirPath, watcher)

    this.watchedDirectories.set(dirPath, watched)
    this.metrics.setActiveWatchers(this.watchedDirectories.size)

    // Start health logger on first watch
    this.startHealthLogger()
  }

  /** Log the backend once, at the first watch (#211, D6). */
  private logBackendOnce(): void {
    if (this.backendLogged) return
    this.backendLogged = true
    logger.info('Directory watcher backend selected', { backend: this.watchBackend })
  }

  /**
   * Build the watcher, scheduling a restart when a first start cannot (#211).
   * The error is rethrown either way, so the caller still hears the start failed.
   *
   * @param session - `switchVersion` when the start began
   */
  private createWatcherOrScheduleRestart(
    dirPath: string,
    depth: number | undefined,
    webContentsId: number,
    session: number
  ): DirectoryWatchHandle {
    try {
      return this.createBackendWatcher(dirPath, depth)
    } catch (error) {
      if (this.canRestartFailedStart(dirPath, session)) {
        // Error type only – the path stays out of the log line
        logger.info('Directory watch failed to start, restart scheduled', { errorType: this.errorTypeOf(error) })
        this.scheduleRestart(dirPath, new Set([webContentsId]))
      }
      throw error
    }
  }

  /**
   * Whether a failed start may schedule a restart. Not while a restart of that
   * folder is pending or running – its own failure is `restartWatcher`'s to
   * handle, under its stale-attempt guard. Not once the start's session is
   * stale or the service is disposing: `stopAll` (a project switch) and
   * `dispose` clear every restart, and one scheduled after them would outlive
   * them – that covers a restart's start overtaken by `stopAll` as well.
   */
  private canRestartFailedStart(dirPath: string, session: number): boolean {
    return (
      !this.isDisposing &&
      session === this.switchVersion &&
      !this.restartAttempts.has(dirPath) &&
      !this.pendingRestarts.has(dirPath)
    )
  }

  /** Build the watcher for `dirPath` with the backend chosen at construction (D6). */
  private createBackendWatcher(dirPath: string, depth: number | undefined): DirectoryWatchHandle {
    return this.watchBackend === 'native-recursive'
      ? this.createNativeWatcher(dirPath, depth)
      : this.createChokidarWatcher(dirPath, depth)
  }

  /**
   * chokidar 3 (macOS, Linux, and Windows under the override). The project
   * path filter decides what is not watched at all (#211, D4): excluded paths,
   * hidden names (the tree's rule, e.g. .git) and ignore patterns
   * (node_modules, build outputs…); other dotfolders such as .claude and
   * .github stay watched.
   */
  private createChokidarWatcher(dirPath: string, depth: number | undefined): DirectoryWatchHandle {
    return chokidar.watch(dirPath, {
      persistent: true,
      ignoreInitial: true, // Don't fire events for existing files
      ignored: (path: string) => this.shouldDropAbs(path, dirPath), // Function-based ignore (more reliable than regex)
      usePolling: false, // Use native fs events (faster)
      // chokidar is pinned to ^3.x: v3 uses macOS FSEvents (a single stream, ~0
      // FDs per file). v4 dropped FSEvents and watches each file via kqueue (one
      // FD per file), which exhausts the process FD table on large projects and
      // breaks spawning child processes (e.g. PDF export's hidden render window
      // crashed with "Failed to initialize sandbox" on a 20k-file folder).
      disableGlobbing: true, // Treat the path literally (matches v4); avoids glob chars in project paths
      awaitWriteFinish: false, // Lower latency for editor saves; downstream
                               // consumers tolerate one pre-flush `change` per write.
      depth, // Optional cap for performance
      followSymlinks: false // Security: don't follow symlinks
    })
  }

  /**
   * The Windows backend (#211, D1, D5): one {@link NativeRecursiveWatcher} per
   * watch root. The path filter works on project-relative paths – the tree
   * walk's base (D4) – while the watcher measures from its own root, so the
   * split paths and walk hints are mapped into the watch and the drop test
   * maps back. `directoryWatchDepth` is honoured by dropping deeper paths;
   * the handles stay recursive.
   */
  private createNativeWatcher(dirPath: string, depth: number | undefined): NativeRecursiveWatcher {
    const filter = this.pathFilter
    // `null`: the watch root is outside the project, so every path is dropped
    const watchPrefix = toRootRelative(this.projectPath || dirPath, dirPath)
    const intoWatch = (projectRel: string): string | null =>
      watchPrefix === null ? null : this.toWatchRelative(watchPrefix, projectRel)
    const pathEntries = filter.splitPaths().map(intoWatch).filter(isPresent)
    const walkHints = filter.getWalkHints().map(intoWatch).filter(isPresent)

    const watcher = new NativeRecursiveWatcher(dirPath, {
      shouldDrop: (rel: string) => this.shouldDropWatchRel(watchPrefix, rel, depth),
      splitPaths: [...pathEntries, ...walkHints],
      splitInputsCapped: filter.splitInputsCapped,
      caseSensitive: this.platformConfig.caseSensitive
    })
    this.attachNativeListeners(dirPath, watcher, walkHints.length)
    return watcher
  }

  /**
   * A project-relative path as seen from a watch whose root is `watchPrefix`
   * (project-relative; `''` is the project root), or `null` when the path is
   * not strictly inside that watch.
   */
  private toWatchRelative(watchPrefix: string, projectRel: string): string | null {
    if (watchPrefix === '') return projectRel
    const head = `${watchPrefix}/`
    if (projectRel.length <= head.length) return null
    const lead = projectRel.slice(0, head.length)
    const inside = this.platformConfig.caseSensitive
      ? lead === head
      : lead.toLowerCase() === head.toLowerCase()
    return inside ? projectRel.slice(head.length) : null
  }

  /**
   * The native watcher's drop test (D4, D5) on a path relative to the watch
   * root: deeper than `directoryWatchDepth` (chokidar's rule – a path of n
   * segments when n − 1 > depth), or dropped by the project path filter once
   * mapped to its project-relative form. A `null` prefix fails closed.
   */
  private shouldDropWatchRel(watchPrefix: string | null, rel: string, depth: number | undefined): boolean {
    if (watchPrefix === null) return true
    if (depth !== undefined && rel.split('/').length - 1 > depth) return true
    return this.shouldDropRel(watchPrefix === '' ? rel : `${watchPrefix}/${rel}`)
  }

  /** The native backend's own events: lost-event resyncs, overflow counts, the plan's size (D3). */
  private attachNativeListeners(dirPath: string, watcher: NativeRecursiveWatcher, walkHints: number): void {
    watcher.on('resync', (reason: DirectoryWatchResyncReason) => this.handleResync(dirPath, reason))
    watcher.on('overflow', () => {
      if (!this.isDisposing) this.metrics.recordNativeOverflow()
    })
    watcher.on('ready', () => {
      // Counts and durations only, never paths (AC8)
      const plan = watcher.getPlanStats()
      logger.info('Native directory watcher ready', {
        recursiveWatches: plan.recursiveWatches,
        splitFolders: plan.splitFolders,
        walkHints,
        planCapped: plan.planCapped,
        elapsedMs: plan.elapsedMs
      })
    })
  }

  /**
   * The native watcher lost events and cannot say where (#211, D3, D13).
   * Answered with one catch-up refresh; while paused, counted as one unknown
   * drop instead, so resume catches up unless a later completed read by the
   * pausing window covers it.
   */
  private handleResync(dirPath: string, reason: DirectoryWatchResyncReason): void {
    if (this.isDisposing) return
    const watched = this.watchedDirectories.get(dirPath)
    if (!watched || watched.version !== this.switchVersion) return
    this.metrics.recordNativeResync()
    const paused = watched.pauseController.isPaused()
    this.resyncLogger.log('info', 'Directory watcher resync', { reason, paused })
    if (paused) {
      watched.pauseEpisode?.recordUnknownDrop()
      return
    }
    this.sendCompensatingRefresh(dirPath)
  }

  /** Route a watcher's events into the pipeline – the same for both backends. */
  private attachWatcherListeners(dirPath: string, watcher: DirectoryWatchHandle): void {
    // Handle file/folder additions
    watcher.on('add', (path: string) => {
      this.queueEvent(dirPath, { type: 'add', path })
    })

    watcher.on('addDir', (path: string) => {
      this.queueEvent(dirPath, { type: 'addDir', path })
    })

    // Handle file/folder deletions
    watcher.on('unlink', (path: string) => {
      this.queueEvent(dirPath, { type: 'unlink', path })
    })

    watcher.on('unlinkDir', (path: string) => {
      this.queueEvent(dirPath, { type: 'unlinkDir', path })
    })

    // Handle in-place file content modifications (editor autosave via
    // fs.writeFile, terminal commands, external editors). Routes through the
    // same throttle/coalesce/broadcast pipeline as structural events so the
    // renderer's git-status refresh (useGitStatus) wakes on edits, not just
    // on create/delete/rename.
    //
    // Pre-flush note (lens-review Finding 6): with `awaitWriteFinish: false`
    // chokidar may surface a `change` event before the write has fully
    // flushed — chokidar emits a final `change` after flush so state
    // converges, but the first `git status` cycle may see partial content.
    // The 250 ms renderer debounce + git's own stat re-read absorb this;
    // documented chokidar behavior on Windows NTFS in particular.
    //
    // Filter `.git/` paths (lens-review Finding 7): GitWatcherService is the
    // canonical publisher for `.git/HEAD`, `.git/index`, `.git/refs/*` state
    // changes (and reaches the same `useGitStatus.debouncedRefresh`).
    // Suppressing here avoids duplicate refresh requests during
    // `git checkout` / `git commit` and similar internal git operations.
    watcher.on('change', (path: string) => {
      if (path.includes('/.git/') || path.includes('\\.git\\')) return
      this.queueEvent(dirPath, { type: 'change', path })
    })

    // Handle errors
    watcher.on('error', (error: unknown) => {
      if (this.isDisposing) return // Ignore errors during disposal
      const errorMessage = error instanceof Error ? error.message : String(error)

      try {
        logger.error(`Directory watcher error for ${dirPath}`, error instanceof Error ? error : undefined)
      } catch {
        // Suppress EPIPE errors
      }

      this.handleWatcherError(dirPath, errorMessage)
    })

    // Handle watcher ready
    watcher.on('ready', () => {
      this.safeLog(`✅ Directory watcher ready for: ${dirPath}`)
      this.metrics.setActiveWatchers(this.watchedDirectories.size)
    })
  }

  /**
   * Stop watching a directory for a specific webContents
   */
  async unwatchDirectory(dirPath: string, webContents: WebContents): Promise<void> {
    const watched = this.watchedDirectories.get(dirPath)
    if (!watched) {
      return
    }

    const webContentsId = webContents.id
    watched.webContentsIds.delete(webContentsId)

    this.safeLog(`👁️  Removed webContents ${webContentsId} from directory watch: ${dirPath}`)

    // If no more webContents watching this directory, stop watching entirely
    if (watched.webContentsIds.size === 0) {
      this.safeLog(`👁️  Stopping directory watch for: ${dirPath}`)
      watched.pauseController.dispose()
      watched.throttledWorker.dispose()
      watched.atomicSaveDetector.dispose()
      await watched.watcher.close()
      this.watchedDirectories.delete(dirPath)
      this.metrics.setActiveWatchers(this.watchedDirectories.size)
    }
  }

  /**
   * Stop watching all directories for a specific webContents (cleanup on window close)
   */
  async unwatchAll(webContents: WebContents): Promise<void> {
    const webContentsId = webContents.id
    const directoriesToUnwatch: string[] = []

    // Find all directories watched by this webContents
    for (const [dirPath, watched] of this.watchedDirectories.entries()) {
      if (watched.webContentsIds.has(webContentsId)) {
        directoriesToUnwatch.push(dirPath)
      }
    }

    // Unwatch each directory
    for (const dirPath of directoriesToUnwatch) {
      await this.unwatchDirectory(dirPath, webContents)
    }

    this.safeLog(`👁️  Cleaned up directory watches for webContents ${webContentsId}`)
  }

  /**
   * Cleanup directory watchers owned by a specific webContents.
   * Called when webContents is destroyed (window close or dev refresh).
   *
   * @param webContentsId - The ID of the destroyed webContents
   * @remarks
   * - Increments session version to invalidate pending events (race guard)
   * - Fire-and-forget safe - errors are logged but don't propagate
   * @see Issue #59 - App enters broken state after window close
   */
  async cleanupForWebContentsId(webContentsId: number): Promise<void> {
    // Bump session version FIRST to invalidate pending events before cleanup (issue #59)
    this.switchVersion++

    const directoriesToCleanup: string[] = []

    // Find all directories watched by this webContentsId
    for (const [dirPath, watched] of this.watchedDirectories.entries()) {
      if (watched.webContentsIds.has(webContentsId)) {
        watched.webContentsIds.delete(webContentsId)

        // If no more watchers, schedule for full cleanup
        if (watched.webContentsIds.size === 0) {
          directoriesToCleanup.push(dirPath)
        }
      }
    }

    // Cleanup directories with no remaining watchers
    for (const dirPath of directoriesToCleanup) {
      const watched = this.watchedDirectories.get(dirPath)
      if (watched) {
        watched.pauseController.dispose()
        watched.throttledWorker.dispose()
        watched.atomicSaveDetector.dispose()
        await watched.watcher.close()
        this.watchedDirectories.delete(dirPath)
      }
    }

    this.metrics.setActiveWatchers(this.watchedDirectories.size)
    this.safeLog(`👁️  Cleaned up directory watches for webContentsId ${webContentsId}`)
  }

  /**
   * Pause watching (during internal operations to prevent race conditions)
   * Uses reference counting to support nested pause/resume operations
   *
   * @param senderId - webContents id of the pausing window; only its tree reads
   *   cover the changes dropped during this pause (#210)
   */
  pauseWatch(dirPath: string, senderId?: number): void {
    const watched = this.watchedDirectories.get(dirPath)
    if (watched) {
      const count = watched.pauseController.pause()
      if (count === 1) {
        watched.pauseEpisode = new PauseEpisode(senderId)
      }
      this.safeLog(`⏸️  Paused directory watch for: ${dirPath} (count: ${count})`)
    }
  }

  /**
   * Resume watching after internal operations complete
   * Only resumes when all pause operations have completed (pauseCount reaches 0)
   *
   * At full resume, sends one catch-up refresh when a structural change from
   * outside was dropped after the pausing window's last completed tree read (#210).
   */
  resumeWatch(dirPath: string): boolean {
    const watched = this.watchedDirectories.get(dirPath)
    if (!watched) {
      this.safeLog(`⚠️  Resume called for non-existent watcher: ${dirPath}`)
      return false
    }

    const isFullyResumed = watched.pauseController.resume()

    // Only resume when all operations complete
    if (isFullyResumed) {
      this.safeLog(`▶️  Resumed directory watch for: ${dirPath}`)
      const episode = watched.pauseEpisode
      watched.pauseEpisode = undefined
      if (episode?.needsCatchUp()) {
        // Counts only – no path at info
        const reason = episode.isForcedByCap()
          ? 'forced: internal-change cap'
          : `${episode.uncoveredDrops()} external changes missed while paused`
        this.safeLog(`🔄 Catch-up refresh after pause (${reason})`)
        this.sendCompensatingRefresh(dirPath)
      }
    } else {
      this.safeLog(`⏸️  Directory watch still paused: ${dirPath} (count: ${watched.pauseController.getCount()})`)
    }
    return true
  }

  /**
   * A tree read of `dirPath` is starting (#210). When it reads the root of a
   * paused watch and comes from the window that paused it, the returned commit
   * marks every change dropped so far as shown – call it only once the read
   * succeeds. Any other read gets a no-op commit.
   *
   * Committing after the pause already ended is harmless: the episode it
   * writes to has been discarded.
   */
  beginTreeRead(dirPath: string, senderId?: number): () => void {
    const noCommit = (): void => {}
    if (!dirPath || typeof dirPath !== 'string') {
      return noCommit
    }

    const readRoot = resolve(dirPath)
    // Only the first root matching the read path is covered; a second key
    // string for the same root costs one extra read, never a missed change.
    for (const watched of this.watchedDirectories.values()) {
      const episode = watched.pauseEpisode
      if (!episode || resolve(watched.dirPath) !== readRoot) {
        continue
      }
      const snapshot = episode.beginTreeRead(senderId)
      return snapshot === null ? noCommit : () => episode.completeTreeRead(snapshot)
    }
    return noCommit
  }

  /**
   * Record changes an internal file operation just made (#210), so the paused
   * watcher does not count their own events as missed external changes. Each
   * change is recorded in every paused root that contains it; with no paused
   * root this is a no-op. Never logs the paths.
   */
  noteInternalChange(...changes: InternalChange[]): void {
    for (const watched of this.watchedDirectories.values()) {
      const episode = watched.pauseEpisode
      if (!episode) {
        continue
      }
      for (const change of changes) {
        if (isLexicallyInside(change.path, watched.dirPath)) {
          episode.noteInternalChange(change)
        }
      }
    }
  }

  /**
   * Handle auto-resume when pause safety timeout fires
   * Logs warning and triggers compensating refresh
   *
   * @see Issue #103 - PauseController can remain paused permanently
   */
  private handlePauseTimeout(dirPath: string): void {
    logger.warn(
      `Safety timeout: auto-resumed directory watch for ${dirPath} after ${PAUSE_CONTROLLER.SAFETY_TIMEOUT_MS}ms (resume was never called)`
    )

    // The timeout refresh below covers this pause; nothing carries forward (#210)
    const watched = this.watchedDirectories.get(dirPath)
    if (watched) {
      watched.pauseEpisode = undefined
    }

    // Trigger compensating refresh to recover any events missed during stuck pause
    this.sendCompensatingRefresh(dirPath)
  }

  /**
   * Broadcast a zero-event change that asks the tree to re-read. `catchUp`
   * lets it through the renderer's internal-operation gate, because it
   * reports changes the pause dropped rather than the operation's own (#210).
   */
  private sendCompensatingRefresh(dirPath: string): void {
    this.notifyWebContents(dirPath, 'directory-watch:changed', {
      dirPath,
      eventCount: 0,
      originalEventCount: 0,
      coalescedCount: 0,
      summary: {},
      catchUp: true
    })
  }

  /**
   * Queue an event for throttled processing with VS Code patterns
   */
  private queueEvent(dirPath: string, event: DirectoryChangeEvent): void {
    if (this.isDisposing) return // Ignore events during disposal
    const watched = this.watchedDirectories.get(dirPath)
    if (!watched) return
    // Drop events generated for a previous session
    if (watched.version !== this.switchVersion) {
      logger.debug('Dropping stale event from previous session', { eventType: event.type, path: event.path })
      return
    }

    // Path filter backstop (#211, D4/D13): an excluded, hidden, ignored or
    // outside path is dropped before pause accounting and before it counts as
    // received, so it is never a missed change and never reaches the renderer –
    // a burst of only such paths broadcasts nothing
    if (this.shouldDropAbs(event.path, dirPath)) {
      this.metrics.recordEventFiltered()
      return
    }

    // Ignore if paused (during our own operations). No path in the log line; the
    // episode remembers structural drops so resume can catch up on them (#210).
    if (watched.pauseController.isPaused()) {
      logger.debug('Directory change dropped while paused', { eventType: event.type })
      watched.pauseEpisode?.recordDrop(event.type, event.path)
      return
    }

    // Track metrics
    this.metrics.recordEventReceived()

    // Handle delete events with atomic save detection (VS Code 100ms pattern).
    // Not for the native backend (#211, D2): its `lstat` already confirmed the
    // removal, a rename-style save is coalesced (`unlink` + `add` → `change`),
    // and a large delete must not start one unthrottled `stat` per file.
    if (event.type === 'unlink' && watched.backend !== 'native-recursive') {
      watched.atomicSaveDetector.registerDelete(event.path, (path, wasAtomicSave) => {
        if (wasAtomicSave) {
          // File reappeared → atomic save, emit as change
          watched.throttledWorker.work({ type: 'change', path })
        } else {
          // Actual delete
          watched.throttledWorker.work({ type: 'unlink', path })
        }
      })
      return
    }

    // For non-delete events, queue directly
    watched.throttledWorker.work({ type: event.type, path: event.path })
  }

  /**
   * Process events with coalescing (VS Code pattern)
   */
  private processEvents(dirPath: string, events: FileChangeEvent[]): void {
    if (this.isDisposing) return // Ignore events during disposal
    const watched = this.watchedDirectories.get(dirPath)
    if (!watched) return
    // Guard against stale events from old sessions
    if (watched.version !== this.switchVersion) {
      return
    }

    if (events.length === 0) return

    // Apply event coalescing (VS Code pattern)
    const coalescer = new EventCoalescer()
    coalescer.processEvents(events)
    const { events: coalescedEvents, coalescedCount } = coalescer.coalesce()

    // Track metrics
    this.metrics.recordEventsCoalesced(coalescedCount)
    this.metrics.recordEventsEmitted(coalescedEvents.length)

    if (coalescedEvents.length === 0) {
      this.safeLog(`📁 All ${events.length} events coalesced away for: ${dirPath}`)
      return
    }

    // Log summary
    const summary = coalescedEvents.reduce(
      (acc, e) => {
        acc[e.type] = (acc[e.type] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    const efficiency = events.length > 0
      ? Math.round((coalescedCount / events.length) * 100)
      : 0

    this.safeLog(
      `📁 Directory changed: ${dirPath} (${coalescedEvents.length} events after coalescing ${events.length}, ${efficiency}% reduced: ${JSON.stringify(summary)})`
    )

    // Notify all watching webContents
    this.notifyWebContents(dirPath, 'directory-watch:changed', {
      dirPath,
      eventCount: coalescedEvents.length,
      originalEventCount: events.length,
      coalescedCount,
      summary
    })
  }

  /**
   * Notify all webContents watching this directory
   */
  private notifyWebContents(
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
  private notifyIds(
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

  /**
   * Get statistics about watched directories and performance metrics
   */
  getStats(): {
    totalWatched: number
    directoryDetails: Array<{ path: string; watchers: number; bufferSize: number }>
    metrics: ReturnType<WatcherMetrics['getSnapshot']>
    platform: ReturnType<typeof getPlatformDiagnostics>
  } {
    return {
      totalWatched: this.watchedDirectories.size,
      directoryDetails: Array.from(this.watchedDirectories.entries()).map(([path, watched]) => ({
        path,
        watchers: watched.webContentsIds.size,
        bufferSize: watched.throttledWorker.getBufferSize()
      })),
      metrics: this.metrics.getSnapshot(),
      platform: getPlatformDiagnostics()
    }
  }

  /**
   * Get formatted metrics string for logging
   */
  getFormattedMetrics(): string {
    return this.metrics.getFormattedStats()
  }

  /**
   * Start the periodic health logger (120s interval).
   * Logs watcher health metrics and promotes to warn on stress indicators.
   */
  private startHealthLogger(): void {
    if (this.healthLogInterval !== null) return

    this.healthLogInterval = setInterval(() => this.logHealth(), 120000)
    this.healthLogInterval.unref()
  }

  /**
   * One health line: watcher metrics plus process memory (#208).
   *
   * Logged at `info` so it reaches `main.log` at the default file level – the
   * memory trend is the only trace a heap exhaustion leaves – and at `warn`
   * when the watcher shows stress.
   */
  private logHealth(): void {
    const snapshot = this.metrics.getSnapshot()
    const resourceCount = process.getActiveResourcesInfo().length

    // The counters are cumulative: a resync is stress only on the first line after it
    const newResyncs = snapshot.nativeResyncs > this.lastNativeResyncs
    this.lastNativeResyncs = snapshot.nativeResyncs
    const isStressed =
      snapshot.bufferOverflows > 0 ||
      snapshot.peakEventsPerSecond > 100 ||
      newResyncs
    const level = isStressed ? 'warn' : 'info'

    logger[level]('DirectoryWatcher health', {
      activeWatchers: snapshot.activeWatchers,
      eventsReceived: snapshot.eventsReceived,
      eventsFiltered: snapshot.eventsFiltered,
      nativeOverflows: snapshot.nativeOverflows,
      nativeResyncs: snapshot.nativeResyncs,
      matcherBudgetExceeded: snapshot.matcherBudgetExceeded,
      bufferOverflows: snapshot.bufferOverflows,
      errorCounts: snapshot.errorCounts,
      peakEventsPerSecond: snapshot.peakEventsPerSecond,
      resourceCount,
      ...collectMemorySnapshot()
    })
  }

  /**
   * Stop the periodic health logger.
   */
  private stopHealthLogger(): void {
    if (this.healthLogInterval) {
      clearInterval(this.healthLogInterval)
      this.healthLogInterval = null
    }
  }

  /**
   * Cleanup all watchers (on app shutdown)
   */
  async dispose(): Promise<void> {
    this.isDisposing = true // Set flag FIRST to stop all event processing
    this.stopHealthLogger()
    this.emfileLogger.reset()
    this.resyncLogger.reset()
    this.safeLog('👁️  Disposing all directory watchers...')
    this.safeLog(this.metrics.getFormattedStats()) // Log final metrics

    // Clear pending restart timers
    for (const timeout of this.pendingRestarts.values()) {
      clearTimeout(timeout)
    }
    this.pendingRestarts.clear()
    this.restartAttempts.clear()

    for (const [, watched] of this.watchedDirectories.entries()) {
      watched.pauseController.dispose()
      watched.throttledWorker.dispose()
      watched.atomicSaveDetector.dispose()
      try {
        await watched.watcher.close()
      } catch {
        // Suppress errors during cleanup
      }
    }
    this.watchedDirectories.clear()
  }

  /**
   * Centralized error handling for watcher errors to keep the service recoverable
   */
  private handleWatcherError(dirPath: string, errorMessage: string): void {
    // Guard against late error events from a watcher that was already closed
    if (!this.watchedDirectories.has(dirPath)) return

    // Track error in metrics
    const errorType = this.classifyError(errorMessage)
    this.metrics.recordError(errorType)

    // Rate-limited EMFILE logging to prevent fd feedback loop
    if (errorType === 'EMFILE') {
      this.emfileLogger.log('warn', 'Directory watcher EMFILE', {
        dirPath,
        activeWatchers: this.watchedDirectories.size,
        bufferSize: this.watchedDirectories.get(dirPath)?.throttledWorker.getBufferSize() ?? 0
      })
    }

    // EMFILE-specific handling: tear down watcher immediately, then schedule restart.
    // Chokidar emits EMFILE every ~120ms which resets scheduleRestart's timer,
    // preventing the restart from ever firing. By closing the watcher first,
    // we stop the error cascade and let scheduleRestart complete uninterrupted.
    if (errorType === 'EMFILE') {
      // Skip if a restart is already pending – the watcher is already torn down
      if (this.pendingRestarts.has(dirPath)) return

      const watched = this.watchedDirectories.get(dirPath)!
      const webContentsIds = new Set(watched.webContentsIds)

      // Dispose resources (same as restartWatcher does)
      watched.pauseController.dispose()
      watched.throttledWorker.dispose()
      watched.atomicSaveDetector.dispose()

      // Close watcher – fire-and-forget to keep method synchronous.
      // Do NOT call stopAll() on failure – it would cancel the pending restart
      // scheduled below. The watcher is already removed from the map, so a
      // failed close is harmless (no more error events can reach us).
      void watched.watcher.close().catch((closeErr) => {
        logger.error(`Failed to close watcher during EMFILE recovery for ${dirPath}`, closeErr instanceof Error ? closeErr : undefined)
      })

      // Increment switchVersion to invalidate any in-flight events, then remove from map
      this.switchVersion++
      this.watchedDirectories.delete(dirPath)
      this.metrics.setActiveWatchers(this.watchedDirectories.size)

      logger.info(`EMFILE detected for ${dirPath} – watcher torn down, scheduling restart`)
      this.scheduleRestart(dirPath, webContentsIds)
      return
    }

    logger.debug('Watcher error classified', { errorMessage, errorType, isTransient: this.isTransientError(errorType) })

    // Get webContentsIds before potentially removing the watched directory
    const watched = this.watchedDirectories.get(dirPath)
    const webContentsIds = watched ? new Set(watched.webContentsIds) : new Set<number>()

    // Check if this is a transient error that we should retry
    if (this.isTransientError(errorType)) {
      const attempts = this.restartAttempts.get(dirPath) ?? 0
      if (attempts < this.MAX_RESTART_ATTEMPTS) {
        this.scheduleRestart(dirPath, webContentsIds)
        return
      }
    }

    // If project root was deleted (ENOENT) and max retries exceeded, or permanent error
    if (errorType === 'ENOENT') {
      this.notifyWebContents(dirPath, 'directory-watch:project-deleted', { dirPath })
      // Use stopAll instead of dispose to keep service reusable without setting isDisposing
      void this.stopAll()
      return
    }

    // Generic error path for permanent errors
    this.notifyWebContents(dirPath, 'directory-watch:error', {
      dirPath,
      error: errorMessage,
      errorType
    })
  }

  /**
   * Classify error message into error type (VS Code pattern)
   */
  private classifyError(errorMessage: string): string {
    const msg = errorMessage.toLowerCase()
    if (msg.includes('enoent') || msg.includes('no such file')) return 'ENOENT'
    if (msg.includes('emfile') || msg.includes('too many')) return 'EMFILE'
    if (msg.includes('enospc') || msg.includes('no space')) return 'ENOSPC'
    if (msg.includes('eperm') || msg.includes('permission')) return 'EPERM'
    if (msg.includes('eacces') || msg.includes('access denied')) return 'EACCES'
    if (msg.includes('estale') || msg.includes('stale')) return 'ESTALE'
    return 'UNKNOWN'
  }

  /**
   * Check if an error type is transient and can be recovered with a restart
   */
  private isTransientError(errorType: string): boolean {
    return ['ENOENT', 'EMFILE', 'EACCES', 'ESTALE'].includes(errorType)
  }

  /**
   * Schedule a watcher restart with exponential backoff
   */
  private scheduleRestart(dirPath: string, webContentsIds: Set<number>): void {
    const attempts = this.restartAttempts.get(dirPath) ?? 0
    const delay = this.RESTART_BASE_DELAY * Math.pow(2, attempts)

    logger.debug('Watcher restart scheduled', {
      dirPath,
      attempt: attempts + 1,
      delay,
      pendingRestartCount: this.pendingRestarts.size
    })

    // Clear any existing pending restart
    const existingTimeout = this.pendingRestarts.get(dirPath)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    const timeout = setTimeout(async () => {
      this.pendingRestarts.delete(dirPath)
      await this.restartWatcher(dirPath, webContentsIds)
    }, delay)

    this.pendingRestarts.set(dirPath, timeout)
    this.metrics.recordRestartScheduled()
  }

  /**
   * Attempt to restart a watcher after failure
   */
  private async restartWatcher(dirPath: string, webContentsIds: Set<number>): Promise<void> {
    if (this.isDisposing) return // Don't restart during disposal

    const attempts = (this.restartAttempts.get(dirPath) ?? 0) + 1
    this.restartAttempts.set(dirPath, attempts)

    logger.info(`Attempting watcher restart for ${dirPath} (attempt ${attempts}/${this.MAX_RESTART_ATTEMPTS})`)

    try {
      // Stop existing watcher if any
      const existing = this.watchedDirectories.get(dirPath)
      if (existing) {
        existing.pauseController.dispose()
        existing.throttledWorker.dispose()
        existing.atomicSaveDetector.dispose()
        await existing.watcher.close()
        this.watchedDirectories.delete(dirPath)
      }

      // Try to restart for each webContents that was watching
      for (const webContentsId of webContentsIds) {
        const webContents = this.getWebContentsById(webContentsId)
        if (webContents && !webContents.isDestroyed()) {
          await this.watchDirectory(dirPath, webContents)
        }
      }

      // Success - reset attempts and notify
      this.restartAttempts.delete(dirPath)
      logger.info(`Watcher restart successful for ${dirPath}`)
      this.metrics.recordRestartSuccess()

      // Emit recovery event
      this.notifyWebContents(dirPath, 'directory-watch:recovered', { dirPath })
      // Nothing else listens for the notice: catch up on changes made while
      // no watcher was running
      this.sendCompensatingRefresh(dirPath)

    } catch (error) {
      logger.error(`Watcher restart failed for ${dirPath}`, error instanceof Error ? error : undefined)
      this.metrics.recordRestartFailure()

      // stopAll (a project switch) or dispose cleared the attempts meanwhile:
      // this restart is stale, and a notice sent by id (D16) would reach the
      // windows of whatever project is open now
      if (this.restartAttempts.get(dirPath) !== attempts) return

      if (attempts < this.MAX_RESTART_ATTEMPTS) {
        // Schedule another attempt
        this.scheduleRestart(dirPath, webContentsIds)
      } else {
        this.reportRestartExhausted(dirPath, webContentsIds, error)
      }
    }
  }

  /**
   * Max attempts reached – tell the windows that were watching (#211, D15,
   * D16). The map entry is already gone, so the notice goes to the captured
   * ids. A root that is still missing (`ENOENT`, as the native backend throws
   * at once) means the project was deleted; anything else is a failed restart.
   */
  private reportRestartExhausted(dirPath: string, webContentsIds: ReadonlySet<number>, error: unknown): void {
    logger.warn(`Max restart attempts (${this.MAX_RESTART_ATTEMPTS}) reached for ${dirPath}`)
    this.restartAttempts.delete(dirPath)
    if (this.errorTypeOf(error) === 'ENOENT') {
      this.notifyIds(webContentsIds, 'directory-watch:project-deleted', { dirPath })
      return
    }
    this.notifyIds(webContentsIds, 'directory-watch:restart-failed', {
      dirPath,
      attempts: this.MAX_RESTART_ATTEMPTS,
      message: 'File watcher could not recover. Please reload the project.'
    })
  }

  /** The error type of a thrown error: from its `code` when it has one, else from its message. */
  private errorTypeOf(error: unknown): string {
    const code = (error as { code?: unknown } | null)?.code
    if (typeof code === 'string') return this.classifyError(code)
    return this.classifyError(error instanceof Error ? error.message : String(error))
  }

  /**
   * Get webContents by ID
   */
  private getWebContentsById(id: number): WebContents | undefined {
    return webContents.getAllWebContents().find((wc) => wc.id === id)
  }
}

// Singleton instance
export const directoryWatcherService = new DirectoryWatcherService()
