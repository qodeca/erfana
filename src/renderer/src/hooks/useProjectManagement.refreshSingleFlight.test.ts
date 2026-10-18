// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useProjectManagement — single-flight refresh and stale-result dropping (#208)
 *
 * `refreshFiles` used to start a new full-tree read on every call; on a huge,
 * churning project those reads piled up until main ran out of heap. These
 * tests pin the renderer half of the fix: at most one refresh read at a time
 * per project scope, one follow-up read for every call made meanwhile, and a
 * tree that never goes backwards – not after a newer read, a project switch, a
 * close, or a call from a caller that belongs to an older project.
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

const REFRESHED = '[useProjectManagement] File tree refreshed'
const LOADED = '[useProjectManagement] File tree loaded'

let reads: ReadCall[]
let projectChangedListener: ProjectChangedListener | null
let readDirectory: ReturnType<typeof vi.fn>

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

/** Open `path` through the listener and let its initial read finish with `files`. */
async function openViaListener(path: string, files: FileNode[]): Promise<void> {
  const done = emitProjectChanged(path)
  const read = reads[reads.length - 1]
  expect(read.path).toBe(path)
  await act(async () => {
    read.gate.resolve(files)
    await done
  })
}

/** Settle a read inside act and wait for whatever depends on it. */
async function settle(read: ReadCall, files: FileNode[], ...waitFor: Array<Promise<unknown>>): Promise<void> {
  await act(async () => {
    read.gate.resolve(files)
    await Promise.all(waitFor)
    await flushMicrotasks()
  })
}

function infoLogs(message: string): Array<Record<string, unknown>> {
  return mocks.logger.info.mock.calls
    .filter(([logged]) => logged === message)
    .map(([, context]) => context as Record<string, unknown>)
}

const refreshedLogs = (): Array<Record<string, unknown>> => infoLogs(REFRESHED)
const loadedLogs = (): Array<Record<string, unknown>> => infoLogs(LOADED)

function toastTitles(): string[] {
  return mocks.showGlobalToast.mock.calls.map(([toast]) => (toast as { title: string }).title)
}

beforeEach(() => {
  vi.clearAllMocks()
  reads = []
  projectChangedListener = null
  readDirectory = vi.fn((path: string) => {
    const gate = deferred<FileNode[]>()
    reads.push({ path, gate })
    return gate.promise
  })
  // Extend the existing window rather than replacing it: `vi.stubGlobal('window',
  // …)` would destroy React's DOM internals.
  ;(window as any).api = {
    file: {
      openProject: vi.fn(async () => null),
      openProjectByPath: vi.fn(async () => null),
      closeProject: vi.fn(async () => true),
      getLastProjectPath: vi.fn(async () => null),
      readDirectory,
      onProjectChanged: vi.fn((listener: ProjectChangedListener) => {
        projectChangedListener = listener
        return () => {}
      })
    },
    logging: { log: vi.fn() }
  }
})

afterEach(() => {
  mocks.logger.info.mockReset()
  mocks.logger.error.mockReset()
  mocks.openProjectWithTokenGuard.mockReset()
  delete (window as any).api
})

