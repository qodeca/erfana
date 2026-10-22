// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * External drop on the project tree: the file-count limit is checked BEFORE the
 * Move / Copy / Import choice, so the user is never asked how to add a drop that
 * is then refused with "Too many files".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import React from 'react'
import { ProjectTree } from './ProjectTree'
import { DialogProvider } from '../Dialog'
import { ProjectManagementProvider } from '../../context/ProjectManagementContext'
import { subscribeGlobalToasts, type GlobalToastPayload } from '../Toast/toastService'
import { EXTERNAL_MOVE_BATCH_MAX } from '../../../../shared/ipc/external-file-limits'
import type { ExternalDropFile } from '../../hooks/useExternalFileDrop'
import type { FileNode } from '../../../../preload/index'

const PROJECT_PATH = '/projA'

const dialog = vi.hoisted(() => ({
  showDropMode: null as any
}))

vi.mock('../Dialog', async () => {
  const actual = await vi.importActual<typeof import('../Dialog')>('../Dialog')
  return {
    ...actual,
    useDialog: () => ({
      showConfirm: vi.fn(async () => false),
      showRename: vi.fn(),
      showNewFile: vi.fn(),
      showNewFolder: vi.fn(),
      showDropMode: dialog.showDropMode,
      showConflict: vi.fn(async () => null),
      showAlert: vi.fn(),
      showPrompt: vi.fn()
    })
  }
})

/**
 * jsdom cannot build a real `DataTransfer` with OS paths, so the drop hook is
 * replaced: every drag counts as external, and a drop yields `drop.files`.
 */
const drop = vi.hoisted(() => ({
  files: [] as ExternalDropFile[]
}))

vi.mock('../../hooks/useExternalFileDrop', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/useExternalFileDrop')>(
    '../../hooks/useExternalFileDrop'
  )
  return {
    ...actual,
    isExternalDrag: () => true,
    useExternalFileDrop: () => ({
      isExternalDragActive: false,
      externalDropTarget: null,
      handleDragEnter: vi.fn(),
      handleDragOver: vi.fn(),
      handleDragLeave: vi.fn(),
      handleDrop: () => drop.files,
      getTargetFromEvent: () => PROJECT_PATH
    })
  }
})

function tree(): FileNode[] {
  return [{ name: 'top.md', path: `${PROJECT_PATH}/top.md`, type: 'file', extension: '.md' }]
}

function droppedFiles(count: number): ExternalDropFile[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `/outside/f${i}.md`,
    name: `f${i}.md`,
    sizeInBytes: 1,
    isDirectory: false
  }))
}

let onProjectChangedCallback: ((data: { newPath: string | null; oldPath: string | null }) => void) | null = null
let toasts: GlobalToastPayload[] = []
let unsubscribeToasts: (() => void) | null = null

const fileApi = {
  readDirectory: vi.fn(async () => tree()),
  onProjectChanged: vi.fn((cb: any) => {
    onProjectChangedCallback = cb
    return () => {}
  }),
  checkConflict: vi.fn(async () => false),
  validateExternal: vi.fn(async () => ({ valid: true })),
  copyFromExternal: vi.fn(async () => ({ success: true })),
  moveBatchFromExternal: vi.fn(async () => ({ results: [] })),
  closeProject: vi.fn(async () => undefined),
  selectExternalFiles: vi.fn(async () => null),
  getStats: vi.fn(async () => ({ size: 0 }))
}

function setupMockApi(): void {
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

async function renderWithProject(): Promise<void> {
  render(
    <DialogProvider>
      <ProjectManagementProvider>
        <ProjectTree
          onFileSelect={vi.fn()}
          showControlPanel={false}
          filterMode={'all' as any}
          onFilterModeChange={() => {}}
        />
      </ProjectManagementProvider>
    </DialogProvider>
  )
  expect(onProjectChangedCallback).not.toBeNull()
  await act(async () => {
    onProjectChangedCallback!({ newPath: PROJECT_PATH, oldPath: null })
  })
  await waitFor(() => {
    expect(screen.getByText('top.md')).toBeInTheDocument()
  })
}

async function dropOnTree(): Promise<void> {
  await act(async () => {
    fireEvent.drop(screen.getByTestId('project-tree'))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  onProjectChangedCallback = null
  dialog.showDropMode = vi.fn(async () => ({ mode: 'copy' }))
  toasts = []
  unsubscribeToasts = subscribeGlobalToasts((payload) => toasts.push(payload))
  setupMockApi()
})

afterEach(() => {
  unsubscribeToasts?.()
  unsubscribeToasts = null
})

describe('ProjectTree external drop – file limit', () => {
  it('refuses a drop over the limit without asking Move / Copy first', async () => {
    await renderWithProject()
    drop.files = droppedFiles(EXTERNAL_MOVE_BATCH_MAX + 1)

    await dropOnTree()

    await waitFor(() => {
      expect(toasts).toContainEqual(expect.objectContaining({ title: 'Too many files', type: 'error' }))
    })
    expect(dialog.showDropMode).not.toHaveBeenCalled()
    expect(fileApi.validateExternal).not.toHaveBeenCalled()
    expect(fileApi.copyFromExternal).not.toHaveBeenCalled()
    expect(fileApi.moveBatchFromExternal).not.toHaveBeenCalled()
  })

  it('asks how to add a drop at the limit', async () => {
    await renderWithProject()
    drop.files = droppedFiles(EXTERNAL_MOVE_BATCH_MAX)

    await dropOnTree()

    await waitFor(() => {
      expect(dialog.showDropMode).toHaveBeenCalledTimes(1)
    })
    expect(toasts).not.toContainEqual(expect.objectContaining({ title: 'Too many files' }))
  })
})
