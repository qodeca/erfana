// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectTree and lazy folders (review finding 32, #320), on the flat
 * virtualised row list (#321).
 *
 * The main process leaves an ignored folder (and every folder past the walk's
 * entry cap) unread and marks the row `lazy`. Expanding that row must read it
 * – one shallow `readDirectory` of that folder – and show what came back.
 * While it is read, a placeholder line sits under it and the folder row says
 * `aria-busy`; a failed read leaves a line that says so. The line is not a
 * row: the keyboard steps over it. The Markdown filter judges a lazy folder
 * by what is known of it.
 *
 * Same harness as ProjectTree.expansion.test.tsx: the real project context,
 * driven through the project-changed bridge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { ProjectTree } from './ProjectTree'
import { DialogProvider } from '../Dialog'
import { ProjectManagementProvider } from '../../context/ProjectManagementContext'
import type { FileNode } from '../../../../shared/ipc/file-schema'
import type { FilterMode } from '../../types/filters'
import { installTreeViewport, treeRowCount } from '../../test-utils/treeViewport'
import { useLazyFolderStore } from '../../stores/useLazyFolderStore'
import { TEST_IDS, getDynamicTestId } from '../../constants/testids'
import { useLazyFolderChildren } from './useLazyFolderChildren'
import { filterMarkdownTree } from './markdownFilter'

// A pass-through spy: the tests below read what the panel hands the hook
vi.mock('./useLazyFolderChildren', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useLazyFolderChildren')>()
  return { ...actual, useLazyFolderChildren: vi.fn(actual.useLazyFolderChildren) }
})

installTreeViewport()

const PROJECT = '/proj'

/** dist/ is lazy (ignored), big/ is lazy (capped), docs/ was read */
const baseTree = (): FileNode[] => [
  { name: 'big', path: `${PROJECT}/big`, type: 'directory', children: [], lazy: 'capped' },
  { name: 'dist', path: `${PROJECT}/dist`, type: 'directory', children: [], lazy: 'ignored' },
  {
    name: 'docs',
    path: `${PROJECT}/docs`,
    type: 'directory',
    children: [{ name: 'a.md', path: `${PROJECT}/docs/a.md`, type: 'file', extension: '.md' }]
  }
]

/** What a shallow read of each lazy folder lists, by path */
let listing: Record<string, FileNode[]>

const fileApi = {
  readDirectory: vi.fn(async ({ dirPath }: { dirPath: string }) =>
    dirPath === PROJECT ? baseTree() : (listing[dirPath] ?? [])
  ),
  onProjectChanged: vi.fn(),
  closeProject: vi.fn(async () => undefined),
  moveItem: vi.fn(async () => ({ path: '/moved' })),
  checkConflict: vi.fn(async () => false),
  selectExternalFiles: vi.fn(async () => null),
  getStats: vi.fn(async () => ({ size: 0 }))
}

let onDirectoryChangedCallback: ((data: unknown) => void) | null = null
let onProjectChangedCallback: ((data: { newPath: string | null; oldPath: string | null }) => void) | null = null

function setupMockApi(): void {
  fileApi.onProjectChanged.mockImplementation((cb: any) => {
    onProjectChangedCallback = cb
    return () => {}
  })
  ;(window as any).api = {
    file: fileApi,
    directoryWatch: {
      start: vi.fn(async () => ({ success: true })),
      stop: vi.fn(async () => ({ success: true })),
      pause: vi.fn(async () => ({ success: true })),
      resume: vi.fn(async () => ({ success: true })),
      onDirectoryChanged: (cb: (data: unknown) => void) => {
        onDirectoryChangedCallback = cb
        return () => {}
      },
      onProjectDeleted: () => () => {},
      onDirectoryError: () => () => {}
    },
    gitWatcher: {
      start: vi.fn(async () => ({ success: true })),
      stop: vi.fn(async () => ({ success: true })),
      onStateChanged: () => () => {}
    },
    gitPolling: {
      start: vi.fn(async () => ({ success: true })),
      stop: vi.fn(async () => ({ success: true })),
      onPollTriggered: () => () => {}
    },
    git: {
      getStatus: vi.fn(async () => ({
        isGitRepo: false,
        branch: null,
        isDetached: false,
        files: [],
        counts: { modified: 0, untracked: 0, deleted: 0, staged: 0, conflicted: 0 },
        truncated: false
      }))
    },
    import: { isSupported: vi.fn(async () => false) },
    logging: { log: vi.fn() }
  }
}

const onFileSelect = vi.fn()
const treeUi = (filterMode: FilterMode) => (
  <DialogProvider>
    <ProjectManagementProvider>
      <ProjectTree
        onFileSelect={onFileSelect}
        showControlPanel={false}
        filterMode={filterMode}
        onFilterModeChange={() => {}}
      />
    </ProjectManagementProvider>
  </DialogProvider>
)

