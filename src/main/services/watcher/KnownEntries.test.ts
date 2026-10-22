// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { KnownEntries, MAX_KNOWN_ENTRIES } from './KnownEntries'
import type { FileNode } from '../../../shared/ipc/file-schema'

const same = (rel: string): string => rel
const lower = (rel: string): string => rel.normalize('NFC').toLowerCase()

const tree: FileNode[] = [
  { name: 'a.md', path: '/p/a.md', type: 'file' },
  { name: 'l.md', path: '/p/l.md', type: 'file', isSymlink: true },
  {
    name: 'Sub',
    path: '/p/Sub',
    type: 'directory',
    children: [{ name: 'B.md', path: '/p/Sub/B.md', type: 'file' }]
  }
]

function seeded(fold = same): KnownEntries {
  const known = new KnownEntries(fold)
  known.beginRootRead().commit(tree)
  return known
}

describe('KnownEntries', () => {
  it('records files and symlinks, keyed while walking; an add of a shown entry is a change', () => {
    const known = seeded()

    expect(known.size).toBe(3)
    expect(known.judge('a.md', 'add', 'file').type).toBe('change')
    expect(known.judge('Sub/B.md', 'add', 'file').type).toBe('change')
    expect(known.judge('l.md', 'add', 'symlink').type).toBe('change')
  })

  it('keeps a new entry, an unknown kind and a kind swap structural', () => {
    const known = seeded()

    expect(known.judge('new.md', 'add', 'file').type).toBe('add')
    expect(known.judge('Sub/B.md', 'add', undefined).type).toBe('add')
    expect(known.judge('a.md', 'add', 'symlink').type).toBe('add')
    expect(known.judge('l.md', 'change', 'file').type).toBe('add')
  })

  it('keeps a case-only or NFC↔NFD-only rename structural, though the folded key matches', () => {
    const known = new KnownEntries(lower)
    known.beginRootRead().commit([
      { name: 'Read.md', path: '/p/Read.md', type: 'file' },
      { name: 'café.md', path: '/p/café.md', type: 'file' }
    ])

    // The exact spelling counts as the same entry
    expect(known.judge('café.md', 'add', 'file').type).toBe('change')
    expect(known.judge('read.md', 'add', 'file').type).toBe('add')
    expect(known.judge('café.md', 'add', 'file').type).toBe('add')
    // The record now follows the new spelling, as the re-read tree will
    expect(known.judge('café.md', 'add', 'file').type).toBe('change')
  })

  it('updates an existing entry on change, and never inserts one', () => {
    const known = seeded()

    known.judge('fresh.md', 'change', 'file')
    expect(known.size).toBe(3)
    expect(known.judge('fresh.md', 'add', 'file').type).toBe('add')
  })

  it('drops the whole record on a folder removal, until the next root read', () => {
    const known = seeded()

    known.judge('Sub', 'unlinkDir', undefined)
    expect(known.size).toBeNull()
    expect(known.judge('a.md', 'add', 'file').type).toBe('add')

    known.beginRootRead().commit(tree)
    expect(known.judge('a.md', 'add', 'file').type).toBe('change')
  })

  it('leaves out every path an event touched while a read ran (read/event race)', () => {
    const known = seeded()
    const read = known.beginRootRead()

    // The walk saw a.md; then a.md is deleted, then the read lands with it
    known.judge('a.md', 'unlink', undefined)
    known.endBatch()
    read.commit(tree)

    // Re-created by a rename: a new entry to the tree, so structural
    expect(known.judge('a.md', 'add', 'file').type).toBe('add')
    // Untouched entries are known again
    expect(known.judge('Sub/B.md', 'add', 'file').type).toBe('change')
  })

  it('ignores a read that saw a folder removed, or began before a reset', () => {
    const known = seeded()
    const beforeRemoval = known.beginRootRead()
    known.judge('Sub', 'unlinkDir', undefined)
    beforeRemoval.commit(tree)
    expect(known.size).toBeNull()

    const beforeReset = known.beginRootRead()
    known.reset()
    beforeReset.commit(tree)
    expect(known.size).toBeNull()
  })

  it('reports an unlink + add of one path in one batch as a kind swap unless both kinds are known equal', () => {
    const known = seeded()

    known.judge('a.md', 'unlink', undefined)
    expect(known.judge('a.md', 'add', 'symlink').kindSwap).toBe(true)
    known.endBatch()

    known.judge('Sub/B.md', 'unlink', undefined)
    expect(known.judge('Sub/B.md', 'add', 'file').kindSwap).toBe(false)
    known.endBatch()

    // Not in the record: cannot be shown equal
    known.judge('other.md', 'unlink', undefined)
    expect(known.judge('other.md', 'add', 'file').kindSwap).toBe(true)
  })

  it('judges a chokidar reappearance: structural unless back as the same known kind', () => {
    const known = seeded()

    expect(known.reappeared('a.md', 'file', 'file')).toBe(false)
    expect(known.reappeared('a.md', 'file', 'symlink')).toBe(true)
    expect(known.reappeared('x.md', undefined, 'file')).toBe(true)
    expect(known.reappeared('a.md', 'file', undefined)).toBe(true)
  })

  it('keeps no record at all above the cap, and learns nothing from events', () => {
    const big: FileNode[] = Array.from({ length: MAX_KNOWN_ENTRIES + 1 }, (_, i) => ({
      name: `f${i}`,
      path: `/p/f${i}`,
      type: 'file' as const
    }))
    const known = new KnownEntries(same)
    known.beginRootRead().commit(big)

    expect(known.size).toBeNull()
    known.judge('n.md', 'add', 'file')
    expect(known.size).toBeNull()
    expect(known.judge('n.md', 'add', 'file').type).toBe('add')
  })

  describe('lazy folders read on expand (finding [32], PR #320 review item 1)', () => {
    /** A root tree whose `Capped` folder the walk left unread */
    const cappedTree: FileNode[] = [
      { name: 'a.md', path: '/p/a.md', type: 'file' },
      { name: 'Capped', path: '/p/Capped', type: 'directory', children: [], lazy: 'capped' }
    ]
    /** What a shallow read of `Capped` lists */
    const cappedLevel: FileNode[] = [
      { name: 'c.md', path: '/p/Capped/c.md', type: 'file' },
      { name: 'deeper', path: '/p/Capped/deeper', type: 'directory', children: [], lazy: 'capped' }
    ]

    function withCapped(): KnownEntries {
      const known = new KnownEntries(same)
      known.beginRootRead().commit(cappedTree)
      return known
    }

    it('adds a folder read to the record, so a rename-style save there is a change', () => {
      // Without the expand read the save is structural (the judge also learns, so a fresh record)
      expect(withCapped().judge('Capped/c.md', 'add', 'file').type).toBe('add')
      const known = withCapped()

      known.beginFolderRead('Capped').commit(cappedLevel)

      expect(known.judge('Capped/c.md', 'add', 'file').type).toBe('change')
    })

    it('adds nothing without a record, and nothing a running event touched', () => {
      const none = new KnownEntries(same)
      none.beginFolderRead('Capped').commit(cappedLevel)
      expect(none.size).toBeNull()

      const known = withCapped()
      const read = known.beginFolderRead('Capped')
      known.judge('Capped/c.md', 'change', 'file')
      read.commit(cappedLevel)
      expect(known.judge('Capped/c.md', 'add', 'file').type).toBe('add')
    })

    it('ignores a folder read across a reset or a folder removal', () => {
      const known = withCapped()
      const stale = known.beginFolderRead('Capped')
      known.reset()
      known.beginRootRead().commit(cappedTree)
      stale.commit(cappedLevel)
      expect(known.judge('Capped/c.md', 'add', 'file').type).toBe('add')

      const removed = withCapped()
      const read = removed.beginFolderRead('Capped')
      removed.judge('Capped/deeper', 'unlinkDir', undefined)
      removed.beginRootRead().commit(cappedTree)
      read.commit(cappedLevel)
      expect(removed.judge('Capped/c.md', 'add', 'file').type).toBe('add')
    })

    it('keeps what an expand read taught across a root read that leaves the folder lazy again', () => {
      const known = withCapped()
      known.beginFolderRead('Capped').commit(cappedLevel)

      known.beginRootRead().commit(cappedTree)

      expect(known.judge('Capped/c.md', 'add', 'file').type).toBe('change')
    })

    it('forgets an entry a newer read of the folder no longer lists', () => {
      const known = withCapped()
      known.beginFolderRead('Capped').commit(cappedLevel)
      known.judge('Capped/deeper/x.md', 'add', 'file')

      known.beginFolderRead('Capped').commit([cappedLevel[1]])

      expect(known.judge('Capped/c.md', 'add', 'file').type).toBe('add')
      // Below a sub-folder the read left lazy, the record keeps what it knew
      expect(known.judge('Capped/deeper/x.md', 'add', 'file').type).toBe('change')
    })
  })
})
