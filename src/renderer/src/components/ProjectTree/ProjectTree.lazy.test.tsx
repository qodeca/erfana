// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectTree and lazy folders (review finding 32).
 *
 * The main process leaves an ignored folder (and every folder past the walk's
 * entry cap) unread and marks the row `lazy: true`. Expanding that row must
 * read it – one `readDirectory` of that folder – and show what came back; the
 * Markdown filter must keep the row, because its contents are not yet known.
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

declare global {
  interface Window {
    api: any
  }
}

const PROJECT = '/proj'

/** dist/ is lazy (ignored), docs/ was read */
const baseTree = (): FileNode[] => [
  { name: 'dist', path: `${PROJECT}/dist`, type: 'directory', children: [], lazy: true },
  {
    name: 'docs',
    path: `${PROJECT}/docs`,
    type: 'directory',
    children: [{ name: 'a.md', path: `${PROJECT}/docs/a.md`, type: 'file', extension: '.md' }]
  }
]

const distChildren = (): FileNode[] => [
  { name: 'bundle.js', path: `${PROJECT}/dist/bundle.js`, type: 'file', extension: '.js' }
]

const fileApi = {
  readDirectory: vi.fn(async ({ dirPath }: { dirPath: string }) =>
    dirPath === PROJECT ? baseTree() : distChildren()
  ),
  onProjectChanged: vi.fn(),
  closeProject: vi.fn(async () => undefined),
  moveItem: vi.fn(async () => ({ path: '/moved' })),
  checkConflict: vi.fn(async () => false),
  selectExternalFiles: vi.fn(async () => null),
  getStats: vi.fn(async () => ({ size: 0 }))
}

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
      onDirectoryChanged: () => () => {},
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

async function openTree(filterMode: FilterMode = 'all'): Promise<void> {
  render(
    <DialogProvider>
      <ProjectManagementProvider>
        <ProjectTree
          onFileSelect={vi.fn()}
          showControlPanel={false}
          filterMode={filterMode}
          onFilterModeChange={() => {}}
        />
      </ProjectManagementProvider>
    </DialogProvider>
  )
  await act(async () => {
    onProjectChangedCallback!({ newPath: PROJECT, oldPath: null })
  })
  await waitFor(() => expect(screen.getByText('dist')).toBeInTheDocument())
}

const readsOf = (dirPath: string): number =>
  fileApi.readDirectory.mock.calls.filter(([request]) => request.dirPath === dirPath).length

beforeEach(() => {
  vi.clearAllMocks()
  onProjectChangedCallback = null
  setupMockApi()
})

describe('ProjectTree lazy folders', () => {
  it('reads a lazy folder only when it is expanded, and shows its children', async () => {
    await openTree()
    expect(readsOf(`${PROJECT}/dist`)).toBe(0)

    fireEvent.click(screen.getByText('dist'))

    await waitFor(() => expect(screen.getByText('bundle.js')).toBeInTheDocument())
    expect(readsOf(`${PROJECT}/dist`)).toBe(1)
  })

  it('keeps a lazy folder in the Markdown filter, whose contents are not known yet', async () => {
    await openTree('markdown')

    expect(screen.getByText('dist')).toBeInTheDocument()
    expect(screen.getByText('docs')).toBeInTheDocument()
  })
})
