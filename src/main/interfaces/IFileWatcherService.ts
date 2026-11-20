// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { WatchEndReason } from '../../shared/freshness/freshnessTypes'
import type { ProjectSession } from '../services/session/ProjectSession'

/**
 * Interface for file watcher service: the slice `ProjectService` drives across
 * a project switch (#478, plan decision 18).
 */
export interface IFileWatcherService {
  /** Read the open project from this session (the read-only view; decision 13). */
  bindSession?(session: Pick<ProjectSession, 'current'>): void

  /** Just before the commit: close every native watcher, keep the records. */
  suspendAll(): Promise<void>

  /** A step after the suspend failed: re-arm every suspended watch. */
  resumeSuspended(): Promise<void>

  /** The commit made `newGeneration` current: end everything recorded before it. */
  endSuspended(newGeneration: number, reason?: WatchEndReason): Promise<void>
}
