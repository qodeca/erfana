// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { KnownEntries, MAX_KNOWN_ENTRIES } from './KnownEntries'
import type { FileNode } from '../../../shared/ipc/file-schema'

const toRel = (abs: string): string | null => (abs.startsWith('/p/') ? abs.slice(3) : null)
const same = (rel: string): string => rel
const lower = (rel: string): string => rel.toLowerCase()

const tree: FileNode[] = [
  { name: 'a.md', path: '/p/a.md', type: 'file' },
  { name: 'l.md', path: '/p/l.md', type: 'file', isSymlink: true },
  {
    name: 'Sub',
    path: '/p/Sub',
    type: 'directory',
    children: [{ name: 'B.md', path: '/p/Sub/B.md', type: 'file' }]
  },
  { name: 'out.md', path: '/elsewhere/out.md', type: 'file' }
]

describe('KnownEntries', () => {
  it('records files and symlinks from a tree, not folders or outside paths', () => {
    const known = KnownEntries.fromTree(tree, toRel, same)

    expect(known.kindOf('a.md')).toBe('file')
    expect(known.kindOf('l.md')).toBe('symlink')
    expect(known.kindOf('Sub/B.md')).toBe('file')
    expect(known.kindOf('Sub')).toBeUndefined()
    expect(known.size).toBe(3)
  })

  it('folds keys on a case-insensitive platform', () => {
    const known = KnownEntries.fromTree(tree, toRel, lower)
    expect(known.kindOf('sub/b.md')).toBe('file')
  })

  it('follows adds and removals, and forgets an entry of unknown kind', () => {
    const known = KnownEntries.fromTree(tree, toRel, same)

    known.noteAdded('new.md', 'file')
    known.noteRemoved('a.md')
    known.noteAdded('l.md', undefined)
    known.noteFolderRemoved('Sub')

    expect(known.kindOf('new.md')).toBe('file')
    expect(known.kindOf('a.md')).toBeUndefined()
    expect(known.kindOf('l.md')).toBeUndefined()
    expect(known.kindOf('Sub/B.md')).toBeUndefined()
  })

  it('records nothing for a tree above the cap', () => {
    const big: FileNode[] = Array.from({ length: MAX_KNOWN_ENTRIES + 1 }, (_, i) => ({
      name: `f${i}`,
      path: `/p/f${i}`,
      type: 'file' as const
    }))
    expect(KnownEntries.fromTree(big, toRel, same).size).toBe(0)
  })
})
