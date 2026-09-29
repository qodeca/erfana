// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PauseEpisode - what one directory-watch pause dropped, and what re-read it (#210)
 *
 * While the project tree runs an internal file operation, the directory watcher
 * is paused and every chokidar event is dropped. The operation ends with a tree
 * re-read, which shows any change made before that read began – but a change an
 * outside program made after the read began and before resume was never shown.
 *
 * One episode lives from the first pause to the full resume and answers a single
 * question at resume: did a structural change from outside land after the last
 * completed tree read by the pausing window? Only then is a catch-up refresh due.
 *
 * - Drops are counted with a monotonic counter. A tree read snapshots the
 *   counter when it starts and, only once it succeeds, marks everything up to
 *   the snapshot as covered. A failed read covers nothing.
 * - The operation's own changes (reported by the file handlers) are filtered
 *   out, so an operation does not earn a second full read for its own events.
 *   A kind only filters its own kind: a deletion inside a just-created copy
 *   still counts.
 * - `change` events never count: content edits do not alter the tree, and the
 *   operations refresh git status separately.
 *
 * Pure: no Electron, no filesystem access.
 */

import path from 'path'
import type { FileChangeType } from './EventCoalescer'

/** Direction of a change the app made itself. */
export type InternalChangeKind = 'added' | 'removed'

/**
 * A change an internal file operation made.
 *
 * `subtree` widens the match from the exact path to everything at or under it
 * (a moved, copied, renamed or deleted folder carries its children with it).
 */
export interface InternalChange {
  path: string
  kind: InternalChangeKind
  subtree: boolean
}

/**
 * Cap on recorded internal changes per episode. Past it the filter is no longer
 * trusted to stay cheap, so the episode simply asks for a catch-up at resume.
 */
export const MAX_INTERNAL_CHANGES = 256

/** Watcher event types by the change kind that explains them; `null` for content-only. */
const STRUCTURAL_EVENT_KIND: Readonly<Record<FileChangeType, InternalChangeKind | null>> = {
  add: 'added',
  addDir: 'added',
  unlink: 'removed',
  unlinkDir: 'removed',
  change: null
}

/**
 * An own change with its path resolved once, when recorded, rather than on
 * every dropped event it is compared against.
 */
interface RecordedChange {
  kind: InternalChangeKind
  resolvedPath: string
  /** `resolvedPath` plus a separator for a subtree change, else `null`. */
  subtreePrefix: string | null
}

export class PauseEpisode {
  /** Structural drops not explained by an own change. Only ever grows. */
  private droppedTotal = 0
  /** Drops seen before the start of the latest completed owner tree read. */
  private coveredUpTo = 0
  private readonly changes: RecordedChange[] = []
  private forceCatchUp = false

  /**
   * @param ownerSenderId - webContents id of the window that paused; only its
   *   tree reads count as covering the drops
   */
  constructor(readonly ownerSenderId: number | undefined) {}

  /**
   * Record one event the paused watcher dropped. Content changes and the
   * operation's own changes are ignored.
   */
  recordDrop(type: FileChangeType, eventPath: string): void {
    // Once the cap forced a catch-up, counting further drops changes nothing
    if (this.forceCatchUp) {
      return
    }
    const kind = STRUCTURAL_EVENT_KIND[type]
    if (!kind || this.isOwnChange(kind, eventPath)) {
      return
    }
    this.droppedTotal++
  }

  /**
   * Remember a change the app made itself, so its watcher event is not counted
   * as a missed external change. Past {@link MAX_INTERNAL_CHANGES} the change is
   * not stored and the episode forces a catch-up instead.
   */
  noteInternalChange(change: InternalChange): void {
    if (this.changes.length >= MAX_INTERNAL_CHANGES) {
      this.forceCatchUp = true
      return
    }
    const resolvedPath = path.resolve(change.path)
    this.changes.push({
      kind: change.kind,
      resolvedPath,
      subtreePrefix: change.subtree ? resolvedPath + path.sep : null
    })
  }

  /**
   * A tree read is starting. Returns the drop count it can cover, or `null`
   * when the reader is not the window that paused.
   */
  beginTreeRead(senderId: number | undefined): number | null {
    if (senderId !== this.ownerSenderId) {
      return null
    }
    return this.droppedTotal
  }

  /** A tree read begun with {@link beginTreeRead} succeeded. */
  completeTreeRead(snapshot: number): void {
    this.coveredUpTo = Math.max(this.coveredUpTo, snapshot)
  }

  /** Whether a catch-up refresh is due when the pause ends. */
  needsCatchUp(): boolean {
    return this.forceCatchUp || this.droppedTotal > this.coveredUpTo
  }

  /** Whether the internal-change cap, not a counted drop, forced the catch-up. */
  isForcedByCap(): boolean {
    return this.forceCatchUp
  }

  /** Drops no completed read covers – for the log line only. */
  uncoveredDrops(): number {
    return this.droppedTotal - this.coveredUpTo
  }

  /**
   * Same lexical rule as `isLexicallyInside` (projectConfinement): the exact
   * path, or – for a subtree change – anything under it at a separator
   * boundary, so `copied-2` is not inside `copied`.
   */
  private isOwnChange(kind: InternalChangeKind, eventPath: string): boolean {
    const resolvedEvent = path.resolve(eventPath)
    return this.changes.some(
      (change) =>
        change.kind === kind &&
        (resolvedEvent === change.resolvedPath ||
          (change.subtreePrefix !== null && resolvedEvent.startsWith(change.subtreePrefix)))
    )
  }
}
