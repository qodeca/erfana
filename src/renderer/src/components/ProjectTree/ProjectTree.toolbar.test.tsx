// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectTree.toolbar.test.tsx
 *
 * Covers the toolbar Import button (the wired in-component button), which the
 * extracted runToolbarImport unit test cannot reach:
 * - renders only when a project is open, positioned after New Folder / before Refresh
 * - idle: FileUp icon, enabled, accessible name "Import a file"
 * - importing: disabled + spinner
 * - clicking invokes the import flow (proves onClick wiring)
 *
 * Render setup mirrors ProjectTree.switching.test.tsx (window.api mock +
 * DialogProvider + ProjectManagementProvider, project opened via onProjectChanged).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { ProjectTree } from './ProjectTree'
import { DialogProvider } from '../Dialog'
import { ProjectManagementProvider } from '../../context/ProjectManagementContext'
import { TEST_IDS } from '../../constants/testids'
import type { FileNode } from '../../../../preload/index'

// Controllable useImport mock (factory reads these lazily at call time)
const importState = { isImporting: false }
const mockImportFile = vi.fn(async () => null as string | null)
vi.mock('../../hooks/useImport', () => ({
  useImport: () => ({
    isImporting: importState.isImporting,
    importFile: mockImportFile,
    processFiles: vi.fn(async () => ({
      successCount: 0, failCount: 0, skippedCount: 0, outputPaths: [], failures: []
    }))
  })
}))

let onProjectChangedCallback: ((data: { newPath: string | null; oldPath: string | null }) => void) | null = null

const projFiles: FileNode[] = [
  { name: 'demo.md', path: '/proj/demo.md', type: 'file', extension: 'md' }
]

function setupMockApi() {
  const readDirectory = vi.fn(async () => projFiles)
  const getStatus = vi.fn(async () => ({
    isGitRepo: false,
    branch: null,
    isDetached: false,
    files: [],
    counts: { modified: 0, untracked: 0, deleted: 0, staged: 0, conflicted: 0 },
    truncated: false
  }))

  ;(window as any).api = {
    file: {
      getLastProjectPath: vi.fn(async () => null),
      readDirectory,
      onProjectChanged: (cb: any) => {
        onProjectChangedCallback = cb
        return () => {}
      },
      moveItem: vi.fn(async () => ({ path: '/moved' })),
      copyItem: vi.fn(async () => ({ path: '/copied' })),
      checkConflict: vi.fn(async () => false)
    },
    directoryWatch: {
      start: vi.fn(async () => ({ success: true })),
      stop: vi.fn(async () => ({ success: true })),
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
    git: { getStatus },
    logging: { log: vi.fn() }
  }

  return { readDirectory, getStatus }
}

function renderProjectTree() {
  return render(
    <DialogProvider>
      <ProjectManagementProvider>
        <ProjectTree
          onFileSelect={() => {}}
          showControlPanel={false}
          filterMode={'all' as any}
          onFilterModeChange={() => {}}
        />
      </ProjectManagementProvider>
    </DialogProvider>
  )
}

/** Render and drive the tree into a project-open state. */
async function renderWithProjectOpen() {
  setupMockApi()
  const view = renderProjectTree()
  await act(async () => {
    onProjectChangedCallback!({ newPath: '/proj', oldPath: null })
  })
  await waitFor(() => {
    expect(screen.getByText('demo.md')).toBeInTheDocument()
  })
  return view
}

beforeEach(() => {
  vi.clearAllMocks()
  onProjectChangedCallback = null
  importState.isImporting = false
  ;(window as any).api = undefined
})

describe('ProjectTree toolbar Import button', () => {
  it('is absent when no project is open', () => {
    setupMockApi()
    renderProjectTree()
    expect(screen.queryByTestId(TEST_IDS.PROJECT_TREE_BTN_IMPORT)).not.toBeInTheDocument()
  })

  it('renders after New Folder and before Refresh when a project is open', async () => {
    await renderWithProjectOpen()

    const importBtn = screen.getByTestId(TEST_IDS.PROJECT_TREE_BTN_IMPORT)
    expect(importBtn).toBeInTheDocument()

    // Order within the toolbar action group
    const actions = importBtn.closest('.project-tree-actions')!
    const order = [...actions.querySelectorAll('button')].map((b) => b.getAttribute('data-testid'))
    const folderIdx = order.indexOf(TEST_IDS.PROJECT_TREE_BTN_NEW_FOLDER)
    const importIdx = order.indexOf(TEST_IDS.PROJECT_TREE_BTN_IMPORT)
    const refreshIdx = order.indexOf(TEST_IDS.PROJECT_TREE_BTN_REFRESH)
    expect(folderIdx).toBeLessThan(importIdx)
    expect(importIdx).toBeLessThan(refreshIdx)
  })

  it('is enabled with the import accessible name when idle', async () => {
    await renderWithProjectOpen()

    const importBtn = screen.getByRole('button', { name: 'Import a file' })
    expect(importBtn).toBeEnabled()
    expect(importBtn.querySelector('.spin')).toBeNull()
  })

  it('is disabled and shows the spinner while importing', async () => {
    importState.isImporting = true
    await renderWithProjectOpen()

    const importBtn = screen.getByTestId(TEST_IDS.PROJECT_TREE_BTN_IMPORT)
    expect(importBtn).toBeDisabled()
    expect(importBtn.querySelector('.spin')).not.toBeNull()
  })

  it('invokes importFile when clicked', async () => {
    await renderWithProjectOpen()

    fireEvent.click(screen.getByTestId(TEST_IDS.PROJECT_TREE_BTN_IMPORT))
    expect(mockImportFile).toHaveBeenCalledTimes(1)
  })
})
