// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectTree initial-expansion tests (issue #60)
 *
 * The project root must be expanded the moment a project is open, otherwise the
 * tree renders as a single collapsed row and the project looks empty.
 *
 * `ProjectTree` used to get that expansion exclusively from the project-changed
 * callback, which is an EFFECT on the instance that is mounted when the event
 * fires. `ProjectPanel` keys the tree's error boundary by project path, so
 * opening or switching a project remounts the tree: the callback writes the
 * expansion into the outgoing instance, and the incoming one starts from a
 * fresh, empty `useState` – collapsed.
 *
 * These tests reproduce that mount site (a wrapper keyed by the context's
 * project path) and drive the real project-changed bridge, so they exercise the
 * same ordering the app does. The fix is a lazy `useState` initializer seeded
 * from the current project path; the callback stays for in-place changes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { ProjectTree } from './ProjectTree'
import { DialogProvider } from '../Dialog'
import {
  ProjectManagementProvider,
  useProjectManagementContextSafe
} from '../../context/ProjectManagementContext'
import type { FileNode } from '../../../../preload/index'

declare global {
  interface Window {
    api: any
  }
}

const PROJECT_A = '/projA'
const PROJECT_B = '/projB'

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

/** top.md, folder1/{child.md} */
function treeA(): FileNode[] {
  return [
    { name: 'a-top.md', path: `${PROJECT_A}/a-top.md`, type: 'file', extension: '.md' },
    {
      name: 'a-folder',
      path: `${PROJECT_A}/a-folder`,
      type: 'directory',
      children: [
        { name: 'a-child.md', path: `${PROJECT_A}/a-folder/a-child.md`, type: 'file', extension: '.md' }
      ]
    }
  ]
}

function treeB(): FileNode[] {
  return [
    { name: 'b-top.md', path: `${PROJECT_B}/b-top.md`, type: 'file', extension: '.md' }
  ]
}

// --------------------------------------------------------------------------
// Mock bridge
// --------------------------------------------------------------------------

const fileApi = {
  getLastProjectPath: vi.fn(async () => null),
  readDirectory: vi.fn(async (_path: string) => [] as FileNode[]),
  onProjectChanged: vi.fn(),
  closeProject: vi.fn(async () => undefined),
  moveItem: vi.fn(async () => ({ path: '/moved' })),
  checkConflict: vi.fn(async () => false),
  selectExternalFiles: vi.fn(async () => null),
  getStats: vi.fn(async () => ({ size: 0 }))
}

let onProjectChangedCallback:
  | ((data: { newPath: string | null; oldPath: string | null }) => void)
  | null = null

function setupMockApi() {
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

// --------------------------------------------------------------------------
// Harness
// --------------------------------------------------------------------------

/**
 * Reproduction of the real mount site.
 *
 * `ProjectPanel` renders `<PanelErrorBoundary key={projectPath ?? 'none'}>`
 * around the tree; the boundary is not what matters here, the KEY is – it makes
 * every project change a remount. Keying the tree directly is the same
 * mechanism with none of the boundary's machinery in the way.
 */
function KeyedProjectTree() {
  const projectPath = useProjectManagementContextSafe()?.projectPath ?? null

  return (
    <ProjectTree
      key={projectPath ?? 'none'}
      onFileSelect={vi.fn()}
      showControlPanel={false}
      filterMode={'all' as any}
      onFilterModeChange={() => {}}
    />
  )
}

function renderKeyedTree() {
  return render(
    <DialogProvider>
      <ProjectManagementProvider>
        <KeyedProjectTree />
      </ProjectManagementProvider>
    </DialogProvider>
  )
}

/** Drive the project-changed bridge exactly as the main process would */
async function openProject(newPath: string, files: FileNode[], oldPath: string | null = null) {
  fileApi.readDirectory.mockImplementation(async () => files)

  expect(onProjectChangedCallback).not.toBeNull()
  await act(async () => {
    onProjectChangedCallback!({ newPath, oldPath })
  })
}

function treeItemFor(path: string): HTMLElement {
  const item = document.querySelector(`[role="treeitem"][data-path="${path}"]`)
  if (!item) throw new Error(`No treeitem rendered for "${path}"`)
  return item as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  onProjectChangedCallback = null
  setupMockApi()
})

describe('ProjectTree initial expansion', () => {
  it('renders the root expanded when a project is opened into a fresh mount', async () => {
    renderKeyedTree()

    await openProject(PROJECT_A, treeA())

    // The root row itself always renders; the fix is whether its CHILDREN do.
    await waitFor(() => {
      expect(screen.getByText('a-top.md')).toBeInTheDocument()
    })
    expect(treeItemFor(PROJECT_A)).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('a-folder')).toBeInTheDocument()

    // Only the root is expanded – nested folders stay closed.
    expect(treeItemFor(`${PROJECT_A}/a-folder`)).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('a-child.md')).not.toBeInTheDocument()
  })

  it('renders the new root expanded after a project switch remounts the tree', async () => {
    renderKeyedTree()

    await openProject(PROJECT_A, treeA())
    await waitFor(() => {
      expect(screen.getByText('a-top.md')).toBeInTheDocument()
    })

    // Switching changes the key, so this is a second remount – the one where
    // the project-changed callback lands on the instance being discarded.
    await openProject(PROJECT_B, treeB(), PROJECT_A)

    await waitFor(() => {
      expect(screen.getByText('b-top.md')).toBeInTheDocument()
    })
    expect(treeItemFor(PROJECT_B)).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByText('a-top.md')).not.toBeInTheDocument()
  })

  it('renders the welcome screen when the project is closed', async () => {
    renderKeyedTree()

    await openProject(PROJECT_A, treeA())
    await waitFor(() => {
      expect(screen.getByText('a-top.md')).toBeInTheDocument()
    })

    // Closing clears the tree; the empty state is what the seeded initializer
    // must not interfere with.
    await openProject(null as unknown as string, [], PROJECT_A)

    await waitFor(() => {
      expect(screen.getByText('Open a project to get started')).toBeInTheDocument()
    })
  })
})
