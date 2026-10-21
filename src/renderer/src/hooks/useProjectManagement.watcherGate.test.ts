// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useProjectManagement — directory-watcher gate (#211, D12)
 *
 * `initialLoadComplete` gates `useDirectoryWatcher`. It is
 * `projectPath !== null && !firstReadPending`: the watcher starts only once the
 * first tree read of the current project has settled (success or failure), so
 * the watcher's own walk never runs alongside the first tree read of a large
 * project. These tests pin every path that sets `projectPath` (risk R10):
 * open, failure, switch, superseded load, close, the IPC reply landing while
 * the listener's read is pending (M1), and main's no-op re-open.
 *
 * Every `readDirectory` call returns its own deferred, settled by the test.
 * No timers and no wall-clock waits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { FileNode } from '../interfaces/IProjectTreeApi'
import { useProjectManagement } from './useProjectManagement'

const mocks = vi.hoisted(() => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  },
  showGlobalToast: vi.fn(),
  openProjectWithTokenGuard: vi.fn(),
  closeProjectWithTokenGuard: vi.fn()
}))

vi.mock('../utils/logger', () => ({ logger: mocks.logger }))

vi.mock('../components/Toast/toastService', () => ({
  showGlobalToast: mocks.showGlobalToast
}))

vi.mock('../components/Dialog', () => ({
  useDialog: () => ({ showConfirm: vi.fn(async () => true) })
}))

vi.mock('../components/ProjectTree/switchHelpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/ProjectTree/switchHelpers')>()),
  checkHasDirtyEditors: vi.fn(async () => false),
  checkTerminalBusy: vi.fn(async () => false),
  openProjectWithTokenGuard: mocks.openProjectWithTokenGuard,
  closeProjectWithTokenGuard: mocks.closeProjectWithTokenGuard
}))

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

interface ReadCall {
  path: string
  gate: Deferred<FileNode[]>
}

type ProjectChangedListener = (data: { oldPath: string | null; newPath: string | null }) => unknown

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const tree = (root: string, ...names: string[]): FileNode[] =>
  names.map((name) => ({ name, path: `${root}/${name}`, type: 'file' as const, extension: '.md' }))

let reads: ReadCall[]
let projectChangedListener: ProjectChangedListener | null

/** Drain queued promise reactions without touching any clock. */
async function flushMicrotasks(ticks = 20): Promise<void> {
  for (let tick = 0; tick < ticks; tick++) {
    await Promise.resolve()
  }
}

/** Fire the main-process project-changed event; returns the listener's promise. */
function emitProjectChanged(newPath: string | null, oldPath: string | null = null): Promise<void> {
  let done: Promise<void> = Promise.resolve()
  act(() => {
    done = Promise.resolve(projectChangedListener?.({ oldPath, newPath })).then(() => undefined)
  })
  return done
}

/** Resolve (or reject) a read inside act and let everything depending on it run. */
async function settle(read: ReadCall, outcome: FileNode[] | Error, ...waitFor: Array<Promise<unknown>>): Promise<void> {
  await act(async () => {
    if (outcome instanceof Error) read.gate.reject(outcome)
    else read.gate.resolve(outcome)
    await Promise.all(waitFor)
    await flushMicrotasks()
  })
}

/** Open `path` through the listener and let its first read succeed. */
async function openViaListener(path: string): Promise<void> {
  const done = emitProjectChanged(path)
  await settle(reads[reads.length - 1], tree(path, 'a.md'), done)
}

beforeEach(() => {
  vi.clearAllMocks()
  reads = []
  projectChangedListener = null
  // Extend the existing window rather than replacing it: `vi.stubGlobal('window',
  // …)` would destroy React's DOM internals.
  ;(window as any).api = {
    file: {
      openProject: vi.fn(async () => null),
      openProjectByPath: vi.fn(async () => null),
      closeProject: vi.fn(async () => true),
      getLastProjectPath: vi.fn(async () => null),
      readDirectory: vi.fn((path: string) => {
        const gate = deferred<FileNode[]>()
        reads.push({ path, gate })
        return gate.promise
      }),
      onProjectChanged: vi.fn((listener: ProjectChangedListener) => {
        projectChangedListener = listener
        return () => {}
      })
    },
    logging: { log: vi.fn() }
  }
})

afterEach(() => {
  mocks.openProjectWithTokenGuard.mockReset()
  mocks.closeProjectWithTokenGuard.mockReset()
  delete (window as any).api
})