/** Render the tree on the project; the answer switches the filter mode */
async function openTree(filterMode: FilterMode = 'all', waitFor_ = 'docs'): Promise<(mode: FilterMode) => void> {
  const { rerender } = render(treeUi(filterMode))
  await act(async () => {
    onProjectChangedCallback!({ newPath: PROJECT, oldPath: null })
  })
  await waitFor(() => expect(screen.getByText(waitFor_)).toBeInTheDocument())
  return (mode) => rerender(treeUi(mode))
}

/** The focusable treeitem of a node row */
const rowOf = (path: string): HTMLElement => {
  const row = document.querySelector<HTMLElement>(`.project-tree-item[data-path="${path}"]`)
  if (!row) throw new Error(`No row for ${path}`)
  return row
}
const placeholderOf = (path: string): HTMLElement | null =>
  screen.queryByTestId(getDynamicTestId(TEST_IDS.PROJECT_TREE_PLACEHOLDER, path))

const readsOf = (dirPath: string): Array<Record<string, unknown>> =>
  fileApi.readDirectory.mock.calls.map(([request]) => request as Record<string, unknown>).filter((r) => r.dirPath === dirPath)

beforeEach(() => {
  vi.clearAllMocks()
  onProjectChangedCallback = null
  listing = {
    [`${PROJECT}/dist`]: [{ name: 'bundle.js', path: `${PROJECT}/dist/bundle.js`, type: 'file', extension: '.js' }],
    [`${PROJECT}/big`]: [{ name: 'notes.txt', path: `${PROJECT}/big/notes.txt`, type: 'file', extension: '.txt' }]
  }
  useLazyFolderStore.getState().reset()
  setupMockApi()
})

describe('ProjectTree lazy folders', () => {
  it('shows a collapsed lazy folder as collapsed, and reads it only on expand', async () => {
    await openTree()

    expect(rowOf(`${PROJECT}/dist`)).toHaveAttribute('aria-expanded', 'false')
    expect(readsOf(`${PROJECT}/dist`)).toEqual([])

    fireEvent.click(screen.getByText('dist'))

    await waitFor(() => expect(screen.getByText('bundle.js')).toBeInTheDocument())
    expect(readsOf(`${PROJECT}/dist`)).toEqual([{ dirPath: `${PROJECT}/dist`, shallow: true }])
  })

  it('shows a loading line and aria-busy while the folder is read, then its children', async () => {
    let finish!: (nodes: FileNode[]) => void
    await openTree()
    const rowsBefore = treeRowCount()
    fileApi.readDirectory.mockImplementationOnce(() => new Promise<FileNode[]>((resolve) => (finish = resolve)))

    fireEvent.click(screen.getByText('dist'))

    await waitFor(() => expect(placeholderOf(`${PROJECT}/dist`)).toHaveTextContent('Loading…'))
    const folder = rowOf(`${PROJECT}/dist`)
    expect(folder).toHaveAttribute('aria-expanded', 'true')
    expect(folder).toHaveAttribute('aria-busy', 'true')
    const line = placeholderOf(`${PROJECT}/dist`)!
    expect(line).toHaveAttribute('aria-disabled', 'true')
    expect(line).not.toHaveAttribute('tabindex')
    expect(line).not.toHaveAttribute('aria-posinset')
    expect(treeRowCount()).toBe(rowsBefore + 1)

    await act(async () => finish(listing[`${PROJECT}/dist`]))

    await waitFor(() => expect(screen.getByText('bundle.js')).toBeInTheDocument())
    expect(placeholderOf(`${PROJECT}/dist`)).toBeNull()
    expect(rowOf(`${PROJECT}/dist`)).not.toHaveAttribute('aria-busy')
  })

  it('says a folder could not be read when its read fails', async () => {
    await openTree()
    fileApi.readDirectory.mockRejectedValueOnce(new Error('EACCES'))

    fireEvent.click(screen.getByText('dist'))

    await waitFor(() => expect(placeholderOf(`${PROJECT}/dist`)).toHaveTextContent('Could not read this folder'))
    expect(rowOf(`${PROJECT}/dist`)).toHaveAttribute('aria-expanded', 'true')
    expect(rowOf(`${PROJECT}/dist`)).not.toHaveAttribute('aria-busy')
  })

  it('shows a folder that loads empty as expanded with no children and no line', async () => {
    listing[`${PROJECT}/dist`] = []
    await openTree()
    const rowsBefore = treeRowCount()

    fireEvent.click(screen.getByText('dist'))

    await waitFor(() => expect(readsOf(`${PROJECT}/dist`)).toHaveLength(1))
    await waitFor(() => expect(placeholderOf(`${PROJECT}/dist`)).toBeNull())
    expect(rowOf(`${PROJECT}/dist`)).toHaveAttribute('aria-expanded', 'true')
    expect(treeRowCount()).toBe(rowsBefore)
  })

  it('steps the keyboard over the loading line', async () => {
    await openTree()
    fileApi.readDirectory.mockImplementationOnce(() => new Promise<FileNode[]>(() => {}))
    fireEvent.click(screen.getByText('dist'))
    await waitFor(() => expect(placeholderOf(`${PROJECT}/dist`)).not.toBeNull())

    const folder = rowOf(`${PROJECT}/dist`)
    folder.focus()
    fireEvent.keyDown(folder, { key: 'ArrowDown' })

    await waitFor(() => expect(document.activeElement).toBe(rowOf(`${PROJECT}/docs`)))
  })
})