describe('useProjectManagement.refreshFiles – single flight (#208)', () => {
  it('AC2: calls made during a read share one follow-up read', async () => {
    const { result } = renderHook(() => useProjectManagement())
    await openViaListener('/proj', tree('/proj', 'a.md'))
    expect(reads).toHaveLength(1)

    const first = result.current.refreshFiles()
    const second = result.current.refreshFiles()
    const third = result.current.refreshFiles()
    expect(reads).toHaveLength(2)

    await settle(reads[1], tree('/proj', 'a.md'), first)
    expect(reads).toHaveLength(3)
    await settle(reads[2], tree('/proj', 'a.md'), second, third)
    expect(reads).toHaveLength(3)

    // A burst of five during a read still costs exactly one follow-up read.
    const leading = result.current.refreshFiles()
    const burst = Array.from({ length: 5 }, () => result.current.refreshFiles())
    await settle(reads[3], tree('/proj', 'a.md'), leading)
    await settle(reads[4], tree('/proj', 'a.md'), ...burst)
    expect(reads).toHaveLength(5)
    expect(refreshedLogs().map(({ followUp, callers }) => ({ followUp, callers }))).toEqual([
      { followUp: false, callers: 1 },
      { followUp: true, callers: 2 },
      { followUp: false, callers: 1 },
      { followUp: true, callers: 5 }
    ])
  })

  it('AC3: a mid-flight caller resolves only after the follow-up read and sees the new file', async () => {
    const { result } = renderHook(() => useProjectManagement())
    await openViaListener('/proj', tree('/proj', 'a.md'))

    const first = result.current.refreshFiles()
    let joinerDone = false
    const joiner = result.current.refreshFiles().then(() => {
      joinerDone = true
    })

    await settle(reads[1], tree('/proj', 'a.md'), first)
    expect(joinerDone).toBe(false)

    const withNewFile = tree('/proj', 'a.md', 'new.md')
    await settle(reads[2], withNewFile, joiner)
    expect(joinerDone).toBe(true)
    expect(result.current.files).toBe(withNewFile)
  })

  it('AC6: sequential refreshes each read at once', async () => {
    const { result } = renderHook(() => useProjectManagement())
    await openViaListener('/proj', tree('/proj', 'a.md'))

    for (let call = 0; call < 3; call++) {
      const refresh = result.current.refreshFiles()
      expect(reads).toHaveLength(call + 2)
      expect(reads[call + 1].path).toBe('/proj')
      await settle(reads[call + 1], tree('/proj', `v${call}.md`), refresh)
    }

    expect(refreshedLogs()).toEqual(
      Array.from({ length: 3 }, () =>
        expect.objectContaining({ followUp: false, callers: 1, applied: true })
      )
    )
  })

  it('AC6: makes no read when no project is open', async () => {
    const { result } = renderHook(() => useProjectManagement())

    await act(async () => {
      await result.current.refreshFiles()
    })

    expect(readDirectory).not.toHaveBeenCalled()
  })
})

