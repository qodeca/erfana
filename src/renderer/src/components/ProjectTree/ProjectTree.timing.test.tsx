/**
 * ProjectTree Project Switching Timing Tests
 *
 * These tests verify the coordination between project switching components.
 *
 * Architecture Note:
 * - useProjectManagement: Handles file loading (readDirectory) on project change
 * - useDirectoryWatcher: Starts watcher based on projectPath + initialLoadComplete
 *
 * Current behavior: Watcher start and file loading are NOT causally linked.
 * The watcher starts when projectPath is set, independent of readDirectory completion.
 * This is intentional - the watcher doesn't need files to watch the directory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import React from 'react'
import { ProjectTree } from './ProjectTree'
import { DialogProvider } from '../Dialog'

declare global {
  interface Window {
    api: any
  }
}

describe('ProjectTree project switching timing', () => {
  beforeEach(() => {
    ;(window as any).api = undefined
  })

  it('starts watcher when projectPath is set (independent of readDirectory)', async () => {
    // This test documents actual behavior: watcher starts based on projectPath,
    // not dependent on readDirectory completion.

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
      }
    }

    render(
      <DialogProvider>
        <ProjectTree
          onFileSelect={() => {}}
          showControlPanel={false}
          filterMode={'all' as any}
          onFilterModeChange={() => {}}
        />
      </DialogProvider>
    )

    expect(onProjectChangedCallback).not.toBeNull()

    // Trigger project change
    await act(async () => {
      onProjectChangedCallback!({ newPath: '/proj', oldPath: null })
    })

    // Both should be called - they are independent operations
    await waitFor(() => {
      expect(readDirectory).toHaveBeenCalledWith('/proj')
      expect(start).toHaveBeenCalledWith('/proj')
    })
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
      }
    }

    render(
      <DialogProvider>
        <ProjectTree
          onFileSelect={() => {}}
          showControlPanel={false}
          filterMode={'all' as any}
          onFilterModeChange={() => {}}
        />
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
