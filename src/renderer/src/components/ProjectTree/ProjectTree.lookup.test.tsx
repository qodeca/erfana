// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectTree lookup parity tests (issue #60)
 *
 * `ProjectTree` used to resolve paths by scanning `enhancedFlattenedItems`, a
 * second full copy of the flattened tree with the synthetic project root
 * prepended. That copy is gone; every call site now goes through the Map-backed
 * lookups exported by `useDragDropTree`:
 *
 * - `findNodeWithRoot` — root-INCLUSIVE (file click, drag over, drag end,
 *   import shortcut, drag overlay label)
 * - `findNode` — root-EXCLUSIVE (cut/copy), which is what keeps the synthetic
 *   project root non-cuttable
 *
 * These tests pin that asymmetry, the per-call-site behaviour, index freshness
 * after a tree rebuild, and the `handlePaste` dependency fix that the lookup
 * change depends on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import React from 'react'
import { ProjectTree } from './ProjectTree'
import { DialogProvider } from '../Dialog'
import { ProjectManagementProvider } from '../../context/ProjectManagementContext'
import { useClipboardStore } from '../../stores/useClipboardStore'
import { subscribeGlobalToasts, type GlobalToastPayload } from '../Toast/toastService'
import type { FileNode } from '../../../../preload/index'

declare global {
  interface Window {
    api: any
  }
}

const PROJECT_PATH = '/projA'

// --------------------------------------------------------------------------
// Module mocks
// --------------------------------------------------------------------------

/**
 * Taps the drag handlers `ProjectTree` hands to `DndContext` while still
 * rendering the real context, so `useDraggable` / `useDroppable` inside
 * `ProjectTreeNode` keep working. jsdom reports every rect as 0x0, which makes
 * dnd-kit's collision detection unable to produce an `over` target from
 * synthetic pointer events — calling the captured handler is the only way to
 * exercise the real drop code path.
 */
const dnd = vi.hoisted(() => ({
  onDragEnd: null as null | ((event: any) => unknown | Promise<unknown>)
}))

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core')
  const react = await import('react')
  return {
    ...actual,
    DndContext: (props: any) => {
      dnd.onDragEnd = props.onDragEnd
      return react.createElement(actual.DndContext, props)
    }
  }
})

/**
 * `showConfirm` is swapped between renders by the stale-closure test, so the
 * mocked `useDialog` must read it at render time rather than close over it.
 */
const dialog = vi.hoisted(() => ({
  showConfirm: null as any
}))

vi.mock('../Dialog', async () => {
  const actual = await vi.importActual<typeof import('../Dialog')>('../Dialog')
  return {
    ...actual,
    useDialog: () => ({
      showConfirm: dialog.showConfirm,
      showRename: vi.fn(),
      showNewFile: vi.fn(),
      showNewFolder: vi.fn(),
      showDropMode: vi.fn(),
      showConflict: vi.fn(),
      showAlert: vi.fn(),
      showPrompt: vi.fn()
    })
  }
})

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

/** top.md, folder1/{child.md}, other.md */
function baseTree(): FileNode[] {
  return [
    { name: 'top.md', path: `${PROJECT_PATH}/top.md`, type: 'file', extension: '.md' },
    {
      name: 'folder1',
      path: `${PROJECT_PATH}/folder1`,
      type: 'directory',
      children: [
        { name: 'child.md', path: `${PROJECT_PATH}/folder1/child.md`, type: 'file', extension: '.md' }
      ]
    },
    { name: 'other.md', path: `${PROJECT_PATH}/other.md`, type: 'file', extension: '.md' }
  ]
}

/** folder1 removed, folder2 added — used by the staleness test */
function rebuiltTree(): FileNode[] {
  return [
    { name: 'top.md', path: `${PROJECT_PATH}/top.md`, type: 'file', extension: '.md' },
    { name: 'folder2', path: `${PROJECT_PATH}/folder2`, type: 'directory', children: [] }
  ]
}

