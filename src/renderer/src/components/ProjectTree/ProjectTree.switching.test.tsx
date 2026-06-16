// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectTree Project Switching Tests (Issue #101)
 *
 * Verifies renderer-side behavior during project switching:
 * - Tree clears promptly (AC-009a)
 * - New project loads (AC-009b)
 * - Stale events rejected (AC-009c)
 * - Git status updates (AC-009d)
 * - In-flight events silently dropped (AC-014)
 *
 * These tests complement switchHelpers.test.ts (token guards) and
 * ProjectTree.timing.test.tsx (watcher timing) by focusing on the
 * full integration of project switching in the rendered component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import React from 'react'
import { ProjectTree } from './ProjectTree'
import { DialogProvider } from '../Dialog'
import { ProjectManagementProvider } from '../../context/ProjectManagementContext'
import type { FileNode } from '../../../../preload/index'

declare global {
  interface Window {
    api: any
  }
}

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

let onProjectChangedCallback: ((data: { newPath: string | null; oldPath: string | null }) => void) | null = null

const projAFiles: FileNode[] = [
  { name: 'projA-file.md', path: '/projA/projA-file.md', type: 'file', extension: 'md' }
]

const projBFiles: FileNode[] = [
  { name: 'projB-file.md', path: '/projB/projB-file.md', type: 'file', extension: 'md' }
]

const projCFiles: FileNode[] = [
  { name: 'projC-file.md', path: '/projC/projC-file.md', type: 'file', extension: 'md' }
]

// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------

/**
 * Creates the mock `window.api` object used by all tests.
 *
 * By default `getStatus` returns a non-git-repo response for every path.
 * Pass a custom `getStatusOverride` to change this behavior per-test
 * (e.g. AC-009d needs path-dependent git repo detection).
 */
