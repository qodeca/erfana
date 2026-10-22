// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * KnownEntries – which non-folder entries the project tree already shows, and
 * whether each is a file or a symlink (finding [29], PR #316 review).
 *
 * `fs.watch` reports a save that writes a temp file and renames it over the
 * target – Erfana's own `atomicWrite`, and many editors and agents – as a
 * `rename` of the target, which the native watcher's `lstat` can only call an
 * `add`. Taken at its word that is a structural change and re-reads the whole
 * tree on every such save. With this record the watcher service can tell "an
 * entry that was already there, still of the same kind" (a content change)
 * from a new entry or a file↔symlink swap (structural).
 *
 * Seeded from the last successful root tree read – the tree the renderer is
 * showing – and kept current between reads by the watcher's own events.
 * Paths are project-relative, `/`-separated and folded per the platform's
 * case rule. Past {@link MAX_KNOWN_ENTRIES} the record is left empty (inferred
 * memory cost: a few tens of MB of path strings at 200k entries), and every
 * rename-style save is structural again, as before.
 */
import type { FileNode } from '../../../shared/ipc/file-schema'

/** What a non-folder entry is, as `lstat` sees it. */
export type KnownEntryKind = 'file' | 'symlink'

/** Above this many non-folder entries nothing is recorded. */
export const MAX_KNOWN_ENTRIES = 100_000

export class KnownEntries {
  private readonly kinds = new Map<string, KnownEntryKind>()

  /**
   * @param fold - case folding for keys (identity on a case-sensitive platform)
   */
  constructor(private readonly fold: (rel: string) => string) {}

  /**
   * Record from a tree read. `toRel` maps a node's absolute path to its
   * project-relative form (`null`: outside, skipped). Returns `false`, with
   * nothing recorded, when the tree holds more than {@link MAX_KNOWN_ENTRIES}.
   */
  static fromTree(
    nodes: readonly FileNode[],
    toRel: (absPath: string) => string | null,
    fold: (rel: string) => string
  ): KnownEntries {
    const known = new KnownEntries(fold)
    const stack: FileNode[] = [...nodes]
    while (stack.length > 0) {
      const node = stack.pop() as FileNode
      if (node.type === 'directory') {
        if (node.children) stack.push(...node.children)
        continue
      }
      const rel = toRel(node.path)
      if (rel === null) continue
      if (known.kinds.size >= MAX_KNOWN_ENTRIES) {
        known.kinds.clear()
        return known
      }
      known.kinds.set(fold(rel), node.isSymlink === true ? 'symlink' : 'file')
    }
    return known
  }

  get size(): number {
    return this.kinds.size
  }

  kindOf(rel: string): KnownEntryKind | undefined {
    return this.kinds.get(this.fold(rel))
  }

  noteAdded(rel: string, kind: KnownEntryKind | undefined): void {
    // An entry of unknown kind is forgotten, so its next `add` stays structural
    if (kind === undefined) this.kinds.delete(this.fold(rel))
    else if (this.kinds.size < MAX_KNOWN_ENTRIES) this.kinds.set(this.fold(rel), kind)
  }

  noteRemoved(rel: string): void {
    this.kinds.delete(this.fold(rel))
  }

  /** A folder is gone: forget everything under it. Rare, and a tree re-read follows. */
  noteFolderRemoved(rel: string): void {
    const prefix = `${this.fold(rel)}/`
    for (const key of this.kinds.keys()) {
      if (key.startsWith(prefix)) this.kinds.delete(key)
    }
  }
}
