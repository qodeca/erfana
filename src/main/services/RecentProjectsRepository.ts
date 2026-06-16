// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * RecentProjectsRepository
 *
 * REFACTORING (todo016): Extract repository pattern from SettingsService
 *
 * Abstracts persistence layer for recent projects.
 * Separates data access from business logic.
 *
 * Single Responsibility: CRUD operations for recent projects storage
 * Dependency Inversion: Depends on StoreLike abstraction, not concrete store
 */

import { RecentProject } from './SettingsService'

interface Settings {
  recentProjects?: RecentProject[]
  lastTimestamp?: number
  lastProjectPath?: string
  projectFilterMode?: string
  directoryWatchDepth?: number | null
}

type StoreLike<T> = {
  get: <K extends keyof T>(key: K) => T[K] | undefined
  set: <K extends keyof T>(key: K, value: T[K]) => void
  delete: (key: keyof T) => void
}

export class RecentProjectsRepository {
  constructor(private store: StoreLike<Settings>) {}

  /**
   * Get all recent projects
   * Returns empty array if none exist
   */
  getAll(): RecentProject[] {
    return this.store.get('recentProjects') || []
  }

  /**
   * Save recent projects list
   */
  save(projects: RecentProject[]): void {
    this.store.set('recentProjects', projects)
  }

  /**
   * Clear all recent projects
   */
  clear(): void {
    this.store.delete('recentProjects')
  }

  /**
   * Get persisted last timestamp
   */
  getLastTimestamp(): number | undefined {
    return this.store.get('lastTimestamp')
  }

  /**
   * Save last timestamp
   */
  saveLastTimestamp(timestamp: number): void {
    this.store.set('lastTimestamp', timestamp)
  }
}
