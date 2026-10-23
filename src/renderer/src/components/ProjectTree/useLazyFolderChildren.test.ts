// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { FileNode, LazyKind } from '../../../../shared/ipc/file-schema'

const readDirectory = vi.hoisted(() => vi.fn())
const isProjectChanged = vi.hoisted(() => vi.fn(() => false))
const warn = vi.hoisted(() => vi.fn())

vi.mock('../../services/fileGateway', () => ({
  fileGateway: { readDirectory },
  isProjectChanged
}))
vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }
}))

import { reconcileLazyState, useLazyFolderChildren } from './useLazyFolderChildren'
import { useLazyFolderStore } from '../../stores/useLazyFolderStore'
import { useMergedProjectFiles } from '../../hooks/useMergedProjectFiles'
import { getBasename } from '../../utils/fileUtils'

const file = (path: string): FileNode => ({ name: getBasename(path), path, type: 'file', extension: '.md' })
const folder = (path: string, children: FileNode[] = [], lazy?: LazyKind): FileNode => ({
  name: getBasename(path),
  path,
  type: 'directory',
  children,
  ...(lazy ? { lazy } : {})
})

/** The base tree: a read folder and a lazy (ignored) one. */
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

const status = (path: string) => useLazyFolderStore.getState().status.get(path)

beforeEach(() => {
  readDirectory.mockReset()
  warn.mockReset()
  isProjectChanged.mockReset().mockReturnValue(false)
  useLazyFolderStore.getState().reset()
})

describe('reconcileLazyState', () => {
  it('carries the children a folder showed over when it turns lazy (review item 3)', () => {
    const previous = [folder('/p/big', [file('/p/big/a.md')])]
    const files = [folder('/p/big', [], 'capped')]

    const next = reconcileLazyState(files, new Map(), previous)

    expect(next.get('/p/big')).toEqual({ children: [file('/p/big/a.md')], baseTree: null })
  })

  it('drops entries whose path is no longer a lazy folder of the tree (review item 7)', () => {
    const loaded = new Map([
      ['/p/dist', { children: [file('/p/dist/b.js')], baseTree: null }],
      ['/other/x', { children: [], baseTree: null }]
    ])

    const next = reconcileLazyState(baseTree(), loaded, [])

    expect([...next.keys()]).toEqual(['/p/dist'])
  })

  it('returns the same map when nothing changes', () => {
    const loaded = new Map([['/p/dist', { children: [], baseTree: null }]])
    expect(reconcileLazyState(baseTree(), loaded, [])).toBe(loaded)
  })
})

