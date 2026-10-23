// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import type { FileNode, LazyKind } from '../../../shared/ipc/file-schema'
import { collectLazyPaths, hasUnloadedCapped, mergeLazyChildren } from './lazyTree'
import { getBasename } from './fileUtils'

const file = (path: string): FileNode => ({ name: getBasename(path), path, type: 'file', extension: '.md' })
const folder = (path: string, children: FileNode[] = [], lazy?: LazyKind): FileNode => ({
  name: getBasename(path),
  path,
  type: 'directory',
  children,
  ...(lazy ? { lazy } : {})
})

const baseTree = (): FileNode[] => [
  folder('/p/dist', [], 'ignored'),
  folder('/p/docs', [file('/p/docs/a.md')]),
  file('/p/README.md')
]

const childrenOf = (tree: FileNode[], path: string): string[] | undefined => {
  for (const node of tree) {
    if (node.path === path) return node.children?.map((c) => c.path)
    const below = node.children ? childrenOf(node.children, path) : undefined
    if (below) return below
  }
  return undefined
}

describe('mergeLazyChildren', () => {
  it('returns the tree itself when nothing was loaded', () => {
    const tree = baseTree()
    expect(mergeLazyChildren(tree, new Map())).toBe(tree)
  })

  it('puts loaded children under their lazy folder and keeps the other subtrees', () => {
    const tree = baseTree()
    const loaded = new Map([['/p/dist', { children: [folder('/p/dist/chunks', [], 'ignored'), file('/p/dist/b.js')] }]])

    const merged = mergeLazyChildren(tree, loaded)

    expect(childrenOf(merged, '/p/dist')).toEqual(['/p/dist/chunks', '/p/dist/b.js'])
    expect(merged[0].lazy).toBe('ignored')
    expect(merged[1]).toBe(tree[1])
  })

  it('merges a nested lazy folder loaded after its parent', () => {
    const loaded = new Map([
      ['/p/dist', { children: [folder('/p/dist/chunks', [], 'ignored')] }],
      ['/p/dist/chunks', { children: [file('/p/dist/chunks/c.js')] }]
    ])

    expect(childrenOf(mergeLazyChildren(baseTree(), loaded), '/p/dist/chunks')).toEqual(['/p/dist/chunks/c.js'])
  })

  it('ignores loaded children for a folder that is no longer lazy', () => {
    const tree = [folder('/p/dist', [file('/p/dist/fresh.js')])]
    const loaded = new Map([['/p/dist', { children: [file('/p/dist/old.js')] }]])

    expect(mergeLazyChildren(tree, loaded)).toBe(tree)
  })
})

describe('collectLazyPaths', () => {
  it('finds lazy folders at any depth', () => {
    const tree = [folder('/p/a', [folder('/p/a/dist', [], 'ignored')]), folder('/p/b', [], 'capped')]
    expect([...collectLazyPaths(tree)].sort()).toEqual(['/p/a/dist', '/p/b'])
  })
})

describe('hasUnloadedCapped', () => {
  it('is true only while some capped folder is unread; ignored ones never count', () => {
    const tree = [folder('/p/dist', [], 'ignored'), folder('/p/a', [folder('/p/a/big', [], 'capped')])]

    expect(hasUnloadedCapped([folder('/p/dist', [], 'ignored')], new Map())).toBe(false)
    expect(hasUnloadedCapped(tree, new Map())).toBe(true)
    expect(hasUnloadedCapped(tree, new Map([['/p/a/big', {}]]))).toBe(false)
  })

  it('does not count a linked folder, and counts a capped one whose read failed (review of #320, items 5, 6)', () => {
    expect(hasUnloadedCapped([folder('/p/alias', [], 'linked')], new Map())).toBe(false)
    const tree = [folder('/p/big', [], 'capped')]
    expect(hasUnloadedCapped(tree, new Map([['/p/big', {}]]), new Map([['/p/big', 'failed' as const]]))).toBe(true)
  })
})