describe('useProjectManagement – stale results are dropped (#208)', () => {
  it('AC4: keeps the newer project when an older refresh resolves after a switch', async () => {
    const { result } = renderHook(() => useProjectManagement())
    await openViaListener('/projA', tree('/projA', 'a.md'))
    const refreshA = result.current.refreshFiles()
    const lateRead = reads[1]

    const treeB = tree('/projB', 'b.md')
    await openViaListener('/projB', treeB)
    expect(result.current.files).toBe(treeB)

    await settle(lateRead, tree('/projA', 'a.md', 'late.md'), refreshA)

    expect(result.current.files).toBe(treeB)
    expect(refreshedLogs()).toEqual([expect.objectContaining({ applied: false })])
  })

  it('AC4: drops a late result after a close, and the queued follow-up makes no read', async () => {
    const { result } = renderHook(() => useProjectManagement())
    await openViaListener('/proj', tree('/proj', 'a.md'))
    const inFlight = result.current.refreshFiles()
    const queued = result.current.refreshFiles()
    expect(reads).toHaveLength(2)

    await emitProjectChanged(null, '/proj')
    expect(result.current.files).toEqual([])

    await settle(reads[1], tree('/proj', 'a.md', 'late.md'), inFlight, queued)

    expect(result.current.files).toEqual([])
    expect(result.current.projectPath).toBeNull()
    expect(reads).toHaveLength(2)
  })

  it('AC4: keeps a newer refresh tree when the older initial load resolves last', async () => {
    const { result } = renderHook(() => useProjectManagement())
    const openDone = emitProjectChanged('/proj')
    const initialRead = reads[0]

    const refresh = result.current.refreshFiles()
    expect(reads).toHaveLength(2)
    const newer = tree('/proj', 'a.md', 'b.md')
    await settle(reads[1], newer, refresh)
    expect(result.current.files).toBe(newer)

    await settle(initialRead, tree('/proj', 'a.md'), openDone)

    expect(result.current.files).toBe(newer)
    expect(result.current.loading).toBe(false)
    // The load line records that its older tree was not shown.
    expect(loadedLogs()).toEqual([expect.objectContaining({ applied: false })])
  })

  it('AC4: rapid A→B shows B, no toast for A, and the spinner stops with B', async () => {
    const { result } = renderHook(() => useProjectManagement())
    const openA = emitProjectChanged('/projA')
    const readA = reads[0]
    const openB = emitProjectChanged('/projB', '/projA')
    const readB = reads[1]
    expect(result.current.loading).toBe(true)

    const treeB = tree('/projB', 'b.md')
    await settle(readB, treeB, openB)
    expect(result.current.files).toBe(treeB)
    expect(result.current.loading).toBe(false)

    await settle(readA, tree('/projA', 'a.md'), openA)

    expect(result.current.files).toBe(treeB)
    expect(result.current.loading).toBe(false)
    const opened = mocks.showGlobalToast.mock.calls
      .map(([toast]) => toast as { title: string; message: string })
      .filter((toast) => toast.title === 'Project Opened')
    expect(opened.map((toast) => toast.message)).toEqual(['/projB'])
    // Only B's load reaches the "loaded" line; A's is logged as dropped.
    expect(loadedLogs()).toEqual([expect.objectContaining({ applied: true })])
  })

  it('AC4: a superseded load that fails shows no error', async () => {
    const { result } = renderHook(() => useProjectManagement())
    const openA = emitProjectChanged('/projA')
    const readA = reads[0]
    await openViaListener('/projB', tree('/projB', 'b.md'))

    await act(async () => {
      readA.gate.reject(new Error('EACCES'))
      await openA
    })

    expect(result.current.error).toBeNull()
    expect(toastTitles()).not.toContain('Failed to Load Project')
    expect(mocks.logger.error).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })

  it('AC4: a close during a pending open stops the spinner and shows no tree', async () => {
    const { result } = renderHook(() => useProjectManagement())
    const openA = emitProjectChanged('/projA')
    expect(result.current.loading).toBe(true)

    await emitProjectChanged(null, '/projA')
    expect(result.current.loading).toBe(false)

    await settle(reads[0], tree('/projA', 'a.md'), openA)

    expect(result.current.files).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(toastTitles()).not.toContain('Project Opened')
  })

  it('does not block the new project behind an old project’s refresh read', async () => {
    const { result } = renderHook(() => useProjectManagement())
    await openViaListener('/projA', tree('/projA', 'a.md'))
    const refreshA = result.current.refreshFiles()
    const readA = reads[1]
    await openViaListener('/projB', tree('/projB', 'b.md'))

    const refreshB = result.current.refreshFiles()
    expect(reads).toHaveLength(4)
    expect(reads[3].path).toBe('/projB')

    const treeB2 = tree('/projB', 'b.md', 'c.md')
    await settle(reads[3], treeB2, refreshB)
    expect(result.current.files).toBe(treeB2)

    await settle(readA, tree('/projA', 'a.md', 'late.md'), refreshA)
    expect(result.current.files).toBe(treeB2)
  })

  it('skips a refresh from a caller that belongs to a project no longer open', async () => {
    const { result } = renderHook(() => useProjectManagement())
    await openViaListener('/projA', tree('/projA', 'a.md'))
    const staleRefresh = result.current.refreshFiles
    const treeB = tree('/projB', 'b.md')
    await openViaListener('/projB', treeB)
    const readsBefore = reads.length

    await act(async () => {
      await staleRefresh()
    })

    expect(reads).toHaveLength(readsBefore)
    expect(result.current.files).toBe(treeB)
  })

  it('reloads the tree and ends the spinner when the open helper supersedes a pending load', async () => {
    // Main treats the same project re-opened through another string as a
    // no-op and sends no project-changed event, so nothing else would load it.
    mocks.openProjectWithTokenGuard.mockImplementation(
      async (_tokenRef: unknown, setPath: (path: string) => void) => {
        setPath('/PROJ')
        return '/PROJ'
      }
    )
    const { result } = renderHook(() => useProjectManagement())
    const openDone = emitProjectChanged('/proj')
    expect(result.current.loading).toBe(true)

    await act(async () => {
      await result.current.handleOpenProject()
    })
    expect(result.current.projectPath).toBe('/PROJ')
    // One replacement read in the new scope; the spinner stays on for it.
    expect(reads.map((read) => read.path)).toEqual(['/proj', '/PROJ'])
    expect(result.current.loading).toBe(true)

    const reloaded = tree('/PROJ', 'a.md')
    await settle(reads[1], reloaded)
    expect(result.current.files).toBe(reloaded)
    expect(result.current.loading).toBe(false)

    // The superseded load landing later changes nothing.
    await settle(reads[0], tree('/proj', 'a.md'), openDone)
    expect(result.current.files).toBe(reloaded)
    expect(result.current.loading).toBe(false)
    expect(reads).toHaveLength(2)
  })

  it('ends the spinner when the replacement read fails', async () => {
    mocks.openProjectWithTokenGuard.mockImplementation(
      async (_tokenRef: unknown, setPath: (path: string) => void) => {
        setPath('/PROJ')
        return '/PROJ'
      }
    )
    const { result } = renderHook(() => useProjectManagement())
    void emitProjectChanged('/proj')
    await act(async () => {
      await result.current.handleOpenProject()
    })

    await act(async () => {
      reads[1].gate.reject(new Error('EACCES'))
      await flushMicrotasks()
    })

    expect(result.current.loading).toBe(false)
    expect(mocks.logger.error).toHaveBeenCalledWith('Error refreshing file tree:', expect.any(Error))
  })

  it.each([
    ['the project-changed event arrives first (main sends it before replying)', true],
    ['the open reply arrives first', false]
  ])('a normal open adds no read of its own when %s', async (_order, eventFirst) => {
    let listenerDone: Promise<unknown> = Promise.resolve()
    const emit = (): void => {
      listenerDone = Promise.resolve(projectChangedListener?.({ oldPath: '/projA', newPath: '/projB' }))
    }
    mocks.openProjectWithTokenGuard.mockImplementation(
      async (_tokenRef: unknown, setPath: (path: string) => void) => {
        if (eventFirst) emit()
        setPath('/projB')
        if (!eventFirst) emit()
        return '/projB'
      }
    )
    const { result } = renderHook(() => useProjectManagement())
    await openViaListener('/projA', tree('/projA', 'a.md'))

    await act(async () => {
      await result.current.handleOpenProject()
    })

    // Only the listener's own load of B – no extra read from the helper.
    expect(reads.map((read) => read.path)).toEqual(['/projA', '/projB'])
    const treeB = tree('/projB', 'b.md')
    await settle(reads[1], treeB, listenerDone)
    expect(result.current.files).toBe(treeB)
    expect(result.current.loading).toBe(false)
    expect(reads).toHaveLength(2)
  })

  it('reads the project the UI shows even if the project-changed event never arrives', async () => {
    mocks.openProjectWithTokenGuard.mockImplementation(
      async (_tokenRef: unknown, setPath: (path: string) => void) => {
        setPath('/projB')
        return '/projB'
      }
    )
    const { result } = renderHook(() => useProjectManagement())
    await openViaListener('/projA', tree('/projA', 'a.md'))

    await act(async () => {
      await result.current.handleOpenProject()
    })
    expect(result.current.projectPath).toBe('/projB')

    const refresh = result.current.refreshFiles()
    expect(reads[reads.length - 1].path).toBe('/projB')
    const treeB = tree('/projB', 'b.md')
    await settle(reads[reads.length - 1], treeB, refresh)

    expect(result.current.files).toBe(treeB)
  })
})

