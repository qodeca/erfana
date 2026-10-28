// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { FileNode, LazyKind } from '../../../../shared/ipc/file-schema'

const readDirectory = vi.hoisted(() => vi.fn())
const isProjectChanged = vi.hoisted(() => vi.fn(() => false))
const logger = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))

vi.mock('../../services/fileGateway', () => ({
  fileGateway: { readDirectory },
  isProjectChanged
}))
vi.mock('../../utils/logger', () => ({ logger }))

import { findFolder, listingDiffers, newlyExpanded, useExpandReconcile } from './useExpandReconcile'
import { getBasename } from '../../utils/fileUtils'

const file = (path: string): FileNode => ({ name: getBasename(path), path, type: 'file', extension: '.html' })
const folder = (path: string, children: FileNode[] = [], lazy?: LazyKind): FileNode => ({
  name: getBasename(path),
  path,
  type: 'directory',
  children,
  ...(lazy ? { lazy } : {})
})

const ROOT = '/p'
const COMMENTS = '/p/comments'
const shownComments = (): FileNode[] => [folder('/p/comments/static-design', [file('/p/comments/static-design/index.html')]), file('/p/comments/e001.html')]
const baseTree = (): FileNode[] => [
  folder(COMMENTS, shownComments()),
  folder('/p/dist', [], 'ignored'),
  file('/p/notes.md')
]

interface Props {
  files: FileNode[]
  expanded: ReadonlySet<string>
  rootPath: string | null
  onStale: (() => void) | undefined
}

/** Render the hook with these props; the root and comments/ start open unless given. */
function setup(overrides: Partial<Props> = {}) {
  const onStale = vi.fn()
  const initialProps: Props = {
    files: baseTree(),
    expanded: new Set([ROOT]),
    rootPath: ROOT,
    onStale,
    ...overrides
  }
  const hook = renderHook((props: Props) => useExpandReconcile(props.files, props.expanded, props.rootPath, props.onStale), {
    initialProps
  })
  const open = (...paths: string[]) => hook.rerender({ ...initialProps, expanded: new Set([ROOT, ...paths]) })
  return { ...hook, onStale, initialProps, open }
}

