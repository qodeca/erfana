// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The tree's Delete key and keyboard clipboard on the focused row (#463).
 *
 * Delete on a focused row runs the menu's own delete: the same confirmation,
 * then the same delete call. It never fires from a text field, never on the
 * project root, and Cmd/Ctrl+C now acts on the focused row – a file row too.
 * The item goes to the Recycle Bin; when it cannot, a second dialog asks before
 * a permanent delete, and its button ignores clicks for a moment after it opens.
 * An item in use is an error toast, never a second dialog (#486).
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

const { showGlobalToast } = vi.hoisted(() => ({ showGlobalToast: vi.fn() }))
vi.mock('../Toast/toastService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../Toast/toastService')>()),
  showGlobalToast
}))

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
  deleteFile = vi.fn(async () => ({ ok: true, trashed: true }))
  deleteFolder = vi.fn(async () => ({ ok: true, trashed: true }))
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

    expect(dialog).toHaveTextContent('will be moved to the Recycle Bin')
    await userEvent.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))
    await waitFor(() => expect(deleteFile).toHaveBeenCalledWith({ filePath: `${ROOT}/alpha.md` }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('deletes a focused folder with the folder confirmation', async () => {
    await renderTree(smallTree())
    fireEvent.keyDown(focusRow(`${ROOT}/docs`), { key: 'Delete' })

    expect(await screen.findByText(/and everything in it will be moved to the Recycle Bin/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }))
    await waitFor(() => expect(deleteFolder).toHaveBeenCalledWith({ filePath: `${ROOT}/docs` }))
  })

  it('deletes nothing when the confirmation is cancelled', async () => {
    await renderTree(smallTree())
    fireEvent.keyDown(focusRow(`${ROOT}/alpha.md`), { key: 'Delete' })

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deleteFile).not.toHaveBeenCalled()
  })

  describe('when the item cannot go to the Recycle Bin', () => {
    async function reachSecondDialog(): Promise<HTMLElement> {
      await renderTree(smallTree())
      deleteFile.mockResolvedValueOnce({ ok: false, code: 'TRASH_UNAVAILABLE' })
      fireEvent.keyDown(focusRow(`${ROOT}/alpha.md`), { key: 'Delete' })
      await userEvent.click(await screen.findByRole('button', { name: 'Move to Recycle Bin' }))
      return screen.findByRole('dialog', { name: 'Delete permanently?' })
    }

    it('shows a second dialog that says the delete is permanent, focused on Cancel', async () => {
      const dialog = await reachSecondDialog()

      expect(dialog).toHaveTextContent('“alpha.md” cannot be moved to the Recycle Bin')
      expect(dialog).toHaveTextContent('You cannot undo this.')
      expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    })

    it('Cancel deletes nothing', async () => {
      await reachSecondDialog()
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(deleteFile).toHaveBeenCalledTimes(1)
      expect(deleteFile).not.toHaveBeenCalledWith(expect.objectContaining({ permanent: true }))
    })

    it('"Delete permanently" ignores a click at once, then sends the permanent delete once armed', async () => {
      await reachSecondDialog()
      const button = screen.getByRole('button', { name: 'Delete permanently' })

      // A double-click on the first dialog's button lands here: ignored
      expect(button).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(button)
      expect(screen.getByRole('dialog', { name: 'Delete permanently?' })).toBeInTheDocument()
      expect(deleteFile).toHaveBeenCalledTimes(1)

      await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'), { timeout: 2000 })
      await userEvent.click(button)

      await waitFor(() =>
        expect(deleteFile).toHaveBeenLastCalledWith({ filePath: `${ROOT}/alpha.md`, permanent: true })
      )
    })
  })

  it('an item in use shows an error toast and no second dialog', async () => {
    await renderTree(smallTree())
    deleteFile.mockResolvedValueOnce({ ok: false, code: 'IN_USE' })
    fireEvent.keyDown(focusRow(`${ROOT}/alpha.md`), { key: 'Delete' })
    await userEvent.click(await screen.findByRole('button', { name: 'Move to Recycle Bin' }))

    await waitFor(() =>
      expect(showGlobalToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: '“alpha.md” is in use – close the programs or terminals using it, then try again.'
        })
      )
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(deleteFile).toHaveBeenCalledTimes(1)
    expect(item(`${ROOT}/alpha.md`)).toBeInTheDocument()
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