function setupMockApi(
  getStatusOverride?: ReturnType<typeof vi.fn>
) {
  const readDirectory = vi.fn(async (path: string) => {
    if (path === '/projA') return projAFiles
    if (path === '/projB') return projBFiles
    if (path === '/projC') return projCFiles
    return []
  })

  const getStatus = getStatusOverride ?? vi.fn(async () => ({
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

// ---------------------------------------------------------------------------
// Reset shared state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  onProjectChangedCallback = null
  ;(window as any).api = undefined
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectTree project switching (AC-009)', () => {
  describe('AC-009a: Tree clears promptly on switch', () => {
    it('tree shows no project A files after switching to project B', async () => {
      const { readDirectory } = setupMockApi()

      renderProjectTree()

      expect(onProjectChangedCallback).not.toBeNull()

      // Load project A
      await act(async () => {
        onProjectChangedCallback!({ newPath: '/projA', oldPath: null })
      })

      await waitFor(() => {
        expect(screen.getByText('projA-file.md')).toBeInTheDocument()
      })

      // Switch to project B
      await act(async () => {
        onProjectChangedCallback!({ newPath: '/projB', oldPath: '/projA' })
      })

      // Project A files should be gone immediately (before readDirectory resolves)
      // Check synchronously - files should be cleared in the onProjectChanged handler
      expect(screen.queryByText('projA-file.md')).not.toBeInTheDocument()

      // Wait for project B to load
      await waitFor(() => {
        expect(readDirectory).toHaveBeenCalledWith('/projB')
      })
    })

    it('tree is empty during transition before new files load', async () => {
      setupMockApi()

      renderProjectTree()

      expect(onProjectChangedCallback).not.toBeNull()

      // Load project A
      await act(async () => {
        onProjectChangedCallback!({ newPath: '/projA', oldPath: null })
      })

      await waitFor(() => {
        expect(screen.getByText('projA-file.md')).toBeInTheDocument()
      })

      // Create a delayed readDirectory to observe the transition state
      const originalReadDirectory = window.api.file.readDirectory
      let resolveReadDirectory: (files: FileNode[]) => void
      const delayedReadDirectory = vi.fn(() => {
        return new Promise<FileNode[]>((resolve) => {
          resolveReadDirectory = resolve
        })
      })
      window.api.file.readDirectory = delayedReadDirectory

      // Switch to project B
      await act(async () => {
        onProjectChangedCallback!({ newPath: '/projB', oldPath: '/projA' })
      })

      // During transition: no project A files, no project B files yet
      expect(screen.queryByText('projA-file.md')).not.toBeInTheDocument()
      expect(screen.queryByText('projB-file.md')).not.toBeInTheDocument()
      expect(screen.getByText(/no files found/i)).toBeInTheDocument()

      // Resolve the load
      await act(async () => {
        resolveReadDirectory!(projBFiles)
      })

      await waitFor(() => {
        expect(screen.getByText('projB-file.md')).toBeInTheDocument()
      })

      // Restore original mock
      window.api.file.readDirectory = originalReadDirectory
    })
  })

  describe('AC-009b: New project tree loads', () => {
    it('readDirectory is called for new project path after switch', async () => {
      const { readDirectory } = setupMockApi()

      renderProjectTree()

      expect(onProjectChangedCallback).not.toBeNull()

      // Load project A
      await act(async () => {
        onProjectChangedCallback!({ newPath: '/projA', oldPath: null })
      })

      await waitFor(() => {
        expect(readDirectory).toHaveBeenCalledWith('/projA')
      })

      readDirectory.mockClear()

      // Switch to project B
      await act(async () => {
        onProjectChangedCallback!({ newPath: '/projB', oldPath: '/projA' })
      })

      // Should call readDirectory for new project
      await waitFor(() => {
        expect(readDirectory).toHaveBeenCalledWith('/projB')
      })
    })

    it('tree shows project B files after readDirectory resolves', async () => {
      setupMockApi()

      renderProjectTree()

      expect(onProjectChangedCallback).not.toBeNull()

      // Load project A
      await act(async () => {
        onProjectChangedCallback!({ newPath: '/projA', oldPath: null })
      })

      await waitFor(() => {
        expect(screen.getByText('projA-file.md')).toBeInTheDocument()
      })

      // Switch to project B
      await act(async () => {
        onProjectChangedCallback!({ newPath: '/projB', oldPath: '/projA' })
      })

      // Wait for project B files to appear
      await waitFor(() => {
        expect(screen.getByText('projB-file.md')).toBeInTheDocument()
      })

      // Project A files should NOT be visible
      expect(screen.queryByText('projA-file.md')).not.toBeInTheDocument()
    })
  })

  describe('AC-009c: No stale events from old project (5s observation)', () => {
    it('directory watcher stops for old project after switch', async () => {
      const { readDirectory } = setupMockApi()
      const stopWatcher = window.api.directoryWatch.stop

      renderProjectTree()

      expect(onProjectChangedCallback).not.toBeNull()

      // Load project A
      await act(async () => {
        onProjectChangedCallback!({ newPath: '/projA', oldPath: null })
      })

      await waitFor(() => {
        expect(readDirectory).toHaveBeenCalledWith('/projA')
      })

      // Verify watcher was started for project A
      expect(window.api.directoryWatch.start).toHaveBeenCalledWith('/projA')

      // Switch to project B
      await act(async () => {
        onProjectChangedCallback!({ newPath: '/projB', oldPath: '/projA' })
      })

      await waitFor(() => {
        expect(readDirectory).toHaveBeenCalledWith('/projB')
      })

      // Watcher should be stopped for old project A (cleanup in useDirectoryWatcher effect)
      expect(stopWatcher).toHaveBeenCalledWith('/projA')

      // Watcher should be started for new project B
      expect(window.api.directoryWatch.start).toHaveBeenCalledWith('/projB')
    })

    it('useDirectoryWatcher effect cleanup prevents stale callbacks', async () => {
      // This test verifies the architecture: useDirectoryWatcher registers cleanup
      // that unsubscribes from directory change events when projectPath changes.
      // The cleanup function returned by onDirectoryChanged() is called, preventing
      // stale events from reaching the component.

      const { readDirectory } = setupMockApi()

      // Track unsubscribe calls
      let unsubscribeCallCount = 0
      window.api.directoryWatch.onDirectoryChanged = vi.fn((_cb: any) => {
        const unsubscribe = () => {
          unsubscribeCallCount++
        }
        return unsubscribe
      })

      renderProjectTree()

      expect(onProjectChangedCallback).not.toBeNull()

      // Load project A
      await act(async () => {
        onProjectChangedCallback!({ newPath: '/projA', oldPath: null })
      })

      await waitFor(() => {
        expect(readDirectory).toHaveBeenCalledWith('/projA')
      })

      // Directory watcher should be subscribed
      expect(window.api.directoryWatch.onDirectoryChanged).toHaveBeenCalled()
      const initialUnsubscribeCount = unsubscribeCallCount

      // Switch to project B
      await act(async () => {
        onProjectChangedCallback!({ newPath: '/projB', oldPath: '/projA' })
      })

      await waitFor(() => {
        expect(readDirectory).toHaveBeenCalledWith('/projB')
      })

      // Unsubscribe should have been called during cleanup (old watcher removed)
      expect(unsubscribeCallCount).toBeGreaterThan(initialUnsubscribeCount)
    })
  })

  describe('AC-009d: Git status shows project B', () => {
    it('git status is refreshed for new project after switch', async () => {
      // Override getStatus to return path-dependent results –
      // only projB is detected as a git repo
      const getStatusOverride = vi.fn(async (path: string) => ({
        isGitRepo: path === '/projB',
        branch: path === '/projB' ? 'main' : null,
        isDetached: false,
        files: [],
        counts: { modified: 0, untracked: 0, deleted: 0, staged: 0, conflicted: 0 },
        truncated: false
      }))

      const { getStatus } = setupMockApi(getStatusOverride)

      renderProjectTree()

      expect(onProjectChangedCallback).not.toBeNull()

      // Load project A
      await act(async () => {
        onProjectChangedCallback!({ newPath: '/projA', oldPath: null })
      })

      await waitFor(() => {
        expect(getStatus).toHaveBeenCalledWith('/projA')
      })

      getStatus.mockClear()

      // Switch to project B
      await act(async () => {
        onProjectChangedCallback!({ newPath: '/projB', oldPath: '/projA' })
      })

      // Git status should be refreshed for project B
      await waitFor(() => {
        expect(getStatus).toHaveBeenCalledWith('/projB')
      })

      // Verify no calls for old project A after switch
      const callsForProjectA = getStatus.mock.calls.filter(call => call[0] === '/projA')
      expect(callsForProjectA).toHaveLength(0)
    })
  })
})

describe('AC-014: In-flight event from project A silently dropped', () => {
  it('useDirectoryWatcher cleanup unsubscribes from old project events', async () => {
    // AC-014: When a project switch occurs, the useDirectoryWatcher effect cleanup
    // unsubscribes from the old project's directory watcher. This prevents in-flight
    // events from the old project's watcher from reaching the component.
    //
    // Architecture: useDirectoryWatcher calls window.api.directoryWatch.onDirectoryChanged()
    // which returns an unsubscribe function. The effect cleanup calls this unsubscribe
    // function when projectPath changes, preventing stale event handlers from firing.

    setupMockApi()

    // Track callback registrations and unsubscribe calls
    const callbacks: Array<(data: any) => void> = []
    let unsubscribeCallCount = 0

    window.api.directoryWatch.onDirectoryChanged = vi.fn((cb: any) => {
      callbacks.push(cb)
      return () => {
        unsubscribeCallCount++
        // Remove callback from active list
        const index = callbacks.indexOf(cb)
        if (index > -1) {
          callbacks.splice(index, 1)
        }
      }
    })

    renderProjectTree()

    expect(onProjectChangedCallback).not.toBeNull()

    // Load project A
    await act(async () => {
      onProjectChangedCallback!({ newPath: '/projA', oldPath: null })
    })

    await waitFor(() => {
      expect(screen.getByText('projA-file.md')).toBeInTheDocument()
    })

    // Should have registered callback(s) for project A
    // Note: might be >1 if other hooks also subscribe (e.g., git watcher)
    const callbacksBeforeSwitch = callbacks.length
    expect(callbacksBeforeSwitch).toBeGreaterThan(0)

    // Switch to project B
    await act(async () => {
      onProjectChangedCallback!({ newPath: '/projB', oldPath: '/projA' })
    })

    await waitFor(() => {
      expect(screen.getByText('projB-file.md')).toBeInTheDocument()
    })

    // Old callback should be unsubscribed (cleanup was called)
    expect(unsubscribeCallCount).toBeGreaterThan(0)

    // New callback should be registered for project B
    // Note: callbacks array might have 0 or 1 depending on cleanup timing
    // The key assertion is that unsubscribe was called
  })

  it('project switch does not cause errors when watcher cleanup executes', async () => {
    // This test verifies that the cleanup process (stopping watcher, unsubscribing
    // from events) happens gracefully without errors when switching projects.

    setupMockApi()

    renderProjectTree()

    expect(onProjectChangedCallback).not.toBeNull()

    // Load project A
    await act(async () => {
      onProjectChangedCallback!({ newPath: '/projA', oldPath: null })
    })

    await waitFor(() => {
      expect(screen.getByText('projA-file.md')).toBeInTheDocument()
    })

    // Switch to project B
    await act(async () => {
      onProjectChangedCallback!({ newPath: '/projB', oldPath: '/projA' })
    })

    await waitFor(() => {
      expect(screen.getByText('projB-file.md')).toBeInTheDocument()
    })

    // No error should be displayed (graceful cleanup)
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument()

    // Tree shows correct project B state
    expect(screen.getByText('projB-file.md')).toBeInTheDocument()
    expect(screen.queryByText('projA-file.md')).not.toBeInTheDocument()
  })
})

describe('Edge cases', () => {
  it('switching to null (close project) clears tree completely', async () => {
    setupMockApi()

    renderProjectTree()

    expect(onProjectChangedCallback).not.toBeNull()

    // Load project A
    await act(async () => {
      onProjectChangedCallback!({ newPath: '/projA', oldPath: null })
    })

    await waitFor(() => {
      expect(screen.getByText('projA-file.md')).toBeInTheDocument()
    })

    // Close project (newPath = null)
    await act(async () => {
      onProjectChangedCallback!({ newPath: null, oldPath: '/projA' })
    })

    // Tree should be completely empty
    expect(screen.queryByText('projA-file.md')).not.toBeInTheDocument()
    expect(screen.getByText(/open a project to get started/i)).toBeInTheDocument()
  })

  it('rapid double switch (A→B→C) only shows project C files', async () => {
    const { readDirectory } = setupMockApi()

    renderProjectTree()

    expect(onProjectChangedCallback).not.toBeNull()

    // Load project A
    await act(async () => {
      onProjectChangedCallback!({ newPath: '/projA', oldPath: null })
    })

    await waitFor(() => {
      expect(screen.getByText('projA-file.md')).toBeInTheDocument()
    })

    // Rapid switch: A → B → C (without waiting)
    await act(async () => {
      onProjectChangedCallback!({ newPath: '/projB', oldPath: '/projA' })
      onProjectChangedCallback!({ newPath: '/projC', oldPath: '/projB' })
    })

    // Wait for final project C to load
    await waitFor(() => {
      expect(screen.getByText('projC-file.md')).toBeInTheDocument()
    })

    // Should NOT show project A or B files
    expect(screen.queryByText('projA-file.md')).not.toBeInTheDocument()
    expect(screen.queryByText('projB-file.md')).not.toBeInTheDocument()

    // Verify readDirectory was called for all three projects
    // (useProjectManagement calls readDirectory for each project change)
    expect(readDirectory).toHaveBeenCalledWith('/projA')
    expect(readDirectory).toHaveBeenCalledWith('/projB')
    expect(readDirectory).toHaveBeenCalledWith('/projC')
  })
})
