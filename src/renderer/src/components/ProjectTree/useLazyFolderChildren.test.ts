// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { FileNode } from '../../../../shared/ipc/file-schema'

const readDirectory = vi.hoisted(() => vi.fn())
const isProjectChanged = vi.hoisted(() => vi.fn(() => false))

vi.mock('../../services/fileGateway', () => ({
  fileGateway: { readDirectory },
  isProjectChanged
}))
vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { collectLazyPaths, mergeLazyChildren, useLazyFolderChildren } from './useLazyFolderChildren'
import { getBasename } from '../../utils/fileUtils'

const file = (path: string): FileNode => ({ name: getBasename(path), path, type: 'file', extension: '.md' })
const folder = (path: string, children: FileNode[] = [], lazy = false): FileNode => ({
  name: getBasename(path),
  path,
  type: 'directory',
  children,
  ...(lazy ? { lazy: true as const } : {})
})

/** The base tree: a read folder and a lazy (ignored) one. */
const baseTree = (): FileNode[] => [
  folder('/p/dist', [], true),
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

beforeEach(() => {
  readDirectory.mockReset()
  isProjectChanged.mockReset().mockReturnValue(false)
})

describe('mergeLazyChildren', () => {
  it('returns the tree itself when nothing was loaded', () => {
    const tree = baseTree()
    expect(mergeLazyChildren(tree, new Map())).toBe(tree)
  })

  it('puts loaded children under their lazy folder and keeps the other subtrees', () => {
    const tree = baseTree()
    const loaded = new Map([['/p/dist', { children: [folder('/p/dist/chunks', [], true), file('/p/dist/b.js')] }]])

    const merged = mergeLazyChildren(tree, loaded)

    expect(childrenOf(merged, '/p/dist')).toEqual(['/p/dist/chunks', '/p/dist/b.js'])
    expect(merged[0].lazy).toBe(true)
    expect(merged[1]).toBe(tree[1])
  })

  it('merges a nested lazy folder loaded after its parent', () => {
    const loaded = new Map([
      ['/p/dist', { children: [folder('/p/dist/chunks', [], true)] }],
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
    const tree = [folder('/p/a', [folder('/p/a/dist', [], true)]), folder('/p/b', [], true)]
    expect([...collectLazyPaths(tree)].sort()).toEqual(['/p/a/dist', '/p/b'])
  })
})

describe('useLazyFolderChildren', () => {
  it('does not read a lazy folder until it is expanded', () => {
    const tree = baseTree()
    const { result } = renderHook(() => useLazyFolderChildren(tree, new Set(['/p', '/p/docs'])))

    expect(result.current).toBe(tree)
    expect(readDirectory).not.toHaveBeenCalled()
  })

  it('reads an expanded lazy folder once and merges its children', async () => {
    readDirectory.mockResolvedValue([file('/p/dist/b.js')])
    const tree = baseTree()
    const expanded = new Set(['/p', '/p/dist'])
    const { result, rerender } = renderHook(() => useLazyFolderChildren(tree, expanded))

    await waitFor(() => expect(childrenOf(result.current, '/p/dist')).toEqual(['/p/dist/b.js']))
    rerender()
    expect(readDirectory).toHaveBeenCalledTimes(1)
    expect(readDirectory).toHaveBeenCalledWith({ dirPath: '/p/dist' })
  })

  it('reads a loaded folder again after a new base tree, keeping the old children until then', async () => {
    readDirectory.mockResolvedValueOnce([file('/p/dist/old.js')])
    const expanded = new Set(['/p', '/p/dist'])
    const { result, rerender } = renderHook(({ files }) => useLazyFolderChildren(files, expanded), {
      initialProps: { files: baseTree() }
    })
    await waitFor(() => expect(childrenOf(result.current, '/p/dist')).toEqual(['/p/dist/old.js']))

    let finish!: (nodes: FileNode[]) => void
    readDirectory.mockReturnValueOnce(new Promise<FileNode[]>((resolve) => (finish = resolve)))
    rerender({ files: baseTree() })
    expect(childrenOf(result.current, '/p/dist')).toEqual(['/p/dist/old.js'])

    finish([file('/p/dist/new.js')])
    await waitFor(() => expect(childrenOf(result.current, '/p/dist')).toEqual(['/p/dist/new.js']))
    expect(readDirectory).toHaveBeenCalledTimes(2)
  })

  it('shows a folder whose read failed as empty and does not retry it in a loop', async () => {
    readDirectory.mockRejectedValue(new Error('EACCES: /p/dist'))
    const tree = baseTree()
    const expanded = new Set(['/p', '/p/dist'])
    const { result, rerender } = renderHook(() => useLazyFolderChildren(tree, expanded))

    await waitFor(() => expect(readDirectory).toHaveBeenCalledTimes(1))
    rerender()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readDirectory).toHaveBeenCalledTimes(1)
    expect(childrenOf(result.current, '/p/dist')).toEqual([])
  })
})
