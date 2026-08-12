// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useProjectManagement — "no auto-load on mount" invariant (issue #60)
 *
 * The mount effect (`useProjectManagement.ts`, "Load last project on mount -
 * DISABLED") only marks the initial load complete; it never reopens the last
 * project. Crash recovery leans on that: relaunching after a crash caused BY a
 * project must land on the welcome screen, not reopen the offending project and
 * crash again.
 *
 * The invariant is renderer-side, so it is pinned here rather than in a
 * main-process autorestore test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useProjectManagement } from './useProjectManagement'

vi.mock('../components/Dialog', async () => {
  const actual = await vi.importActual<typeof import('../components/Dialog')>('../components/Dialog')
  return {
    ...actual,
    useDialog: () => ({
      showConfirm: vi.fn(async () => true),
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

const unsubscribe = vi.fn()

const fileApi = {
  openProject: vi.fn(async () => null),
  openProjectByPath: vi.fn(async () => '/should-not-open'),
  closeProject: vi.fn(async () => true),
  getLastProjectPath: vi.fn(async () => '/previous-project'),
  readDirectory: vi.fn(async () => []),
  onProjectChanged: vi.fn(() => unsubscribe)
}

beforeEach(() => {
  vi.clearAllMocks()
  // Extend the existing window rather than replacing it: `vi.stubGlobal('window',
  // …)` would destroy React's DOM internals.
  ;(window as any).api = {
    file: fileApi,
    logging: { log: vi.fn() }
  }
})

afterEach(() => {
  // Deleted, not set to `undefined`: `window.api = undefined` leaves the
  // property in place, so a later `'api' in window` / optional-chaining probe
  // still sees a bridge that is not there.
  delete (window as any).api
})

describe('useProjectManagement — no auto-load of the last project', () => {
  it('marks the initial load complete on mount and never enters a loading state', () => {
    const { result, rerender } = renderHook(() => useProjectManagement())

    // Nothing is awaited, so the hook never shows a spinner on mount.
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()

    // `initialLoadComplete` is backed by a ref the mount effect flips; the
    // flag is therefore observable from the next render onwards.
    rerender()
    expect(result.current.initialLoadComplete).toBe(true)
  })

  it('opens no project on mount', () => {
    const { result } = renderHook(() => useProjectManagement())

    expect(fileApi.getLastProjectPath).not.toHaveBeenCalled()
    expect(fileApi.readDirectory).not.toHaveBeenCalled()
    expect(fileApi.openProject).not.toHaveBeenCalled()
    expect(fileApi.openProjectByPath).not.toHaveBeenCalled()

    expect(result.current.projectPath).toBeNull()
    expect(result.current.files).toEqual([])
  })

  it('only subscribes to project-changed notifications on mount', () => {
    const { unmount } = renderHook(() => useProjectManagement())

    expect(fileApi.onProjectChanged).toHaveBeenCalledTimes(1)

    unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('still opens nothing when remounted (post-restart simulation)', () => {
    renderHook(() => useProjectManagement()).unmount()
    const { result, rerender } = renderHook(() => useProjectManagement())
    rerender()

    expect(fileApi.getLastProjectPath).not.toHaveBeenCalled()
    expect(fileApi.readDirectory).not.toHaveBeenCalled()
    expect(result.current.projectPath).toBeNull()
    expect(result.current.initialLoadComplete).toBe(true)
  })
})
