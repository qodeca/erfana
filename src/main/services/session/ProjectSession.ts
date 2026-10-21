// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectSession
 *
 * The main process's record of which project is open: its root, a generation
 * number and the window that opened it. `ProjectService` is the only writer
 * (through `ProjectSessionStore`); everything else reads it through the
 * read-only `ProjectSession` view.
 *
 * A snapshot is immutable and swapped whole at commit. A failed open never
 * touches it, so there is nothing to roll back.
 */

import { logger } from '../LoggingService'
import { normaliseResolved } from '../../utils/pathCompare'
import { redactedLogError } from '../../utils/redactUserInput'
import { ConfinementError, type ConfinementErrorCode } from '../../ipc/confinement/ConfinementError'

export interface ProjectSessionSnapshot {
  /** +1 on every commit, open or close */
  readonly generation: number
  /** The opened path as shown to the renderer: `path.resolve`, or the native `realpath` spelling on Windows (see `displayRootSpelling`) */
  readonly root: string
  /** `realpath(root)` at open, normalised (see `normaliseRealRoot`) */
  readonly realRoot: string
  /** Whether names differ by case on the project's volume */
  readonly caseSensitive: boolean
  /** The window that opened the project; null when opened without one */
  readonly ownerWebContentsId: number | null
}

export type ProjectSessionListener = (
  prev: ProjectSessionSnapshot | null,
  next: ProjectSessionSnapshot | null
) => void

export interface ProjectSession {
  current(): ProjectSessionSnapshot | null
  /** @throws ConfinementError with code `NO_PROJECT` when no project is open */
  require(): ProjectSessionSnapshot
  /** Called synchronously at commit; the returned function unsubscribes */
  onChange(listener: ProjectSessionListener): () => void
}

// The error lives with the path checker; re-exported so existing imports keep working
export { ConfinementError, type ConfinementErrorCode }

/**
 * Normalise `realpath` output for storage: strip a Windows extended-length
 * prefix and trailing separators past the filesystem root. Defensive: libuv
 * does not emit the prefix. Shared with the path checker.
 */
export function normaliseRealRoot(real: string): string {
  return normaliseResolved(real)
}

/**
 * The spelling of the project path that is shown and stored. On Windows it is
 * the native `realpath` result (on-disk case, no 8.3 short names; a UNC
 * admin-share path keeps its form), so a project opened as `c:\\users\\X~1`
 * and one opened as `C:\\Users\\Xavier` are the same name. Elsewhere the
 * caller's resolved spelling is kept: a symlinked root stays what the user chose.
 */
export function displayRootSpelling(
  resolved: string,
  realRoot: string,
  platform: NodeJS.Platform
): string {
  return platform === 'win32' ? realRoot : resolved
}

/** The writable side. Only `ProjectService` holds one. */
export class ProjectSessionStore implements ProjectSession {
  private snapshot: ProjectSessionSnapshot | null = null
  // Generation of the last commit, kept across a close so numbers never repeat
  private generation = 0
  private readonly listeners = new Set<ProjectSessionListener>()

  current(): ProjectSessionSnapshot | null {
    return this.snapshot
  }

  require(): ProjectSessionSnapshot {
    if (!this.snapshot) {
      throw new ConfinementError('NO_PROJECT', 'No project is open')
    }
    return this.snapshot
  }

  onChange(listener: ProjectSessionListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Swap the snapshot and tell the listeners, synchronously and in the order
   * they subscribed. A listener that throws is logged and does not stop the
   * rest: a commit is final.
   *
   * @param next - The new state without its generation, or null to close
   * @returns The generation of this commit
   */
  commit(next: Omit<ProjectSessionSnapshot, 'generation'> | null): number {
    const prev = this.snapshot
    this.generation += 1
    this.snapshot = next ? { ...next, generation: this.generation } : null
    for (const listener of [...this.listeners]) {
      try {
        listener(prev, this.snapshot)
      } catch (error) {
        logger.error('ProjectSession: change listener threw', redactedLogError(error))
      }
    }
    return this.generation
  }
}