describe('ProjectTree – what is in view decides what is read (round 3, item 5)', () => {
  const lastView = () => vi.mocked(useLazyFolderChildren).mock.calls.at(-1)?.[2]

  it('hands the hook the root row and, in Markdown mode, the Markdown filter', async () => {
    const setFilterMode = await openTree('all')
    expect(lastView()).toEqual({ rootPath: PROJECT, filter: undefined })

    act(() => setFilterMode('markdown'))
    expect(lastView()).toEqual({ rootPath: PROJECT, filter: filterMarkdownTree })
  })
})

describe('ProjectTree lazy folders in the Markdown filter (review items 4, 9)', () => {
  it('hides a never-read ignored folder and keeps a never-read capped one', async () => {
    await openTree('markdown')

    expect(screen.getByText('big')).toBeInTheDocument()
    expect(screen.queryByText('dist')).toBeNull()
  })

  it('drops a capped folder that loads with no Markdown, and focus goes to its parent', async () => {
    let finish!: (nodes: FileNode[]) => void
    await openTree('markdown')
    fileApi.readDirectory.mockImplementationOnce(() => new Promise<FileNode[]>((resolve) => (finish = resolve)))
    fireEvent.click(screen.getByText('big'))
    const folder = rowOf(`${PROJECT}/big`)
    folder.focus()

    await act(async () => {
      // jsdom does not fire focusout for a removed element; Blink does, just before it detaches it
      fireEvent.focusOut(folder, { relatedTarget: null })
      finish(listing[`${PROJECT}/big`])
    })

    await waitFor(() => expect(screen.queryByText('big')).toBeNull())
    // Focus recovery lands on the nearest ancestor that still has a row: the project root
    await waitFor(() => expect(document.activeElement).toBe(rowOf(PROJECT)))
  })

  it('keeps a folder whose read failed, with its "Could not read" line (review of #320, item 6)', async () => {
    await openTree('markdown')
    fileApi.readDirectory.mockRejectedValueOnce(new Error('EACCES'))

    fireEvent.click(screen.getByText('big'))

    await waitFor(() => expect(placeholderOf(`${PROJECT}/big`)).toHaveTextContent('Could not read this folder'))
    expect(screen.getByText('big')).toBeInTheDocument()
  })

  it('keeps an ignored folder whose read failed when the filter turns to Markdown (item 6)', async () => {
    const setFilterMode = await openTree('all')
    fileApi.readDirectory.mockRejectedValueOnce(new Error('EACCES'))
    fireEvent.click(screen.getByText('dist'))
    await waitFor(() => expect(placeholderOf(`${PROJECT}/dist`)).not.toBeNull())

    act(() => setFilterMode('markdown'))

    expect(screen.getByText('dist')).toBeInTheDocument()
    expect(placeholderOf(`${PROJECT}/dist`)).toHaveTextContent('Could not read this folder')
  })

  it('shows a hidden capped folder again after a refresh: its files may have changed (round 4, item 3)', async () => {
    let finish!: (nodes: FileNode[]) => void
    await openTree('markdown')
    fileApi.readDirectory.mockImplementationOnce(() => new Promise<FileNode[]>((resolve) => (finish = resolve)))
    fireEvent.click(screen.getByText('big'))
    await waitFor(() => expect(placeholderOf(`${PROJECT}/big`)).not.toBeNull())
    // Collapsed again while it loads, then it loads with no Markdown: hidden
    fireEvent.click(screen.getByText('big'))
    await act(async () => finish(listing[`${PROJECT}/big`]))
    await waitFor(() => expect(screen.queryByText('big')).toBeNull())

    // An agent writes notes.md into it; the watcher reports a change
    listing[`${PROJECT}/big`] = [{ name: 'notes.md', path: `${PROJECT}/big/notes.md`, type: 'file', extension: '.md' }]
    act(() => onDirectoryChangedCallback!({ eventCount: 1, structural: true }))

    await waitFor(() => expect(screen.getByText('big')).toBeInTheDocument(), { timeout: 3_000 })
  })

  it('keeps a capped folder whose loaded level holds Markdown', async () => {
    listing[`${PROJECT}/big`] = [{ name: 'b.md', path: `${PROJECT}/big/b.md`, type: 'file', extension: '.md' }]
    await openTree('markdown')

    fireEvent.click(screen.getByText('big'))

    await waitFor(() => expect(screen.getByText('b.md')).toBeInTheDocument())
    expect(screen.getByText('big')).toBeInTheDocument()
  })
})
