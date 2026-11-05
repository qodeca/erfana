// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The tree's Delete key and keyboard clipboard on the focused row (#463).
 *
 * Delete on a focused row runs the menu's own delete: the same confirmation,
 * then the same delete call. It never fires from a text field, never on the
 * project root, and Cmd/Ctrl+C now acts on the focused row – a file row too.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectTree } from './ProjectTree'
import { DialogProvider } from '../Dialog'
import { DialogManager } from '../Dialog/DialogManager'
import { ProjectManagementProvider } from '../../context/ProjectManagementContext'
import { useClipboardStore } from '../../stores/useClipboardStore'
import type { FileNode } from '../../../../preload/index'
import { installTreeViewport } from '../../test-utils/treeViewport'

installTreeViewport()

const ROOT = '/proj'

const file = (path: string, name: string): FileNode => ({ name, path, type: 'file', extension: '.md' })

function smallTree(): FileNode[] {
  return [
    file(`${ROOT}/alpha.md`, 'alpha.md'),
    { name: 'docs', path: `${ROOT}/docs`, type: 'directory', children: [file(`${ROOT}/docs/beta.md`, 'beta.md')] }
  ]
}

let onProjectChanged: ((data: { newPath: string | null; oldPath: string | null }) => void) | null = null
let deleteFile: ReturnType<typeof vi.fn>
let deleteFolder: ReturnType<typeof vi.fn>

function setupMockApi(files: FileNode[]) {
  deleteFile = vi.fn(async () => undefined)
  deleteFolder = vi.fn(async () => undefined)
  ;(window as any).api = {
    utils: { getPlatform: () => 'win32' },
    file: {
      readDirectory: vi.fn(async () => files),
      onProjectChanged: vi.fn((cb: any) => {
        onProjectChanged = cb
        return () => {}
      }),
      closeProject: vi.fn(async () => undefined),
      checkConflict: vi.fn(async () => false),
      deleteFile,
      deleteFolder
    },
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

async function renderTree(files: FileNode[]) {
  setupMockApi(files)
  render(
    <DialogProvider>
      <ProjectManagementProvider>
        <input aria-label="Elsewhere" />
        <ProjectTree onFileSelect={vi.fn()} showControlPanel={false} filterMode={'all' as any} onFilterModeChange={() => {}} />
      </ProjectManagementProvider>
      <DialogManager />
    </DialogProvider>
  )
  await act(async () => {
    onProjectChanged!({ newPath: ROOT, oldPath: null })
  })
  await waitFor(() => expect(item(`${ROOT}/alpha.md`)).toBeInTheDocument())
}

function item(path: string): HTMLElement {
  for (const el of document.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
    if (el.dataset.path === path) return el
  }
  throw new Error(`No treeitem rendered for "${path}"`)
}

function focusRow(path: string): HTMLElement {
  const row = item(path)
  act(() => row.focus())
  return row
}

let portalRoot: HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  onProjectChanged = null
  useClipboardStore.getState().clear()
  portalRoot = document.createElement('div')
  portalRoot.id = 'portal-root'
  document.body.appendChild(portalRoot)
})

afterEach(() => {
  portalRoot.remove()
})

describe('ProjectTree – Delete key (#463)', () => {
  it('asks for confirmation, then deletes the focused file', async () => {
    await renderTree(smallTree())
    fireEvent.keyDown(focusRow(`${ROOT}/alpha.md`), { key: 'Delete' })

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('alpha.md')
    expect(deleteFile).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteFile).toHaveBeenCalledWith({ filePath: `${ROOT}/alpha.md` }))
  })

  it('deletes a focused folder with the folder confirmation', async () => {
    await renderTree(smallTree())
    fireEvent.keyDown(focusRow(`${ROOT}/docs`), { key: 'Delete' })

    expect(await screen.findByText(/and all its contents/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteFolder).toHaveBeenCalledWith({ filePath: `${ROOT}/docs` }))
  })

  it('deletes nothing when the confirmation is cancelled', async () => {
    await renderTree(smallTree())
    fireEvent.keyDown(focusRow(`${ROOT}/alpha.md`), { key: 'Delete' })

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('never asks while typing in a text field', async () => {
    await renderTree(smallTree())
    // A folder was clicked earlier; focus then moved to a field outside the tree.
    fireEvent.click(item(`${ROOT}/docs`))
    const field = screen.getByRole('textbox', { name: 'Elsewhere' })
    act(() => field.focus())
    fireEvent.keyDown(field, { key: 'Delete' })

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('never offers to delete the project root from the keyboard', async () => {
    await renderTree(smallTree())
    fireEvent.keyDown(focusRow(ROOT), { key: 'Delete' })

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('ProjectTree – keyboard clipboard on the focused row (#463)', () => {
  it('copies a focused FILE row with Ctrl+C', async () => {
    await renderTree(smallTree())
    fireEvent.keyDown(focusRow(`${ROOT}/alpha.md`), { key: 'c', ctrlKey: true })

    expect(useClipboardStore.getState().itemPath).toBe(`${ROOT}/alpha.md`)
  })
})