describe('useLazyFolderChildren', () => {
  it('does not read a lazy folder until it is expanded', () => {
    const tree = baseTree()
    const { result } = renderHook(() => useLazyFolderChildren(tree, new Set(['/p', '/p/docs'])).tree)

    expect(result.current).toBe(tree)
    expect(readDirectory).not.toHaveBeenCalled()
  })

  it('reads an expanded lazy folder once, one level, and merges its children', async () => {
    readDirectory.mockResolvedValue([file('/p/dist/b.js')])
    const tree = baseTree()
    const expanded = new Set(['/p', '/p/dist'])
    const { result, rerender } = renderHook(() => useLazyFolderChildren(tree, expanded).tree)

    expect(status('/p/dist')).toBe('loading')
    await waitFor(() => expect(childrenOf(result.current, '/p/dist')).toEqual(['/p/dist/b.js']))
    rerender()
    expect(readDirectory).toHaveBeenCalledTimes(1)
    expect(readDirectory).toHaveBeenCalledWith({ dirPath: '/p/dist', shallow: true })
    expect(status('/p/dist')).toBeUndefined()
  })

  it('shares what it read with the merged files any other consumer sees', async () => {
    readDirectory.mockResolvedValue([file('/p/dist/b.js')])
    const tree = baseTree()
    renderHook(() => useLazyFolderChildren(tree, new Set(['/p/dist'])).tree)
    const { result } = renderHook(() => useMergedProjectFiles(tree))

    await waitFor(() => expect(childrenOf(result.current.files, '/p/dist')).toEqual(['/p/dist/b.js']))
    expect(result.current.truncated).toBe(false)
  })

  it('reads a loaded folder again after a new base tree, keeping the old children until then', async () => {
    readDirectory.mockResolvedValueOnce([file('/p/dist/old.js')])
    const expanded = new Set(['/p', '/p/dist'])
    const { result, rerender } = renderHook(({ files }) => useLazyFolderChildren(files, expanded).tree, {
      initialProps: { files: baseTree() }
    })
    await waitFor(() => expect(childrenOf(result.current, '/p/dist')).toEqual(['/p/dist/old.js']))

    let finish!: (nodes: FileNode[]) => void
    readDirectory.mockReturnValueOnce(new Promise<FileNode[]>((resolve) => (finish = resolve)))
    rerender({ files: baseTree() })
    expect(childrenOf(result.current, '/p/dist')).toEqual(['/p/dist/old.js'])

    await act(async () => finish([file('/p/dist/new.js')]))
    await waitFor(() => expect(childrenOf(result.current, '/p/dist')).toEqual(['/p/dist/new.js']))
    expect(readDirectory).toHaveBeenCalledTimes(2)
  })

  it('keeps a read folder that turns lazy showing its children, then re-reads it (review item 3)', async () => {
    readDirectory.mockResolvedValue([file('/p/big/a.md'), file('/p/big/b.md')])
    const expanded = new Set(['/p/big'])
    const { result, rerender } = renderHook(({ files }) => useLazyFolderChildren(files, expanded).tree, {
      initialProps: { files: [folder('/p/big', [file('/p/big/a.md')])] }
    })

    rerender({ files: [folder('/p/big', [], 'capped')] })

    // No empty frame: the carried-over children are there on the first render after the change
    expect(childrenOf(result.current, '/p/big')).toEqual(['/p/big/a.md'])
    await waitFor(() => expect(childrenOf(result.current, '/p/big')).toEqual(['/p/big/a.md', '/p/big/b.md']))
  })

  it('marks a failed read, keeps it empty and does not retry it in a loop', async () => {
    readDirectory.mockRejectedValue(new Error('EACCES: /p/dist'))
    const tree = baseTree()
    const { result, rerender } = renderHook(({ expanded }) => useLazyFolderChildren(tree, expanded).tree, {
      initialProps: { expanded: new Set(['/p', '/p/dist']) as ReadonlySet<string> }
    })

    await waitFor(() => expect(status('/p/dist')).toBe('failed'))
    // The panel hands a new set on every expand change: still no second read
    rerender({ expanded: new Set(['/p', '/p/dist']) })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readDirectory).toHaveBeenCalledTimes(1)
    expect(childrenOf(result.current, '/p/dist')).toEqual([])
    // A failure is not a read: nothing is stored as loaded (review of #320, item 6)
    expect(useLazyFolderStore.getState().loaded.has('/p/dist')).toBe(false)
    // The path in the message is never logged
    expect(JSON.stringify(warn.mock.calls)).not.toContain('/p/dist')
  })

  it('keeps the older children of a folder whose re-read fails, and counts it as unread (item 6)', async () => {
    readDirectory.mockResolvedValueOnce([file('/p/big/a.md')])
    const expanded = new Set(['/p/big'])
    const capped = (): FileNode[] => [folder('/p/big', [], 'capped')]
    const { result, rerender } = renderHook(
      ({ files }) => ({ lazy: useLazyFolderChildren(files, expanded), merged: useMergedProjectFiles(files) }),
      { initialProps: { files: capped() } }
    )
    await waitFor(() => expect(childrenOf(result.current.lazy.tree, '/p/big')).toEqual(['/p/big/a.md']))
    expect(result.current.merged.truncated).toBe(false)

    readDirectory.mockRejectedValueOnce(new Error('EIO'))
    rerender({ files: capped() })

    await waitFor(() => expect(status('/p/big')).toBe('failed'))
    expect(childrenOf(result.current.lazy.tree, '/p/big')).toEqual(['/p/big/a.md'])
    expect(result.current.merged.truncated).toBe(true)
  })

  it('reads only the lazy folders in view: not one below a collapsed folder (item 7)', async () => {
    readDirectory.mockResolvedValue([file('/p/a/big/x.md')])
    const tree = [folder('/p/a', [folder('/p/a/big', [], 'capped')])]
    const { rerender } = renderHook(({ expanded }) => useLazyFolderChildren(tree, expanded), {
      initialProps: { expanded: new Set(['/p/a/big']) as ReadonlySet<string> }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readDirectory).not.toHaveBeenCalled()

    rerender({ expanded: new Set(['/p/a', '/p/a/big']) })

    await waitFor(() => expect(readDirectory).toHaveBeenCalledTimes(1))
  })

  it('does not re-read a loaded folder out of view after a new base tree, until it is shown (item 7)', async () => {
    readDirectory.mockResolvedValue([file('/p/a/big/x.md')])
    const tree = (): FileNode[] => [folder('/p/a', [folder('/p/a/big', [], 'capped')])]
    const open = new Set(['/p/a', '/p/a/big'])
    const { rerender } = renderHook(({ files, expanded }) => useLazyFolderChildren(files, expanded), {
      initialProps: { files: tree(), expanded: open as ReadonlySet<string> }
    })
    await waitFor(() => expect(useLazyFolderStore.getState().loaded.has('/p/a/big')).toBe(true))

    // Collapse the parent, then a refresh brings a new base tree
    const collapsed = new Set(['/p/a/big'])
    rerender({ files: tree(), expanded: collapsed })
    rerender({ files: tree(), expanded: collapsed })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readDirectory).toHaveBeenCalledTimes(1)

    rerender({ files: tree(), expanded: open })
    await waitFor(() => expect(readDirectory).toHaveBeenCalledTimes(2))
  })

  it('reads nothing while the root row is collapsed, and reads once it is expanded (round 3, item 5)', async () => {
    readDirectory.mockResolvedValue([])
    const tree = baseTree()
    const { rerender } = renderHook(({ expanded }) => useLazyFolderChildren(tree, expanded, { rootPath: '/p' }), {
      initialProps: { expanded: new Set(['/p/dist']) as ReadonlySet<string> }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readDirectory).not.toHaveBeenCalled()

    rerender({ expanded: new Set(['/p', '/p/dist']) })
    await waitFor(() => expect(readDirectory).toHaveBeenCalledTimes(1))
  })

  it('reads nothing the view filter hides (round 3, item 5)', async () => {
    readDirectory.mockResolvedValue([])
    const tree = baseTree()
    const hideDist = (nodes: FileNode[]): FileNode[] => nodes.filter((node) => node.path !== '/p/dist')
    renderHook(() => useLazyFolderChildren(tree, new Set(['/p', '/p/dist']), { rootPath: '/p', filter: hideDist }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readDirectory).not.toHaveBeenCalled()
  })

  it('drops a read the project switch refused: no marker, no log, nothing merged', async () => {
    readDirectory.mockRejectedValue(new Error('PROJECT_CHANGED'))
    isProjectChanged.mockReturnValue(true)
    const tree = baseTree()
    const { result } = renderHook(() => useLazyFolderChildren(tree, new Set(['/p/dist'])).tree)

    await waitFor(() => expect(readDirectory).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(status('/p/dist')).toBeUndefined())
    expect(warn).not.toHaveBeenCalled()
    expect(useLazyFolderStore.getState().loaded.size).toBe(0)
    expect(result.current).toBe(tree)
  })
})

describe('useMergedProjectFiles', () => {
  it('reports a tree with an unread capped folder as truncated', () => {
    const tree = [folder('/p/big', [], 'capped')]
    const { result } = renderHook(() => useMergedProjectFiles(tree))
    expect(result.current.truncated).toBe(true)
  })
})
