// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectTree Project Switching Timing Tests
 *
 * These tests verify the coordination between project switching components.
 *
 * Architecture Note:
 * - useProjectManagement: Handles file loading (readDirectory) on project change
 * - useDirectoryWatcher: Starts watcher based on projectPath + initialLoadComplete
 *
 * Watcher start is causally linked to the first tree read (#211, D12): the
 * directory watcher starts only once the first readDirectory of the project
 * has settled, so the watcher's own walk never competes with the first tree
 * read on a large project.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import React from 'react'
import { ProjectTree } from './ProjectTree'
import { DialogProvider } from '../Dialog'
import { ProjectManagementProvider } from '../../context/ProjectManagementContext'

declare global {
  interface Window {
    api: any
  }
}

describe('ProjectTree project switching timing', () => {
  beforeEach(() => {
    ;(window as any).api = undefined
  })

  it('starts the watcher only after the first readDirectory resolves', async () => {
    const start = vi.fn(async () => ({ success: true }))
    // Deferred first read: the test decides when it lands.
    let resolveRead: (tree: unknown[]) => void = () => {}
    const readDirectory = vi.fn(
      () => new Promise<unknown[]>((resolve) => { resolveRead = resolve })
    )

    let onProjectChangedCallback: ((data: { newPath: string | null; oldPath: string | null }) => void) | null = null

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
        start,
        stop: vi.fn(async () => ({ success: true })),
        onDirectoryChanged: () => () => {},
        onProjectDeleted: () => () => {},
        onDirectoryError: () => () => {}
      },
      // Git index watching migrated to GitWatcherService (Issue #74)
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
      logging: {
        log: vi.fn()
      }
    }

    render(
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

    expect(onProjectChangedCallback).not.toBeNull()

    // Trigger project change
    await act(async () => {
      onProjectChangedCallback!({ newPath: '/proj', oldPath: null })
    })

    await waitFor(() => {
      expect(readDirectory).toHaveBeenCalledWith('/proj')
    })
    // The read is still pending: the gate is closed.
    expect(start).not.toHaveBeenCalled()

    await act(async () => {
      resolveRead([])
    })

    await waitFor(() => {
      expect(start).toHaveBeenCalledWith('/proj')
    })
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('does not start watcher when no project path is set', async () => {
    const start = vi.fn(async () => ({ success: true }))
    const readDirectory = vi.fn(async () => [])

    let onProjectChangedCallback: ((data: { newPath: string | null; oldPath: string | null }) => void) | null = null

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
        start,
        stop: vi.fn(async () => ({ success: true })),
        onDirectoryChanged: () => () => {},
        onProjectDeleted: () => () => {},
        onDirectoryError: () => () => {}
      },
      // Git index watching migrated to GitWatcherService (Issue #74)
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
      logging: {
        log: vi.fn()
      }
    }

    render(
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

    expect(onProjectChangedCallback).not.toBeNull()

    // Trigger project close (null path)
    await act(async () => {
      onProjectChangedCallback!({ newPath: null, oldPath: '/old' })
    })

    // Watcher should NOT start when project is closed
    expect(start).not.toHaveBeenCalled()
    expect(readDirectory).not.toHaveBeenCalled()
  })
})

describe('AC-007: Manual refresh via keyboard shortcut', () => {
  it('Cmd+Alt+R triggers readDirectory and getStatus directly', async () => {
    const readDirectory = vi.fn(async () => [])
    const getStatus = vi.fn(async () => ({
      isGitRepo: true,
      branch: 'main',
      isDetached: false,
      files: [],
      counts: { modified: 0, untracked: 0, deleted: 0, staged: 0, conflicted: 0 },
      truncated: false
    }))

    let onProjectChangedCallback: ((data: { newPath: string | null; oldPath: string | null }) => void) | null = null

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

    render(
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

    // Set up project
    expect(onProjectChangedCallback).not.toBeNull()
    await act(async () => {
      onProjectChangedCallback!({ newPath: '/proj', oldPath: null })
    })

    // Wait for initial load to complete
    await waitFor(() => {
      expect(readDirectory).toHaveBeenCalledWith('/proj')
    })

    // Clear call counts after initial load
    readDirectory.mockClear()
    getStatus.mockClear()

    // Simulate Cmd+Alt+R keyboard shortcut
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'r',
        altKey: true,
        metaKey: true,
        bubbles: true
      }))
    })

    // Manual refresh should trigger both readDirectory and getStatus
    await waitFor(() => {
      expect(readDirectory).toHaveBeenCalledWith('/proj')
      expect(getStatus).toHaveBeenCalledWith('/proj')
    })
  })
})
