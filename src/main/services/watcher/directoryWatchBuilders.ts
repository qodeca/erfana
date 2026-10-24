// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Builds the watcher one `DirectoryWatcherService` watch root runs on – the
 * chokidar backend or the native recursive one (#211, D6) – split out of the
 * service (finding [65]). The service decides which paths are dropped; these
 * builders only wire that decision into each backend.
 */
import chokidar from 'chokidar'
import { logger } from '../LoggingService'
import type { ProjectPathFilter } from '../../utils/projectPathFilter'
import { NativeRecursiveWatcher } from './NativeRecursiveWatcher'
import type { DirectoryWatchHandle, DirectoryWatchResyncReason } from './directoryWatchBackend'
import { isPresent } from './directoryWatchTypes'

/**
 * chokidar (Linux, and every platform under the override). The project
 * path filter decides what is not watched at all (#211, D4): excluded paths,
 * hidden names (the tree's rule, e.g. .git) and ignore patterns
 * (node_modules, build outputs…); other dotfolders such as .claude and
 * .github stay watched.
 *
 * @param shouldDropAbs - the service's drop test for an absolute path under `dirPath`
 */
export function createChokidarWatcher(
  dirPath: string,
  depth: number | undefined,
  shouldDropAbs: (absPath: string) => boolean
): DirectoryWatchHandle {
  return chokidar.watch(dirPath, {
    persistent: true,
    ignoreInitial: true, // Don't fire events for existing files
    ignored: (path: string) => shouldDropAbs(path), // Function-based ignore (more reliable than regex)
    usePolling: false, // Use native fs events (faster)
    // chokidar 4+ dropped macOS FSEvents and watches each file through kqueue
    // (one FD per file), which exhausts the process FD table on large
    // projects and breaks spawning child processes (PDF export's hidden render
    // window crashed with "Failed to initialize sandbox" on a 20k-file
    // folder). So macOS never gets here by default: `directoryWatchBackend`
    // picks the native recursive watcher (FSEvents) there. Paths are literal.
    awaitWriteFinish: false, // Lower latency for editor saves; downstream
                             // consumers tolerate one pre-flush `change` per write.
    depth, // Optional cap for performance
    followSymlinks: false // Security: don't follow symlinks
  })
}

/** What the native builder needs from the service (D4, D5). */
export interface NativeWatcherContext {
  /** The project path filter, as set when the watch starts. */
  readonly filter: ProjectPathFilter
  /** The watch root, project-relative (`''`: the project root; `null`: outside, every path dropped). */
  readonly watchPrefix: string | null
  readonly caseSensitive: boolean
  /** The drop test on a path relative to the watch root. */
  readonly shouldDrop: (rel: string) => boolean
  /** The watcher lost events and cannot say where (D3, D13). */
  readonly onResync: (reason: DirectoryWatchResyncReason) => void
  /** The watcher overflowed (counted, D3). */
  readonly onOverflow: () => void
}

/**
 * The Windows backend (#211, D1, D5): one {@link NativeRecursiveWatcher} per
 * watch root. The path filter works on project-relative paths – the tree
 * walk's base (D4) – while the watcher measures from its own root, so the
 * split paths and walk hints are mapped into the watch and the drop test
 * maps back. `directoryWatchDepth` is honoured by dropping deeper paths;
 * the handles stay recursive.
 */
export function createNativeWatcher(dirPath: string, context: NativeWatcherContext): NativeRecursiveWatcher {
  const { filter, watchPrefix, caseSensitive } = context
  const intoWatch = (projectRel: string): string | null =>
    watchPrefix === null ? null : toWatchRelative(watchPrefix, projectRel, caseSensitive)
  const pathEntries = filter.splitPaths().map(intoWatch).filter(isPresent)
  const walkHints = filter.getWalkHints().map(intoWatch).filter(isPresent)

  const watcher = new NativeRecursiveWatcher(dirPath, {
    shouldDrop: context.shouldDrop,
    splitPaths: [...pathEntries, ...walkHints],
    splitInputsCapped: filter.splitInputsCapped,
    caseSensitive
  })
  attachNativeListeners(watcher, walkHints.length, context)
  return watcher
}

/**
 * A project-relative path as seen from a watch whose root is `watchPrefix`
 * (project-relative; `''` is the project root), or `null` when the path is
 * not strictly inside that watch.
 */
export function toWatchRelative(watchPrefix: string, projectRel: string, caseSensitive: boolean): string | null {
  if (watchPrefix === '') return projectRel
  const head = `${watchPrefix}/`
  if (projectRel.length <= head.length) return null
  const lead = projectRel.slice(0, head.length)
  const inside = caseSensitive
    ? lead === head
    : lead.toLowerCase() === head.toLowerCase()
  return inside ? projectRel.slice(head.length) : null
}

/** The native backend's own events: lost-event resyncs, overflow counts, the plan's size (D3). */
function attachNativeListeners(
  watcher: NativeRecursiveWatcher,
  walkHints: number,
  context: NativeWatcherContext
): void {
  watcher.on('resync', (reason: DirectoryWatchResyncReason) => context.onResync(reason))
  watcher.on('overflow', () => context.onOverflow())
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
