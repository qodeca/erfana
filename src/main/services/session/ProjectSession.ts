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

import { parse, sep } from 'path'
import { logger } from '../LoggingService'
import { redactedLogError } from '../../utils/redactUserInput'
import { ConfinementError, type ConfinementErrorCode } from '../../ipc/confinement/ConfinementError'

export interface ProjectSessionSnapshot {
  /** +1 on every commit, open or close */
  readonly generation: number
  /** `path.resolve` of the path that was opened; shown to the renderer */
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

const WIN_UNC_EXTENDED_PREFIX = '\\\\?\\UNC\\'
const WIN_EXTENDED_PREFIX = '\\\\?\\'

/**
 * Normalise `realpath` output for storage: strip a Windows extended-length
 * prefix (`\\?\C:\x` -> `C:\x`, `\\?\UNC\srv\sh` -> `\\srv\sh`) and trailing
 * separators past the filesystem root. Defensive: libuv should not emit them.
 */
export function normaliseRealRoot(real: string): string {
  let n = real
  if (n.startsWith(WIN_UNC_EXTENDED_PREFIX)) {
    n = `\\\\${n.slice(WIN_UNC_EXTENDED_PREFIX.length)}`
  } else if (n.startsWith(WIN_EXTENDED_PREFIX)) {
    n = n.slice(WIN_EXTENDED_PREFIX.length)
  }
  const root = parse(n).root
  while (n.length > root.length && (n.endsWith(sep) || n.endsWith('/'))) {
    n = n.slice(0, -1)
  }
  return n
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