describe('useProjectManagement.initialLoadComplete – watcher gate (#211)', () => {
  it('is false while no project is open', () => {
    const { result, rerender } = renderHook(() => useProjectManagement())
    rerender()
    expect(result.current.initialLoadComplete).toBe(false)
  })

  it('is false while the first read is pending and true once it succeeds', async () => {
    const { result } = renderHook(() => useProjectManagement())
    const done = emitProjectChanged('/proj')

    // The same render that sets the path already has the gate closed.
    expect(result.current.projectPath).toBe('/proj')
    expect(result.current.initialLoadComplete).toBe(false)

    await settle(reads[0], tree('/proj', 'a.md'), done)
    expect(result.current.initialLoadComplete).toBe(true)
  })

  it('opens after a failed first read, so the watcher can still heal the tree', async () => {
    const { result } = renderHook(() => useProjectManagement())
    const done = emitProjectChanged('/proj')
    expect(result.current.initialLoadComplete).toBe(false)

    await settle(reads[0], new Error('EACCES'), done)
    expect(result.current.error).toBe('EACCES')
    expect(result.current.initialLoadComplete).toBe(true)
  })

  it('closes again on a switch and opens only after the new project’s first read', async () => {
    const { result } = renderHook(() => useProjectManagement())
    await openViaListener('/projA')
    expect(result.current.initialLoadComplete).toBe(true)

    const done = emitProjectChanged('/projB', '/projA')
    expect(result.current.initialLoadComplete).toBe(false)

    await settle(reads[1], tree('/projB', 'b.md'), done)
    expect(result.current.projectPath).toBe('/projB')
    expect(result.current.initialLoadComplete).toBe(true)
  })

  it('stays closed when a superseded load settles, and opens with the newer load', async () => {
    const { result } = renderHook(() => useProjectManagement())
    const doneA = emitProjectChanged('/projA')
    const doneB = emitProjectChanged('/projB', '/projA')

    // A lands first – success or failure, it no longer owns the gate.
    await settle(reads[0], tree('/projA', 'a.md'), doneA)
    expect(result.current.initialLoadComplete).toBe(false)

    await settle(reads[1], tree('/projB', 'b.md'), doneB)
    expect(result.current.initialLoadComplete).toBe(true)
  })

  it('stays closed when a superseded load fails', async () => {
    const { result } = renderHook(() => useProjectManagement())
    const doneA = emitProjectChanged('/projA')
    const doneB = emitProjectChanged('/projB', '/projA')

    await settle(reads[0], new Error('ENOENT'), doneA)
    expect(result.current.initialLoadComplete).toBe(false)

    await settle(reads[1], tree('/projB', 'b.md'), doneB)
    expect(result.current.initialLoadComplete).toBe(true)
  })

  it('stays closed when the open reply lands while the listener read is pending (M1)', async () => {
    let listenerDone: Promise<unknown> = Promise.resolve()
    mocks.openProjectWithTokenGuard.mockImplementation(
      async (_tokenRef: unknown, setPath: (path: string) => void) => {
        // Main broadcasts project-changed before it replies to the open call.
        listenerDone = Promise.resolve(projectChangedListener?.({ oldPath: null, newPath: '/proj' }))
        setPath('/proj')
        return '/proj'
      }
    )
    const { result } = renderHook(() => useProjectManagement())

    await act(async () => {
      await result.current.handleOpenProject()
    })
    expect(result.current.projectPath).toBe('/proj')
    expect(reads.map((read) => read.path)).toEqual(['/proj'])
    expect(result.current.initialLoadComplete).toBe(false)

    await settle(reads[0], tree('/proj', 'a.md'), listenerDone)
    expect(result.current.initialLoadComplete).toBe(true)
  })

  it('opens at once after main’s no-op re-open (no project-changed event follows)', async () => {
    mocks.openProjectWithTokenGuard.mockImplementation(
      async (_tokenRef: unknown, setPath: (path: string) => void) => {
        setPath('/PROJ')
        return '/PROJ'
      }
    )
    const { result } = renderHook(() => useProjectManagement())
    await openViaListener('/proj')

    await act(async () => {
      await result.current.handleOpenProject()
    })
    expect(result.current.projectPath).toBe('/PROJ')
    // No read is coming for this scope, so the gate must not wait for one.
    expect(reads).toHaveLength(1)
    expect(result.current.initialLoadComplete).toBe(true)
  })

  it('stays closed until the replacement read settles when the open helper supersedes a pending load', async () => {
    mocks.openProjectWithTokenGuard.mockImplementation(
      async (_tokenRef: unknown, setPath: (path: string) => void) => {
        setPath('/PROJ')
        return '/PROJ'
      }
    )
    const { result } = renderHook(() => useProjectManagement())
    const openDone = emitProjectChanged('/proj')

    await act(async () => {
      await result.current.handleOpenProject()
    })
    expect(reads.map((read) => read.path)).toEqual(['/proj', '/PROJ'])

    // The superseded listener load landing first leaves the gate closed.
    await settle(reads[0], tree('/proj', 'a.md'), openDone)
    expect(result.current.initialLoadComplete).toBe(false)

    await settle(reads[1], new Error('EACCES'))
    expect(result.current.initialLoadComplete).toBe(true)
  })

  it('is false after an external close, even with a load still pending', async () => {
    const { result } = renderHook(() => useProjectManagement())
    await openViaListener('/projA')
    expect(result.current.initialLoadComplete).toBe(true)

    const doneB = emitProjectChanged('/projB', '/projA')
    void emitProjectChanged(null, '/projB')
    expect(result.current.projectPath).toBeNull()
    expect(result.current.initialLoadComplete).toBe(false)

    await settle(reads[1], tree('/projB', 'b.md'), doneB)
    expect(result.current.initialLoadComplete).toBe(false)
  })

  it('is false after a close through the close helper', async () => {
    mocks.closeProjectWithTokenGuard.mockImplementation(
      async (_tokenRef: unknown, setPath: (path: string | null) => void) => {
        setPath(null)
        return true
      }
    )
    const { result } = renderHook(() => useProjectManagement())
    await openViaListener('/proj')
    expect(result.current.initialLoadComplete).toBe(true)

    await act(async () => {
      await result.current.handleCloseProject()
    })
    expect(result.current.projectPath).toBeNull()
    expect(result.current.initialLoadComplete).toBe(false)
  })
})
