// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * KnownEntries – which non-folder entries the project tree shows, as what
 * kind and under which spelling (finding [29], PR #316 review).
 *
 * `fs.watch` reports a save that writes a temp file and renames it over the
 * target – Erfana's own `atomicWrite`, and many editors and agents – as a
 * `rename` of the target, which the native watcher's `lstat` can only call an
 * `add`. Taken at its word that is a structural change and re-reads the whole
 * tree on every such save. With this record the watcher service can tell "an
 * entry the tree already shows, same kind, same spelling" (a content change)
 * from anything else (structural).
 *
 * Every doubt resolves to structural – a full tree read is the safe default:
 *
 * - The record is seeded only by a successful read of the project root, and
 *   every path an event touched while that read ran is left out of it (the
 *   walk may have seen the entry before or after the event). A read that
 *   began before a project switch, or saw a folder removed while it ran, is
 *   not used at all.
 * - A folder the root read left lazy (finding [32]: ignored, or past the
 *   walk's cap) is filled in by the read the tree makes when it is expanded,
 *   under the same rules, and only into a record a root read seeded. A later
 *   root read keeps what the record knows below the folders it leaves lazy
 *   again, because the tree on screen still shows those children.
 * - A folder removal drops the whole record until the next root read (the
 *   structural refresh it causes rebuilds it), instead of scanning for keys.
 * - Above {@link MAX_KNOWN_ENTRIES} entries there is no record (`null`), and
 *   nothing is learnt from events either: every rename-style save is
 *   structural again, as before the record existed.
 * - A `change` only updates an entry the record already has; it never adds one.
 * - An `unlink` + `add` of one path within one batch, which the coalescer
 *   turns into a `change`, is reported as a kind swap unless both sides are
 *   known to be the same kind.
 *
 * Keys are project-relative, `/`-separated, NFC on macOS and case-folded
 * where the platform is case-insensitive; the spelling kept per entry is the
 * exact last segment, so a case-only or NFC↔NFD-only rename never passes as
 * a content change.
 */
import path from 'node:path'
import type { FileNode } from '../../../shared/ipc/file-schema'

/** What a non-folder entry is, as `lstat` sees it. */
export type KnownEntryKind = 'file' | 'symlink'

/** Above this many non-folder entries there is no record. */
export const MAX_KNOWN_ENTRIES = 100_000

interface KnownEntry {
  kind: KnownEntryKind
  /** The last path segment exactly as shown */
  name: string
}

/** A tree read in flight: of the root, or of one folder. */
interface PendingRead {
  readonly epoch: number
  /** Folded keys an event touched while the read ran */
  readonly touched: Set<string>
  /** A folder was removed while the read ran: its result is not used */
  invalid: boolean
}

/** The handle a root read gets: commit its tree, or cancel on failure. */
export interface KnownEntriesRead {
  commit(tree: readonly FileNode[]): void
  cancel(): void
}

/** What an event means against the record. */
export interface JudgedEvent {
  /** The event's type after the record's view: `add` may become `change` and back */
  readonly type: 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change'
  /** An `unlink` + `add` of one path whose kinds differ, or cannot be shown equal */
  readonly kindSwap: boolean
  /** For an `unlink`: the kind the record had for the entry, if any */
  readonly removedKind?: KnownEntryKind
}

/** Count non-folder nodes, stopping as soon as `limit` is passed. */
function countEntries(nodes: readonly FileNode[], limit: number): number {
  let count = 0
  const stack: FileNode[] = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop() as FileNode
    if (node.type === 'directory') {
      if (node.children) stack.push(...node.children)
    } else if (++count > limit) {
      return count
    }
  }
  return count
}

/** Whether `key` lies below one of the folder keys in `folders`. */
function isBelowAny(key: string, folders: ReadonlySet<string>): boolean {
  for (let slash = key.indexOf('/'); slash !== -1; slash = key.indexOf('/', slash + 1)) {
    if (folders.has(key.slice(0, slash))) return true
  }
  return false
}

export class KnownEntries {
  private record: Map<string, KnownEntry> | null = null
  private epoch = 0
  private readonly reads = new Set<PendingRead>()
  /** Kinds removed by `unlink` in the current batch, by folded key; `null`: not in the record */
  private readonly removedInBatch = new Map<string, KnownEntryKind | null>()

  /**
   * @param fold - key folding: NFC on macOS, lower case where case-insensitive
   */
  constructor(private readonly fold: (rel: string) => string) {}

  /** The number of recorded entries, or `null` when there is no record. */
  get size(): number | null {
    return this.record?.size ?? null
  }

  /** A new project: forget the record and ignore reads that began before. */
  reset(): void {
    this.record = null
    this.epoch++
    this.reads.clear()
    this.removedInBatch.clear()
  }

  /** A read of the project root begins. */
  beginRootRead(): KnownEntriesRead {
    const read: PendingRead = { epoch: this.epoch, touched: new Set(), invalid: false }
    this.reads.add(read)
    return {
      commit: (tree) => {
        if (!this.reads.delete(read)) return
        if (read.epoch !== this.epoch || read.invalid) return
        this.record = this.build(tree, read.touched, this.record)
      },
      cancel: () => {
        this.reads.delete(read)
      }
    }
  }

  /**
   * A read of one folder below the root begins – the tree expanding a lazy
   * folder. Its tree replaces what the record knows below that folder, except
   * below the sub-folders it leaves lazy. With no record (no root read yet, a
   * folder removed, past the cap) it adds nothing.
   *
   * @param rel - the folder's project-relative path, `/`-separated
   */
  beginFolderRead(rel: string): KnownEntriesRead {
    const read: PendingRead = { epoch: this.epoch, touched: new Set(), invalid: false }
    this.reads.add(read)
    return {
      commit: (tree) => {
        if (!this.reads.delete(read)) return
        if (read.epoch !== this.epoch || read.invalid || this.record === null) return
        this.mergeFolder(rel, tree, read.touched)
      },
      cancel: () => {
        this.reads.delete(read)
      }
    }
  }

  /**
   * Judge one watcher event against the record, then let the record follow it.
   *
   * @param rel - project-relative path of the event
   * @param kind - the entry's kind per `lstat`, when the backend said
   */
  judge(rel: string, type: JudgedEvent['type'], kind: KnownEntryKind | undefined): JudgedEvent {
    const key = this.fold(rel)
    for (const read of this.reads) {
      read.touched.add(key)
      if (type === 'unlinkDir') read.invalid = true
    }
    if (type === 'unlinkDir') {
      this.record = null
      return { type, kindSwap: false }
    }
    const record = this.record
    const before = record?.get(key)
    const name = path.basename(rel)

    if (type === 'unlink') {
      record?.delete(key)
      this.removedInBatch.set(key, before?.kind ?? null)
      return { type, kindSwap: false, removedKind: before?.kind }
    }
    if (type === 'add') {
      let kindSwap = false
      if (this.removedInBatch.has(key)) {
        const removed = this.removedInBatch.get(key)
        this.removedInBatch.delete(key)
        kindSwap = removed === null || removed === undefined || kind === undefined || removed !== kind
      }
      const sameEntry = before !== undefined && kind !== undefined && before.kind === kind && before.name === name
      this.learn(key, kind, name)
      return { type: sameEntry ? 'change' : 'add', kindSwap }
    }
    if (type === 'change' && before !== undefined && kind !== undefined && before.kind !== kind) {
      // A file turned into a symlink in place, or back: structural
      before.kind = kind
      return { type: 'add', kindSwap: false }
    }
    return { type, kindSwap: false }
  }

  /**
   * chokidar's `unlink` turned out to be an atomic save (the entry reappeared,
   * `AtomicSaveDetector`). Structural unless the entry was known and is back
   * as the same kind.
   */
  reappeared(rel: string, removedKind: KnownEntryKind | undefined, kind: KnownEntryKind | undefined): boolean {
    const same = removedKind !== undefined && kind !== undefined && removedKind === kind
    if (same) this.learn(this.fold(rel), kind, path.basename(rel))
    return !same
  }

  /** A batch went out: `unlink` + `add` pairs are judged within one batch only. */
  endBatch(): void {
    this.removedInBatch.clear()
  }

  private learn(key: string, kind: KnownEntryKind | undefined, name: string): void {
    const record = this.record
    if (!record) return
    if (kind === undefined) {
      // An entry of unknown kind is forgotten, so its next `add` stays structural
      record.delete(key)
      return
    }
    record.set(key, { kind, name })
    // Past the cap there is no record at all, never a partial one
    if (record.size > MAX_KNOWN_ENTRIES) this.record = null
  }

  private build(
    tree: readonly FileNode[],
    touched: ReadonlySet<string>,
    previous: ReadonlyMap<string, KnownEntry> | null
  ): Map<string, KnownEntry> | null {
    if (countEntries(tree, MAX_KNOWN_ENTRIES) > MAX_KNOWN_ENTRIES) return null
    const { entries: record, lazy } = this.collect(tree, '')
    // What an expand read taught the record below a folder that is lazy again
    if (previous !== null && lazy.size > 0) {
      for (const [key, entry] of previous) {
        if (!record.has(key) && isBelowAny(key, lazy)) record.set(key, entry)
      }
    }
    for (const key of touched) record.delete(key)
    return record.size > MAX_KNOWN_ENTRIES ? null : record
  }

  /** Replace what the record knows below `rel` with an expand read's tree. */
  private mergeFolder(rel: string, tree: readonly FileNode[], touched: ReadonlySet<string>): void {
    const record = this.record
    if (record === null) return
    const { entries, lazy } = this.collect(tree, rel)
    const prefix = `${this.fold(rel)}/`
    for (const key of [...record.keys()]) {
      // Gone from the folder since: forgotten, so its re-creation stays structural
      if (key.startsWith(prefix) && !entries.has(key) && !isBelowAny(key, lazy)) record.delete(key)
    }
    for (const [key, entry] of entries) if (!touched.has(key)) record.set(key, entry)
    for (const key of touched) record.delete(key)
    if (record.size > MAX_KNOWN_ENTRIES) this.record = null
  }

  /** The non-folder entries of a tree below `base` (`''`: the root), and its lazy folders, by folded key. */
  private collect(tree: readonly FileNode[], base: string): { entries: Map<string, KnownEntry>; lazy: Set<string> } {
    const entries = new Map<string, KnownEntry>()
    const lazy = new Set<string>()
    const join = (parent: string, name: string): string => (parent === '' ? name : `${parent}/${name}`)
    // Keys built while walking (parent + '/' + name): no path maths per node
    const stack: Array<{ node: FileNode; rel: string }> = tree.map((node) => ({ node, rel: join(base, node.name) }))
    while (stack.length > 0) {
      const { node, rel } = stack.pop() as { node: FileNode; rel: string }
      if (node.type === 'directory') {
        if (node.lazy !== undefined) lazy.add(this.fold(rel))
        for (const child of node.children ?? []) stack.push({ node: child, rel: `${rel}/${child.name}` })
        continue
      }
      entries.set(this.fold(rel), { kind: node.isSymlink === true ? 'symlink' : 'file', name: node.name })
    }
    return { entries, lazy }
  }
}