// --------------------------------------------------------------------------
// Shared mock bridge
// --------------------------------------------------------------------------

// The clipboard store is a module singleton that captures `window.api.file` on
// first use, so the `file` object identity must stay stable across tests.
const fileApi = {
  getLastProjectPath: vi.fn(async () => null),
  readDirectory: vi.fn(async (_path: string) => baseTree()),
  onProjectChanged: vi.fn(),
  moveItem: vi.fn(async () => ({ path: '/moved' })),
  copyItem: vi.fn(async () => ({ path: '/copied' })),
  checkConflict: vi.fn(async () => false),
  closeProject: vi.fn(async () => undefined),
  selectExternalFiles: vi.fn(async () => null),
  getStats: vi.fn(async () => ({ size: 0 }))
}

let onProjectChangedCallback: ((data: { newPath: string | null; oldPath: string | null }) => void) | null = null
let toasts: GlobalToastPayload[] = []
let unsubscribeToasts: (() => void) | null = null

function setupMockApi() {
  fileApi.readDirectory.mockImplementation(async () => baseTree())
  fileApi.checkConflict.mockImplementation(async () => false)
  fileApi.moveItem.mockImplementation(async () => ({ path: '/moved' }))
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

const onFileSelect = vi.fn()

function renderProjectTree(showControlPanel = false) {
  return render(
    <DialogProvider>
      <ProjectManagementProvider>
        <ProjectTree
          onFileSelect={onFileSelect}
          showControlPanel={showControlPanel}
          filterMode={'all' as any}
          onFilterModeChange={() => {}}
        />
      </ProjectManagementProvider>
    </DialogProvider>
  )
}

/** Render the tree and load PROJECT_PATH through the project-changed bridge */
async function renderWithProject() {
  const view = renderProjectTree()

  expect(onProjectChangedCallback).not.toBeNull()
  await act(async () => {
    onProjectChangedCallback!({ newPath: PROJECT_PATH, oldPath: null })
  })
  await waitFor(() => {
    expect(screen.getByText('top.md')).toBeInTheDocument()
  })

  return view
}

/** Clickable row for a tree path (the row carries the click handler) */
function rowFor(path: string): HTMLElement {
  const row = document.querySelector(`.project-tree-item[data-path="${path}"]`)
  if (!row) throw new Error(`No tree row rendered for "${path}"`)
  return row as HTMLElement
}

function treeItemFor(path: string): HTMLElement {
  const item = document.querySelector(`[role="treeitem"][data-path="${path}"]`)
  if (!item) throw new Error(`No treeitem rendered for "${path}"`)
  return item as HTMLElement
}

async function dragEnd(sourcePath: string, targetPath: string) {
  expect(dnd.onDragEnd).not.toBeNull()
  await act(async () => {
    await dnd.onDragEnd!({ active: { id: sourcePath }, over: { id: targetPath } })
  })
}

function pressKey(key: string) {
  fireEvent.keyDown(window, { key, metaKey: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  onProjectChangedCallback = null
  dnd.onDragEnd = null
  dialog.showConfirm = vi.fn(async () => false)
  toasts = []
  unsubscribeToasts = subscribeGlobalToasts((payload) => toasts.push(payload))
  setupMockApi()
  useClipboardStore.getState().clear()
})

afterEach(() => {
  unsubscribeToasts?.()
  unsubscribeToasts = null
})

// --------------------------------------------------------------------------
// Root-inclusive lookups (findNodeWithRoot)
// --------------------------------------------------------------------------

describe('ProjectTree root-inclusive lookups', () => {
  it('resolves the synthetic project root when a row is clicked', async () => {
    await renderWithProject()

    fireEvent.click(rowFor(PROJECT_PATH))

    // A missed lookup would fall through to onFileSelect instead of selecting
    // the folder, so this pins that the root resolved as a directory.
    expect(treeItemFor(PROJECT_PATH)).toHaveAttribute('aria-selected', 'true')
    expect(onFileSelect).not.toHaveBeenCalledWith(PROJECT_PATH)
  })

  it('resolves the project root as a drop target', async () => {
    await renderWithProject()

    await dragEnd(`${PROJECT_PATH}/top.md`, PROJECT_PATH)

    expect(fileApi.moveItem).toHaveBeenCalledWith(`${PROJECT_PATH}/top.md`, PROJECT_PATH)
  })

  it('resolves a nested folder as a drop target', async () => {
    await renderWithProject()

    await dragEnd(`${PROJECT_PATH}/top.md`, `${PROJECT_PATH}/folder1`)

    expect(fileApi.moveItem).toHaveBeenCalledWith(
      `${PROJECT_PATH}/top.md`,
      `${PROJECT_PATH}/folder1`
    )
  })

  it('resolves a nested file to its parent directory', async () => {
    await renderWithProject()

    // child.md lives inside a collapsed folder: the index covers the whole
    // tree, not just the rendered rows.
    await dragEnd(`${PROJECT_PATH}/top.md`, `${PROJECT_PATH}/folder1/child.md`)

    expect(fileApi.moveItem).toHaveBeenCalledWith(
      `${PROJECT_PATH}/top.md`,
      `${PROJECT_PATH}/folder1`
    )
  })

  it('resolves a top-level file to the project root (drop parity)', async () => {
    await renderWithProject()

    // Top-level entries carry parentId === null in the index; the projectPath
    // fallback must reproduce what the prepended-root copy used to supply.
    await dragEnd(`${PROJECT_PATH}/folder1`, `${PROJECT_PATH}/top.md`)

    expect(fileApi.moveItem).toHaveBeenCalledWith(`${PROJECT_PATH}/folder1`, PROJECT_PATH)
  })

  it('reports a miss for an unknown path instead of moving anything', async () => {
    await renderWithProject()

    await dragEnd(`${PROJECT_PATH}/top.md`, `${PROJECT_PATH}/ghost.md`)

    expect(fileApi.moveItem).not.toHaveBeenCalled()
    expect(toasts.some(t => t.message === 'Cannot determine target location')).toBe(true)
  })
})

// --------------------------------------------------------------------------
// Root-exclusive lookup (findNode)
// --------------------------------------------------------------------------

describe('ProjectTree root-exclusive clipboard lookup', () => {
  it('does not resolve the synthetic root, keeping the project non-cuttable', async () => {
    await renderWithProject()

    fireEvent.click(rowFor(PROJECT_PATH))
    expect(treeItemFor(PROJECT_PATH)).toHaveAttribute('aria-selected', 'true')

    pressKey('x')

    expect(useClipboardStore.getState().hasClipboard()).toBe(false)
    expect(useClipboardStore.getState().itemPath).toBeNull()
  })

  it('resolves a real folder for cut', async () => {
    await renderWithProject()

    fireEvent.click(rowFor(`${PROJECT_PATH}/folder1`))
    pressKey('x')

    expect(useClipboardStore.getState().itemPath).toBe(`${PROJECT_PATH}/folder1`)
    expect(useClipboardStore.getState().operation).toBe('cut')
  })

  it('resolves a real folder for copy', async () => {
    await renderWithProject()

    // Only directories become the selection (`handleFileClick` opens files in
    // the editor instead), so the clipboard path always resolves a folder.
    fireEvent.click(rowFor(`${PROJECT_PATH}/folder1`))
    pressKey('c')

    expect(useClipboardStore.getState().itemPath).toBe(`${PROJECT_PATH}/folder1`)
    expect(useClipboardStore.getState().operation).toBe('copy')
  })

  it('opens a file instead of selecting it (nested lookup hit)', async () => {
    await renderWithProject()

    fireEvent.click(rowFor(`${PROJECT_PATH}/top.md`))

    expect(onFileSelect).toHaveBeenCalledWith(`${PROJECT_PATH}/top.md`)
    expect(treeItemFor(`${PROJECT_PATH}/top.md`)).toHaveAttribute('aria-selected', 'false')
  })
})

// --------------------------------------------------------------------------
// Index freshness
// --------------------------------------------------------------------------

describe('ProjectTree lookup staleness', () => {
  it('uses the rebuilt tree for the keydown handler after a refresh', async () => {
    await renderWithProject()

    fireEvent.click(rowFor(`${PROJECT_PATH}/folder1`))
    expect(treeItemFor(`${PROJECT_PATH}/folder1`)).toHaveAttribute('aria-selected', 'true')

    // Rebuild the tree without a project switch: the selection survives, but
    // folder1 no longer exists.
    fileApi.readDirectory.mockImplementation(async () => rebuiltTree())
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Refresh project tree and git status'))
    })
    await waitFor(() => {
      expect(screen.getByText('folder2')).toBeInTheDocument()
    })
    expect(screen.queryByText('folder1')).not.toBeInTheDocument()

    // A stale index would still resolve folder1 and cut a path that is gone.
    pressKey('x')
    expect(useClipboardStore.getState().hasClipboard()).toBe(false)

    // A node that only exists after the rebuild resolves.
    fireEvent.click(rowFor(`${PROJECT_PATH}/folder2`))
    pressKey('x')
    expect(useClipboardStore.getState().itemPath).toBe(`${PROJECT_PATH}/folder2`)
  })
})