describe('useProjectManagement.refreshFiles – error contract (#208)', () => {
  it('resolves when the read fails, logs it, still serves joiners, and reads again next time', async () => {
    const { result } = renderHook(() => useProjectManagement())
    await openViaListener('/proj', tree('/proj', 'a.md'))

    const first = result.current.refreshFiles()
    const joiner = result.current.refreshFiles()
    await act(async () => {
      reads[1].gate.reject(new Error('EACCES'))
      await expect(first).resolves.toBeUndefined()
    })
    expect(mocks.logger.error).toHaveBeenCalledWith('Error refreshing file tree:', expect.any(Error))

    expect(reads).toHaveLength(3)
    const recovered = tree('/proj', 'a.md', 'b.md')
    await settle(reads[2], recovered, joiner)
    expect(result.current.files).toBe(recovered)

    const next = result.current.refreshFiles()
    expect(reads).toHaveLength(4)
    await settle(reads[3], recovered, next)
  })

  it('never rejects, even when logging inside the read throws', async () => {
    const { result } = renderHook(() => useProjectManagement())
    await openViaListener('/proj', tree('/proj', 'a.md'))
    mocks.logger.info.mockImplementation((message: string) => {
      if (message === REFRESHED) throw new Error('logger broke')
    })
    mocks.logger.error.mockImplementation(() => {
      throw new Error('error logger broke too')
    })

    const refresh = result.current.refreshFiles()
    await act(async () => {
      reads[1].gate.resolve(tree('/proj', 'a.md'))
      await expect(refresh).resolves.toBeUndefined()
    })

    // The runner is idle again: the next call reads at once.
    const next = result.current.refreshFiles()
    expect(reads).toHaveLength(3)
    await act(async () => {
      reads[2].gate.resolve([])
      await expect(next).resolves.toBeUndefined()
    })
  })
})