/** Let the read's callbacks run. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

beforeEach(() => {
  readDirectory.mockReset()
  isProjectChanged.mockReset().mockReturnValue(false)
  Object.values(logger).forEach((fn) => fn.mockReset())
})

describe('newlyExpanded', () => {
  it('lists the folders the new set adds, and none it drops', () => {
    expect(newlyExpanded(new Set(['/p', '/p/a']), new Set(['/p', '/p/b', '/p/c']))).toEqual(['/p/b', '/p/c'])
    expect(newlyExpanded(new Set(['/p', '/p/a']), new Set(['/p']))).toEqual([])
  })
})

describe('findFolder', () => {
  it('finds a nested folder through its ancestors', () => {
    expect(findFolder(baseTree(), '/p/comments/static-design')?.children).toEqual([
      file('/p/comments/static-design/index.html')
    ])
  })

  it('answers null for a missing folder, a file, the root itself and a path below a folder with no children', () => {
    const tree = [...baseTree(), { name: 'odd', path: '/p/odd', type: 'directory' } as FileNode]
    expect(findFolder(tree, '/p/gone')).toBeNull()
    expect(findFolder(tree, '/p/notes.md')).toBeNull()
    expect(findFolder(tree, ROOT)).toBeNull()
    expect(findFolder(tree, '/p/odd/inner')).toBeNull()
  })

  it('finds a folder on Windows-style paths', () => {
    const tree = [folder('C:\\p\\comments', [folder('C:\\p\\comments\\deep')])]
    expect(findFolder(tree, 'C:\\p\\comments\\deep')?.path).toBe('C:\\p\\comments\\deep')
  })
})

describe('listingDiffers', () => {
  it('is false for the same names and kinds in any order', () => {
    expect(listingDiffers(shownComments(), [...shownComments()].reverse())).toBe(false)
  })

  it('is true for an added, a removed, a renamed or a re-kinded entry', () => {
    const shown = shownComments()
    expect(listingDiffers(shown, [...shown, file('/p/comments/crlf-bom.html')])).toBe(true)
    expect(listingDiffers(shown, shown.slice(1))).toBe(true)
    expect(listingDiffers(shown, [shown[0], file('/p/comments/e002.html')])).toBe(true)
    expect(listingDiffers(shown, [shown[0], folder('/p/comments/e001.html')])).toBe(true)
  })
})

describe('useExpandReconcile', () => {
  it('reads an opened folder one level and refreshes the tree when the disk holds a file it missed', async () => {
    readDirectory.mockResolvedValue([...shownComments(), file('/p/comments/crlf-bom.html')])
    const { open, onStale } = setup()

    open(COMMENTS)

    await waitFor(() => expect(onStale).toHaveBeenCalledTimes(1))
    expect(readDirectory).toHaveBeenCalledWith({ dirPath: COMMENTS, shallow: true })
    // Counts only, never names or paths
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('differs from the disk'), { shown: 2, onDisk: 3 })
  })

  it('reads the folder again each time it is collapsed and opened', async () => {
    readDirectory.mockResolvedValue(shownComments())
    const { rerender, initialProps, open } = setup()

    open(COMMENTS)
    await settle()
    rerender({ ...initialProps, expanded: new Set([ROOT]) })
    open(COMMENTS)
    await settle()

    expect(readDirectory).toHaveBeenCalledTimes(2)
  })

  it('reads only the folder when the disk matches', async () => {
    readDirectory.mockResolvedValue(shownComments())
    const { open, onStale } = setup()

    open(COMMENTS)
    await settle()

    expect(readDirectory).toHaveBeenCalledTimes(1)
    expect(onStale).not.toHaveBeenCalled()
  })

  it('reads nothing for the expansion the panel starts from', async () => {
    setup({ expanded: new Set([ROOT, COMMENTS]) })
    await settle()
    expect(readDirectory).not.toHaveBeenCalled()
  })

  it('reads nothing when several folders open at once', async () => {
    const { open } = setup()
    open(COMMENTS, '/p/comments/static-design')
    await settle()
    expect(readDirectory).not.toHaveBeenCalled()
  })

  it('reads nothing for a lazy folder, a folder the base tree does not hold, or the root row', async () => {
    const { rerender, initialProps, open } = setup()
    open('/p/dist') // lazy
    rerender({ ...initialProps, expanded: new Set([ROOT]) })
    open('/p/dist/inner') // not in the base tree
    rerender({ ...initialProps, expanded: new Set() })
    rerender({ ...initialProps, expanded: new Set([ROOT]) }) // the root row
    await settle()
    expect(readDirectory).not.toHaveBeenCalled()
  })

  it('reads nothing without a refresh to call', async () => {
    const { open } = setup({ onStale: undefined })
    open(COMMENTS)
    await settle()
    expect(readDirectory).not.toHaveBeenCalled()
  })

  it('reads one folder once at a time', async () => {
    readDirectory.mockReturnValue(new Promise(() => {}))
    const { rerender, initialProps, open } = setup()

    open(COMMENTS)
    rerender({ ...initialProps, expanded: new Set([ROOT]) })
    open(COMMENTS)

    expect(readDirectory).toHaveBeenCalledTimes(1)
  })

  it('compares with the tree shown when the read lands: a refresh that already shows the file is enough', async () => {
    let finish!: (nodes: FileNode[]) => void
    readDirectory.mockReturnValue(new Promise<FileNode[]>((resolve) => (finish = resolve)))
    const { rerender, initialProps, onStale } = setup()
    const onDisk = [...shownComments(), file('/p/comments/crlf-bom.html')]

    rerender({ ...initialProps, expanded: new Set([ROOT, COMMENTS]) })
    rerender({ ...initialProps, expanded: new Set([ROOT, COMMENTS]), files: [folder(COMMENTS, onDisk)] })
    await act(async () => finish(onDisk))
    await settle()

    expect(onStale).not.toHaveBeenCalled()
  })

  it('drops the result once the project changed, and when the folder left the tree', async () => {
    let finish!: (nodes: FileNode[]) => void
    readDirectory.mockImplementation(() => new Promise<FileNode[]>((resolve) => (finish = resolve)))
    const { rerender, initialProps, onStale } = setup()
    const onDisk = [file('/p/comments/other.html')]

    rerender({ ...initialProps, expanded: new Set([ROOT, COMMENTS]) })
    rerender({ ...initialProps, expanded: new Set([ROOT, COMMENTS]), rootPath: '/q' })
    await act(async () => finish(onDisk))
    await settle()
    expect(onStale).not.toHaveBeenCalled()

    rerender({ ...initialProps, expanded: new Set([ROOT]) })
    rerender({ ...initialProps, expanded: new Set([ROOT, COMMENTS]) })
    rerender({ ...initialProps, expanded: new Set([ROOT, COMMENTS]), files: [file('/p/notes.md')] })
    await act(async () => finish(onDisk))
    await settle()
    expect(onStale).not.toHaveBeenCalled()
  })

  it('logs a failed read by its error name only and changes nothing; a project switch logs nothing', async () => {
    readDirectory.mockRejectedValueOnce(new TypeError('/p/comments: EACCES'))
    const { rerender, initialProps, open, onStale } = setup()

    open(COMMENTS)
    await waitFor(() => expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { error: 'TypeError' }))
    expect(onStale).not.toHaveBeenCalled()

    isProjectChanged.mockReturnValue(true)
    readDirectory.mockRejectedValueOnce(new Error('PROJECT_CHANGED'))
    rerender({ ...initialProps, expanded: new Set([ROOT]) })
    open(COMMENTS)
    await settle()
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(onStale).not.toHaveBeenCalled()
  })

  it('logs a refresh that throws instead of letting it escape', async () => {
    readDirectory.mockResolvedValue([file('/p/comments/other.html')])
    const onStale = vi.fn(() => {
      throw new RangeError('boom')
    })
    const { open } = setup({ onStale })

    open(COMMENTS)

    await waitFor(() => expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { error: 'RangeError' }))
  })
})