// --------------------------------------------------------------------------
// handlePaste dependency fix
// --------------------------------------------------------------------------

describe('ProjectTree paste keyboard shortcut', () => {
  it('uses the current dependencies, not the ones captured at first render', async () => {
    const { rerender } = await renderWithProject()

    // Select a paste target and put a cut item on the clipboard.
    fireEvent.click(rowFor(`${PROJECT_PATH}/folder1`))
    await act(async () => {
      useClipboardStore.getState().cut(`${PROJECT_PATH}/other.md`, 'other.md', 'file')
    })

    const staleShowConfirm = dialog.showConfirm
    fileApi.checkConflict.mockImplementation(async () => true)

    // Swap a `handlePaste` dependency and force a re-render WITHOUT touching
    // the selection, the clipboard or the file tree — the three values the
    // keydown effect used to list. Before the fix the listener kept the first
    // render's closure and would call `staleShowConfirm`.
    const currentShowConfirm = vi.fn(async () => false)
    dialog.showConfirm = currentShowConfirm

    rerender(
      <DialogProvider>
        <ProjectManagementProvider>
          <ProjectTree
            onFileSelect={onFileSelect}
            showControlPanel={true}
            filterMode={'all' as any}
            onFilterModeChange={() => {}}
          />
        </ProjectManagementProvider>
      </DialogProvider>
    )

    await act(async () => {
      pressKey('v')
    })

    await waitFor(() => {
      expect(currentShowConfirm).toHaveBeenCalledTimes(1)
    })
    expect(currentShowConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Replace Item' })
    )
    expect(staleShowConfirm).not.toHaveBeenCalled()
  })

  it('pastes into the selected folder when there is no conflict', async () => {
    await renderWithProject()

    fireEvent.click(rowFor(`${PROJECT_PATH}/folder1`))
    await act(async () => {
      useClipboardStore.getState().cut(`${PROJECT_PATH}/other.md`, 'other.md', 'file')
    })

    await act(async () => {
      pressKey('v')
    })

    await waitFor(() => {
      expect(fileApi.moveItem).toHaveBeenCalledWith(
        `${PROJECT_PATH}/other.md`,
        `${PROJECT_PATH}/folder1`,
        undefined,
        false
      )
    })
    expect(dialog.showConfirm).not.toHaveBeenCalled()
  })
})
