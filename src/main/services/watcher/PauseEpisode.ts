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
 * - A drop with no known path (the native Windows watcher lost events and asked
 *   for a resync, #211 D13) counts as one structural drop that no own change
 *   can explain; a completed owner read that began after it covers it.
 *
 * It also answers a second question at resume (#252): which paths did an
 * outside program remove during the pause? A tree read redraws the tree but
 * tells no open tab that its folder is gone, so those removals are handed to
 * the single-file watches whether or not a read covered them. Removals are
 * kept as their top-most removed folder, so a deleted folder costs one entry
 * however many children it had; and the operation's own removals – noted
 * after their events arrived, as they usually are – are filtered at resume.
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

/**
 * Cap on removals remembered per episode. Past it the deepest ones are folded
 * into their parent folder, which is then re-checked on disk, not reported.
 */
export const MAX_REMEMBERED_REMOVALS = 256

/**
 * The removals an outside program made during one pause (#252).
 *
 * `paths` were seen removed, each the top-most of its removed subtree.
 * `recheckUnder` are folders that removals were folded into past the cap: not
 * known to be removed themselves, so the open files under them are checked on
 * disk. `complete` is false when some removals cannot be placed at all – a
 * resync, or the internal-change cap, past which an own change can no longer
 * be told from an outside one; both lists are then empty.
 */
export interface ExternalRemovals {
  paths: string[]
  recheckUnder: string[]
  complete: boolean
}

/** A remembered removal; `exact` is false for a folder that removals were folded into. */
interface RememberedRemoval {
  path: string
  exact: boolean
}

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
  /** Top-most removals not yet known as own changes; none is under another (#252). */
  private removals: RememberedRemoval[] = []
  /** Some removal cannot be placed in {@link removals}. */
  private removalsLost = false

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
    const kind = STRUCTURAL_EVENT_KIND[type]
    if (kind === 'removed') {
      this.rememberRemoval(eventPath)
    }
    // Once the cap forced a catch-up, counting further drops changes nothing
    if (this.forceCatchUp) {
      return
    }
    if (!kind || this.isOwnChange(kind, eventPath)) {
      return
    }
    this.droppedTotal++
  }

  /**
   * Record a drop whose paths are unknown – a watcher resync during the pause
   * (#211, D13). It counts as one structural drop, never filtered as an own
   * change, since nothing says where the lost changes were.
   */
  recordUnknownDrop(): void {
    // A resync may have swallowed a removal, and nothing says where
    this.removalsLost = true
    // Once the cap forced a catch-up, counting further drops changes nothing
    if (this.forceCatchUp) {
      return
    }
    this.droppedTotal++
  }

  /**
   * The paths an outside program removed during this pause, for the open files
   * under them (#252). Asked at resume, when the operation has noted every own
   * change – an event can arrive before its operation notes it, so the filter
   * runs again here rather than only at drop time.
   */
  externalRemovals(): ExternalRemovals {
    if (this.removalsLost || this.forceCatchUp) {
      return { paths: [], recheckUnder: [], complete: false }
    }
    const outside = this.removals.filter(removal => !this.isOwnRemoval(removal.path))
    return {
      paths: outside.filter(removal => removal.exact).map(removal => removal.path),
      recheckUnder: outside.filter(removal => !removal.exact).map(removal => removal.path),
      complete: true
    }
  }

  /** Whether an own change noted so far removed this path or a folder above it. */
  isOwnRemoval(filePath: string): boolean {
    return this.isOwnChange('removed', filePath)
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
   * Keep a removed path for {@link externalRemovals}, as its top-most removed
   * folder: a path under a kept one adds nothing, and a removed folder takes
   * the place of the kept paths under it. A path already known as an own
   * change is not kept. Past the cap, the deepest entries are folded.
   */
  private rememberRemoval(eventPath: string): void {
    if (this.removalsLost || this.isOwnChange('removed', eventPath)) {
      return
    }
    const removed = path.resolve(eventPath)
    const holder = this.removals.find(kept => isAtOrUnder(removed, kept.path))
    if (holder) {
      // A folded folder that is now seen removed itself is exact again
      if (holder.path === removed) holder.exact = true
      return
    }
    this.removals = this.removals.filter(kept => !isAtOrUnder(kept.path, removed))
    this.removals.push({ path: removed, exact: true })
    this.foldRemovals()
  }

  /**
   * Past {@link MAX_REMEMBERED_REMOVALS}, fold the deepest entries into their
   * parent folder until the rest fit. An outside `rm -r` and the app's own
   * folder delete alike send a folder's children before the folder, so this
   * is what keeps both from overflowing before the folder's own event arrives.
   * Nothing above the file-system root: lost.
   */
  private foldRemovals(): void {
    while (this.removals.length > MAX_REMEMBERED_REMOVALS) {
      const deepest = Math.max(...this.removals.map(removal => depthOf(removal.path)))
      if (deepest === 0) {
        this.removals = []
        this.removalsLost = true
        return
      }
      const folded = this.removals.map(removal =>
        depthOf(removal.path) === deepest ? { path: path.dirname(removal.path), exact: false } : removal
      )
      this.removals = topMost(folded)
    }
  }

  /**
   * The exact path, or – for a subtree change – anything under it at a separator
   * boundary, so `copied-2` is not inside `copied`. Unlike `isLexicallyInside`
   * this compares spelling exactly, which is right: both sides are paths this
   * app produced itself.
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

/** `candidate` is `folder` or inside it; both already resolved. */
function isAtOrUnder(candidate: string, folder: string): boolean {
  if (candidate === folder) return true
  return candidate.startsWith(folder.endsWith(path.sep) ? folder : folder + path.sep)
}

/** Steps from a resolved path up to its file-system root. */
function depthOf(resolvedPath: string): number {
  let depth = 0
  for (let current = resolvedPath; path.dirname(current) !== current; current = path.dirname(current)) {
    depth++
  }
  return depth
}

/** Drop the removals inside another one; for a path kept twice, exact wins. */
function topMost(removals: readonly RememberedRemoval[]): RememberedRemoval[] {
  const shallowFirst = [...removals].sort((a, b) => depthOf(a.path) - depthOf(b.path))
  const kept: RememberedRemoval[] = []
  for (const removal of shallowFirst) {
    const holder = kept.find(k => isAtOrUnder(removal.path, k.path))
    if (!holder) {
      kept.push({ ...removal })
    } else if (holder.path === removal.path && removal.exact) {
      holder.exact = true
    }
  }
  return kept
}
