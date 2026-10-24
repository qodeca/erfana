// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The listeners `DirectoryWatcherService` tells about removals and coverage
 * (#252), split out of the service (finding [65]). A listener that throws is
 * logged and skipped; the others still hear.
 */
import { logger } from '../LoggingService'
import { redactedLogError } from '../../utils/redactUserInput'
import type { FileChangeEvent } from './EventCoalescer'
import type { PauseEpisode } from './PauseEpisode'
import type { PathsRemovedListener, RemovalsLostListener } from './directoryWatchTypes'

export class DirectoryWatchListeners {
  // Told about every confirmed removal in a delivered batch, so the single-file
  // watches can notice a file whose parent folder was renamed or deleted
  private readonly removalListeners = new Set<PathsRemovedListener>()
  private readonly removalsLostListeners = new Set<RemovalsLostListener>()
  // Told when reportsRemovalsAbove may answer differently (#252)
  private readonly coverageListeners = new Set<() => void>()

  /** @returns a function that removes the listener */
  onPathsRemoved(listener: PathsRemovedListener): () => void {
    this.removalListeners.add(listener)
    return () => {
      this.removalListeners.delete(listener)
    }
  }

  /** @returns a function that removes the listener */
  onRemovalsLost(listener: RemovalsLostListener): () => void {
    this.removalsLostListeners.add(listener)
    return () => {
      this.removalsLostListeners.delete(listener)
    }
  }

  /** @returns a function that removes the listener */
  onCoverageChanged(listener: () => void): () => void {
    this.coverageListeners.add(listener)
    return () => {
      this.coverageListeners.delete(listener)
    }
  }

  coverageChanged(): void {
    this.callEachListener(this.coverageListeners, (listener) => listener())
  }

  /** Hand a batch's removed paths to every listener. */
  reportRemovals(events: readonly FileChangeEvent[]): void {
    this.reportRemovedPaths(
      events.filter((e) => e.type === 'unlink' || e.type === 'unlinkDir').map((e) => e.path)
    )
  }

  /** Hand removed paths to every listener; one that throws is logged and skipped. */
  reportRemovedPaths(removed: readonly string[]): void {
    if (removed.length === 0) return
    this.callEachListener(this.removalListeners, (listener) => listener(removed))
  }

  /**
   * At the end of a pause, hand on what outside programs removed during it
   * (#252): by path, and as lost under each folder the episode folded
   * removals into – or under the whole watch when it could not keep them.
   */
  reportPausedRemovals(dirPath: string, episode: PauseEpisode | undefined): void {
    if (!episode) return
    const removals = episode.externalRemovals()
    const lostUnder = removals.complete ? removals.recheckUnder : [dirPath]
    const isOwnRemoval = (filePath: string): boolean => episode.isOwnRemoval(filePath)
    for (const root of lostUnder) {
      this.callEachListener(this.removalsLostListeners, (listener) => listener(root, isOwnRemoval))
    }
    this.reportRemovedPaths(removals.paths)
  }

  private callEachListener<T>(listeners: ReadonlySet<T>, call: (listener: T) => void): void {
    for (const listener of listeners) {
      try {
        call(listener)
      } catch (error) {
        logger.error('Directory removal listener failed', redactedLogError(error))
      }
    }
  }
}
